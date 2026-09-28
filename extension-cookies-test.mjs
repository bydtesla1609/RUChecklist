// Real browser Cookies API check using a new profile and synthetic cookies only.
import assert from "node:assert/strict";
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root=resolve(tmpdir()),dir=await mkdtemp(join(root,'campus-cookie-test-'));
try {
 await writeFile(join(dir,'bg.js'),'chrome.runtime.onInstalled.addListener(()=>{});');
 for(const origins of [[],['https://chaoxing.com/*'],['https://*.chaoxing.com/*','http://*.chaoxing.com/*']]) {
  await writeFile(join(dir,'manifest.json'),JSON.stringify({manifest_version:3,name:'Synthetic cookie permission test',version:'1.0',permissions:['cookies'],host_permissions:['https://mooc1.chaoxing.com/*',...origins],background:{service_worker:'bg.js'}}));
  const context=await chromium.launchPersistentContext('',{headless:true,channel:"chromium",executablePath:process.env.BROWSER_EXECUTABLE,ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${dir}`,`--load-extension=${dir}`]});
  try {
   await context.addCookies([{name:'parent_test',value:'synthetic',domain:'.chaoxing.com',path:'/',secure:false},{name:'host_test',value:'synthetic',url:'https://mooc1.chaoxing.com/'}]);
   const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
   const names=await worker.evaluate(async()=> (await chrome.cookies.getAll({url:'https://mooc1.chaoxing.com/mooc2/work/list'})).map(x=>x.name));
   if(origins.length===2) {
    assert.equal(await worker.evaluate(()=>chrome.permissions.contains({origins:['*://*.chaoxing.com/*']})),false);
    assert.equal(await worker.evaluate(()=>chrome.permissions.contains({origins:['http://*.chaoxing.com/*','https://*.chaoxing.com/*']})),true);
   }
   assert.deepEqual(names,origins.includes('http://*.chaoxing.com/*')?['parent_test','host_test']:['host_test']);
  }finally {await context.close();}
 }
}finally {if(dirname(resolve(dir))!==root)throw Error('path');await rm(dir,{recursive:true,force:true});}

console.log("PASS: HTTPS-only access omits non-Secure shared login cookies; scoped HTTP + HTTPS permission includes them. Isolated profile only.");
