// Render the real UI with fictional fixtures in an isolated browser/database.
// All network requests are restricted to this process's loopback server.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createEnvironment} from './local.mjs';
import worker,{RELEASE} from './worker.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const tempRoot=resolve(tmpdir()),dir=await mkdtemp(join(tempRoot,'rucapture-promo-'));
const output=resolve('data/promotional'),raw=join(output,'screens');await mkdir(raw,{recursive:true});
const {env,database}=await createEnvironment(dir,'fictional-preview-only');
database.prepare("INSERT INTO settings(key,value) VALUES('read_release',?)").run(RELEASE.version);
const now='2026-10-06T10:00:00.000Z';
const links=[{source:'smartestu',name:'SmartEstu',url:'https://smartestu.cn/assignment'},
 {source:'ketangpai',name:'课堂派',url:'https://www.ketangpai.com/'},
 {source:'zhifz',name:'智夫子',url:'https://www.zhifz.com/#/zuoye'},
 {source:'ruc_courses',name:'人大课表',url:'https://jw.ruc.edu.cn/Njw2017/index.html#/'}];
const cloud={available:true,enabled:true,interval_minutes:30,sources:Object.fromEntries(links.slice(0,3).map((link,i)=>[link.source,{authorized:true,last_success:now,count:[3,2,1][i],status_count:[3,2,1][i],error:null}]))};
database.prepare("INSERT INTO settings(key,value) VALUES('source_links',?)").run(JSON.stringify(links));
const server=createServer(async(req,res)=>{
 const request=new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})});
 const result=await worker.fetch(request,env);res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
});
server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try{
 browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1600,height:1580},deviceScaleFactor:2,locale:'zh-CN',timezoneId:'Asia/Shanghai'});
 const forbidden=[];
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin!==origin){forbidden.push(url.origin);await route.abort();return;}
  if(url.pathname==='/api/cloud'){await route.fulfill({json:cloud});return;}
  if(url.pathname==='/api/cloud/run'){await route.fulfill({json:{smartestu:{count:3},ketangpai:{count:2},zhifz:{count:1}}});return;}
  await route.continue();
 });
 await context.addInitScript(()=>{
  localStorage.setItem('ruchecklist-demo:personal','seen');
  window.addEventListener('message',event=>{if(event.data?.kind!=='campus-board-command')return;const m=event.data;window.postMessage({kind:'campus-board-reply',id:m.id,result:m.command==='status'?{version:'1.9.3',connected:true,enabled:true,sourceResults:{}}:{ok:true}},location.origin);});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.clock.setFixedTime(new Date(now));await page.goto(origin);
 await page.locator('#password').fill('fictional-preview-only');await page.locator('#login-form button[type=submit]').click();await page.locator('#workspace').waitFor();
 await page.waitForFunction(()=>messageReady);
 if(await page.locator('#messages-dialog').isVisible())await page.locator('#messages-read').click();
 const fixtures=await page.evaluate(async()=>{
  accountName='林间笔记';updateAccountCard();
  const axes=[];for(const title of ['数据分析','运动习惯','城市随记'])axes.push(await api('/api/axes','POST',{title,content:{数据分析:'从概念到实践，每周完成一个小目标。',运动习惯:'循序渐进，让运动成为日常。',城市随记:'用文字和照片，留住经过的风景。'}[title],starts_at:'2026-10-01T00:00:00Z',ends_at:'2026-11-01T00:00:00Z'}));
  const date=(day,hour=20)=>`2026-10-${String(day).padStart(2,'0')}T${String(hour-8).padStart(2,'0')}:00:00.000Z`;
  const checklist=(labels,done=0)=>labels.map((text,i)=>({id:crypto.randomUUID(),text,done:i<done}));
  const cards=[
   {category:'作业',title:'数据可视化练习',due_at:date(8,22),course:'数据分析入门',content:'用一张图，讲清一组数据。',todos:checklist(['整理样本数据','绘制图表并写下结论']),status:'todo',axis_id:axes[0].id,source:'smartestu'},
   {category:'作业',title:'阅读与短评',due_at:date(12,22),course:'城市与社会',todos:checklist(['阅读指定章节','写一段 300 字短评']),status:'todo',source:'ketangpai'},
   {category:'作业',title:'问卷数据清理',due_at:date(10,22),course:'社会调查方法',todos:checklist(['检查缺失值','统一变量命名','记录处理过程'],2),status:'doing',axis_id:axes[0].id,source:'smartestu'},
   {category:'作业',title:'概率模型练习',due_at:date(11,22),course:'概率论基础',todos:checklist(['完成计算题','整理易错步骤'],1),status:'doing',source:'zhifz'},
   {category:'作业',title:'Python 热身练习',due_at:date(5,22),course:'数据分析入门',todos:checklist(['完成函数练习','运行并提交'],2),status:'done',axis_id:axes[0].id,source:'smartestu'},
   {category:'作业',title:'读书笔记 · 第一次',due_at:date(4,22),course:'城市与社会',todos:checklist(['摘录三个观点','写下自己的问题'],2),status:'done',source:'ketangpai'},
   {category:'考试',title:'概率论阶段测验',starts_at:date(16,10),ends_at:date(16,11),location:'教学楼 A201',content:'复习随机变量与常见分布。',source:'ruc_exams'},
   {category:'考试',title:'英语听说测评',starts_at:date(23,14),ends_at:date(23,15),location:'语言实验室',source:'ruc_exams'},
   {category:'会议',title:'小组项目讨论',starts_at:date(9,19),ends_at:date(9,20),location:'图书馆研讨室',content:'确定选题、分工与下一次检查时间。'},
   {category:'会议',title:'月末复盘',starts_at:date(28,20),ends_at:date(28,21)},
   {category:'活动',title:'轻松跑 3 公里',starts_at:date(7,18),ends_at:date(7,19),location:'校园操场',axis_id:axes[1].id},
   {category:'活动',title:'周末骑行',starts_at:date(17,10),ends_at:date(17,12),location:'滨河绿道',axis_id:axes[1].id},
   {category:'活动',title:'街巷摄影散步',starts_at:date(18,15),ends_at:date(18,17),location:'老城街区',axis_id:axes[2].id},
   {category:'活动',title:'晨间拉伸',starts_at:date(5,8),ends_at:date(5,9),status:'done',axis_id:axes[1].id},
   {category:'记录',title:'第一张图表的发现',starts_at:date(6,17),content:'换一种图表，数据之间的关系忽然清晰了。',status:'done',axis_id:axes[0].id},
   {category:'记录',title:'今天的一个小进步',starts_at:date(8,21),content:'把“等有空再做”，换成先做十分钟。\n小小的一步，也值得记下来。',status:'done'},
   {category:'记录',title:'跑步后的好心情',starts_at:date(10,20),content:'不追求速度，先找到舒服的节奏。',axis_id:axes[1].id},
   {category:'记录',title:'窗边的一束光',starts_at:date(3,16),content:'午后的光落在书页上。',status:'done',axis_id:axes[2].id},
   {category:'记录',title:'旧书店偶遇',starts_at:date(14,17),content:'找到一本写满批注的旧书，像遇见另一位读者。',status:'done',axis_id:axes[2].id}
  ];
  for(const day of [8,13,15,20,22,27])cards.push({category:'课程',title:day%2?'设计与生活':'数据分析入门',starts_at:date(day,10),ends_at:date(day,12),location:'教学楼 B302',details:{teacher:'林老师',week:'6',period:'3–4 节'},source:'ruc_courses'});
  const created=[];for(const {source,course,...card} of cards){const result=await api('/api/tasks','POST',card);created.push({id:result.id,source,course,title:card.title});}return created;
 });
 for(const task of fixtures){
  if(task.source)database.prepare('UPDATE tasks SET source=?,source_url=?,course=? WHERE id=?').run(task.source,task.source==='ruc_courses'?'https://jw.ruc.edu.cn/student/student-choice-center/syllabus-entry-check.html#/?param=fictional-preview':`https://example.com/demo/${task.id}`,task.course||'',task.id);
 }
 database.prepare("UPDATE tasks SET completed_at='2026-10-06T08:00:00.000Z' WHERE status='done'").run();
 database.prepare('UPDATE sources SET last_seen=?,error=NULL,task_count=(SELECT count(*) FROM tasks WHERE tasks.source=sources.id)').run(now);
 await page.evaluate(async()=>{lastPayload='';await refresh();calendarSelect('2026-10-08');});
 const shots=[];
 async function shoot(name){await page.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.getElementById('toast').hidden=true;document.activeElement.blur();window.scrollTo(0,0);});await page.waitForTimeout(250);const path=join(raw,name+'.png');await page.screenshot({path,fullPage:true,animations:'disabled'});shots.push(path);}
 await shoot('01-calendar');
 await page.setViewportSize({width:1600,height:1160});await page.locator('[data-view="axes"]').click();
 // Arrange fictional nodes with the same keyboard gestures available to users.
 for(const [line,node,keys] of [[0,2,['ArrowDown','ArrowDown']],[0,3,['ArrowUp']],[1,1,['ArrowUp','ArrowUp']],[1,3,['ArrowDown']],[2,2,['ArrowDown','ArrowDown']]]){
  const target=page.locator(`.axis-node[data-line="${line}"][data-node="${node}"]`);await target.focus();for(const key of keys)await page.keyboard.press(key);
 }
 await page.locator('#save-layout').click();await page.waitForFunction(()=>!axisScene.dirty);await page.locator('.axes-canvas svg').focus();await shoot('02-axes');
 await page.setViewportSize({width:1600,height:1520});await page.locator('#categories button').filter({has:page.locator('span',{hasText:/^作业$/})}).click();await shoot('03-homework');
 await page.setViewportSize({width:1040,height:1320});await page.locator('#sources-button').click();await page.waitForFunction(()=>collectorState?.connected && sourceLinksState?.length===4);
 for(let step=1;step<5;step++)await page.locator('#sync-next').click();await page.locator('#collector-scan').click();await page.waitForFunction(()=>!syncing);await page.evaluate(()=>document.getElementById('toast').hidden=true);
 await page.waitForTimeout(250);const syncPath=join(raw,'04-sync.png');await page.screenshot({path:syncPath,animations:'disabled'});shots.push(syncPath);
 assert.deepEqual(forbidden,[],'the preview must never contact a real website');assert.deepEqual(errors,[]);
 const specs=[
  ['01-日历总览','把日子，看得更清楚。','课程、作业、考试与日常记录，放回同一本日历。',['按天查看安排','未来 7 天提醒','添加不同类型的卡片'],'CALENDAR / 01'],
  ['02-轴线视图','让每一步，都有来处。','用一条轴线，串起目标、行动与途中的感受。',['任务与记录归轴','拖动节点 · 缩放画布','保存自己的布局'],'TIMELINES / 02'],
  ['03-作业看板','把待办，变成已完成。','从截止时间到下一件小事，进度清清楚楚。',['三栏管理进度','可勾选的待办清单','手动归档 · 7 天自动归档'],'ASSIGNMENTS / 03'],
  ['04-网站同步','分散的作业，在这里汇合。','五步连接常用网站，一键同步，随时查看。',['逐步配置','云端定时同步','各网站状态一目了然'],'SYNC / 04']
 ];
 const icon=Buffer.from(await readFile('static/icon.svg')).toString('base64'),gallery=[];
 for(let i=0;i<specs.length;i++){
  const [name,title,subtitle,tags,code]=specs[i],screenshot=Buffer.from(await readFile(shots[i])).toString('base64');
  const html=`<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;font-family:"Microsoft YaHei",system-ui,sans-serif;background:#0d1022;color:#f0efff}.poster{width:1800px;padding:76px 84px 44px;position:relative;overflow:hidden;background:radial-gradient(ellipse at 90% 0%,#6c54af35,transparent 42%),radial-gradient(ellipse at 0% 100%,#47778a24,transparent 45%),#0d1022}.top{display:flex;align-items:center;justify-content:space-between}.brand{display:flex;align-items:center;gap:15px;font-size:27px;font-weight:650;letter-spacing:.3px}.brand img{width:44px;height:44px}.edition{font-size:17px;letter-spacing:3px;color:#9c9fba}.intro{display:flex;justify-content:space-between;align-items:flex-end;margin:51px 0 34px}h1{font-size:61px;line-height:1.25;letter-spacing:1px;margin:0 0 20px;font-weight:650}p{font-size:24px;color:#a8b1cf;margin:0;line-height:1.65}.number{font-size:112px;font-weight:250;line-height:1;color:#b7a7fb24;letter-spacing:-8px}.tags{display:flex;gap:13px;margin:0 0 32px}.tags span{font-size:19px;color:#c5bbea;border:1px solid #a899ef30;background:#aa99ef08;border-radius:24px;padding:11px 20px}.frame{border:1px solid #bbb0fb35;border-radius:20px;overflow:hidden;box-shadow:0 25px 100px #0007}.bar{height:39px;background:#21243b;display:flex;align-items:center;gap:7px;padding:0 18px}.bar i{width:8px;height:8px;border-radius:50%;background:#73718e}.bar span{font-size:12px;letter-spacing:1px;margin-left:12px;color:#989ab3}.screen{display:block;width:100%;height:auto}.bottom{margin-top:30px;display:flex;justify-content:space-between;align-items:center;font-size:16px;color:#8a91ae}.bottom b{font-weight:450;color:#b7b7d1}</style><div class="poster"><div class="top"><div class="brand"><img src="data:image/svg+xml;base64,${icon}">RUCapture</div><span class="edition">记录与规划</span></div><div class="intro"><div><h1>${title}</h1><p>${subtitle}</p></div><div class="number">0${i+1}</div></div><div class="tags">${tags.map(t=>`<span>${t}</span>`).join('')}</div><div class="frame"><div class="bar"><i></i><i></i><i></i><span>rucapture.pages.dev</span></div><img class="screen" src="data:image/png;base64,${screenshot}"></div><div class="bottom"><b>${code}</b><span>实际界面 · 所有账号与卡片内容均为虚构演示</span></div></div>`;
  await writeFile(join(output,name+'.html'),html);
  const poster=await browser.newPage({viewport:{width:1800,height:1200},deviceScaleFactor:1.5});await poster.setContent(html);await poster.locator('.screen').evaluate(img=>img.decode());await poster.screenshot({path:join(output,name+'.png'),fullPage:true,animations:'disabled'});await poster.close();
  gallery.push({name,title});
 }
 await writeFile(join(output,'index.html'),`<!doctype html><meta charset="utf-8"><title>RUCapture 宣传图</title><style>body{background:#101225;color:#e8e5ff;font:16px/1.6 "Microsoft YaHei",sans-serif;padding:32px}h1{font-size:27px}p{color:#a0aacb}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}img{width:100%;border:1px solid #a899ef40;border-radius:12px}a{color:inherit;text-decoration:none}small{display:block;margin:8px}</style><h1>RUCapture · 记录与规划</h1><p>四幅宣传图。基于实际界面，所有账号、卡片与同步状态均为本地虚构演示。</p><div class="grid">${gallery.map(item=>`<a href="${item.name}.png"><img src="${item.name}.png"><small>${item.title}</small></a>`).join('')}</div>`);
 await writeFile(join(output,'说明.txt'),'RUCapture 宣传图\n\n基于 v3.1.2 实际界面渲染。所有账号、卡片内容、任务数量与同步状态均为本地隔离环境中的虚构演示。没有读取或修改线上账号的数据。\n\nPNG 为可直接发布的宣传图；screens 目录为未加宣传排版的原始界面截图。HTML 为本地可编辑排版源文件。\n');
 console.log('PASS: four posters rendered with fictional data only; no external requests or live data access. Output: '+output);
}finally{
 await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));database.close();
 if(dirname(resolve(dir))!==tempRoot)throw Error('Unsafe preview cleanup path');await rm(dir,{recursive:true,force:true});
}
