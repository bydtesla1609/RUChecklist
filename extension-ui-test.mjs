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
    const stored=()=>JSON.parse(localStorage.getItem("test-saved-settings") || "{}");
    globalThis.chrome={storage:{local:{get:async keys=>{
      const data=stored();return typeof keys==="string"?{[keys]:data[keys]}:data;
    },set:async value=>localStorage.setItem("test-saved-settings",JSON.stringify({...stored(),...value}))}},
    runtime:{sendMessage:async()=>({ok:true})},extension:{getViews:()=>[]},permissions:{request:async()=>globalThis.allowPermission===true}};
  });
  async function openSettings() {
    const page=await context.newPage();await page.goto(optionsURL);
    await page.waitForFunction(()=>document.getElementById("url").value!=="");
    return page;
  }
  let page=await openSettings();
  assert.equal(await page.locator("#url").inputValue(),"https://campus-task-board.pages.dev");
  await page.locator("#url").fill("https://example.com/my-board");
  const other=await context.newPage();await other.bringToFront();await page.bringToFront();
  assert.equal(await page.locator("#url").inputValue(),"https://example.com/my-board");
  await page.locator("#token").fill("synthetic-pair-code-for-test-only");
  await page.locator("summary").click();
  await page.locator("#smartestu").fill("https://smartestu.cn/assignment?tab=assignments");
  await page.locator("#enabled").check();await page.close();
  page=await openSettings();
  assert.equal(await page.locator("#url").inputValue(),"https://example.com/my-board");
  assert.equal(await page.locator("#token").inputValue(),"synthetic-pair-code-for-test-only");
  assert.equal(await page.locator("#smartestu").inputValue(),"https://smartestu.cn/assignment?tab=assignments");
  assert.equal(await page.locator("#enabled").isChecked(),true);
  assert.match(await page.locator("#draft-state").textContent(),/已恢复/);
  assert.deepEqual(await page.evaluate(()=>chrome.storage.local.get([])),{});
  await page.reload();await page.waitForFunction(()=>document.getElementById("token").value!=="");
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
  await mkdir("data/screenshots",{recursive:true});await page.screenshot({path:"data/screenshots/extension.png",fullPage:true});
  console.log("PASS: Chaoxing DOM metadata and submission statuses; settings UI preserves draft through tab switching, close/reopen and reload; permission denial retains draft; successful save clears draft and restores active settings. Chrome APIs simulated; user's Edge untouched.");
} finally {
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
