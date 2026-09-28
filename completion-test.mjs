import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,dirname,resolve,basename} from "node:path";
import vm from "node:vm";
import worker from "./worker.mjs";
import {createEnvironment} from "./local.mjs";
import "./extension/parsers.js";

test("completion transitions, unchanged imports, seven-day archive and protected details",async()=>{
  const root=resolve(tmpdir()),dir=await mkdtemp(join(root,"campus-completion-"));
  const {env,database}=await createEnvironment(dir,"completion-test-only");let cookie="";
  async function api(path,method="GET",value,headers={}) {
    const r=await worker.fetch(new Request(`https://campus-task-board.pages.dev${path}`,{method,headers:{Cookie:cookie,"Content-Type":"application/json",...headers},...(value!==undefined?{body:JSON.stringify(value)}:{})}),env);
    if(r.headers.has("set-cookie")) cookie=r.headers.get("set-cookie").split(";")[0];
    return {status:r.status,data:await r.json()};
  }
  try {
    assert.equal((await api("/api/archive")).status,401);
    await api("/api/login","POST",{password:"completion-test-only"});
    const token=(await api("/api/collector-token","POST",{})).data.token,auth={Authorization:`Bearer ${token}`};
    const task={external_id:"course:one",title:"已提交的课程作业",due_at:"2026-10-10T00:00:00Z",status:"todo"};
    const upload=()=>api("/api/import","POST",{source:"smartestu",tasks:[task]},auth);
    assert.equal((await upload()).data.changed,1);
    const id=(await api("/api/board")).data.tasks[0].id;
    const get=async()=>(await api(`/api/tasks/${id}`)).data;
    assert.equal((await get()).completed_at,null);
    let source=(await api("/api/board")).data.sources.find(item=>item.id==="smartestu");
    assert.equal(source.imported_count,1);assert.equal(source.status_count,1);
    task.status="done";assert.equal((await upload()).data.changed,1);
    let current=await get();const firstTime=current.completed_at,revision=current.revision;
    assert.ok(firstTime);assert.equal(current.due_at,task.due_at.replace("Z",".000Z"));
    assert.equal((await upload()).data.changed,0);
    assert.equal((await get()).completed_at,firstTime);assert.equal((await get()).revision,revision);
    await api(`/api/tasks/${id}`,"PATCH",{title:"我的标题",location:"图书馆",status:"done",revision});
    assert.equal((await get()).completed_at,firstTime);
    task.status="todo";await upload();current=await get();
    assert.equal(current.status,"todo");assert.equal(current.completed_at,null);assert.equal(current.title,"我的标题");assert.equal(current.location,"图书馆");
    // A manual completion is retained while the remote snapshot stays unchanged.
    await api(`/api/tasks/${id}`,"PATCH",{status:"done",revision:current.revision});
    assert.equal((await upload()).data.changed,0);assert.equal((await get()).status,"done");
    const archivedTime=new Date(Date.now()-8*86400000).toISOString();
    database.prepare("UPDATE tasks SET completed_at=? WHERE id=?").run(archivedTime,id);
    assert.equal((await api("/api/board")).data.tasks.length,0);
    const archive=(await api("/api/archive?category=作业")).data;
    assert.equal(archive.total,1);assert.equal(archive.tasks[0].id,id);assert.ok(archive.tasks[0].due_at);
    assert.equal((await api("/api/archive?category=科研")).data.total,0);
    assert.equal((await api("/api/archive?offset=-1")).status,400);
    current=await get();assert.equal(current.location,"图书馆");
    // Missing/unknown source status and absent deadline never reopen or erase data.
    delete task.status;task.due_at=null;await upload();assert.equal((await get()).completed_at,archivedTime);assert.ok((await get()).due_at);
    current=await get();await api(`/api/tasks/${id}`,"PATCH",{status:"doing",revision:current.revision});
    assert.equal((await api("/api/archive")).data.total,0);assert.equal((await api("/api/board")).data.tasks.length,1);
    current=await get();await api(`/api/tasks/${id}`,"PATCH",{status:"done",revision:current.revision});
    assert.ok((await get()).completed_at>archivedTime);
    current=await get();await api(`/api/tasks/${id}`,"DELETE",{revision:current.revision});
    task.status="done";assert.equal((await upload()).data.changed,0);assert.equal((await api(`/api/tasks/${id}`)).status,404);

    // Exercise the extension's incremental cache against the real import API.
    let saved={enabled:true,boardURL:"https://campus-task-board.pages.dev",token};const requests=[];
    const noop={addListener(){}};
    const context=vm.createContext({URL,URLSearchParams,AbortSignal,crypto,console,setTimeout,clearTimeout,
      chrome:{storage:{local:{get:async()=>structuredClone(saved),set:async value=>{saved={...saved,...structuredClone(value)};}}},action:{onClicked:noop,setBadgeText:async()=>{}},runtime:{onMessage:noop,onStartup:noop,onInstalled:noop,getManifest:()=>({version:"test"})},alarms:{onAlarm:noop,clear:async()=>{},create:async()=>{}}},
      fetch:async(url,options)=>{if(options.body) requests.push(JSON.parse(options.body));return worker.fetch(new Request(url,options),env);}});
    vm.runInContext(await readFile(new URL("./extension/background.js",import.meta.url),"utf8"),context);
    context.message={source:"smartestu",tasks:[{external_id:"course:cached",title:"增量任务",status:"done"}]};context.sender={url:"https://smartestu.cn/assignment",tab:{id:1}};
    await vm.runInContext("upload(message,sender)",context);await vm.runInContext("upload(message,sender)",context);
    assert.equal(requests[0].tasks.length,1);assert.equal(requests[1].tasks.length,0);
    context.message.tasks[0].status="todo";await vm.runInContext("upload(message,sender)",context);assert.equal(requests[2].tasks.length,1);
    await assert.rejects(()=>vm.runInContext("boardControl({command:'pair',token:'invalid'},{url:'https://evil.example',tab:{id:1},frameId:0})",context),/不允许/);
    context.boardSender={url:"https://campus-task-board.pages.dev/",tab:{id:2},frameId:0};context.pairToken=token;
    const paired=await vm.runInContext("boardControl({command:'pair',token:pairToken},boardSender)",context);
    assert.equal(paired.connected,true);assert.equal(paired.enabled,true);assert.deepEqual(saved.importCache,{});
    await vm.runInContext("boardControl({command:'configure',enabled:false},boardSender)",context);assert.equal(saved.enabled,false);
    const noCookie=new Request(`https://campus-task-board.pages.dev/api/tasks/${id}`);
    assert.equal((await worker.fetch(noCookie,env)).status,401);
  }finally{database.close();assert.equal(dirname(resolve(dir)),root);assert.ok(basename(dir).startsWith("campus-completion-"));await rm(dir,{recursive:true,force:true});}
});

test("platform states distinguish completed, partial and returned submissions",()=>{
  const {parse}=globalThis.CampusParsers;
  const smart=status=>parse("smartestu","/api/homework/student/mark/queryHomeworks",{studentCourseHomeworkDTOList:[{id:"1",name:"作业",submission_status:status}]})[0];
  assert.equal(smart("completed").status,"done");assert.equal(smart("submitted").status,"doing");assert.equal(smart("not_submitted").status,"todo");assert.equal(smart("unknown").status,undefined);
  const ketang=status=>parse("ketangpai","/FutureV2/CourseMeans/getCourseContent",{list:[{id:"1",title:"作业",contenttype:4,mstatus:status}]})[0];
  for(const status of [1,2,4]) assert.equal(ketang(status).status,"done");
  for(const status of [0,3]) assert.equal(ketang(status).status,"todo");
  assert.equal(ketang(99).status,undefined);
});

test("learning scan preserves signed course entry and repairs an old managed tab",async()=>{
  const entry="https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu?courseid=course&clazzid=class&cpi=student&enc=test-signature&t=123";
  let saved={enabled:true,boardURL:"https://board.example",token:"test",managedTabs:{chaoxing:3}};
  const updated=[],noop={addListener(){}};let nextId=4,active=false;
  const context=vm.createContext({URL,AbortSignal,
    fetch:async()=>({ok:true,json:async()=>({sources:{chaoxing:{url:entry}}})}),
    chrome:{storage:{local:{get:async()=>structuredClone(saved),set:async value=>{saved={...saved,...structuredClone(value)};}}},
      action:{onClicked:noop},runtime:{onMessage:noop,onStartup:noop,onInstalled:noop},alarms:{onAlarm:noop,clear:async()=>{},create:async()=>{}},
      tabs:{get:async id=>({id,active,url:"https://mooc1.chaoxing.com/visit/stucoursemiddle?courseid=course"}),
        create:async()=>({id:nextId++}),update:async(id,{url})=>updated.push({id,url}),reload:async()=>{throw new Error("Stale entry must be replaced");}}}});
  vm.runInContext(await readFile(new URL("./extension/background.js",import.meta.url),"utf8"),context);
  await vm.runInContext("performScan()",context);
  assert.equal(updated.find(tab=>tab.id===3).url,entry);
  saved.managedTabs={};updated.length=0;
  await vm.runInContext("performScan()",context);
  assert.equal(updated.find(tab=>tab.url.includes("chaoxing.com")).url,entry);
  active=true;updated.length=0;saved.managedTabs={chaoxing:3};
  await vm.runInContext("start()",context);
  assert.equal(updated.length,3);assert.ok(updated.every(tab=>tab.id!==3));
  saved.enabled=false;updated.length=0;
  await vm.runInContext("start()",context);assert.equal(updated.length,0);
});
