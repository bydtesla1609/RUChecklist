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
  const path=new URL(req.url,"http://localhost").pathname;
  if(!files[path]) {res.writeHead(404);res.end();return;}
  res.writeHead(200,{"Content-Type":files[path]});
  res.end(await readFile(new URL(path.slice(1),extension)));
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
    runtime:{reload:()=>{globalThis.reloadCalled=true;},sendMessage:async message=>{runtimeMessages.push(message.type);return message.type==="generic-permission"?{origin:"https://class.example",url:"https://class.example/list"}:{ok:true};},getManifest:()=>({version:"test",optional_host_permissions:["http://*.chaoxing.com/*"]})},extension:{getViews:()=>[]},permissions:{request:async value=>{globalThis.lastPermissions=value;return globalThis.allowPermission===true;}}};
  });
  async function openSettings() {
    const page=await context.newPage();await page.goto(optionsURL);
    await page.waitForFunction(()=>document.getElementById("url").value!=="");
    await page.locator("#legacy-settings > summary").click();
    return page;
  }
  let page=await openSettings();
  assert.equal(await page.locator("h1").textContent(),"扩展设置");
  assert.equal(await page.locator("#open-board").textContent(),"打开看板 · 来源与同步 ↗");
  assert.equal(await page.locator("body").innerText().then(text=>text.includes("按四步指南")),false);
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
  assert.ok((await page.evaluate(()=>lastPermissions.origins)).includes("https://www.zhifz.com/*"));
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
  const zhifzRequests=[];
  let zhifzExpired=false;
  await captureContext.route("https://www.zhifz.com/yonghu_ceyan?*",route=>{
    const request=route.request(),states=JSON.parse(new URL(request.url()).searchParams.get("状态"));
    zhifzRequests.push({method:request.method(),states});
    return route.fulfill({contentType:"application/json",body:JSON.stringify(zhifzExpired && states.includes(2)?{result:false,error:"请重新登录"}:{result:true,data:[{测验ID:states[0]+100,测验名称:"示例作业",科目名称:"示例课程",状态:states[0]}]})});
  });
  await capture.goto("https://www.zhifz.com/#/zuoye");
  await capture.evaluate(()=>{window.messages=[];addEventListener("message",event=>messages.push(event.data));});
  for(const name of ["cloud-routes.js","parsers.js","capture.js"])await capture.addScriptTag({content:await readFile(new URL(name,extension),"utf8")});
  const readZhifz=method=>capture.evaluate(method=>new Promise(resolve=>{
    const xhr=new XMLHttpRequest();xhr.open(method,"/yonghu_ceyan?"+new URLSearchParams({UID:"123",类型:"2",状态:"[0,1]"}));xhr.onload=resolve;xhr.send();
  }),method);
  await readZhifz("GET");
  await capture.waitForFunction(()=>messages.some(m=>m.kind==="campus-assignments-v1"));
  assert.deepEqual(await capture.evaluate(()=>messages.find(m=>m.kind==="campus-assignments-v1").tasks.map(task=>task.status)),["todo","done"]);
  assert.equal(await capture.evaluate(()=>messages.some(m=>m.kind==="campus-cloud-recipe-v1")),false);
  assert.deepEqual(zhifzRequests,[{method:"GET",states:[0,1]},{method:"GET",states:[2,3]}]);
  await capture.evaluate(()=>window.postMessage({kind:"campus-cloud-mode",enabled:true},location.origin));
  await readZhifz("GET");
  await capture.waitForFunction(()=>messages.some(m=>m.kind==="campus-cloud-recipe-v1"));
  assert.equal(await capture.evaluate(()=>messages.find(m=>m.kind==="campus-cloud-recipe-v1").recipe.method),"GET");
  const beforePost=await capture.evaluate(()=>messages.filter(m=>m.kind==="campus-assignments-v1").length);
  await readZhifz("POST");
  assert.equal(await capture.evaluate(()=>messages.filter(m=>m.kind==="campus-assignments-v1").length),beforePost,"answer submissions must not be captured");
  assert.equal(zhifzRequests.length,5,"companion list read must not recurse or replay a POST");
  zhifzExpired=true;await readZhifz("GET");
  await capture.waitForFunction(()=>messages.some(m=>m.kind==="campus-assignments-v1" && m.error));
  assert.match(await capture.evaluate(()=>messages.find(m=>m.error).error),/登录/);
  const rucCalls=[];
  await captureContext.route("https://k.ruc.edu.cn/jiakt/**",route=>{
    const request=route.request();rucCalls.push(new URL(request.url()).pathname);
    if(request.url().includes("getMyLearnCourse"))return route.fulfill({contentType:"application/json",body:JSON.stringify({stat:1,data:[{id:11,name:"示例课程",classesList:[{id:12}]}]})});
    assert.ok(request.url().endsWith("/studentGlobalSearch"));assert.equal(request.method(),"POST");assert.equal(request.headers().authorization,"Bearer test-only");
    return route.fulfill({contentType:"application/json",body:JSON.stringify({stat:1,data:{list:[{type:10,courseReleaseInfoId:101,name:"课程作业",submitStatus:1,endTime:"2026-10-10 22:00:00"}],totalPages:1}})});
  });
  await capture.goto("https://k.ruc.edu.cn/UserClient/student_extracurricular.html");
  await capture.evaluate(()=>{window.messages=[];addEventListener("message",event=>messages.push(event.data));});
  for(const name of ["cloud-routes.js","parsers.js","ruc-adapters.js","ruc-capture.js"])await capture.addScriptTag({content:await readFile(new URL(name,extension),"utf8")});
  await capture.evaluate(()=>fetch("/jiakt/adminApi/course/getMyLearnCourse",{method:"POST",headers:{authorization:"Bearer test-only","content-type":"application/json"},body:"{}"}).then(r=>r.json()));
  assert.equal(rucCalls.length,1,"an unconfigured source must not actively collect course pages");
  await capture.evaluate(()=>window.postMessage({kind:"campus-ruc-mode",enabled:true,cloudEnabled:false},location.origin));
  await capture.waitForFunction(()=>messages.some(m=>m.kind==="campus-assignments-v1"));
  assert.equal(await capture.evaluate(()=>messages.find(m=>m.kind==="campus-assignments-v1").tasks[0].status),"done");
  assert.equal(await capture.evaluate(()=>messages.some(m=>m.kind==="campus-cloud-recipe-v1")),false);
  await capture.evaluate(()=>window.postMessage({kind:"campus-ruc-mode",enabled:true,cloudEnabled:true},location.origin));
  await capture.evaluate(()=>new Promise(resolve=>{const xhr=new XMLHttpRequest();xhr.open("POST","/jiakt/adminApi/course/getMyLearnCourse");xhr.setRequestHeader("authorization","Bearer test-only");xhr.setRequestHeader("content-type","application/json");xhr.onload=resolve;xhr.send("{}");}));
  await capture.waitForFunction(()=>messages.some(m=>m.kind==="campus-cloud-recipe-v1"));
  assert.equal(rucCalls.length,4);
  // The real site's course page is framed; its successful capture must suppress
  // the outer shell's later "no list" timeout.
  await capture.evaluate(()=>{document.body.innerHTML='<iframe src="/UserClient/platform_index.html"></iframe>';});
  await capture.locator("iframe").waitFor();
  const framed=capture.frame({url:"https://k.ruc.edu.cn/UserClient/platform_index.html"});
  for(const surface of [capture,framed]){
    await surface.evaluate(()=>{
      window.sent=[];window.listTimeouts=[];const timer=setTimeout;
      window.setTimeout=(fn,ms,...args)=>ms===25000?listTimeouts.push(fn):timer(fn,ms,...args);
      window.chrome={runtime:{sendMessage:async message=>{sent.push(message);return message.type==="collection-context"?{managed:true,enabled:true}:{};},onMessage:{addListener(){}}}};
    });
    await surface.addScriptTag({content:await readFile(new URL("content.js",extension),"utf8")});
  }
  await framed.evaluate(()=>window.postMessage({kind:"campus-assignments-v1",source:"weilai",tasks:[{external_id:"frame-task",content:"示例"}]},location.origin));
  await capture.waitForFunction(()=>messages.some(message=>message.kind==="campus-ruc-frame-seen"));
  await capture.evaluate(()=>listTimeouts.forEach(callback=>callback()));
  assert.equal(await capture.evaluate(()=>sent.some(message=>message.type==="capture" && message.error)),false,"outer shell must not overwrite frame success");
  await captureContext.route("https://ruc.thusaac.com/api/course/**",route=>route.fulfill({contentType:"application/json",body:JSON.stringify(route.request().url().endsWith("/list")?{courses:[{_id:7,role:"student"},{_id:9,role:"none"}]}:{info:{title:"课程",contests:[{_id:3,title:"已截止作业",status:"ended",endTime:1790863200000}]}})}));
  await capture.goto("https://ruc.thusaac.com/course/list");
  await capture.evaluate(()=>{window.messages=[];addEventListener("message",event=>messages.push(event.data));});
  for(const name of ["cloud-routes.js","parsers.js","ruc-adapters.js","ruc-capture.js"])await capture.addScriptTag({content:await readFile(new URL(name,extension),"utf8")});
  await capture.evaluate(()=>window.postMessage({kind:"campus-ruc-mode",enabled:true,cloudEnabled:false},location.origin));
  await capture.evaluate(()=>fetch("/api/course/list").then(r=>r.json()));
  await capture.waitForFunction(()=>messages.some(m=>m.kind==="campus-assignments-v1"));
  const tuTasks=await capture.evaluate(()=>messages.find(m=>m.kind==="campus-assignments-v1").tasks);
  assert.equal(tuTasks.length,1);assert.equal(tuTasks[0].external_id,"7:3");assert.equal(tuTasks[0].status,undefined);
  await page.addScriptTag({content:await readFile(new URL("ruc-adapters.js",extension),"utf8")});
  const yoj=await page.evaluate(()=>{
    const document=new DOMParser().parseFromString('<h2>示例课程</h2><table><thead><tr><th>作业名称</th><th>截止时间</th><th>状态</th></tr></thead><tbody><tr><td><a href="/index.php/index/contest/detail/pno/1.html">1</a> <a href="/index.php/index/contest/detail/pno/1.html">课程作业</a></td><td>2026-10-02 22:00:00</td><td>已结束</td></tr><tr><td><a href="/index.php/index/contest/detail/pno/2.html">第二次作业</a></td><td>暂无</td><td>已完成</td></tr><tr><td><a href="https://evil.example/index.php/index/contest/detail/pno/3.html">其他站点</a></td></tr></tbody></table><a href="/index.php/index/problem/detail/pno/5.html">公共题库</a>','text/html');
    return RUCLists.yoj(document,"http://yoj.ruc.edu.cn/index.php/index/course/detail.html");
  });
  assert.equal(yoj.tasks.length,2);assert.equal(yoj.tasks[0].content,"课程作业");assert.equal(yoj.tasks[0].status,undefined);assert.equal(yoj.tasks[0].due_at,"2026-10-02T14:00:00.000Z");assert.equal(yoj.tasks[1].status,"done");assert.equal(yoj.tasks[1].due_at,null);
  await captureContext.close();
  const permissionPage=await context.newPage();await permissionPage.goto(optionsURL+"?generic=1");
  await permissionPage.locator("#generic-site").filter({hasText:"https://class.example"}).waitFor();
  await permissionPage.locator("#generic-allow").click();await permissionPage.locator("#generic-result").filter({hasText:"未授权"}).waitFor();
  assert.equal(await permissionPage.evaluate(()=>runtimeMessages.includes("generic-open")),false);
  await permissionPage.evaluate(()=>allowPermission=true);await permissionPage.locator("#generic-allow").click();await permissionPage.locator("#generic-result").filter({hasText:"已打开网页"}).waitFor();
  assert.deepEqual(await permissionPage.evaluate(()=>lastPermissions),{origins:["https://class.example/*"]});await permissionPage.close();
  await page.locator("#legacy-settings").evaluate(el=>el.open=false);await mkdir("data/screenshots",{recursive:true});await page.screenshot({path:"data/screenshots/extension.png",fullPage:true});
  console.log("PASS: Future Classroom and TUOJ list capture and opt-in, YOJ course table metadata, Zhifz latest/past lists, Chaoxing DOM metadata; settings draft persistence and permission handling. Synthetic responses and Chrome APIs; user's browser untouched.");
} finally {
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
