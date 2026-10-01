import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {DatabaseSync} from "node:sqlite";
import vm from "node:vm";
import worker from "./worker.mjs";
import {createEnvironment} from "./local.mjs";
import "./extension/academic-parser.js";

const row={id:"lesson",jczy013id:"term",kc_name:"数学分析",pksj:"10102",idjkssj:1,idjjssj:3,pkzc:"1-3(单)",teachernames:"示例教师",js_name:"示例教室"};
const calendar={jxzllist:[{zc:1,xq:1,rq:"2026-09-07"},{zc:3,xq:1,rq:"2026-09-21"}]};
const models=[{id:"model",pkgl00201List:[{idjkssj:1,idjjssj:3,djkssj:"08:00",djjssj:"09:30"}]}];
test("academic parser uses teaching dates, odd/even weeks and exact times; rejects uncertain results",()=>{
  const {weeks,courses,exams}=globalThis.RUAcademic;
  assert.deepEqual(weeks("2-6双周,8"),[2,4,6,8]);
  const tasks=courses([row],calendar,models,"term");
  assert.equal(tasks.length,2);assert.equal(tasks[0].starts_at,"2026-09-07T00:00:00.000Z");assert.equal(tasks[0].ends_at,"2026-09-07T01:30:00.000Z");
  assert.equal(tasks[1].external_id,"term:lesson:3");assert.equal(tasks[0].details.teacher,"示例教师");
  const linked=globalThis.RUAcademic.courseInput({rows:[{...row,bkxt004id:"outline",kkgl004id:"class"}],calendar,models,semester:"term"});
  assert.equal(courses(linked.rows,linked.calendar,linked.models,"term")[0].source_url,"https://jw.ruc.edu.cn/Njw2017/student/student-choice-center/syllabus-entry-check.html#/?param=term,class");
  const numericCalendar={jxzllist:calendar.jxzllist.map(entry=>({...entry,rq:Date.parse(`${entry.rq}T00:00:00+08:00`)}))};
  assert.deepEqual(courses([row],numericCalendar,models,"term"),tasks);
  assert.throws(()=>courses([row],{jxzllist:[]},models),/日期/);
  assert.throws(()=>courses([row],calendar,[]),/时间/);
  assert.throws(()=>courses([{...row,pkzc:"未知"}],calendar,models),/教学周/);
  assert.equal(courses([{...row,sftkcode:"1"}],calendar,models).length,0);
  const exam={id:"exam",kc_name:"示例考试",newformatkssj:"2026-12-28 09:00 ~ 11:00",kcmc_name:"考场",zwh:12};
  const parsed=exams([{xq1:[exam],xq2:[]}],"term","batch");
  assert.equal(parsed[0].starts_at,"2026-12-28T01:00:00.000Z");assert.equal(parsed[0].details.seat,"12");
  assert.deepEqual(exams([{xq1:[],xq2:[]}]),[]);
  assert.throws(()=>exams([{message:"login required"}]),/无法识别/);
  assert.throws(()=>exams([{...exam,newformatkssj:"09:00 ~ 11:00"}]),/日期/);
  assert.throws(()=>exams([{...exam,newformatkssj:"2026-02-30 09:00 ~ 11:00"}]),/日期/);
});

test("legacy category migration preserves all rows, attachments and user edits across restart",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"ru-category-migration-"));let db;
  try {
    db=new DatabaseSync(join(dir,"board.sqlite3"));
    for(const name of ["schema.sql","migrations/0002_task_details.sql","migrations/0003_resources.sql","migrations/0004_completion.sql"])db.exec(await readFile(new URL(name,import.meta.url),"utf8"));
    for(const [i,category] of ["作业","科研","竞赛","组织","活动"].entries()) {
      db.prepare("INSERT INTO tasks(id,category,content,title,created_at,updated_at,todos,links,attachments,overrides,completed_at,source_status,revision,deleted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(String(i),category,"内容","标题","2026-09-01","2026-09-02",'[{"id":"t","text":"保留","done":true}]','[{"url":"https://example.com"}]','["file"]','["title"]',"2026-09-03","done",4,i===3?1:0);
    }
    db.prepare("INSERT INTO files VALUES ('file','保留.pdf','application/pdf',3,'2026-09-01')").run();
    db.prepare("INSERT INTO file_chunks VALUES ('file',0,?)").run(new Uint8Array([1,2,3]));
    const before=db.prepare("SELECT * FROM tasks ORDER BY id").all();db.close();
    ({database:db}=await createEnvironment(dir,"test-only"));
    for(const [i,item] of db.prepare("SELECT * FROM tasks ORDER BY id").all().entries()) {
      assert.deepEqual({...item,category:before[i].category,revision:before[i].revision,details:undefined,archived_at:undefined},{...before[i],details:undefined,archived_at:undefined});
      assert.equal(item.category,i===0?"作业":"活动");assert.equal(item.revision,[1,2,3].includes(i)?5:4);
    }
    assert.deepEqual([...db.prepare("SELECT data FROM file_chunks").get().data],[1,2,3]);
    db.close();({database:db}=await createEnvironment(dir,"test-only"));assert.equal(db.prepare("SELECT count(*) n FROM tasks").get().n,5);
  } finally {db?.close();await rm(dir,{recursive:true,force:true});}
});

test("academic imports are idempotent, preserve manual fields/state and never resurrect deleted tasks",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"ru-academic-api-"));const {database:db,env}=await createEnvironment(dir,"test-only");let cookie="";
  async function api(path,method="GET",value,headers={}) {
    const result=await worker.fetch(new Request(`https://campus-task-board.pages.dev${path}`,{method,headers:{Cookie:cookie,"Content-Type":"application/json",...headers},...(value===undefined?{}:{body:JSON.stringify(value)})}),env);
    if(result.headers.has("set-cookie"))cookie=result.headers.get("set-cookie").split(";")[0];return {status:result.status,data:await result.json()};
  }
  try {
    assert.equal((await api("/api/import","POST",{source:"ruc_courses",tasks:[]})).status,401);
    assert.equal((await api("/api/academic/snapshot")).status,401);
    assert.equal((await api("/api/academic/retry","POST",{})).status,401);
    await api("/api/login","POST",{password:"test-only"});
    const auth={Authorization:`Bearer ${(await api("/api/collector-token","POST",{})).data.token}`};
    const input={rows:[{...row,token:"must-not-be-stored"}],calendar:{jxzllist:calendar.jxzllist.map(entry=>({...entry,rq:Date.parse(`${entry.rq}T00:00:00+08:00`)}))},models,semester:"raw-term",semester_label:"示例学期",cookie:"must-not-be-stored"};
    const imported=await api("/api/import","POST",{source:"ruc_courses",academic:input},auth);
    assert.equal(imported.data.count,2);assert.equal(imported.data.changed,2);
    assert.equal((await api("/api/academic/retry","POST",{})).data.changed,0);
    const snapshot=(await api("/api/academic/snapshot")).data;assert.ok(!JSON.stringify(snapshot).includes("must-not-be-stored"));
    assert.equal((await api("/api/board")).data.timetables[0].label,"示例学期");
    db.exec("DELETE FROM tasks");
    const item=globalThis.RUAcademic.courses([row],calendar,models,"term")[0];
    const upload=()=>api("/api/import","POST",{source:"ruc_courses",tasks:[item]},auth);
    assert.equal((await upload()).data.changed,1);
    const get=async()=>(await api("/api/board")).data.tasks[0];let task=await get();
    assert.equal(task.category,"课程");assert.equal(task.details.teacher,"示例教师");const revision=task.revision;
    db.prepare("UPDATE tasks SET content=title WHERE id=?").run(task.id); // Existing installations duplicated the title.
    assert.equal((await upload()).data.changed,0);assert.equal((await get()).revision,revision);
    await api(`/api/tasks/${task.id}`,"PATCH",{title:"我的标题",location:"自定地点",status:"doing",details:{teacher:"保留教师"},revision});
    item.title="新标题";item.location="新地点";item.starts_at="2026-09-07T02:00:00Z";item.ends_at="2026-09-07T03:00:00Z";item.details.teacher="新教师";
    assert.equal((await upload()).data.changed,1);task=await get();
    assert.equal(task.title,"我的标题");assert.equal(task.location,"自定地点");assert.equal(task.details.teacher,"保留教师");assert.equal(task.status,"todo");assert.equal(task.starts_at,"2026-09-07T02:00:00.000Z");
    assert.equal((await upload()).data.changed,0);assert.equal(task.content,"我的标题");
    let memo=(await api(`/api/tasks/${task.id}`,"PATCH",{content:"课程备忘：携带讲义",revision:task.revision})).data;
    assert.equal(memo.title,"我的标题");item.title="再改课程标题";await upload();memo=await get();assert.equal(memo.content,"课程备忘：携带讲义");task=memo;
    await api(`/api/tasks/${task.id}`,"DELETE",{revision:task.revision});assert.equal((await upload()).data.changed,0);assert.equal((await api("/api/board")).data.tasks.length,0);
    const invalid=await api("/api/import","POST",{source:"ruc_exams",tasks:[{...item,source_url:"https://evil.example/"}]},auth);assert.equal(invalid.status,400);
    assert.equal((await api("/api/import","POST",{source:"ruc_exams",tasks:[]},auth)).status,200);
  } finally {db.close();await rm(dir,{recursive:true,force:true});}
});

test("academic capture requests every current-term exam batch once and only approved read services",async()=>{
  const calls=[],messages=[],handlers={};let tick;
  const context=vm.createContext({RUAcademic:globalThis.RUAcademic,location:{hostname:"jw.ruc.edu.cn",origin:"https://jw.ruc.edu.cn",hash:"#/student/test-arrange-search/"},setInterval:fn=>{tick=fn;return 1;},clearInterval(){},
    student:{testArrangeSearch:{async findKwglPkcsszlb(){calls.push("batches");return {items:[{id:"one",jczy013id:"term"},{id:"two",jczy013id:"term"},{id:"old",jczy013id:"old"}]};},async findXsksapNew(params){calls.push(params);return [];}}},
    app:{$children:[{$options:{name:"test-arrange-search"},model:{term:"term"}}]},addEventListener:(name,fn)=>{handlers[name]=fn;},postMessage:message=>messages.push(message)});
  context.window=context;context.top=context;
  vm.runInContext(await readFile(new URL("./extension/academic-capture.js",import.meta.url),"utf8"),context);
  tick();await new Promise(resolve=>setImmediate(resolve));tick();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,3);assert.deepEqual(calls.slice(1).map(item=>item.kwgl001id),["one","two"]);assert.equal(messages.length,1);assert.equal(messages[0].tasks.length,0);
  assert.equal(messages[0].source,"ruc_exams");
});
