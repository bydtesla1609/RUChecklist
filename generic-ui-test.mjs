import assert from "node:assert/strict";
import {readFile,mkdir} from "node:fs/promises";
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || "playwright"),browser=await chromium.launch({headless:true});
const files=await Promise.all(["generic-parser.js","generic-content.js"].map(name=>readFile(new URL(`./extension/${name}`,import.meta.url),"utf8")));
const table='<main><table><thead><tr><th>作业名称</th><th>截止时间</th><th>状态</th></tr></thead><tbody><tr><td><a href="/work/1">第一次作业</a></td><td>2026/10/12 22:00</td><td>未提交</td></tr><tr><td><a href="/work/2">第二次作业</a></td><td>2026-10-13 23:00</td><td>已结束</td></tr><tr><td><a href="/work/3">不需要的条目</a></td><td>2026-10-14 22:00</td><td>已完成</td></tr></tbody></table></main>';
let saved=null,html='<form>'+table.replace('第一次作业</a>','第一次作业</a><span hidden>must-not-copy</span><input value="must-not-copy"><textarea hidden>must-not-copy</textarea>')+'</form>',imports=[];
try {
  const context=await browser.newContext({viewport:{width:1280,height:960}}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.stack));
  await context.route('https://class.example/**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta charset="utf-8"><style>body{font:18px sans-serif;padding:30px}td{padding:15px}.tiles{display:flex;gap:30px}.tile{padding:20px;border:1px solid}</style></head><body>${html}</body></html>`}));
  await page.exposeFunction('testMessage',async message=>{
    if(message.type==='generic-context')return {binding:'synthetic-account',rule:saved,review:false};
    assert.equal(message.type,'generic-import');imports.push(message);
    if(message.confirmed)saved={fields:message.rule,automatic:message.tasks.every(item=>item.stable),excluded:message.excluded};
    return {ok:true,changed:message.tasks.length};
  });
  await page.addInitScript(()=>{
    // Open the otherwise closed UI shadow root only in this synthetic test.
    const attach=Element.prototype.attachShadow;Element.prototype.attachShadow=function(options){return attach.call(this,{...options,mode:'open'});};
    window.messages=[];window.chrome={runtime:{sendMessage:async message=>{const result=await window.testMessage(message);messages.push(message);return result;},onMessage:{addListener(){}}}};
  });
  async function open(url='https://class.example/list'){
    await page.goto(url);for(const content of files)await page.addScriptTag({content});
    await page.locator('#ruchecklist-reader').waitFor();
  }
  const ui=page.locator('#ruchecklist-reader');
  await open();await ui.getByRole('checkbox').first().waitFor();assert.equal(imports.length,0,'first recognition must not import');
  const queryIds=await page.evaluate(async()=>{
    const links=[...document.querySelectorAll('tbody a')],original=links.map(link=>link.href);
    links[0].href='/work?page=1';links[1].href='/work?page=2';
    const tasks=await CampusGeneric.extract(CampusGeneric.detect(),location.href);
    links.forEach((link,i)=>link.href=original[i]);return tasks.map(task=>task.external_id);
  });assert.equal(new Set(queryIds).size,3,'pagination parameters in task links can identify different tasks');
  assert.match(await ui.locator('section').innerText(),/完成状态未识别/);
  await ui.getByRole('checkbox',{name:'导入：不需要的条目',exact:true}).uncheck();
  await mkdir('data/screenshots',{recursive:true});await page.screenshot({path:'data/screenshots/generic-preview.png'});
  await ui.getByRole('button',{name:'确认导入并保存规则',exact:true}).click();await ui.locator('[role=status]').filter({hasText:'已导入 2 项'}).waitFor();
  assert.equal(imports.length,1);assert.equal(imports[0].tasks[0].due_at,'2026-10-12T14:00:00.000Z');assert.equal(imports[0].tasks[1].status,undefined);assert.equal(saved.automatic,true);
  const originalId=imports[0].tasks[0].external_id;
  await open();await page.waitForFunction(()=>messages.some(message=>message.type==='generic-import'));
  assert.equal(imports.at(-1).confirmed,false);assert.equal(imports.at(-1).tasks.length,2);
  assert.ok(!JSON.stringify(imports).includes('must-not-copy'),'hidden text and form values are never imported');
  await page.locator('tbody tr').first().locator('td').nth(2).evaluate(node=>node.textContent='已提交');
  await page.waitForFunction(()=>messages.filter(message=>message.type==='generic-import').length>=2);
  assert.equal(imports.at(-1).tasks[0].status,'done');assert.equal(imports.at(-1).tasks[0].external_id,originalId);
  await page.evaluate(()=>{history.pushState({},'', '/list?page=2');document.querySelector('tbody').append(document.querySelector('tbody tr'));});
  await page.waitForFunction(()=>messages.filter(message=>message.type==='generic-import').length>=3);
  assert.equal(imports.at(-1).tasks.find(item=>item.title==='第一次作业').external_id,originalId);
  // A new layout can be taught using clicks; the title link must not navigate.
  saved=null;imports=[];
  html='<main><div class="tiles"><div class="tile"><a href="/work/10">自定义任务甲</a><div class="due">2026-11-01 18:30</div><span class="state">已提交</span></div><div class="tile"><a href="/work/11">自定义任务乙</a><div class="due">2026-11-02 19:30</div><span class="state">未提交</span></div></div></main>';
  await open('https://class.example/custom');await ui.locator('[role=status]').filter({hasText:'暂未识别'}).waitFor();
  for(const [label,selector] of [['标题','.tile a'],['截止时间','.tile .due'],['完成状态','.tile .state']]){
    await ui.getByRole('button',{name:`点选${label}`,exact:true}).click();await page.locator(selector).first().click();
    await ui.getByRole('checkbox').first().waitFor();
  }
  assert.equal(page.url(),'https://class.example/custom');await ui.getByRole('button',{name:'确认导入并保存规则'}).click();
  await ui.locator('[role=status]').filter({hasText:'已导入 2 项'}).waitFor();assert.equal(imports[0].tasks[0].status,'done');assert.equal(imports[0].tasks[0].due_at,'2026-11-01T10:30:00.000Z');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'data/screenshots/generic-mobile.png'});
  const box=await ui.locator('section').boundingBox();assert.ok(box.x>=0 && box.x+box.width<=390 && box.height<=844);
  // Without distinct task links, confirmation is required every time.
  saved=null;imports=[];html=table.replaceAll(/<a href="[^"]+">|<\/a>/g,'');
  await open();await ui.getByRole('checkbox').first().waitFor();await ui.getByRole('button',{name:'确认导入并保存规则'}).click();await ui.locator('[role=status]').filter({hasText:'已导入 3 项'}).waitFor();assert.equal(saved.automatic,false);
  await open();await ui.getByRole('button',{name:'RUChecklist · 读取任务',exact:true}).waitFor();assert.equal(imports.length,1);
  await ui.getByRole('button',{name:'RUChecklist · 读取任务',exact:true}).click();
  await page.locator('tbody tr').nth(1).locator('td').first().evaluate(node=>node.textContent='第一次作业');await ui.getByRole('button',{name:'重新读取',exact:true}).click();await ui.locator('[role=status]').filter({hasText:'无法区分'}).waitFor();assert.equal(await ui.getByRole('button',{name:'确认导入并保存规则'}).isDisabled(),true);
  assert.deepEqual(errors,[]);
  console.log('PASS: local preview before import, selection, manual field picking without navigation, saved rules, pagination-stable IDs, completion updates, ambiguous identities require review, and mobile panel. Synthetic website and extension bridge; user browser untouched.');
} finally {await browser.close();}
