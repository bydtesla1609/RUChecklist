import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,readFile} from "node:fs/promises";
import {DatabaseSync} from "node:sqlite";
import {tmpdir} from "node:os";
import {join} from "node:path";
import worker from "./worker.mjs";
import {createEnvironment} from "./local.mjs";
import "./extension/parsers.js";

test("two devices, validation, conflict protection, import idempotency and persistent state",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"campus-board-test-"));
  let {env,database}=await createEnvironment(dir,"test-password-never-deployed");
  const client=()=>({cookie:"",async request(path,method="GET",body,extra={}){
    const response=await worker.fetch(new Request(`https://board.example${path}`,{method,headers:{"Content-Type":"application/json",Cookie:this.cookie,...extra},...(body!==undefined?{body:JSON.stringify(body)}:{})}),env);
    if(response.headers.has("set-cookie")) this.cookie=response.headers.get("set-cookie").split(";")[0];
    return {status:response.status,data:await response.json(),headers:response.headers};
  }});
  const pc=client(),phone=client();
  try {
    assert.equal((await pc.request("/api/board")).status,401);
    assert.equal((await pc.request("/api/login","POST",{password:"wrong"})).status,401);
    for(const device of [pc,phone]){
      const login=await device.request("/api/login","POST",{password:"test-password-never-deployed"});
      assert.equal(login.status,200);assert.match(login.headers.get("set-cookie"),/HttpOnly.*SameSite=Strict.*Secure/);
    }
    assert.equal((await pc.request("/api/tasks","POST",{category:"作业",content:"缺少日期"})).status,400);
    assert.equal((await pc.request("/api/tasks","POST",{category:"科研",content:"日期倒置",starts_at:"2026-10-02T10:00:00+08:00",ends_at:"2026-10-01T10:00:00+08:00"})).status,400);
    assert.equal((await pc.request("/api/tasks","POST",{category:"作业",content:"拒绝跨站",due_at:"2026-10-01T10:00:00+08:00"},{Origin:"https://evil.example"})).status,403);
    const created=(await pc.request("/api/tasks","POST",{category:"作业",content:"线性表实验",due_at:"2026-10-01T20:00:00+08:00"}));
    assert.equal(created.status,201); assert.equal(created.data.due_at,"2026-10-01T12:00:00.000Z");
    const id=created.data.id;
    assert.equal(created.data.title,"线性表实验");
    assert.equal((await pc.request("/api/tasks","POST",{title:"  ",due_at:"2026-10-01T20:00:00+08:00"})).status,400);
    assert.equal((await phone.request("/api/board")).data.tasks[0].content,"线性表实验");
    assert.equal((await phone.request(`/api/tasks/${id}`,"PATCH",{status:"doing",revision:1})).status,200);
    assert.equal((await pc.request(`/api/tasks/${id}`,"PATCH",{content:"过期修改",revision:1})).status,409);
    assert.equal((await pc.request("/api/board")).data.tasks[0].status,"doing");
    const todos=[{id:"a",text:"阅读实验要求",done:false},{id:"b",text:"提交报告",done:false}];
    let changed=await pc.request(`/api/tasks/${id}`,"PATCH",{title:"线性表实验（新版）",location:"图书馆",todos,revision:2});
    assert.equal(changed.status,200);
    let fromPhone=(await phone.request("/api/board")).data.tasks.find(t=>t.id===id);
    assert.deepEqual(fromPhone.todos,todos); assert.equal(fromPhone.location,"图书馆");
    assert.equal(fromPhone.title,"线性表实验（新版）");
    const reordered=[{...todos[1],text:"检查报告并提交",done:true},todos[0]];
    changed=await phone.request(`/api/tasks/${id}`,"PATCH",{todos:reordered,revision:fromPhone.revision});
    assert.equal(changed.status,200);
    assert.deepEqual((await pc.request("/api/board")).data.tasks.find(t=>t.id===id).todos,reordered);
    assert.equal((await pc.request(`/api/tasks/${id}`,"PATCH",{todos,revision:fromPhone.revision})).status,409);
    assert.equal((await pc.request(`/api/tasks/${id}`,"PATCH",{todos:[todos[0],todos[0]],revision:changed.data.revision})).status,400);
    assert.equal((await pc.request(`/api/tasks/${id}`,"PATCH",{todos:[{...todos[0],text:" "}],revision:changed.data.revision})).status,400);
    changed=await pc.request(`/api/tasks/${id}`,"PATCH",{todos:[reordered[0]],revision:changed.data.revision});
    assert.equal(changed.status,200); assert.equal(changed.data.todos.length,1);
    for(const category of ["科研","竞赛","活动","组织"]){
      assert.equal((await phone.request("/api/tasks","POST",{category,content:category+"任务",starts_at:"2026-10-01T10:00:00+08:00",ends_at:"2026-10-03T10:00:00+08:00"})).status,201);
    }
    const token=(await pc.request("/api/collector-token","POST",{})).data.token;
    const auth={Authorization:`Bearer ${token}`};
    const batch={source:"smartestu",tasks:[{external_id:"course:hw:1",content:"矩阵作业",due_at:"2026-10-02T20:00:00+08:00",course:"线性代数"}]};
    assert.equal((await pc.request("/api/import","POST",batch,{Authorization:"Bearer wrong"})).status,401);
    assert.equal((await pc.request("/api/import","POST",batch,auth)).data.changed,1);
    assert.equal((await pc.request("/api/import","POST",batch,auth)).data.changed,0);
    let imported=(await phone.request("/api/board")).data.tasks.find(t=>t.source);
    assert.equal((await phone.request(`/api/tasks/${imported.id}`,"PATCH",{title:"自己备注",location:"自习室",todos,status:"done",revision:imported.revision})).status,200);
    batch.tasks[0].content="教师改了标题";batch.tasks[0].due_at="2026-10-04T20:00:00+08:00";
    await pc.request("/api/import","POST",batch,auth);
    imported=(await phone.request("/api/board")).data.tasks.find(t=>t.source);
    assert.equal(imported.content,"自己备注"); assert.equal(imported.status,"done");assert.equal(imported.due_at,"2026-10-04T12:00:00.000Z");
    assert.equal(imported.title,"自己备注");assert.equal(imported.location,"自习室");assert.deepEqual(imported.todos,todos);
    assert.equal((await phone.request(`/api/tasks/${imported.id}`,"DELETE",{revision:imported.revision})).status,200);
    assert.equal((await pc.request("/api/import","POST",batch,auth)).data.changed,0);
    assert.equal((await phone.request("/api/board")).data.tasks.length,5);
    assert.deepEqual((await phone.request("/api/board")).data.tasks.find(t=>t.id===id).todos,[reordered[0]]);
    const invalidBatch={source:"smartestu",tasks:[{...batch.tasks[0],external_id:"new-id"},{content:"无编号"}]};
    assert.equal((await pc.request("/api/import","POST",invalidBatch,auth)).status,400);
    assert.equal((await pc.request("/api/board")).data.tasks.length,5);
    await pc.request("/api/collector-token","POST",{});
    assert.equal((await pc.request("/api/import","POST",batch,auth)).status,401);
    const savedCookie=phone.cookie;
    database.close(); ({env,database}=await createEnvironment(dir,"test-password-never-deployed"));
    phone.cookie=savedCookie;
    assert.equal((await phone.request("/api/board")).data.tasks.length,5);
    await phone.request("/api/logout","POST",{});
    phone.cookie=savedCookie;
    assert.equal((await phone.request("/api/board")).status,401);
  } finally {database.close();await rm(dir,{recursive:true,force:true});}
});

test("legacy migration preserves complete content and is safe on restart",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"campus-board-migration-"));
  let database=new DatabaseSync(join(dir,"board.sqlite3"));
  try {
    database.exec(await readFile(new URL("./schema.sql",import.meta.url),"utf8"));
    const title="原有的长内容\n".repeat(150);
    database.prepare("INSERT INTO tasks(id,category,content,created_at,updated_at) VALUES ('legacy','作业',?,'2026-09-01','2026-09-01')").run(title);
    database.close();
    ({database}=await createEnvironment(dir,"migration-test"));
    let task=database.prepare("SELECT * FROM tasks WHERE id='legacy'").get();
    assert.equal(task.title,title); assert.equal(task.content,title); assert.equal(task.todos,"[]"); assert.equal(task.location,"");
    database.close();
    ({database}=await createEnvironment(dir,"migration-test"));
    task=database.prepare("SELECT * FROM tasks WHERE id='legacy'").get(); assert.equal(task.title,title);
  } finally { database.close(); await rm(dir,{recursive:true,force:true}); }
});

test("source parsers require recognized assignment structures and preserve explicit timezones",()=>{
  const {parse,date}=globalThis.CampusParsers;
  const list=parse("smartestu","/api/homework/student/mark/queryHomeworks",{data:[{courseId:9,courseName:"数学",studentCourseHomeworkDTOList:[{id:7,name:"作业一",endTime:"2026-10-03 23:59:00"}]}]});
  assert.equal(list[0].external_id,"9:7");assert.equal(list[0].due_at,"2026-10-03T15:59:00.000Z");
  const mixed=parse("ketangpai","/FutureV2/CourseMeans/getCourseContent",{data:{list:[{contenttype:"4",id:"hw",title:"练习",endtime:1791028800},{contenttype:"2",id:"file",title:"课件",endtime:1791028800}]}});
  assert.equal(mixed.length,1);assert.equal(mixed[0].external_id,"hw");
  assert.equal(parse("smartestu","/api/user",{token:"should-not-be-copied"}),null);
  assert.equal(parse("smartestu","/api/homework/student/mark/queryHomeworks",{error:"login required"}),null);
  assert.throws(()=>date("明天"));assert.equal(date(null),null);
});
