// Optional browser check: install Playwright + Chromium, then run node ui-test.mjs.
// Uses a temporary database and an isolated browser; never touches the live board.
import assert from "node:assert/strict";
import {mkdtemp, mkdir, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createServer} from "node:http";
import {once} from "node:events";
import {createEnvironment} from "./local.mjs";
import worker,{RELEASE} from "./worker.mjs";
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const directory = await mkdtemp(join(tmpdir(), "campus-board-ui-"));
const {env, database} = await createEnvironment(directory, "isolated-ui-test");
database.prepare("INSERT INTO settings(key,value) VALUES ('read_release',?)").run(RELEASE.version);
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
  await desktop.addInitScript(()=>localStorage.setItem("ruchecklist-demo:personal","seen"));
  const page = await desktop.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog",dialog=>dialog.accept());
  async function login(page) {
    await page.goto(origin); await page.locator("#password").fill("isolated-ui-test");
    await page.locator("#login-form button[type=submit]").click(); await page.locator("#workspace").waitFor({state: "visible"});
    await page.waitForFunction(()=>messageReady);if(await page.locator("#messages-dialog").isVisible())await page.locator("#messages-read").click();
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
  await page.route("**/static/capture.js",async route=>{await new Promise(resolve=>setTimeout(resolve,300));await route.continue();},{times:1});
  await login(page);
  assert.equal(await page.title(),"RUCapture");
  assert.equal(await category(page,"课程").count(),0);assert.equal(await category(page,"记录").count(),1);
  assert.equal(await page.locator('.nav-heading,#board-caption').count(),0);
  const initialY=await page.locator('.brand-icon').first().evaluate(n=>n.getBoundingClientRect().y),initialIconX=await page.locator('#categories .nav-icon').first().evaluate(n=>n.getBoundingClientRect().x);
  const toggleBox=await page.locator('#sidebar-toggle').boundingBox(),brandBox=await page.locator('.brand-icon').first().boundingBox();assert.ok(toggleBox.x>brandBox.x);
  await page.locator('#sidebar-toggle').click();
  for(let frame=0;frame<8;frame++){await page.waitForTimeout(35);assert.ok(Math.abs(await page.locator('.brand-icon').first().evaluate(n=>n.getBoundingClientRect().y)-initialY)<1,'brand has no vertical jump');const iconX=await page.locator('#categories .nav-icon').first().evaluate(n=>n.getBoundingClientRect().x);assert.ok(iconX>=initialIconX-1 && iconX<=initialIconX+10,'navigation icon follows its short horizontal path');}
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#workspace').evaluate(n=>n.classList.contains('sidebar-collapsed')),true);
  assert.ok((await page.locator('.sidebar').boundingBox()).width<100);
  assert.equal(await page.locator('#user-avatar').isVisible(),true);
  assert.equal(await page.locator('.sidebar-divider').evaluate(n=>getComputedStyle(n).transform),'matrix(1, 0, 0, 1, -5, 0)');
  await page.locator('#sidebar-toggle').click();
  await page.locator('[data-view="axes"]').click();await page.getByRole('button',{name:'＋ 添加轴线',exact:true}).click();
  await page.locator('#axis-title').fill('学会摄影');await page.locator('#axis-content').fill('观察日常的光');await page.locator('#axis-save').click();await page.locator('#axis-dialog').waitFor({state:'hidden'});
  await page.evaluate(async()=>{
    const axis=axes[0];
    await api('/api/tasks','POST',{category:'作业',title:'摄影阅读',due_at:'2026-10-09T12:00:00Z',axis_id:axis.id,todos:[{id:'a',text:'阅读一章',done:false},{id:'b',text:'记下疑问',done:false},{id:'c',text:'整理笔记',done:false}]});
    await api('/api/tasks','POST',{category:'课程',title:'摄影课',starts_at:'2026-10-08T08:00:00Z',ends_at:'2026-10-08T09:00:00Z',axis_id:axis.id});
    const next=await api('/api/axes','POST',{title:'校园随记'});
    await api('/api/tasks','POST',{category:'记录',title:'雨后校园',starts_at:'2026-10-07T12:00:00Z',content:'抬头看到晚霞',axis_id:next.id});await refresh();
  });
  assert.equal(await page.locator('.axis-head').count(),2);
  const circle=page.locator('.axis-card circle').first(),box=await circle.boundingBox();
  const neighbor=await page.locator('.axis-line').nth(1).locator('.axis-head').getAttribute('transform');
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+box.height/2+250,{steps:12});await page.mouse.up();
  assert.notEqual(await page.locator('.axis-line').nth(1).locator('.axis-card').getAttribute('transform'),'translate(220,220)');
  assert.equal(await page.locator('#task-dialog').isVisible(),false,'node drag does not open editor');
  const scale=await page.evaluate(()=>axisScene.camera.z);await page.getByRole('button',{name:'放大画布',exact:true}).click();assert.ok(await page.evaluate(()=>axisScene.camera.z)>scale);
  await page.getByRole('button',{name:'复位画布',exact:true}).click();assert.equal(await page.evaluate(()=>axisScene.camera.z),1);
  for(const selector of ['.axis-head','.axis-tail']){
    const node=page.locator(selector).first(),before=await node.getAttribute('transform'),bounds=await node.boundingBox();
    await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();await page.waitForTimeout(200);await page.mouse.move(bounds.x+bounds.width/2+25,bounds.y+bounds.height/2+50,{steps:10});await page.mouse.up();
    assert.notEqual(await node.getAttribute('transform'),before,`${selector} is draggable`);
    assert.equal(await page.locator('#axis-dialog').isVisible(),false);assert.equal(await page.locator('#axis-add-dialog').isVisible(),false);
  }
  await page.locator('#save-layout').click();await page.waitForFunction(()=>!axisScene.dirty);
  const savedLayout=await page.evaluate(()=>JSON.stringify(axisScene.lines));
  await page.reload();await page.locator('#workspace').waitFor();await page.waitForFunction(()=>messageReady);if(await page.locator('#messages-dialog').isVisible())await page.locator('#messages-read').click();await page.locator('[data-view="axes"]').click();
  assert.equal(await page.evaluate(()=>JSON.stringify(axisScene.lines)),savedLayout,'saved layout survives reload');
  await page.locator('.axis-tail').first().click();await page.locator('#axis-add-dialog').getByRole('button',{name:'记录',exact:true}).click();
  assert.equal(await page.locator('#task-axis').inputValue(),await page.evaluate(()=>axes[0].id));
  assert.equal(await page.locator('#done-field').isVisible(),true);assert.equal(await page.locator('#range-fields').isVisible(),false);
  await page.locator('#task-title').fill('第一张照片');await page.locator('#record-time').fill('2026-10-06T20:00');await page.locator('#task-content').fill('看见树叶上的纹理');
  await page.locator('#save-task').click();await page.locator('#task-dialog').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>axisItems.filter(t=>t.axis_id===axes[0].id).sort(chronological)[0].title),'第一张照片');
  await page.locator('.axis-head').first().click();assert.equal(await page.locator('.axis-member').count(),3);
  await page.locator('.axis-member').first().getByRole('button',{name:'离轴'}).click();await page.waitForFunction(()=>document.querySelectorAll('.axis-member').length===2);
  assert.equal(await page.evaluate(()=>tasks.some(t=>t.title==='第一张照片' && !t.axis_id)),true);
  await page.getByRole('button',{name:'关闭轴线',exact:true}).click();
  // An unassigned card must not inherit the last axis used for creation.
  await page.evaluate(()=>openTask(tasks.find(t=>t.title==='第一张照片')));assert.equal(await page.locator('#task-axis').inputValue(),'');
  const trigger=page.locator('#task-axis').locator('..').locator('.select-trigger');const rect=await trigger.boundingBox(),arrow=await trigger.locator('.select-arrow').boundingBox();assert.ok(arrow.x>rect.x+rect.width-30,'chevron stays on the far right');
  await trigger.click();assert.equal(await trigger.getAttribute('aria-expanded'),'true');await page.keyboard.press('Escape');
  await page.locator('#task-dialog .close-dialog').first().click();

  await page.screenshot({path:'data/screenshots/capture-axes.png',animations:'disabled',fullPage:true});
  await category(page,'记录').click();assert.equal(await page.locator('.record-column .task').count(),2);assert.equal(await page.locator('.summary').isVisible(),true);
  assert.deepEqual(await page.locator('.summary>div>span:first-child').allTextContents(),['记录总数','近七天记录数','今日记录数','待完善记录数']);assert.ok((await page.locator('.summary small').allTextContents()).every(Boolean));assert.equal(await page.locator('.record-column > h2').count(),2);assert.equal(await page.locator('.record-column .record-group').count(),2);
  await page.getByRole('checkbox',{name:'已完善：第一张照片',exact:true}).check();await page.waitForFunction(()=>tasks.find(t=>t.title==='第一张照片').status==='done');
  assert.equal(await page.locator('.record-column').nth(1).locator('.task').count(),1);
  await page.screenshot({path:'data/screenshots/capture-records.png',animations:'disabled',fullPage:true});
  await category(page,'作业').click();const card=page.locator('article.task').first();
  let requests=0;await page.route('**/api/tasks/*',async route=>{if(route.request().method()==='PATCH'){requests++;await new Promise(resolve=>setTimeout(resolve,250));}await route.continue();});
  await card.getByRole('checkbox',{name:'完成：阅读一章',exact:true}).check();
  assert.equal(await card.locator('.todo-text').nth(1).evaluate(n=>getComputedStyle(n).opacity),'1');assert.equal(await card.locator('.todo-text').nth(1).isDisabled(),false);
  await card.getByRole('checkbox',{name:'完成：记下疑问',exact:true}).check();
  await page.waitForFunction(()=>!document.querySelector('.checklist[data-busy]'));assert.equal(requests,2);
  await page.reload();await page.locator('#workspace').waitFor();await page.waitForFunction(()=>messageReady);if(await page.locator('#messages-dialog').isVisible())await page.locator('#messages-read').click();await category(page,'作业').click();
  assert.equal(await page.getByRole('checkbox',{name:'完成：阅读一章',exact:true}).isChecked(),true);assert.equal(await page.getByRole('checkbox',{name:'完成：记下疑问',exact:true}).isChecked(),true);
  await page.locator('.task-footer-main .select-trigger').click();await page.getByRole('option',{name:'进行中',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('article[data-busy]'));assert.equal(await page.locator('.task-status').inputValue(),'doing');
  await category(page,'总览').click();await page.evaluate(()=>calendarSelect('2026-10-08'));assert.equal(await page.locator('.day-list .task-title').textContent(),'摄影课');
  const counts=await page.locator('.summary strong').allTextContents();assert.equal(counts[0],'1');
  for(const width of [390,320,768]){
    await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`overflow ${width}`);
    await page.locator('[data-view="axes"]').click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`axes overflow ${width}`);
    await page.locator('#sidebar-toggle').click();await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`collapsed overflow ${width}`);await page.locator('#sidebar-toggle').click();
    await page.locator('[data-view="calendar"]').click();
  }
  await page.setViewportSize({width:390,height:844});await page.locator('[data-view="axes"]').click();await page.screenshot({path:'data/screenshots/capture-mobile.png',animations:'disabled',fullPage:true});
  const touchContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await touchContext.addInitScript(()=>localStorage.setItem("ruchecklist-demo:personal","seen"));const phone=await touchContext.newPage();phone.on('pageerror',error=>errors.push(error.message));await login(phone);
  await phone.locator('[data-view="axes"]').tap();await phone.locator('.axes-canvas').scrollIntoViewIfNeeded();
  const touch=await touchContext.newCDPSession(phone),bounds=await phone.locator('.axes-canvas').boundingBox(),y=bounds.y+220;
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:bounds.x+90,y,id:1},{x:bounds.x+240,y,id:2}]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:bounds.x+60,y,id:1},{x:bounds.x+270,y,id:2}]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.ok(await phone.evaluate(()=>axisScene.camera.z)>1,'two-finger canvas zoom');
  const cameraX=await phone.evaluate(()=>axisScene.camera.x);
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:bounds.x+150,y,id:1}]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:bounds.x+190,y:y+20,id:1}]});await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.ok(Math.abs(await phone.evaluate(()=>axisScene.camera.x)-cameraX-40)<1,'touch canvas pan');
  assert.deepEqual(errors,[]);console.log('PASS: RUCapture navigation, records, axes, node dragging/repulsion/zoom/reset, ordered membership/detach, responsive collapse, queued todo checks without dimming, themed select and course calendar.');
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));database.close();await rm(directory,{recursive:true,force:true});}
