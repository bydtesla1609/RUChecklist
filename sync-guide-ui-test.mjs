// Isolated Chromium profile, synthetic database and intercepted network only.
import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {createEnvironment} from './local.mjs';
import worker,{RELEASE} from './worker.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=resolve(tmpdir()),dir=await mkdtemp(join(root,'rucapture-sync-ui-')),ext=join(dir,'extension');
const {env,database}=await createEnvironment(join(dir,'db'),'isolated-sync-test');env.CLOUD_ENCRYPTION_KEY='12'.repeat(32);
database.prepare("INSERT INTO settings(key,value) VALUES('read_release',?)").run(RELEASE.version);
await cp('extension',ext,{recursive:true});
const manifest=JSON.parse(await readFile(join(ext,'manifest.json'),'utf8'));
// Pregrant in this disposable profile; use real extension APIs without an OS prompt.
manifest.permissions.push('cookies');manifest.host_permissions.push('https://openapiv5.ketangpai.com/*','https://*.chaoxing.com/*','http://*.chaoxing.com/*','https://ketangpai.com/*');
await writeFile(join(ext,'manifest.json'),JSON.stringify(manifest));
const origin='https://rucapture.pages.dev';let context,runMode='failure';
try{
 context=await chromium.launchPersistentContext('',{headless:true,channel:'chromium',executablePath:process.env.BROWSER_EXECUTABLE,ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`],viewport:{width:1440,height:1000}});
 const errors=[];context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.protocol==='chrome-extension:'){await route.continue();return;}
  if(url.origin===origin){
   if(url.pathname==='/api/cloud/run'){await route.fulfill({status:runMode==='failure'?503:200,contentType:'application/json',body:JSON.stringify(runMode==='failure'?{error:'Synthetic connection failure'}:runMode==='running'?{running:true}:{smartestu:{error:'Synthetic empty or unavailable website'}})});return;}
   const response=await worker.fetch(new Request(req.url(),{method:req.method(),headers:await req.allHeaders(),...(!['GET','HEAD'].includes(req.method())?{body:req.postDataBuffer()}: {})}),env);
   await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
  }else if(url.hostname==='smartestu.cn')await route.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic empty website</title><p>No real account or cookie used</p>'});
  else await route.abort();
 });
 await context.addInitScript(()=>{if(location.origin==='https://rucapture.pages.dev')localStorage.setItem('ruchecklist-demo:personal','seen');});
 const page=await context.newPage();await page.goto(origin);
 // All ornamental nodes belong to one of the drawn curves.
 assert.ok(await page.locator('.landing-art svg').evaluate(svg=>[...svg.querySelectorAll('circle')].every(c=>[...svg.querySelectorAll('path')].some(p=>{const length=p.getTotalLength();for(let i=0;i<=length;i+=.5){const pt=p.getPointAtLength(i);if(Math.hypot(pt.x-c.cx.baseVal.value,pt.y-c.cy.baseVal.value)<1)return true;}return false;}))));
 await page.locator('#password').fill('isolated-sync-test');await page.locator('#login-form button[type=submit]').click();await page.locator('#workspace').waitFor();
 await page.locator('#sources-button').click();await page.waitForFunction(()=>document.getElementById('install-state').textContent.includes('1.9.3'));
 await page.locator('#sync-tab-5').click();assert.equal(await page.locator('#guide-install').isVisible(),true,'progress indicators cannot navigate');
 await page.locator('#collector-recheck').click();assert.equal(await page.locator('#guide-install').isVisible(),true);await page.locator('#sync-next').click();
 await page.locator('#account-setup').waitFor();assert.equal(await page.locator('#sync-tab-1').getAttribute('class'),'complete');
 await page.locator('#collector-connect').click();await page.waitForFunction(()=>collectorState?.connected);assert.equal(await page.locator('#account-setup').isVisible(),true);await page.locator('#sync-next').click();await page.locator('#website-setup').waitFor();
 assert.equal(await page.locator('#sync-tab-2').getAttribute('class'),'complete');
 await page.locator('#add-source-link').click();await page.locator('#source-url').fill('https://smartestu.cn/assignment');await page.locator('#save-source-link').click();await page.waitForFunction(()=>!websiteBusy && sourceLinksState?.some(link=>link.source==='smartestu'));assert.equal(await page.locator('#website-setup').isVisible(),true);await page.locator('#sync-next').click();await page.locator('#cloud-settings').waitFor();
 const iframe=page.frameLocator('#cloud-panel iframe');await iframe.locator('#enable:not(:disabled)').waitFor({timeout:10000}).catch(async error=>{console.log('FRAME DEBUG',errors,await page.locator('#source-error').textContent(),page.frames().map(f=>f.url()));for(const f of page.frames().slice(1))console.log(await f.locator('body').innerText().catch(()=>''));throw error;});
 // Map local coordinates to the scaled frame for real pointer input (no DOM clicks).
 async function frameClick(selector){
  const frame=page.locator('#cloud-panel iframe');await frame.scrollIntoViewIfNeeded();
  const box=await frame.boundingBox(),point=await iframe.locator(selector).evaluate(el=>{const b=el.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2,width:innerWidth};});
  const scale=box.width/point.width;await page.mouse.click(box.x+point.x*scale,box.y+point.y*scale);
 }
 assert.equal(await page.locator('#sync-tab-3').getAttribute('class'),'complete');
 assert.equal(context.pages().some(p=>p.url().includes('options.html')),false);
 await page.locator('#sources-dialog').evaluate(el=>Promise.all(el.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{}))));await page.waitForTimeout(250);
 await frameClick('#enable');await iframe.locator('#result').filter({hasText:'请先勾选'}).waitFor();
 assert.equal(await page.evaluate(()=>cloudState.enabled),false);
 // Denied browser confirmation leaves the user on the same step, able to retry.
 await iframe.locator('#enable').evaluate(()=>{window.originalPermissionRequest=chrome.permissions.request;chrome.permissions.request=async()=>false;});
 await frameClick('#consent');await frameClick('#enable');await iframe.locator('#result').filter({hasText:'未开启'}).waitFor();assert.equal(await page.locator('#sync-tab-4').getAttribute('aria-current'),'step');
 await iframe.locator('#enable').evaluate(()=>chrome.permissions.request=window.originalPermissionRequest);
 await frameClick('#enable');await page.waitForFunction(()=>cloudState?.enabled);assert.equal(await page.locator('#cloud-settings').isVisible(),true);await page.locator('#sync-next').click();await page.locator('#sync-results').waitFor();
 assert.equal(await page.locator('#sync-tab-4').getAttribute('class'),'complete');assert.equal(context.pages().some(p=>p.url().includes('options.html')),false,'inline grant must not open a settings tab');
 assert.equal(await page.evaluate(()=>cloudState.enabled),true);
 const sw=context.serviceWorkers()[0],stored=await sw.evaluate(()=>chrome.storage.local.get(['cloudEnabled','boardURL','account']));assert.equal(stored.cloudEnabled,true);assert.equal(stored.boardURL,origin);
 // Public frame cannot enable a different account or operate as a standalone tab.
 const url=await page.locator('#cloud-panel iframe').getAttribute('src');
 await page.locator('#sync-prev').click();await page.locator('#cloud-panel iframe').evaluate((el,url)=>el.src=url.replace('account=personal','account=someone_else'),url);
 await iframe.locator('#result').filter({hasText:'账号连接已变化'}).waitFor();assert.equal(await iframe.locator('#enable').isDisabled(),true);
 await page.locator('#cloud-panel iframe').evaluate((el,url)=>el.src=url,url);await iframe.locator('#enable:not(:disabled)').waitFor();
 const standalone=await context.newPage();await standalone.goto(url);assert.equal(await standalone.locator('#enable').isDisabled(),true);await standalone.close();
 // Site status/history never completes the last step. Executing sync does, even with source errors.
 database.prepare("UPDATE sources SET last_seen=?,error=NULL").run(new Date().toISOString());
 await page.evaluate(()=>refresh());await page.locator('#sync-next').click();
 assert.equal(await page.locator('#sync-tab-5').evaluate(n=>n.classList.contains('complete')),false);assert.equal(await page.locator('#sync-next').isDisabled(),true);
 await page.evaluate(async()=>{await collectorCommand('configure',{enabled:false});await checkCollector();});
 for(const mode of ['failure','running']){runMode=mode;await page.locator('#collector-scan').click();await page.waitForFunction(()=>!syncing);assert.equal(await page.locator('#sync-tab-5').evaluate(n=>n.classList.contains('complete')),false);}
 runMode='results';await page.locator('#collector-scan').click();await page.waitForFunction(()=>!syncing);
 assert.equal(await page.locator('#sync-tab-5').getAttribute('class'),'complete');assert.equal(await page.locator('#sync-next').isDisabled(),false);
 assert.match(await page.locator('#source-error').textContent(),/Synthetic empty/);
 await page.reload();await page.locator('#workspace').waitFor();await page.locator('#sources-button').click();await page.locator('#sync-results').waitFor();assert.equal(await page.locator('#sync-tab-5').getAttribute('class'),'complete');
 // A new website version clears old guide progress, even if all connection settings remain.
 await page.evaluate(()=>{const key='rucapture-sync-guide:personal',saved=JSON.parse(localStorage.getItem(key));saved.version='previous';localStorage.setItem(key,JSON.stringify(saved));});
 await page.reload();await page.locator('#workspace').waitFor();await page.locator('#sources-button').click();await page.waitForFunction(()=>collectorState?.connected && cloudState?.enabled);
 assert.equal(await page.locator('#guide-install').isVisible(),true);
 assert.deepEqual(await page.locator('#sync-progress li').evaluateAll(points=>points.map(p=>p.classList.contains('complete'))),[true,false,false,false,false]);
 for(const expected of ['account-setup','website-setup','cloud-settings','sync-results']){await page.locator('#sync-next').click();await page.locator('#'+expected).waitFor();}
 assert.equal(await page.locator('#sync-tab-5').evaluate(n=>n.classList.contains('complete')),false);
 // An older extension cannot keep the later dots lit from previously saved settings.
 await page.evaluate(()=>{collectorState.version='1.9.2';updateSyncSteps();});
 assert.deepEqual(await page.locator('#sync-progress li').evaluateAll(points=>points.map(p=>p.classList.contains('complete'))),[false,false,false,false,false]);await page.evaluate(()=>checkCollector());
 async function goStep(step){while(await page.evaluate(()=>syncStep)>step)await page.locator('#sync-prev').click();while(await page.evaluate(()=>syncStep)<step)await page.locator('#sync-next').click();}
 await mkdir('data/screenshots',{recursive:true});
 for(const step of [1,3,4,5]){await goStep(step);await page.waitForTimeout(250);await page.screenshot({path:`data/screenshots/sync-step-${step}.png`,animations:'disabled'});}
 for(const width of [320,390,768]){
  await page.setViewportSize({width,height:844});await goStep(4);await iframe.locator('#enable').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await iframe.locator('body').evaluate(body=>body.scrollWidth<=innerWidth+1),true,JSON.stringify(await iframe.locator('body').evaluate(body=>({width:innerWidth,scroll:body.scrollWidth,zoom:getComputedStyle(frameElement || body).zoom}))));
 }
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);assert.ok(await iframe.locator('body').evaluate(b=>parseFloat(getComputedStyle(b).fontSize))*1.5>=15);await page.screenshot({path:'data/screenshots/sync-step-mobile.png',animations:'disabled'});
 assert.deepEqual(errors,[]);console.log('PASS: real embedded extension, five-step transitions, opt-in/denial/retry, account checks, no new settings tab, manual progress, version reset, sync execution independent of results, and mobile layout.');
}finally{
 await context?.close();database.close();if(dirname(resolve(dir))!==root)throw Error('Unsafe test cleanup path');await rm(dir,{recursive:true,force:true});
}
