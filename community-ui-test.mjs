import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile,mkdir} from 'node:fs/promises';
import trial from './trial-worker.mjs';
import {RELEASE} from './worker.mjs';
process.env.TRIAL_UI_FIXTURE='1';
const {trialFixture}=await import('./trial-test.mjs');
const {database:db,env,invites,client}=await trialFixture();env.CLOUD_ENCRYPTION_KEY='12'.repeat(32);
env.ASSETS={async fetch(request){const name=new URL(request.url).pathname.slice(1)||'index.html';return new Response(await readFile(new URL(`./static/${name}`,import.meta.url)),{headers:{'Content-Type':name.endsWith('.html')?'text/html':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'image/svg+xml'}});}};
const server=createServer(async(req,res)=>{const r=await trial.fetch(new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})}),env);res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));});
server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://localhost:${server.address().port}`;
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),browser=await chromium.launch({headless:true}),errors=[];
try{
  const admin=client(),user=client();
  for(const [i,c] of [admin,user].entries())await c.api('/api/register','POST',{username:i?'student':'admin',password:'Ab1234',invite:invites[i]});
  await user.api('/api/source-links','PUT',{urls:['https://smartestu.cn/assignment']});
  const soon=new Date(Date.now()+86400000).toISOString(),end=new Date(Date.now()+90000000).toISOString();
  for(const category of ['作业','考试','会议','活动'])await user.api('/api/tasks','POST',{title:`近期${category}`,category,due_at:soon,starts_at:soon,ends_at:end});
  await user.api('/api/tasks','POST',{title:'不应提醒的已完成作业',due_at:soon,status:'done'});
  for(const [status,date] of [['todo','2026-01-01T00:00:00Z'],['todo',soon],['done',soon]])await user.api('/api/tasks','POST',{category:'课程',title:'仅作课表安排',starts_at:date,ends_at:date,status});
  db.prepare("INSERT INTO u2_settings(key,value) VALUES ('cloud_enabled','1'),('cloud_state_smartestu',?)").run(JSON.stringify({authorized:true,error_code:'auth_expired',auth_expired_at:new Date().toISOString(),error:'登录过期'}));
  await admin.api('/api/announcements','POST',{body:'测试公告：欢迎提出建议 <script>错误脚本</script>',client_id:crypto.randomUUID()});
  async function login(username,mobile){
    const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:!!mobile,hasTouch:!!mobile});
    await context.addInitScript(()=>{localStorage.setItem('ruchecklist-demo-disabled','true');});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin);await page.locator('#username').fill(username);await page.locator('#password').fill('Ab1234');await page.locator('#login-form button[type=submit]').click();await page.locator('#messages-dialog').waitFor();return page;
  }
  await mkdir('data/screenshots',{recursive:true});const phone=await login('student',true);
  assert.equal(await phone.evaluate(()=>needsLogin({id:'yoj',error:'登录已失效，请重新登录'})),true);
  assert.equal(await phone.evaluate(()=>needsLogin({id:'yoj',error:'未识别到作业列表，请确认已登录'})),false);
  assert.equal(await phone.locator('#messages-content .message-task').count(),4);
  assert.equal(await phone.locator('#messages-content .expired-site').count(),1);
  assert.equal(await phone.locator('#messages-content script').count(),0);
  assert.match(await phone.locator('#messages-content').textContent(),/测试公告/);
  await phone.screenshot({animations:"disabled",path:'data/screenshots/messages-mobile.png'});
  await phone.locator('#messages-read').click();await phone.locator('#messages-dialog').waitFor({state:'hidden'});if(await phone.locator('#demo-dialog').isVisible())await phone.locator('#demo-skip').click();
  assert.equal(await phone.locator('.sidebar-bottom > button').count(),3);
  assert.equal(await phone.locator('#user-card-name').textContent(),'student');
  assert.equal(await phone.locator('#app-version').textContent(),'v3.1.2');
  assert.deepEqual(await phone.locator('#count-open,#count-soon,#count-overdue,#count-done').allTextContents(),['4','4','0','1']);
  assert.equal(await phone.locator('#categories button').first().locator('.count').textContent(),'4');
  await phone.locator('#user-menu-toggle').click();await phone.locator('#user-menu').waitFor();
  const menuBox=await phone.locator('#user-menu').boundingBox();assert.ok(menuBox.x>=0&&menuBox.x+menuBox.width<=390&&menuBox.y>=0&&menuBox.y+menuBox.height<=844);
  await phone.screenshot({animations:"disabled",path:'data/screenshots/account-menu-mobile.png'});await phone.keyboard.press('Escape');await phone.locator('#user-menu').waitFor({state:'hidden'});
  assert.equal(await phone.locator('#user-menu-toggle').getAttribute('aria-expanded'),'false');
  assert.equal((await user.api('/api/notices')).data.unread,false);assert.ok((await user.api('/api/announcements')).data.last_read>0);
  await accountEntry(phone,'feedback-button');await phone.locator('#chat-input').fill('手机端反馈：希望优化课表。');await phone.locator('#chat-send').click();await phone.locator('.chat-bubble').filter({hasText:'手机端反馈'}).waitFor();
  const desktop=await login('admin',false);await desktop.locator('#messages-read').click();await desktop.locator('#messages-dialog').waitFor({state:'hidden'});if(await desktop.locator('#demo-dialog').isVisible())await desktop.locator('#demo-skip').click();
  assert.equal(await desktop.locator('#feedback-button span').textContent(),'公告与答疑');
  await desktop.locator('#user-menu-toggle').click();await desktop.locator('#user-menu').waitFor();await desktop.screenshot({animations:"disabled",path:'data/screenshots/account-menu-desktop.png'});await desktop.locator('#view-title').click();await desktop.locator('#user-menu').waitFor({state:'hidden'});
  await desktop.emulateMedia({reducedMotion:'reduce'});await desktop.locator('#categories button').filter({has:desktop.locator('span',{hasText:/^活动$/})}).click();
  assert.equal(await desktop.locator('#board').evaluate(el=>el.getAnimations().length),0);
  await accountEntry(desktop,'feedback-button');await desktop.locator('.chat-thread').filter({hasText:'student'}).click();await desktop.locator('.chat-bubble').filter({hasText:'手机端反馈'}).waitFor();
  await desktop.locator('#chat-input').fill('已收到，感谢反馈。');await desktop.locator('#chat-send').click();await phone.locator('.chat-bubble').filter({hasText:'已收到'}).waitFor();
  await desktop.screenshot({animations:"disabled",path:'data/screenshots/chat-admin-desktop.png'});await phone.screenshot({animations:"disabled",path:'data/screenshots/chat-user-mobile.png'});
  await desktop.setViewportSize({width:390,height:844});await desktop.locator('#chat-back').click();assert.equal(await desktop.locator('#chat-threads').isVisible(),true);assert.equal(await desktop.locator('.chat-main').isVisible(),false);
  await desktop.screenshot({animations:"disabled",path:'data/screenshots/chat-admin-mobile-list.png'});await desktop.locator('.chat-thread').filter({hasText:'发布公告'}).click();
  await desktop.locator('#chat-input').fill('第二条公告：测试手机发布。');await desktop.locator('#chat-send').click();await desktop.locator('.chat-bubble').filter({hasText:'第二条公告'}).waitFor();
  for(const page of [phone,desktop])assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.getElementById('feedback-dialog').scrollWidth<=innerWidth),true);
  await phone.locator('[aria-label="关闭聊天"]').click();await phone.reload();await phone.locator('#messages-dialog').waitFor();assert.match(await phone.locator('#messages-content').textContent(),/第二条公告/);assert.doesNotMatch(await phone.locator('#messages-content').textContent(),/测试公告/);
  await phone.locator('#messages-read').click();await phone.locator('#messages-dialog').waitFor({state:'hidden'});await phone.locator('#categories button').filter({has:phone.locator('span',{hasText:/^活动$/})}).click();
  const card=phone.locator('article.task').first();await card.locator('.archive-task').click();await card.waitFor({state:'hidden'});await accountEntry(phone,'archive-button');await phone.getByRole('button',{name:'恢复归档：近期活动',exact:true}).click();await phone.locator('#archive-list .archive-empty').waitFor();await phone.getByRole('button',{name:'关闭归档',exact:true}).click();await card.waitFor();
  // Deletion is cancellable; the server keeps the task until explicit confirmation.
  await card.locator('.delete-task').click();await phone.locator('#delete-dialog .close-dialog').click();assert.equal(await card.count(),1);
  await card.locator('.edit-task').click();await phone.locator('#add-link').click();const link=phone.locator('.link-edit-row');
  phone.once('dialog',d=>d.dismiss());await phone.getByRole('button',{name:'移除链接',exact:true}).click();assert.equal(await link.count(),1);
  phone.once('dialog',d=>d.accept());await phone.getByRole('button',{name:'移除链接',exact:true}).click();assert.equal(await link.count(),0);
  assert.deepEqual(errors,[]);console.log('PASS: mobile reminders, independent announcement receipts, feedback/replies, admin mobile navigation, archive restore and cancelable removals.');
}finally{await browser.close();server.close();db.close();}

async function accountEntry(page,id){
  if(!await page.locator('#user-menu').isVisible())await page.locator('#user-menu-toggle').click();
  await page.locator('#'+id).click();
}
