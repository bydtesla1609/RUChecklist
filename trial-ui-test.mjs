import assert from "node:assert/strict";
import {createServer} from "node:http";
import {once} from "node:events";
import {readFile,mkdir} from "node:fs/promises";
import trial from "./trial-worker.mjs";
process.env.TRIAL_UI_FIXTURE="1";
const {trialFixture}=await import("./trial-test.mjs");
const {env,database,invites}=await trialFixture();env.CLOUD_ENCRYPTION_KEY="12".repeat(32);
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
  await page.locator("#username").fill("trial_student");await page.locator("#password").fill("Ab1234");await page.locator("#invite-code").fill(invites[0]);
  await page.locator("#login-form button[type=submit]").click();await page.locator("#recovery-dialog").waitFor({state:"visible"});
  const recovery=await page.locator("#recovery-value").textContent();assert.equal(recovery.length,48);
  const download=page.waitForEvent("download");await page.locator("#download-recovery").click();assert.equal((await download).suggestedFilename(),"RUChecklist-账号恢复码.txt");await page.locator("#recovery-done").click();
  await page.locator("#demo-dialog").waitFor({state:"visible"});
  for(let step=0;step<7;step++) {
    await page.locator("#demo-progress").filter({hasText:`${step+1} / 7`}).waitFor();
    if(step===5){assert.equal(await page.locator("#website-setup").isVisible(),true);await page.screenshot({path:"data/screenshots/demo-websites.png"});}
    await page.locator("#demo-next").click();
  }
  assert.equal(await page.locator("#demo-dialog").isVisible(),false);
  await page.locator("#demo-button").click();await page.locator("#demo-skip").click();
  for(const name of ["考试","活动","会议"]) {await page.locator("#categories button").filter({has:page.locator("span",{hasText:new RegExp(`^${name}$`)})}).click();assert.ok((await page.locator(".heading").boundingBox()).y<100,"empty section stays at top");}
  await page.locator("#sources-button").click();await page.locator("#collector-state").filter({hasText:"此浏览器"}).waitFor();
  assert.equal(await page.locator("#guide-install").getAttribute("open"),"");assert.equal(await page.locator(".guide-step").count(),4);
  await Promise.all([page.waitForEvent("load"),page.locator("#collector-recheck").click()]);
  await page.locator("#sources-dialog").waitFor({state:"visible"});
  assert.equal(await page.locator("#website-list .website-row").count(),0);assert.equal(await page.locator("#sources-list .source-row").count(),0);
  async function addWebsite(url) {await page.locator("#add-source-link").click();await page.locator("#source-url").fill(url);await page.locator("#save-source-link").click();await page.locator("#source-links-form").waitFor({state:"hidden"});}
  await addWebsite("https://smartestu.cn/assignment");await addWebsite("https://course.example/homework");
  assert.equal(await page.locator("#website-list .website-row").count(),2);assert.match(await page.locator("#unsupported-links").textContent(),/尚未适配/);
  await page.evaluate(()=>{
    window.fixtureConnected=false;window.fixtureCommands=[];
    addEventListener("message",e=>{if(e.data?.kind!=="campus-board-command")return;fixtureCommands.push(e.data.command);if(e.data.command==="pair")fixtureConnected=true;
      window.postMessage({kind:"campus-board-reply",id:e.data.id,result:["status","pair"].includes(e.data.command)?{version:"1.5.1",connected:fixtureConnected,enabled:true,sourceResults:{}}:{ok:true}},location.origin);
    });
  });
  await page.locator("#collector-recheck").click();await page.locator("#collector-connect").click();await page.locator("#collector-state").filter({hasText:"已连接"}).waitFor();
  await addWebsite("https://jw.ruc.edu.cn/Njw2017/index.html#/");await page.waitForFunction(()=>fixtureCommands.includes("scan"));assert.equal(await page.locator("#academic-scan").count(),0);
  await page.locator("#collector-scan").click();await page.waitForFunction(()=>fixtureCommands.filter(x=>x==="scan").length>=2);
  await page.locator("#sync-settings summary").click();assert.equal(await page.locator("#cloud-settings").isVisible(),true);await page.locator("#cloud-authorize").click();await page.waitForFunction(()=>fixtureCommands.includes("options"));
  await mkdir("data/screenshots",{recursive:true});await page.screenshot({path:"data/screenshots/trial-guide-desktop.png"});
  for(const width of [320,390,768]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:"data/screenshots/trial-guide-mobile.png"});
  await page.locator("#sources-dialog .close-dialog").click();await page.locator("#demo-button").click();for(let i=0;i<5;i++)await page.locator("#demo-next").click();await page.locator("#demo-progress").filter({hasText:"6 / 7"}).waitFor();await page.waitForFunction(()=>{const frame=document.getElementById("demo-highlight").getBoundingClientRect(),target=document.getElementById("add-source-link").getBoundingClientRect();return target.top<innerHeight-120 && Math.abs(frame.top-Math.max(8,target.top-5))<2;},null,{timeout:5000});await page.locator("#demo-dialog").evaluate(el=>Promise.all(el.getAnimations({subtree:true}).map(animation=>animation.finished)));await page.screenshot({path:"data/screenshots/demo-mobile.png"});const box=await page.locator("#demo-card").boundingBox();assert.ok(box.x>=0 && box.x+box.width<=390 && box.y+box.height<=844);await page.locator("#demo-skip").click();await page.locator("#sources-button").click();
  await page.locator("#sources-dialog .close-dialog").click();await page.locator("#logout").click();await page.locator("#logout-dialog").waitFor({state:"visible"});await page.locator("#logout-dialog .close-dialog").click();assert.equal(await page.locator("#workspace").isVisible(),true);await page.locator("#logout").click();await page.locator("#confirm-logout").click();await page.locator("#login").waitFor({state:"visible"});
  assert.equal(await page.locator("#website-list .website-row").count(),0);
  await page.locator("#auth-login").click();await page.locator("#username").fill("trial_student");await page.locator("#password").fill("Ab1234");await page.locator("#login-form button[type=submit]").click();await page.locator("#workspace").waitFor({state:"visible"});
  await page.locator("#sources-button").click();await page.locator("#website-list a").filter({hasText:"course.example"}).waitFor();await page.locator("#sources-dialog .close-dialog").click();
  await page.locator("#logout").click();await page.locator("#logout-dialog").waitFor({state:"visible"});await page.locator("#logout-dialog .close-dialog").click();assert.equal(await page.locator("#workspace").isVisible(),true);await page.locator("#logout").click();await page.locator("#confirm-logout").click();await page.locator("#auth-recover").click();await page.locator("#recovery-code").fill(recovery);await page.locator("#password").fill("New-synthetic-password-123");await page.locator("#login-form button[type=submit]").click();await page.locator("#recovery-dialog").waitFor({state:"visible"});
  assert.notEqual(await page.locator("#recovery-value").textContent(),recovery);assert.deepEqual(errors,[]);
  console.log("PASS: six-character passwords, auto/manual tour, top-aligned empty sections, individual website configuration, all-source sync, cloud authorization entry, logout confirmation, invite registration, recovery download, username/password login, recovery reset, four-step setup, missing-extension guidance, pairing, generic links, unsupported-site notice, first scan, persisted settings, logout cleanup and 320–768px layouts. Provider and extension use explicit test doubles.");
} finally {await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));database.close();}
