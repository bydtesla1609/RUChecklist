// Disposable local database and synthetic cards only; no production requests.
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createEnvironment} from './local.mjs';
import worker,{RELEASE,RELEASES} from './worker.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=resolve(tmpdir()),directory=await mkdtemp(join(root,'rucapture-editor-'));
const {env,database}=await createEnvironment(directory,'isolated-editor-test');env.CLOUD_ENCRYPTION_KEY='12'.repeat(32);
database.prepare("INSERT INTO settings(key,value) VALUES('read_release',?)").run(RELEASE.version);
const server=createServer(async(req,res)=>{
 const result=await worker.fetch(new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})}),env);
 res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
});
server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;let browser;
try{
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await context.addInitScript(()=>localStorage.setItem('ruchecklist-demo:personal','seen'));
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin);await page.locator('#login').waitFor();
 const brandColor=await page.locator('.landing-brand .wordmark b').evaluate(el=>getComputedStyle(el).color);
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 await page.locator('#password').fill('isolated-editor-test');await page.locator('#login-form button[type=submit]').click();await page.locator('#workspace').waitFor();
 assert.equal(await page.locator('.brand .wordmark b').evaluate(el=>getComputedStyle(el).color),brandColor);
 await page.waitForFunction(()=>messageReady);if(await page.locator('#messages-dialog').isVisible())await page.locator('#messages-read').click();
 await mkdir('data/screenshots',{recursive:true});
 // Empty pending columns offer a category-specific entry without preselecting an axis.
 for(const category of ['作业','活动','会议','记录']){
  await page.locator('#categories button').filter({hasText:category}).click();
  assert.equal(await page.locator('#board .empty-add').count(),1);
  await page.locator('#board').getByRole('button',{name:`＋ 添加${category}`,exact:true}).click();
  assert.equal(await page.evaluate(()=>taskCategory),category);assert.equal(await page.locator('#task-axis').inputValue(),'');
  assert.match(await page.locator('label[for=task-axis]').textContent(),/所属轴线/);
  assert.equal(await page.locator('#task-axis option:checked').textContent(),'（无）');
  await page.locator('#task-dialog .close-dialog').first().click();
 }
 const fixture=await page.evaluate(async()=>{
  const axis=await api('/api/axes','POST',{title:'摄影练习'});
  const task=await api('/api/tasks','POST',{category:'记录',title:'虚构的练习记录',starts_at:'2099-10-08T08:00:00Z',axis_id:axis.id,todos:[{id:'one',text:'示例待办',done:false}],links:[{label:'示例链接',url:'https://example.com/fictional'}]});
  await refresh();categoryFilter='全部';overviewView='axes';render();return {axis,task};
 });
 // Start from axes, visit both views (and back), then restore the unsaved layout.
 await page.locator('.axis-head').focus();await page.keyboard.press('ArrowDown');
 const layout=await page.evaluate(()=>JSON.stringify(axisScene));
 await page.locator('#demo-button').click();await page.locator('#demo-progress').filter({hasText:'1 / 9'}).waitFor();
 assert.equal(await page.evaluate(()=>overviewView),'calendar');assert.equal(await page.locator('.calendar-grid').isVisible(),true);
 await page.locator('#demo-next').click();await page.locator('#demo-progress').filter({hasText:'2 / 9'}).waitFor();assert.equal(await page.locator('.axes-canvas').isVisible(),true);
 await page.locator('#demo-prev').click();assert.equal(await page.evaluate(()=>overviewView),'calendar');await page.locator('#demo-skip').click();
 assert.equal(await page.evaluate(()=>overviewView),'axes');assert.equal(await page.evaluate(()=>JSON.stringify(axisScene)),layout);
 // Keep website requests unresolved: 6 -> 7 must render immediately, even on return.
 const pending=[];await page.route('**/api/source-links',route=>pending.push(route));
 await page.locator('#demo-button').click();for(let i=0;i<5;i++)await page.locator('#demo-next').click();
 for(let attempt=0;attempt<3;attempt++){
  await page.locator('#demo-next').click();await page.waitForFunction(()=>document.getElementById('demo-progress').textContent==='7 / 9' && !document.getElementById('demo-next').disabled,null,{timeout:500});
  assert.equal(await page.locator('#website-setup').isVisible(),true);
  await page.locator('#demo-prev').click();assert.equal(await page.locator('#demo-progress').textContent(),'6 / 9');
 }
 await page.locator('#demo-next').click();assert.equal(pending.length,1,'returning to a demo step does not repeat network checks');
 await pending[0].fulfill({contentType:'application/json',body:JSON.stringify({links:Array.from({length:5},(_,i)=>({name:`示例课程 ${i+1}`,url:`https://example.com/course/${i}`,source:'web:https://example.com',generic:true}))})});await page.unroute('**/api/source-links');
 for(const width of [390,768,1440]){
  await page.setViewportSize({width,height:844});
  await page.waitForFunction(()=>{const target=document.getElementById('add-source-link').getBoundingClientRect(),frame=document.getElementById('demo-highlight').getBoundingClientRect(),card=document.getElementById('demo-card').getBoundingClientRect();return target.top>=0 && target.bottom<=innerHeight && Math.abs(frame.top-Math.max(8,target.top-5))<2 && card.right<=innerWidth && card.bottom<=innerHeight;},null,{timeout:2000}).catch(async error=>{console.log(await page.evaluate(()=>Object.fromEntries(['add-source-link','demo-highlight','demo-card','sources-dialog'].map(id=>[id,document.getElementById(id).getBoundingClientRect().toJSON()]))));await page.screenshot({path:'data/screenshots/tour-layout-failure.png'});throw error;});
  await page.screenshot({path:`data/screenshots/tour-step-seven-${width}.png`,animations:'disabled'});
 }
 await page.locator('#demo-skip').click();assert.equal(await page.locator('#sources-dialog').evaluate(el=>el.classList.contains('demo-preview')),false);
 await page.setViewportSize({width:1440,height:1000});
 // A nested card editor must preserve both its draft and the outer axis draft.
 await page.evaluate(id=>openAxis(axes.find(a=>a.id===id)),fixture.axis.id);await page.locator('#axis-title').fill('尚未保存的轴线标题');
 await page.locator('#axis-members').getByRole('button',{name:'编辑',exact:true}).click();
 await page.locator('#task-title').fill('尚未保存的记录标题');await page.locator('#task-content').fill('创建轴线时保留这段草稿。');
 await page.locator('#attachment-input').setInputFiles({name:'虚构附件.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic fixture')});await page.waitForFunction(()=>!uploading && draftAttachments.length===1);
 const draft=await page.evaluate(()=>({todos:draftTodos,attachments:draftAttachments,links:[...document.querySelectorAll('#task-links input')].map(i=>i.value)}));
 const picker=page.locator('#task-axis').locator('..'),create=page.locator('#new-axis-dialog');
 async function openCreate(){await picker.locator('.select-trigger').click();await picker.locator('.select-create-axis').click();await create.waitFor();}
 await openCreate();await page.locator('#new-axis-title').fill('取消的轴线');await create.getByRole('button',{name:'取消',exact:true}).click();
 assert.equal(await page.locator('#task-axis').inputValue(),fixture.axis.id);assert.equal(await page.locator('#task-title').inputValue(),'尚未保存的记录标题');
 assert.equal(await picker.locator('.select-trigger').evaluate(el=>el===document.activeElement),true);
 await openCreate();await page.keyboard.press('Escape');await create.waitFor({state:'hidden'});
 await openCreate();await page.locator('#new-axis-title').fill('新的摄影目标');await page.locator('#new-axis-content').fill('虚构的轴线内容');
 // Server failure stays in the form, retaining all parent fields and resources.
 await page.route('**/api/axes',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'模拟暂时无法保存'})}));
 await page.locator('#new-axis-save').click();await page.locator('#new-axis-error').filter({hasText:'模拟暂时无法保存'}).waitFor();assert.equal(await create.isVisible(),true);
 await page.unroute('**/api/axes');
 for(const width of [320,390,768]){await page.setViewportSize({width,height:844});assert.equal(await create.evaluate(el=>el.scrollWidth<=el.clientWidth && el.getBoundingClientRect().left>=0 && el.getBoundingClientRect().right<=innerWidth),true);}
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'data/screenshots/new-axis-mobile.png',animations:'disabled'});
 await page.locator('#new-axis-save').click();await create.waitFor({state:'hidden'});
 const selected=await page.locator('#task-axis').inputValue();assert.notEqual(selected,fixture.axis.id);assert.notEqual(selected,'');
 assert.equal(await page.locator('#task-axis option:checked').textContent(),'新的摄影目标');
 assert.equal(await page.locator('#task-title').inputValue(),'尚未保存的记录标题');assert.equal(await page.locator('#task-content').inputValue(),'创建轴线时保留这段草稿。');
 assert.deepEqual(await page.evaluate(()=>({todos:draftTodos,attachments:draftAttachments,links:[...document.querySelectorAll('#task-links input')].map(i=>i.value)})),draft);
 assert.equal(database.prepare('SELECT axis_id FROM tasks WHERE id=?').get(fixture.task.id).axis_id,fixture.axis.id,'axis creation must not save the parent card');
 await picker.locator('.select-trigger').click();
 assert.equal(await picker.locator('.select-create-axis').evaluate(el=>{const r=el.getBoundingClientRect(),d=el.closest('dialog').getBoundingClientRect();return r.top>=d.top && r.bottom<=d.bottom && el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));}),true,'create action stays visible in the mobile picker');
 await page.screenshot({path:'data/screenshots/axis-picker-mobile.png',animations:'disabled'});await page.keyboard.press('Escape');
 await page.locator('#save-task').click();await page.locator('#task-dialog').waitFor({state:'hidden'});
 assert.equal(database.prepare('SELECT axis_id FROM tasks WHERE id=?').get(fixture.task.id).axis_id,selected);
 assert.equal(await page.locator('#axis-title').inputValue(),'尚未保存的轴线标题');await page.locator('#axis-dialog .close-dialog').first().click();
 // Long archived titles retain readable width, including desktop-sized narrow dialogs.
 const archived=await page.evaluate(async()=>{
  const card=await api('/api/tasks','POST',{title:'示例数学分析第五次作业与复习安排',category:'作业',due_at:'2099-10-12T08:00:00Z'});
  await api(`/api/tasks/${card.id}/archive`,'PATCH',{archived:true,revision:card.revision});return card.id;
 });
 await page.locator('#user-menu-toggle').click();await page.locator('#archive-button').click();await page.locator('.archive-row').waitFor();
 for(const width of [320,390,768,1024,1440]){
  await page.setViewportSize({width,height:844});
  assert.equal(await page.locator('.archive-row').first().evaluate(row=>{const text=row.querySelector('.archive-info').getBoundingClientRect(),actions=row.querySelector('.task-actions').getBoundingClientRect(),dialog=row.closest('dialog');return text.width>160 && dialog.scrollWidth<=dialog.clientWidth && (text.right<=actions.left || text.bottom<=actions.top);}),true,`archive title/actions fit at ${width}px`);
 }
 await page.screenshot({path:'data/screenshots/archive-responsive-desktop.png',animations:'disabled'});await page.locator('#archive-dialog .close-dialog').first().click();
 assert.equal(database.prepare('SELECT title FROM tasks WHERE id=?').get(archived).title,'示例数学分析第五次作业与复习安排');
 // Only the newest release is shown initially; expanding history does not mark it read.
 await page.locator('#user-menu-toggle').click();await page.locator('#messages-button').click();await page.locator('#messages-dialog').waitFor();
 assert.equal(await page.locator('.release-entry:visible').count(),1);assert.match(await page.locator('.release-entry:visible h4').textContent(),new RegExp(RELEASE.version));
 await page.getByRole('button',{name:'查看更多',exact:true}).click();assert.equal(await page.locator('.release-entry:visible').count(),RELEASES.length);
 assert.match(await page.locator('.release-entry:visible').last().textContent(),/3\.0\.0/);
 for(const width of [320,390,768]){await page.setViewportSize({width,height:844});assert.equal(await page.locator('#messages-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),true);}
 await page.getByRole('button',{name:'收起历史更新',exact:true}).click();assert.equal(await page.locator('.release-entry:visible').count(),1);
 await page.screenshot({path:'data/screenshots/release-history-collapsed.png',animations:'disabled'});
 await page.locator('#messages-read').click();await page.locator('#messages-dialog').waitFor({state:'hidden'});
 await page.locator('#user-menu-toggle').click();await page.locator('#messages-button').click();await page.locator('#messages-dialog').waitFor();assert.equal(await page.locator('.release-entry:visible').count(),1);await page.locator('#messages-read').click();
 await page.setViewportSize({width:390,height:844});
 // Real detector UI, with an isolated extension message double. No auto advance.
 await page.evaluate(()=>addEventListener('message',event=>{if(event.data?.kind==='campus-board-command')postMessage({kind:'campus-board-reply',id:event.data.id,result:{version:'1.9.3',connected:false,enabled:true,sourceResults:{}}},location.origin);}));
 await page.locator('#sources-button').click();await page.locator('#guide-install').waitFor();await page.locator('#collector-recheck').click();
 const notice=page.locator('#guide-install .dialog-notice');await notice.filter({hasText:'扩展已就绪'}).waitFor();
 await notice.scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>{const el=document.querySelector('#guide-install .dialog-notice'),r=el.getBoundingClientRect(),d=el.closest('dialog').getBoundingClientRect();return r.top>=d.top && r.bottom<=d.bottom && el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));},null,{timeout:2000}).catch(async error=>{console.log(await notice.evaluate(el=>({notice:el.getBoundingClientRect().toJSON(),dialog:el.closest('dialog').getBoundingClientRect().toJSON(),hit:document.elementFromPoint(el.getBoundingClientRect().left+20,el.getBoundingClientRect().top+20)?.outerHTML})));await page.screenshot({path:'data/screenshots/detection-notice-failure.png',animations:'disabled'});throw error;});
 assert.equal(await page.evaluate(()=>syncStep),1);assert.equal(await page.locator('#toast').isVisible(),false);
 await page.screenshot({path:'data/screenshots/detection-notice-mobile.png',animations:'disabled'});
 await page.setViewportSize({width:1440,height:1000});await page.locator('#collector-recheck').click();await notice.waitFor();await page.screenshot({path:'data/screenshots/detection-notice-desktop.png',animations:'disabled'});
 assert.deepEqual(errors,[]);
 console.log('PASS: responsive login brand/archive rows/release history; consistent empty boards; immediate repeatable 6→7 tour with delayed network; calendar/axes restoration; nested axis draft/resource preservation; modal detection notice; 320–1440px layouts.');
}finally{
 await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));database.close();
 if(dirname(resolve(directory))!==root)throw Error('Unsafe cleanup path');await rm(directory,{recursive:true,force:true});
}
