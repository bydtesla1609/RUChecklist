// Isolated local fixtures only. Never opens or changes a real account.
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createEnvironment} from './local.mjs';
import worker,{RELEASE} from './worker.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=resolve(tmpdir()),directory=await mkdtemp(join(root,'rucapture-confirm-'));
const {env,database}=await createEnvironment(directory,'isolated-confirm-test');env.CLOUD_ENCRYPTION_KEY='12'.repeat(32);
database.prepare("INSERT INTO settings(key,value) VALUES('read_release',?)").run(RELEASE.version);
const writes=[];
const server=createServer(async(req,res)=>{
 if(!['GET','HEAD'].includes(req.method))writes.push([req.method,req.url]);
 const result=await worker.fetch(new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})}),env);
 res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
});
server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;let browser;
try{
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await context.addInitScript(()=>localStorage.setItem('ruchecklist-demo:personal','seen'));
 const page=await context.newPage(),errors=[],nativeDialogs=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('dialog',async dialog=>{nativeDialogs.push(dialog.message());await dialog.dismiss();});
 await page.goto(origin);await page.locator('#password').fill('isolated-confirm-test');await page.locator('#login-form button[type=submit]').click();await page.locator('#workspace').waitFor();
 await page.waitForFunction(()=>messageReady);if(await page.locator('#messages-dialog').isVisible())await page.locator('#messages-read').click();
 const fixture=await page.evaluate(async()=>{
  const axis=await api('/api/axes','POST',{title:'示例轴线'});
  const task=await api('/api/tasks','POST',{category:'记录',title:'应当保留的卡片',starts_at:'2099-10-08T08:00:00Z',axis_id:axis.id,todos:[{id:'one',text:'保留这条待办',done:false}],links:[{label:'示例资料',url:'https://example.com/fictional'}]});
  await refresh();openAxis(axes.find(item=>item.id===axis.id));return {axis,task};
 });
 const confirm=page.locator('#action-confirm-dialog');
 const deletions=()=>writes.filter(([method])=>method==='DELETE').length;
 await page.locator('#axis-title').fill('尚未保存的标题');
 await page.locator('#axis-delete').click();await confirm.waitFor();assert.equal(deletions(),0);
 assert.equal(await page.locator('#action-confirm-cancel').evaluate(node=>node===document.activeElement),true);
 assert.match(await page.locator('#action-confirm-message').textContent(),/卡片会保留/);
 await page.keyboard.press('Escape');await confirm.waitFor({state:'hidden'});
 assert.equal(await page.locator('#axis-dialog').isVisible(),true);assert.equal(await page.locator('#axis-title').inputValue(),'尚未保存的标题');
 assert.equal(await page.locator('#axis-delete').evaluate(node=>node===document.activeElement),true);assert.equal(deletions(),0);
 await page.locator('#axis-delete').click();await page.locator('#action-confirm-cancel').click();await confirm.waitFor({state:'hidden'});assert.equal(deletions(),0);
 await page.locator('#axis-delete').click();await confirm.waitFor();await mkdir('data/screenshots',{recursive:true});
 await page.screenshot({path:'data/screenshots/confirm-axis-desktop.png',animations:'disabled'});
 for(const width of [320,390,768]){
  await page.setViewportSize({width,height:844});assert.equal(await confirm.evaluate(node=>node.scrollWidth<=node.clientWidth && node.getBoundingClientRect().left>=0 && node.getBoundingClientRect().right<=innerWidth),true);
 }
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'data/screenshots/confirm-axis-mobile.png',animations:'disabled'});
 await page.locator('#action-confirm-accept').click();await page.locator('#axis-dialog').waitFor({state:'hidden'});
 assert.equal(deletions(),1);const retained=database.prepare('SELECT deleted,axis_id FROM tasks WHERE id=?').get(fixture.task.id);assert.equal(retained.deleted,0);assert.equal(retained.axis_id,null);
 // The same prompt protects nested editor removals, without discarding unsaved fields.
 await page.setViewportSize({width:1440,height:1000});await page.evaluate(id=>openTask(tasks.find(t=>t.id===id)),fixture.task.id);
 await page.locator('#task-title').fill('未保存的卡片标题');
 await page.getByRole('button',{name:'移除链接',exact:true}).click();await page.getByRole('button',{name:'关闭确认弹窗'}).click();await confirm.waitFor({state:'hidden'});assert.equal(await page.locator('.link-edit-row').count(),1);
 await page.getByRole('button',{name:'移除链接',exact:true}).click();await page.locator('#action-confirm-accept').click();await page.waitForFunction(()=>!document.querySelector('.link-edit-row'));assert.equal(await page.locator('#task-title').inputValue(),'未保存的卡片标题');
 await page.locator('#attachment-input').setInputFiles({name:'虚构附件.txt',mimeType:'text/plain',buffer:Buffer.from('fictional test only')});await page.waitForFunction(()=>!uploading && draftAttachments.length===1);
 await page.getByRole('button',{name:'移除附件：虚构附件.txt'}).click();await page.keyboard.press('Escape');await confirm.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>draftAttachments.length),1);
 await page.getByRole('button',{name:'移除附件：虚构附件.txt'}).click();await page.locator('#action-confirm-accept').click();await page.waitForFunction(()=>draftAttachments.length===0);
 await page.getByRole('button',{name:'删除待办：保留这条待办'}).click();await page.locator('#action-confirm-cancel').click();await confirm.waitFor({state:'hidden'});assert.equal(await page.locator('#task-todos .todo-row').count(),1);
 await page.getByRole('button',{name:'删除待办：保留这条待办'}).click();await page.locator('#action-confirm-accept').click();await page.waitForFunction(()=>draftTodos.length===0);
 assert.equal(JSON.parse(database.prepare('SELECT todos FROM tasks WHERE id=?').get(fixture.task.id).todos).length,1,'editor changes require saving');
 await page.locator('#task-dialog .close-dialog').first().click();
 await page.evaluate(async()=>{await api('/api/source-links','PUT',{urls:['https://smartestu.cn/assignment']});});
 await page.locator('#sources-button').click();await page.evaluate(()=>setSyncStep(3));await page.getByRole('button',{name:'移除网站：SmartEstu'}).click();
 const before=writes.length;await page.keyboard.press('Escape');await confirm.waitFor({state:'hidden'});assert.equal(writes.length,before);
 await page.getByRole('button',{name:'移除网站：SmartEstu'}).click();await page.locator('#action-confirm-accept').click();await page.waitForFunction(()=>!websiteBusy && sourceLinksState.length===0);
 assert.equal(database.prepare('SELECT deleted FROM tasks WHERE id=?').get(fixture.task.id).deleted,0);
 database.prepare("INSERT INTO settings(key,value) VALUES('cloud_enabled','1')").run();await page.evaluate(async()=>{await checkCloud();setSyncStep(4);});
 await page.locator('#cloud-revoke').click();await page.locator('#action-confirm-cancel').click();await confirm.waitFor({state:'hidden'});assert.equal(database.prepare("SELECT value FROM settings WHERE key='cloud_enabled'").get().value,'1');
 await page.locator('#cloud-revoke').click();await page.locator('#action-confirm-accept').click();await page.waitForFunction(()=>!cloudState.enabled);
 assert.deepEqual(nativeDialogs,[]);assert.deepEqual(errors,[]);
 console.log('PASS: page confirmations, cancel/Esc/close/focus restoration, one confirmed axis deletion preserving cards, draft removals, website/cloud confirmation, and 320–768px layouts.');
}finally{
 await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));database.close();
 if(dirname(resolve(directory))!==root)throw Error('Unsafe test cleanup path');await rm(directory,{recursive:true,force:true});
}
