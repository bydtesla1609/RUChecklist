// Optional browser check: install Playwright + Chromium, then run node ui-test.mjs.
// Uses a temporary database and an isolated browser; never touches the live board.
import assert from "node:assert/strict";
import {mkdtemp, mkdir, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createServer} from "node:http";
import {once} from "node:events";
import {createEnvironment} from "./local.mjs";
import worker from "./worker.mjs";
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const directory = await mkdtemp(join(tmpdir(), "campus-board-ui-"));
const {env, database} = await createEnvironment(directory, "isolated-ui-test");
const server = createServer(async (req, res) => {
  const request = new Request(`http://${req.headers.host}${req.url}`, {method: req.method, headers: req.headers,
    ...(!["GET", "HEAD"].includes(req.method) ? {body: req, duplex: "half"} : {})});
  const result = await worker.fetch(request, env);
  res.writeHead(result.status, Object.fromEntries(result.headers)); res.end(Buffer.from(await result.arrayBuffer()));
});
server.listen(0, "127.0.0.1"); await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({headless: true});
  const desktop = await browser.newContext({viewport: {width: 1440, height: 1050}});
  const page = await desktop.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  async function login(page) {
    await page.goto(origin); await page.locator("#password").fill("isolated-ui-test");
    await page.locator("#login-form button[type=submit]").click(); await page.locator("#workspace").waitFor({state: "visible"});
  }
  const category = (page, name) => page.locator("#categories button").filter({has: page.locator("span", {hasText: new RegExp(`^${name}$`)})});
  async function saved(page, action) {
    const response = page.waitForResponse(r => r.url().includes("/api/tasks/") && r.request().method() === "PATCH");
    await action(); assert.equal((await response).status(), 200);
    await page.waitForFunction(() => !document.querySelector(".checklist[data-busy]"));
  }
  async function addTodo(root, value) {
    await root.getByRole("textbox", {name: "新的待办事项"}).fill(value);
    await root.getByRole("button", {name: "添加待办事项", exact: true}).click();
  }
  await login(page);
  await page.locator("#add-task").click(); await page.locator("#add-menu button").filter({hasText: "科研"}).click();
  assert.equal(await page.locator("#category").count(), 0);
  assert.equal(await page.locator("#task-title").getAttribute("required"), "");
  await page.locator("#task-title").fill("课程研究 · 读懂一篇论文");
  await page.locator("#task-location").fill("图书馆 · 三层");
  await page.locator("#starts-at").fill("2026-10-01T10:00"); await page.locator("#ends-at").fill("2026-10-08T18:00");
  await addTodo(page.locator("#task-todos"), "读论文"); await addTodo(page.locator("#task-todos"), "整理笔记");
  await page.locator("#save-task").click(); await page.locator("#task-dialog").waitFor({state: "hidden"});
  const card = page.locator("article.task").first(); await card.waitFor();
  assert.equal(await card.locator(".badge").textContent(), "科研");
  await saved(page, () => addTodo(card, "补充参考资料"));
  await card.getByRole("button", {name: "编辑待办：读论文", exact: true}).click();
  await card.getByRole("textbox", {name: "编辑待办事项"}).fill("读论文并标注");
  await saved(page, () => card.getByRole("button", {name: "确认待办修改"}).click());
  await saved(page, () => card.getByRole("checkbox", {name: "完成：读论文并标注", exact: true}).check());
  await saved(page, () => card.getByRole("button", {name: "删除待办：补充参考资料"}).click());
  await saved(page, () => card.locator(".drag-handle").first().press("ArrowDown"));
  assert.deepEqual(await card.locator(".todo-text").allTextContents(), ["整理笔记", "读论文并标注"]);
  await saved(page, async () => {
    const a = await card.locator(".drag-handle").first().boundingBox(), b = await card.locator(".todo-row").last().boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2, b.y + b.height - 2, {steps: 10}); await page.mouse.up();
  });
  assert.deepEqual(await card.locator(".todo-text").allTextContents(), ["读论文并标注", "整理笔记"]);
  const mobile = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2});
  const phone = await mobile.newPage(); phone.on("pageerror", error => errors.push(error.message));
  await login(phone); await category(phone, "科研").click();
  const mobileCard = phone.locator("article.task").first();
  assert.deepEqual(await mobileCard.locator(".todo-text").allTextContents(), ["读论文并标注", "整理笔记"]);
  await mobileCard.scrollIntoViewIfNeeded();
  const touch = await mobile.newCDPSession(phone);
  await saved(phone, async () => {
    const a = await mobileCard.locator(".drag-handle").first().boundingBox(), b = await mobileCard.locator(".todo-row").last().boundingBox();
    const x = a.x + a.width / 2, y = a.y + a.height / 2, target = b.y + b.height - 2;
    await touch.send("Input.dispatchTouchEvent", {type: "touchStart", touchPoints: [{x, y}]});
    for (let step = 1; step <= 8; step++) await touch.send("Input.dispatchTouchEvent", {type: "touchMove", touchPoints: [{x, y: y + (target - y) * step / 8}]});
    await touch.send("Input.dispatchTouchEvent", {type: "touchEnd", touchPoints: []});
  });
  assert.deepEqual(await mobileCard.locator(".todo-text").allTextContents(), ["整理笔记", "读论文并标注"]);
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator("#sync-state").click();
  await page.waitForFunction(() => document.querySelector(".todo-text")?.textContent === "整理笔记");
  assert.deepEqual(await card.locator(".todo-text").allTextContents(), ["整理笔记", "读论文并标注"]);
  await card.locator(".task-title").click();
  assert.equal(await page.locator("#task-location").inputValue(), "图书馆 · 三层");
  await page.locator("#task-todos .todo-text").first().click();
  await page.locator("#task-todos .todo-edit").fill("写一页阅读小结");
  await page.locator("#task-todos").getByRole("button", {name: "确认待办修改"}).click();
  await page.locator("#save-task").click(); await page.locator("#task-dialog").waitFor({state: "hidden"});
  await card.locator(".todo-text").filter({hasText: "写一页阅读小结"}).waitFor();
  // A second device changing the same task must not erase a local draft.
  await card.locator(".todo-text").first().click(); await card.locator(".todo-edit").fill("未保存的本地草稿");
  await phone.locator("#sync-state").click();
  await mobileCard.locator(".todo-text").filter({hasText: "写一页阅读小结"}).waitFor();
  await mobileCard.locator(".task-title").click(); await phone.locator("#task-location").fill("明德楼 · 302");
  await phone.locator("#save-task").click(); await phone.locator("#task-dialog").waitFor({state: "hidden"});
  const conflict = page.waitForResponse(r => r.url().includes("/api/tasks/") && r.request().method() === "PATCH");
  await card.getByRole("button", {name: "确认待办修改"}).click(); assert.equal((await conflict).status(), 409);
  await card.locator(".checklist-recovery").waitFor();
  assert.ok((await card.locator(".todo-text").allTextContents()).includes("未保存的本地草稿"));
  await card.getByRole("button", {name: "放弃草稿并刷新"}).click();
  await card.locator(".task-location").filter({hasText: "明德楼"}).waitFor();
  // Realistic, explicitly synthetic fixtures for visual inspection.
  await page.evaluate(async () => {
    const samples = [
      {category:"作业",title:"数据结构 · 线性表实验",location:"实验室 402",due_at:"2026-10-02T23:59:00+08:00",status:"doing",todos:[{id:"x",text:"完成链表实现",done:true},{id:"y",text:"整理实验报告",done:false}]},
      {category:"竞赛",title:"数学建模 · 组队讨论",location:"线上会议",starts_at:"2026-10-03T19:00:00+08:00",ends_at:"2026-10-03T20:00:00+08:00",status:"todo",todos:[{id:"x",text:"确定分工与选题方向",done:false}]},
      {category:"活动",title:"校园夜跑计划",location:"东操场",starts_at:"2026-09-24T19:00:00+08:00",ends_at:"2026-09-24T20:00:00+08:00",status:"done",todos:[{id:"x",text:"完成 3 公里",done:true}]},
      {category:"组织",title:"分享会 · 做好每个小细节",location:"学生活动中心",starts_at:"2026-09-28T14:00:00+08:00",ends_at:"2026-09-28T16:00:00+08:00",status:"doing",todos:[{id:"x",text:"确认场地与设备",done:true},{id:"y",text:"准备活动物料",done:false}]}
    ];
    for (const sample of samples) { const r=await fetch("/api/tasks",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(sample)}); if(!r.ok) throw new Error("Fixture creation failed"); }
  });
  await page.locator("#sync-state").click(); await category(page, "全部任务").click();
  await page.locator("article.task").filter({hasText: "数据结构"}).waitFor();
  await mkdir("data/screenshots", {recursive: true});
  await page.screenshot({path:"data/screenshots/desktop.png",fullPage:true});
  await phone.locator("#sync-state").click(); await category(phone, "全部任务").click();
  await phone.locator("article.task").filter({hasText: "数据结构"}).waitFor(); await phone.evaluate(() => scrollTo(0,0));
  await phone.screenshot({path:"data/screenshots/mobile.png",fullPage:true});
  await category(page, "活动").click(); await page.locator("#add-task").click();
  assert.equal(await page.locator("#dialog-title").textContent(), "添加活动");
  await page.screenshot({path:"data/screenshots/form.png"});
  assert.deepEqual(errors, []);
  console.log("PASS: category inheritance, required title, location, detail/card todo CRUD, mouse/touch/keyboard sorting, two browser sessions, conflict draft retention, 390px layout. Screenshots: data/screenshots/ (synthetic data only).");
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); database.close();
  await rm(directory, {recursive:true,force:true});
}
