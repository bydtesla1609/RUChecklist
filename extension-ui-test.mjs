// Optional check: isolated settings-page UI with synthetic Chrome API storage.
import assert from "node:assert/strict";
import {readFile,mkdir} from "node:fs/promises";
import {createServer} from "node:http";
import {once} from "node:events";
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const extension=new URL("./extension/",import.meta.url);
const manifest=JSON.parse(await readFile(new URL("manifest.json",extension),"utf8"));
assert.equal(manifest.action.default_popup,undefined);
const files={"/options.html":"text/html","/options.js":"text/javascript","/options.css":"text/css"};
const server=createServer(async(req,res)=>{
  if(!files[req.url]) {res.writeHead(404);res.end();return;}
  res.writeHead(200,{"Content-Type":files[req.url]});
  res.end(await readFile(new URL(req.url.slice(1),extension)));
});
server.listen(0,"127.0.0.1");await once(server,"listening");
const optionsURL=`http://127.0.0.1:${server.address().port}/options.html`;
let browser;
try {
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext();
  await context.addInitScript(()=>{
    globalThis.runtimeMessages=[];
    const stored=()=>JSON.parse(localStorage.getItem("test-saved-settings") || "{}");
    globalThis.chrome={storage:{local:{get:async keys=>{
      const data=stored();return typeof keys==="string"?{[keys]:data[keys]}:data;
    },set:async value=>localStorage.setItem("test-saved-settings",JSON.stringify({...stored(),...value})),remove:async key=>{const data=stored();delete data[key];localStorage.setItem("test-saved-settings",JSON.stringify(data));}}},
    runtime:{reload:()=>{globalThis.reloadCalled=true;},sendMessage:async message=>{runtimeMessages.push(message.type);return {ok:true};},getManifest:()=>({version:"test",optional_host_permissions:["http://*.chaoxing.com/*"]})},extension:{getViews:()=>[]},permissions:{request:async value=>{globalThis.lastPermissions=value;return globalThis.allowPermission===true;}}};
  });
  async function openSettings() {
    const page=await context.newPage();await page.goto(optionsURL);
    await page.waitForFunction(()=>document.getElementById("url").value!=="");
    await page.locator("#legacy-settings > summary").click();
    return page;
  }
  let page=await openSettings();
  assert.equal(await page.locator("#url").inputValue(),"https://campus-task-board.pages.dev");
  await page.locator("#url").fill("https://example.com/my-board");
  await page.locator("#reload-extension").click();
  assert.equal(await page.evaluate(()=>reloadCalled),true);
  await page.reload();await page.locator("#reload-result").filter({hasText:"当前仍为 vtest"}).waitFor();
  await page.evaluate(()=>chrome.storage.local.remove("reopenAfterReload"));
  await page.locator("#legacy-settings > summary").click();
  const other=await context.newPage();await other.bringToFront();await page.bringToFront();
  assert.equal(await page.locator("#url").inputValue(),"https://example.com/my-board");
  await page.locator("#token").fill("synthetic-pair-code-for-test-only");
  await page.locator("#settings details summary").click();
  await page.locator("#smartestu").fill("https://smartestu.cn/assignment?tab=assignments");
  await page.locator("#enabled").check();await page.close();
  page=await openSettings();
  assert.equal(await page.locator("#url").inputValue(),"https://example.com/my-board");
  assert.equal(await page.locator("#token").inputValue(),"synthetic-pair-code-for-test-only");
  assert.equal(await page.locator("#smartestu").inputValue(),"https://smartestu.cn/assignment?tab=assignments");
  assert.equal(await page.locator("#enabled").isChecked(),true);
  assert.match(await page.locator("#draft-state").textContent(),/已恢复/);
  assert.deepEqual(await page.evaluate(()=>chrome.storage.local.get([])),{});
  await page.reload();await page.locator("#legacy-settings > summary").click();await page.waitForFunction(()=>document.getElementById("token").value!=="");
  assert.equal(await page.locator("#token").inputValue(),"synthetic-pair-code-for-test-only");
  await page.getByRole("button",{name:"保存设置",exact:true}).click();
  await page.waitForFunction(()=>document.getElementById("result").textContent.includes("需要允许"));
  assert.notEqual(await page.evaluate(()=>localStorage.getItem("settingsDraft")),null);
  await page.evaluate(()=>globalThis.allowPermission=true);
  await page.getByRole("button",{name:"保存设置",exact:true}).click();
  await page.waitForFunction(()=>document.getElementById("draft-state").textContent==="设置已生效。");
  assert.equal(await page.evaluate(()=>localStorage.getItem("settingsDraft")),null);
  assert.deepEqual(await page.evaluate(()=>chrome.storage.local.get([])),{boardURL:"https://example.com",token:"synthetic-pair-code-for-test-only",enabled:true,importCache:{},sourceURLs:{smartestu:"https://smartestu.cn/assignment?tab=assignments"}});
  await page.close();page=await openSettings();
  assert.equal(await page.locator("#url").inputValue(),"https://example.com");
  assert.equal(await page.locator("#token").inputValue(),"synthetic-pair-code-for-test-only");
  await page.addScriptTag({content:await readFile(new URL("./extension/parsers.js",import.meta.url),"utf8")});
  const learning=await page.evaluate(()=>{
    const html=`<div class="ulDiv"><li data="https://mooc1.chaoxing.com/mooc-ans/mooc2/work/task?courseId=9&amp;workId=1"><p class="overHidden2">作业一</p><p class="status">待批阅</p><div class="time">2026-10-01 22:00</div></li><li data="/mooc-ans/mooc2/work/task?courseId=9&amp;workId=2"><p class="overHidden2">作业二</p><p class="status">未交</p><div class="tag icon-zy-g"></div></li></div>`;
    const doc=new DOMParser().parseFromString(html,"text/html");
    return CampusParsers.chaoxing(doc,"https://mooc1.chaoxing.com/mooc-ans/mooc2/work/list?courseId=9");
  });
  assert.equal(learning[0].status,"done");assert.equal(learning[0].external_id,"9:1");assert.equal(learning[0].due_at,"2026-10-01T14:00:00.000Z");
  assert.equal(learning[1].status,"todo");assert.equal(learning[1].due_at,null);
  await page.locator("#cloud-authorize").click();assert.match(await page.locator("#cloud-result").textContent(),/请先阅读/);
  assert.equal(await page.evaluate(()=>runtimeMessages.includes("cloud-authorize")),false);
  await page.locator("#cloud-consent").check();await page.locator("#cloud-authorize").click();
  assert.match(await page.locator("#cloud-result").textContent(),/未获得/);assert.equal(await page.evaluate(()=>runtimeMessages.includes("cloud-authorize")),false);
  await page.evaluate(()=>globalThis.allowPermission=true);await page.locator("#cloud-authorize").click();
  await page.waitForFunction(()=>document.getElementById("cloud-result").textContent.includes("已启用"));assert.equal(await page.evaluate(()=>runtimeMessages.includes("cloud-authorize")),true);
  assert.ok((await page.evaluate(()=>lastPermissions.origins)).includes("http://*.chaoxing.com/*"));
  assert.ok((await page.evaluate(()=>lastPermissions.origins)).includes("https://*.chaoxing.com/*"));
  await page.evaluate(()=>{const current=chrome.runtime.getManifest;chrome.runtime.getManifest=()=>({version:"old"});window.restoreManifest=()=>{chrome.runtime.getManifest=current;};lastPermissions=null;});
  await page.locator("#cloud-authorize").click();assert.match(await page.locator("#cloud-result").textContent(),/尚未加载新增权限/);assert.equal(await page.evaluate(()=>lastPermissions),null);await page.evaluate(()=>restoreManifest());
  await page.evaluate(()=>{chrome.runtime.sendMessage=async()=>undefined;chrome.runtime.reload=()=>{window.testReloaded=true;};});
  await page.locator("#cloud-authorize").click();await page.waitForFunction(()=>document.getElementById("cloud-result").textContent.includes("未确认授权"));
  await page.locator("#reload-extension").click();assert.equal(await page.evaluate(()=>window.testReloaded),true);
  assert.equal((await page.evaluate(()=>chrome.storage.local.get([]))).reopenAfterReload,true);
  const captureContext=await browser.newContext();
  await captureContext.route("**/*",route=>route.fulfill(route.request().url().includes("/api/")?{contentType:"application/json",body:JSON.stringify({studentCourseHomeworkDTOList:[{id:1,name:"捕获验证",submission_status:"completed"}]})}:{contentType:"text/html",body:"<!doctype html><body>测试</body>"}));
  const capture=await captureContext.newPage();await capture.goto("https://smartestu.cn/assignment");
  await capture.evaluate(()=>{window.messages=[];addEventListener("message",event=>messages.push(event.data));});
  for(const name of ["cloud-routes.js","parsers.js","capture.js"])await capture.addScriptTag({content:await readFile(new URL(name,extension),"utf8")});
  await capture.evaluate(()=>fetch("/api/homework/student/mark/queryHomeworks",{headers:{Authorization:"Bearer synthetic"}}).then(r=>r.json()));
  await capture.waitForFunction(()=>messages.some(m=>m.kind==="campus-assignments-v1"));
  assert.equal(await capture.evaluate(()=>messages.some(m=>m.kind==="campus-cloud-recipe-v1")),false);
  await capture.evaluate(()=>window.postMessage({kind:"campus-cloud-mode",enabled:true},location.origin));
  await capture.evaluate(()=>fetch("/api/homework/student/mark/queryHomeworks",{headers:{Authorization:"Bearer synthetic"}}).then(r=>r.json()));
  await capture.waitForFunction(()=>messages.some(m=>m.kind==="campus-cloud-recipe-v1"));
  assert.equal(await capture.evaluate(()=>messages.find(m=>m.kind==="campus-cloud-recipe-v1").recipe.headers.authorization),"Bearer synthetic");
  await capture.evaluate(()=>new Promise(resolve=>{const xhr=new XMLHttpRequest();xhr.open("POST","/api/homework/student/mark/queryHomeworks");xhr.setRequestHeader("Content-Type","application/json");xhr.setRequestHeader("Authorization","Bearer xhr-synthetic");xhr.onload=resolve;xhr.send('{"courseid":"test"}');}));
  await capture.waitForFunction(()=>messages.filter(m=>m.kind==="campus-cloud-recipe-v1").length===2);
  assert.equal(await capture.evaluate(()=>messages.filter(m=>m.kind==="campus-cloud-recipe-v1")[1].recipe.headers.authorization),"Bearer xhr-synthetic");
  await captureContext.route("**/FutureV2/CourseMeans/getCourseContent",route=>route.fulfill({contentType:"application/json",headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"token,content-type"},body:JSON.stringify({data:{list:[{id:"test",title:"课堂派验证",contenttype:4,mstatus:1}]}})}));
  await capture.goto("https://www.ketangpai.com/#/main/classDetail?courseid=test-course");
  await capture.evaluate(()=>{window.messages=[];addEventListener("message",event=>messages.push(event.data));});
  for(const name of ["cloud-routes.js","parsers.js","capture.js"])await capture.addScriptTag({content:await readFile(new URL(name,extension),"utf8")});
  await capture.evaluate(()=>window.postMessage({kind:"campus-cloud-mode",enabled:true},location.origin));
  await capture.evaluate(()=>new Promise(resolve=>{const xhr=new XMLHttpRequest();xhr.open("POST","https://openapiv5.ketangpai.com//FutureV2/CourseMeans/getCourseContent");xhr.setRequestHeader("Content-Type","application/json");xhr.setRequestHeader("token","synthetic-class-token");xhr.onload=resolve;xhr.send('{"courseid":"test-course"}');}));
  await capture.waitForFunction(()=>messages.some(m=>m.kind==="campus-cloud-recipe-v1"));
  assert.equal(await capture.evaluate(()=>messages.find(m=>m.kind==="campus-cloud-recipe-v1").recipe.headers.token),"synthetic-class-token");
  await captureContext.close();
  await mkdir("data/screenshots",{recursive:true});await page.screenshot({path:"data/screenshots/extension.png",fullPage:true});
  console.log("PASS: Chaoxing DOM metadata and submission statuses; settings UI preserves draft through tab switching, close/reopen and reload; permission denial retains draft; successful save clears draft and restores active settings. Chrome APIs simulated; user's Edge untouched.");
} finally {
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
