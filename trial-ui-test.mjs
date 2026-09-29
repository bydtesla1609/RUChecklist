import assert from "node:assert/strict";
import {createServer} from "node:http";
import {once} from "node:events";
import {readFile,mkdir} from "node:fs/promises";
import trial from "./trial-worker.mjs";
process.env.TRIAL_UI_FIXTURE="1";
const {trialFixture}=await import("./trial-test.mjs");
const {env,database,invites}=await trialFixture();
env.ASSETS={async fetch(request){const name=new URL(request.url).pathname.slice(1) || "index.html";return new Response(await readFile(new URL(`./static/${name}`,import.meta.url)),{headers:{"Content-Type":name.endsWith(".html")?"text/html":name.endsWith(".js")?"text/javascript":name.endsWith(".css")?"text/css":"image/svg+xml"}});}};
const server=createServer(async(req,res)=>{
  const request=new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(!["GET","HEAD"].includes(req.method)?{body:req,duplex:"half"}:{})});
  const result=await trial.fetch(request,env);res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
});
server.listen(0,"127.0.0.1");await once(server,"listening");const origin=`http://localhost:${server.address().port}`;
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || "playwright");const browser=await chromium.launch({headless:true});
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];page.on("pageerror",e=>errors.push(e.stack));
  await page.goto(origin);await page.locator("#auth-register").click();
  await page.locator("#username").fill("trial_student");await page.locator("#password").fill("Synthetic-password-only-123");await page.locator("#invite-code").fill(invites[0]);
  await page.locator("#login-form button[type=submit]").click();await page.locator("#recovery-dialog").waitFor({state:"visible"});
  const recovery=await page.locator("#recovery-value").textContent();assert.equal(recovery.length,48);
  const download=page.waitForEvent("download");await page.locator("#download-recovery").click();assert.equal((await download).suggestedFilename(),"RUChecklist-账号恢复码.txt");await page.locator("#recovery-done").click();
  await page.locator("#sources-button").click();await page.locator("#collector-state").filter({hasText:"此浏览器"}).waitFor();
  assert.equal(await page.locator("#guide-install").getAttribute("open"),"");assert.equal(await page.locator(".guide-step").count(),4);
  await Promise.all([page.waitForEvent("load"),page.locator("#collector-recheck").click()]);
  await page.locator("#sources-dialog").waitFor({state:"visible"});
  assert.equal(await page.locator("#source-urls").inputValue(),"");assert.equal(await page.locator("#sources-list .source-row").count(),0);
  await page.locator("#source-urls").fill("https://smartestu.cn/assignment\nhttps://course.example/homework");await page.locator("#save-source-links").click();
  await page.locator("#source-links-result").filter({hasText:"已保存 2 个"}).waitFor();assert.match(await page.locator("#unsupported-links").textContent(),/尚未适配/);
  await page.evaluate(()=>{
    window.fixtureConnected=false;window.fixtureCommands=[];
    addEventListener("message",e=>{if(e.data?.kind!=="campus-board-command")return;fixtureCommands.push(e.data.command);if(e.data.command==="pair")fixtureConnected=true;
      window.postMessage({kind:"campus-board-reply",id:e.data.id,result:["status","pair"].includes(e.data.command)?{version:"1.5.0",connected:fixtureConnected,enabled:true,sourceResults:{}}:{ok:true}},location.origin);
    });
  });
  await page.locator("#collector-recheck").click();await page.locator("#collector-connect").click();await page.locator("#collector-state").filter({hasText:"已连接"}).waitFor();
  await page.locator("#collector-scan").click();await page.waitForFunction(()=>fixtureCommands.includes("scan"));
  assert.equal(await page.locator("#cloud-settings").isVisible(),false);
  await mkdir("data/screenshots",{recursive:true});await page.screenshot({path:"data/screenshots/trial-guide-desktop.png"});
  for(const width of [320,390,768]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:"data/screenshots/trial-guide-mobile.png"});
  await page.locator("#sources-dialog .close-dialog").click();await page.locator("#logout").click();await page.locator("#login").waitFor({state:"visible"});
  assert.equal(await page.locator("#source-urls").inputValue(),"");
  await page.locator("#auth-login").click();await page.locator("#username").fill("trial_student");await page.locator("#password").fill("Synthetic-password-only-123");await page.locator("#login-form button[type=submit]").click();await page.locator("#workspace").waitFor({state:"visible"});
  await page.locator("#sources-button").click();await page.waitForFunction(()=>document.getElementById("source-urls").value.includes("course.example"));await page.locator("#sources-dialog .close-dialog").click();
  await page.locator("#logout").click();await page.locator("#auth-recover").click();await page.locator("#recovery-code").fill(recovery);await page.locator("#password").fill("New-synthetic-password-123");await page.locator("#login-form button[type=submit]").click();await page.locator("#recovery-dialog").waitFor({state:"visible"});
  assert.notEqual(await page.locator("#recovery-value").textContent(),recovery);assert.deepEqual(errors,[]);
  console.log("PASS: invite registration, recovery download, username/password login, recovery reset, four-step setup, missing-extension guidance, pairing, generic links, unsupported-site notice, first scan, persisted settings, logout cleanup and 320–768px layouts. Provider and extension use explicit test doubles.");
} finally {await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));database.close();}
