// Real MV3 registration/runtime in a fresh profile, with synthetic pages and a
// mocked board backend. No user cookies, browser profile or server data involved.
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const extension=fileURLToPath(new URL('./extension/',import.meta.url));
const context=await chromium.launchPersistentContext('',{headless:true,channel:'chromium',executablePath:process.env.BROWSER_EXECUTABLE,ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
try {
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='smartestu.cn'?route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html><body><table><tbody><tr><td><a href="/work/synthetic">隔离浏览器测试</a></td><td>2026-10-20 22:00</td></tr></tbody></table></body></html>'}):route.abort());
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const registered=await worker.evaluate(async()=>{
    const url='https://smartestu.cn/generic-demo',source='web:https://smartestu.cn',boardURL='https://campus-task-board.pages.dev',binding=boardURL+'|personal';
    globalThis.imports=[];
    globalThis.fetch=async(address,init)=>{
      if(address.endsWith('/api/collector-config'))return Response.json({account:'personal',links:[{url,source,generic:true}]});
      if(address.endsWith('/api/import')){imports.push(JSON.parse(init.body));return Response.json({changed:1});}
      throw new Error('Unexpected test request');
    };
    await chrome.storage.local.set({boardURL,account:'personal',token:'a'.repeat(48),enabled:true,genericRules:{[binding+'|'+url]:{fields:{rows:'tbody > tr',title:':scope > td:nth-of-type(1)',due:':scope > td:nth-of-type(2)',status:'',course:''},automatic:true,excluded:[]}}});
    await registerGeneric([{url}]);return chrome.scripting.getRegisteredContentScripts({ids:['ru-generic']});
  });
  assert.deepEqual(registered[0].matches,['https://smartestu.cn/*']);
  const page=await context.newPage();await page.goto('https://smartestu.cn/generic-demo');await page.locator('#ruchecklist-reader').waitFor();
  const deadline=Date.now()+8000;
  let imported=[];while(Date.now()<deadline){imported=await worker.evaluate(()=>imports);if(imported.length)break;await new Promise(resolve=>setTimeout(resolve,100));}
  assert.equal(imported.length,1);assert.equal(imported[0].source,'web:https://smartestu.cn');assert.equal(imported[0].tasks[0].title,'隔离浏览器测试');
  assert.equal(imported[0].tasks[0].due_at,'2026-10-20T14:00:00.000Z');
  console.log('PASS: real MV3 dynamic script registration, isolated content script, account-scoped saved rule and metadata upload in a fresh Chromium profile. Board and website data are synthetic.');
}finally{await context.close();}
