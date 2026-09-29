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
  await page.locator("#add-task").click(); await page.locator("#add-menu button").filter({hasText: "活动"}).click();
  assert.equal(await page.locator("#category").count(), 0);
  assert.equal(await page.locator("#task-title").getAttribute("required"), "");
  await page.locator("#task-title").fill("课程研究 · 读懂一篇论文");
  await page.locator("#task-location").fill("图书馆 · 三层");
  await page.locator("#starts-at").fill("2026-10-01T10:00"); await page.locator("#ends-at").fill("2026-10-08T18:00");
  await addTodo(page.locator("#task-todos"), "读论文"); await addTodo(page.locator("#task-todos"), "整理笔记");
  await page.locator("#add-link").click();
  await page.getByRole("textbox",{name:"链接名称",exact:true}).fill("课程参考资料");
  await page.getByRole("textbox",{name:"链接地址",exact:true}).fill("https://example.com/course-notes");
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJb8AAAAASUVORK5CYII=","base64");
  await page.locator("#attachment-input").setInputFiles([{name:"示例图片.png",mimeType:"image/png",buffer:png},{name:"阅读材料.docx",mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",buffer:Buffer.from("PK-test-download")}]);
  await page.waitForFunction(()=>document.getElementById("upload-state").textContent.includes("上传完成"));
  await page.locator("#save-task").click(); await page.locator("#task-dialog").waitFor({state: "hidden"});
  const card = page.locator("article.task").first(); await card.waitFor();
  assert.equal(await card.locator(".badge").textContent(), "活动");
  assert.equal(await card.getByRole("link",{name:"课程参考资料 ↗"}).getAttribute("href"),"https://example.com/course-notes");
  const fileURL=await card.getByRole("link",{name:"打开附件：示例图片.png"}).getAttribute("href");
  const preview=await desktop.newPage(); await preview.goto(origin+fileURL);
  assert.equal(await preview.locator("img").evaluate(image=>image.complete && image.naturalWidth===1),true); await preview.close();
  const fileResponse=await desktop.request.get(origin+fileURL);assert.deepEqual(await fileResponse.body(),png);
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
  await login(phone); await category(phone, "活动").click();
  assert.equal(await phone.locator(".brand-icon img").count(),2);
  const alignment=await phone.locator(".brand .brand-icon").evaluate(icon=>{const box=icon.getBoundingClientRect(),svg=icon.querySelector("img").getBoundingClientRect();return Math.abs(box.top+box.height/2-svg.top-svg.height/2)<1 && Math.abs(box.left+box.width/2-svg.left-svg.width/2)<1;});assert.equal(alignment,true);
  assert.deepEqual(await (await mobile.request.get(origin+fileURL)).body(),png);
  assert.ok(await phone.getByRole("link",{name:"课程参考资料 ↗"}).isVisible());
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
  await page.evaluate(() => refresh());
  await page.waitForFunction(() => document.querySelector(".todo-text")?.textContent === "整理笔记");
  assert.deepEqual(await card.locator(".todo-text").allTextContents(), ["整理笔记", "读论文并标注"]);
  await card.locator(".task-title").click();
  assert.equal(await page.locator("#task-dialog").isVisible(), false);
  assert.equal(await card.locator(".task-title").evaluate(node => node.tagName), "H3");
  assert.equal(await card.locator("select").count(), 1);
  await saved(page,()=>card.locator(".task-status").selectOption("doing"));
  await page.waitForFunction(()=>!document.querySelector("article[data-busy]"));
  assert.equal(await card.locator(".task-status").inputValue(),"doing");
  assert.deepEqual(await card.locator(".task-actions button").allTextContents(), ["编辑", "删除"]);
  await card.locator(".edit-task").click();
  assert.equal(await page.locator("#task-location").inputValue(), "图书馆 · 三层");
  await page.locator("#task-todos .todo-text").first().click();
  await page.locator("#task-todos .todo-edit").fill("写一页阅读小结");
  await page.locator("#task-todos").getByRole("button", {name: "确认待办修改"}).click();
  await page.locator("#save-task").click(); await page.locator("#task-dialog").waitFor({state: "hidden"});
  await card.locator(".todo-text").filter({hasText: "写一页阅读小结"}).waitFor();
  // A second device changing the same task must not erase a local draft.
  await card.locator(".todo-text").first().click(); await card.locator(".todo-edit").fill("未保存的本地草稿");
  await phone.evaluate(() => refresh());
  await mobileCard.locator(".todo-text").filter({hasText: "写一页阅读小结"}).waitFor();
  await mobileCard.locator(".edit-task").click(); await phone.locator("#task-location").fill("明德楼 · 302");
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
      {category:"会议",title:"数学建模 · 组队讨论",location:"线上会议",starts_at:"2026-10-03T19:00:00+08:00",ends_at:"2026-10-03T20:00:00+08:00",status:"todo",todos:[{id:"x",text:"确定分工与选题方向",done:false}]},
      {category:"活动",title:"校园夜跑计划",location:"东操场",starts_at:"2026-09-24T19:00:00+08:00",ends_at:"2026-09-24T20:00:00+08:00",status:"done",todos:[{id:"x",text:"完成 3 公里",done:true}]},
      {category:"活动",title:"分享会 · 做好每个小细节",location:"学生活动中心",starts_at:"2026-09-28T14:00:00+08:00",ends_at:"2026-09-28T16:00:00+08:00",status:"doing",todos:[{id:"x",text:"确认场地与设备",done:true},{id:"y",text:"准备活动物料",done:false}]}
    ];
    for (const sample of samples) { const r=await fetch("/api/tasks",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(sample)}); if(!r.ok) throw new Error("Fixture creation failed"); }
  });
  await page.evaluate(async()=>fetch("/api/tasks",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:"完成较晚的作业",due_at:"2026-09-01T00:00:00Z",status:"done"})}));
  database.prepare("UPDATE tasks SET completed_at=? WHERE title=?").run(new Date(Date.now()-3600000).toISOString(),"校园夜跑计划");
  await page.evaluate(async()=>fetch("/api/tasks",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:"完成较早的作业",due_at:"2026-09-01T00:00:00Z",status:"done"})}));
  database.prepare("UPDATE tasks SET completed_at=? WHERE title=?").run(new Date(Date.now()-3600000).toISOString(),"完成较早的作业");
  await page.evaluate(() => refresh());await category(page,"作业").click();
  await page.locator(".done .task-title").filter({hasText:"完成较晚的作业"}).waitFor();
  assert.deepEqual(await page.locator(".done .task-title").allTextContents(),["完成较晚的作业","完成较早的作业"]);
  assert.equal(await page.locator(".done .task").first().locator(".time-label").textContent(),"完成时间");
  const archiveId=await page.evaluate(async()=>{
    const response=await fetch("/api/tasks",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({category:"作业",title:"归档检查 · 已提交报告",location:"实验室",due_at:"2026-09-01T12:00:00Z",status:"done",todos:[{id:"archive-todo",text:"最终检查",done:true}],links:[{label:"参考文档",url:"https://example.com/archive"}]})});
    return (await response.json()).id;
  });
  database.prepare("UPDATE tasks SET completed_at=? WHERE id=?").run(new Date(Date.now()-8*86400000).toISOString(),archiveId);
  await page.evaluate(() => refresh());await page.locator("#archive-button").click();
  await page.getByRole("button",{name:"查看归档：归档检查 · 已提交报告",exact:true}).click();
  await page.locator("#archive-detail-dialog").waitFor({state:"visible"});
  assert.ok(await page.locator("#archive-detail").getByText("地点 · 实验室",{exact:true}).isVisible());
  assert.ok(await page.locator("#archive-detail").getByText("☑ 最终检查",{exact:true}).isVisible());
  await mkdir("data/screenshots",{recursive:true});await page.screenshot({path:"data/screenshots/archive-detail.png"});
  await page.getByRole("button",{name:"关闭详情",exact:true}).click();
  await page.screenshot({path:"data/screenshots/archive.png"});
  await page.locator("#archive-categories button").filter({hasText:"活动"}).click();
  await page.locator("#archive-list .archive-empty").waitFor();
  await page.locator("#archive-categories button").filter({hasText:"作业"}).click();
  await page.getByRole("button",{name:"删除归档：归档检查 · 已提交报告",exact:true}).click();
  await page.locator("#confirm-delete").click();await page.locator("#archive-list .archive-empty").waitFor();
  await page.getByRole("button",{name:"关闭归档",exact:true}).click();
  await page.evaluate(async()=> {
    const response=await fetch("/api/tasks",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({category:"作业",title:"很长的任务标题".repeat(12),due_at:"2026-10-01T16:15:00Z"})});
    if(!response.ok)throw new Error("Calendar fixture failed");
    await fetch("/api/tasks",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({category:"作业",title:"待补充日期的导入任务",due_at:"2026-10-01T00:00:00Z"})});
  });
  database.prepare("UPDATE tasks SET due_at=NULL WHERE title=?").run("待补充日期的导入任务");
  await page.evaluate(() => refresh());await category(page,"总览").click();
  await page.evaluate(()=>{calendarMonth="2026-10";selectedDay="2026-10-02";renderCalendar();});
  assert.equal(await page.title(),"RUChecklist");
  assert.equal(await page.locator(".topbar,.focus-note,#sync-state").count(),0);
  assert.equal(await page.locator("#board [data-date='2026-10-02'] .day-task").count(),2);
  assert.equal(await page.locator("#board [data-date='2026-10-02'] .day-more").textContent(),"+1 项");
  assert.equal(await page.locator(".day-list .task").count(),3);
  // UTC 16:15 belongs to the next Beijing date; ranges include both ends.
  assert.equal(await page.locator("#board [data-date='2026-10-01'] .day-task").count(),1);
  await page.locator("[data-date='2026-10-08']").click();
  assert.equal(await page.locator("[data-date='2026-10-08']").getAttribute("aria-pressed"),"true");
  assert.match(await page.locator(".day-list .task-title").textContent(),/课程研究/);
  await page.locator("[data-date='2026-10-09']").click();assert.equal(await page.locator(".day-empty").count(),1);
  await page.getByRole("button",{name:"下个月",exact:true}).click();assert.match(await page.locator(".calendar-toolbar h2").textContent(),/11 月/);
  await page.getByRole("button",{name:"上个月",exact:true}).click();
  await page.locator("[data-date='2026-10-01']").press("ArrowLeft");assert.match(await page.locator(".calendar-toolbar h2").textContent(),/9 月/);
  await page.getByRole("button",{name:"下个月",exact:true}).click();
  await page.locator(".undated-button").click();assert.equal(await page.locator(".day-list .task-title").textContent(),"待补充日期的导入任务");
  await page.locator("[data-date='2026-10-02']").click();
  const homework=page.locator(".day-list .task").filter({has:page.locator("h3",{hasText:"数据结构"})});
  const homeworkId=await homework.getAttribute("data-task-id");
  await saved(page,()=>homework.locator(".task-status").selectOption("done"));
  await page.waitForFunction(()=>!document.querySelector("article[data-busy]"));
  let completed=database.prepare("SELECT completed_at,due_at,status FROM tasks WHERE id=?").get(homeworkId);
  assert.equal(completed.status,"done");assert.ok(completed.completed_at);assert.equal(completed.due_at,"2026-10-02T15:59:00.000Z");
  assert.equal(await homework.count(),0);
  assert.equal(await page.locator(".calendar .day-task").filter({hasText:"数据结构"}).count(),0);
  await page.getByRole("button",{name:"今天",exact:true}).click();
  assert.equal(await page.locator(`article[data-task-id="${homeworkId}"]`).count(),0);
  assert.equal(await page.locator(".calendar .day-task").filter({hasText:"完成较"}).count(),0);
  await page.evaluate(()=>calendarSelect("2026-09-24"));
  assert.equal(await page.locator(".day-list .task-title").textContent(),"校园夜跑计划");
  await category(page,"作业").click();
  const completedCard=page.locator(`article[data-task-id="${homeworkId}"]`);await completedCard.waitFor();
  await saved(page,()=>completedCard.locator(".task-status").selectOption("todo"));
  await page.waitForFunction(()=>!document.querySelector("article[data-busy]"));
  assert.equal(database.prepare("SELECT completed_at FROM tasks WHERE id=?").get(homeworkId).completed_at,null);
  await category(page,"总览").click();
  await page.evaluate(()=>{calendarMonth="2026-10";selectedDay="2026-10-02";renderCalendar();});
  assert.equal(await homework.count(),1);
  // A failed direct status update preserves the task and shows its actual state.
  await page.route(`**/api/tasks/${homeworkId}`,route=>route.fulfill({status:409,contentType:"application/json",body:JSON.stringify({error:"任务已在其他设备修改，请刷新后重试"})}),{times:1});
  await homework.locator(".task-status").selectOption("doing");
  await page.waitForFunction(()=>!document.querySelector("article[data-busy]"));
  assert.equal(await homework.locator(".task-status").inputValue(),"todo");
  assert.match(await page.locator("#toast").textContent(),/其他设备/);
  await mkdir("data/screenshots", {recursive: true});
  await page.screenshot({path:"data/screenshots/desktop.png",fullPage:true});
  await phone.evaluate(() => refresh()); await category(phone, "总览").click();
  await phone.evaluate(()=>{calendarMonth="2026-10";selectedDay="2026-10-02";renderCalendar();scrollTo(0,0);});
  await phone.screenshot({path:"data/screenshots/mobile.png",fullPage:true});
  await phone.screenshot({path:"data/screenshots/mobile-top.png"});
  for(const width of [320,375,430,768]) {
    await phone.setViewportSize({width,height:844});assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`overflow at ${width}px`);
    assert.equal(await phone.locator(".day-task").first().evaluate(node=>getComputedStyle(node).textOverflow),"ellipsis");
  }
  const zip=await desktop.request.get(origin+"/extension.zip");assert.equal(zip.status(),200);assert.equal((await zip.body()).subarray(0,2).toString(),"PK");
  await page.evaluate(()=>{
    let enabled=true;window.testScanCount=0;
    window.addEventListener("message",event=>{
      if(event.data?.kind!=="campus-board-command") return;
      const {id,command}=event.data;
      if(command==="configure") enabled=event.data.enabled;
      if(command==="scan") window.testScanCount++;
      window.postMessage({kind:"campus-board-reply",id,result:command==="status"?{version:"1.5.0",connected:true,enabled,sourceResults:{}}:{ok:true}},location.origin);
    });
  });
  await page.locator("#sources-button").click();await page.waitForFunction(()=>document.getElementById("collector-state").textContent.includes("已连接"));
  await page.locator("#collector-scan").click();await page.waitForFunction(()=>window.testScanCount===1);
  await page.locator("#sync-settings summary").click();await page.locator("#collector-enabled").uncheck();await page.waitForFunction(()=>document.getElementById("collector-state").textContent.includes("已暂停"));
  assert.equal(await page.locator("#collector-scan").isDisabled(),true);
  await page.route("**/api/cloud",route=>route.fulfill({json:{available:true,enabled:true,sources:{smartestu:{authorized:true,last_success:new Date().toISOString(),count:3,status_count:3,changed:0}}}}));
  let cloudRuns=0;
  await page.route("**/api/cloud/run",route=>{cloudRuns++;return route.fulfill({json:{ok:true}});});
  await page.evaluate(()=>checkCloud());assert.equal(await page.locator("#collector-scan").isDisabled(),false);
  await page.locator("#collector-scan").click();await page.waitForFunction(()=>!syncing);
  assert.equal(cloudRuns,1);assert.equal(await page.evaluate(()=>window.testScanCount),1);
  assert.match(await page.locator("#sources-list").textContent(),/已同步/);
  await page.locator("#sync-settings summary").click();
  await page.screenshot({path:"data/screenshots/sources.png"});
  await page.locator("#sources-dialog .close-dialog").click();
  await category(page, "活动").click(); await page.locator("#add-task").click();
  assert.equal(await page.locator("#dialog-title").textContent(), "添加活动");
  await page.screenshot({path:"data/screenshots/form.png"});
  await page.locator("#task-dialog .close-dialog").first().click();
  const scheduleDate=await page.evaluate(()=>localInput(new Date()).slice(0,10));
  const weekStart=await page.evaluate(day=>monday(day),scheduleDate);
  const timetable={semester:"term-a",label:"2026–2027 学年秋",slots:[
    {label:"第一大节",period:"1–2",start:"08:00",end:"09:30"},{label:"第二大节",period:"3–4",start:"10:00",end:"11:30"},
    {label:"第三大节",period:"5–6",start:"12:00",end:"13:30"},{label:"第四大节",period:"7–8",start:"14:00",end:"15:30"},
    {label:"第五大节",period:"9–10",start:"16:00",end:"17:30"},{label:"第六大节",period:"11–12",start:"18:00",end:"19:30"}],days:[]};
  for(let i=0;i<21;i++)timetable.days.push({week:4+Math.floor(i/7),weekday:i%7+1,date:new Date(Date.parse(weekStart)+i*86400000).toISOString().slice(0,10)});
  database.prepare("INSERT INTO settings(key,value) VALUES (?,?)").run("timetable:term-a",JSON.stringify(timetable));
  await page.evaluate(async ({day,weekStart})=>{
    for(const week of [4,5]) await api("/api/tasks","POST",{category:"课程",title:"教学周课表验证",location:"明德楼 101",starts_at:`${shiftDay(weekStart,(week-4)*7)}T08:00:00+08:00`,ends_at:`${shiftDay(weekStart,(week-4)*7)}T09:30:00+08:00`,details:{semester:"term-a",semester_label:"2026–2027 学年秋",teacher:"示例教师",week:String(week),weekday:"1",period:"1–2节"}});
    const names=["线性代数","概率论","数据结构","英语阅读","体育"];
    for(let i=0;i<names.length;i++)await api("/api/tasks","POST",{category:"课程",title:names[i],location:`示例教室 ${i+201}`,starts_at:`${shiftDay(weekStart,i+1)}T${i%2?"14":"10"}:00:00+08:00`,ends_at:`${shiftDay(weekStart,i+1)}T${i%2?"15":"11"}:30:00+08:00`,details:{semester:"term-a",teacher:"示例教师",campus:"示例校区",week:"4",weekday:String(i+2),period:i%2?"7–8节":"3–4节"}});
    await api("/api/tasks","POST",{category:"课程",title:"上学期课程",starts_at:"2026-04-01T08:00:00+08:00",ends_at:"2026-04-01T09:30:00+08:00",details:{semester:"term-old",semester_label:"2025–2026 学年春",week:"2"}});
    await api("/api/tasks","POST",{category:"考试",title:"期中考试验证",location:"示例考场",starts_at:`${shiftDay(day,2)}T09:00:00+08:00`,ends_at:`${shiftDay(day,2)}T11:00:00+08:00`,details:{seat:"28"}});
    await refresh();
  },{day:scheduleDate,weekStart});
  await category(page,"课程").click();
  assert.equal(await page.locator(".summary").isVisible(),false);
  assert.equal(await page.locator(".timetable thead th").count(),8);
  assert.equal(await page.locator(".timetable tbody tr").count(),6);
  assert.equal(await page.locator("#course-semester").inputValue(),"term-a");
  assert.equal(await page.locator(".course-block").filter({hasText:"教学周课表验证"}).count(),1);
  assert.match(await page.locator(".course-block").filter({hasText:"教学周课表验证"}).textContent(),/4–5周/);
  await page.locator("#course-week").selectOption("6");assert.equal(await page.locator(".course-block").count(),0);
  await page.locator("#course-week").selectOption("5");assert.equal(await page.locator(".course-block").count(),1);
  await page.locator("#course-semester").selectOption("term-old");assert.equal(await page.locator(".course-block h3").textContent(),"上学期课程");
  await page.locator("#course-semester").selectOption("term-a");
  await page.getByRole("button",{name:"查看课程：教学周课表验证",exact:true}).click();
  assert.equal(await page.locator("#course-occurrence option").count(),2);
  await page.locator("#course-detail .edit-task").click();assert.equal(await page.locator("#schedule-person").inputValue(),"示例教师");
  await page.locator("#task-title").fill("教学周课表验证 · 改名");await page.locator("#save-task").click();await page.locator("#task-dialog").waitFor({state:"hidden"});
  assert.equal(JSON.parse(database.prepare("SELECT overrides FROM tasks WHERE title=?").get("教学周课表验证 · 改名").overrides).includes("details"),false);
  await page.locator("#course-week").selectOption("6");await page.locator("#add-task").click();
  await page.locator("#task-title").fill("手动补课验证");
  await page.locator("#starts-at").fill(`${timetable.days[16].date}T14:00`);await page.locator("#ends-at").fill(`${timetable.days[16].date}T15:30`);
  await page.locator("#save-task").click();await page.locator("#task-dialog").waitFor({state:"hidden"});
  const addedCourse=page.locator('.timetable td[data-weekday="3"][data-start="14:00"] .course-block');await addedCourse.waitFor();assert.match(await addedCourse.textContent(),/手动补课验证/);
  await addedCourse.locator(".course-view").click();await page.locator("#course-detail .edit-task").click();
  await page.locator("#starts-at").fill(`${timetable.days[10].date}T10:00`);await page.locator("#ends-at").fill(`${timetable.days[10].date}T11:30`);
  await page.locator("#save-task").click();await page.locator("#task-dialog").waitFor({state:"hidden"});
  await page.locator("#course-week").selectOption("5");assert.match(await page.locator('.timetable td[data-weekday="4"][data-start="10:00"]').textContent(),/手动补课验证/);
  const moved=database.prepare("SELECT id,revision,details FROM tasks WHERE title=?").get("手动补课验证");assert.equal(JSON.parse(moved.details).week,"5");
  await page.evaluate(async task=>{await api(`/api/tasks/${task.id}`,"DELETE",{revision:task.revision});await refresh();},moved);
  await page.locator("#course-week").selectOption("all");
  await page.screenshot({path:"data/screenshots/courses.png",fullPage:true});
  await category(page,"考试").click();assert.match(await page.locator(".exam-group").textContent(),/2 天后/);assert.match(await page.locator(".exam-group").textContent(),/座位 · 28/);
  await page.screenshot({path:"data/screenshots/exams.png",fullPage:true});
  await phone.evaluate(()=>refresh());
  for(const section of ["课程","考试","会议","活动"]) {
    await category(phone,section).click();
    for(const width of [320,375,430,768]) {await phone.setViewportSize({width,height:844});assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${section} overflow at ${width}px`);}
  }
  await phone.setViewportSize({width:390,height:844});await category(phone,"课程").click();await phone.screenshot({path:"data/screenshots/courses-mobile.png",fullPage:true});
  assert.deepEqual(errors, []);
  console.log("PASS: Beijing monthly calendar, date selection, month/keyboard navigation, ranges, undated tasks, direct status and conflict handling, downloadable extension, unified cloud/local sync, completion order, archive filter/detail/delete, simulated board-to-extension controls, category inheritance, required title, location, detail/card todo CRUD, mouse/touch/keyboard sorting, two browser sessions, conflict draft retention, 320–768px layouts, timetable semester/week filters, recurring course grouping, course detail editing, hidden course summary, logo alignment, attachment upload/preview/download and shared links. Screenshots: data/screenshots/ (synthetic data only).");
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); database.close();
  await rm(directory, {recursive:true,force:true});
}
