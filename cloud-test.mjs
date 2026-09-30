import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,dirname,resolve} from "node:path";
import vm from "node:vm";
import worker from "./worker.mjs";
import {createEnvironment} from "./local.mjs";

test("cloud authorization is encrypted, scoped, independently scheduled, incremental and revocable",async()=>{
  const root=resolve(tmpdir()),dir=await mkdtemp(join(root,"campus-cloud-"));
  const {env,database}=await createEnvironment(dir,"cloud-test-only");
  const originalFetch=globalThis.fetch;let cookie="",remoteStatus="completed",failSmart=false,requests=0;
  async function api(path,method="GET",value,headers={}) {
    const r=await worker.fetch(new Request(`https://board.example${path}`,{method,headers:{Cookie:cookie,"Content-Type":"application/json",...headers},...(value!==undefined?{body:JSON.stringify(value)}:{})}),env);
    if(r.headers.has("set-cookie"))cookie=r.headers.get("set-cookie").split(";")[0];return {status:r.status,data:await r.json()};
  }
  try {
    assert.equal((await api("/api/cloud")).status,401);
    await api("/api/login","POST",{password:"cloud-test-only"});
    const token=(await api("/api/collector-token","POST",{})).data.token,auth={Authorization:`Bearer ${token}`};
    assert.equal((await api("/api/cloud-authorize","POST",{},auth)).status,503);
    env.CLOUD_ENCRYPTION_KEY="12".repeat(32);
    const smart={source:"smartestu",recipe:{url:"https://smartestu.cn/api/homework/student/mark/queryHomeworks",method:"POST",page_url:"https://smartestu.cn/assignment",headers:{authorization:"Bearer synthetic-private-session",cookie:"session=synthetic-cookie","content-type":"application/json"},body:JSON.stringify({pageNo:1,pageSize:20})}};
    assert.equal((await api("/api/cloud-credentials","POST",smart,auth)).status,403);
    assert.equal((await api("/api/cloud-authorize","POST",{})).status,401);
    assert.equal((await api("/api/cloud-authorize","POST",{},auth)).status,200);
    for(const url of ["http://127.0.0.1/private","https://smartestu.cn/api/homework/submit","https://evil.example/api/homework/student/mark/queryHomeworks"])assert.equal((await api("/api/cloud-credentials","POST",{...smart,recipe:{...smart.recipe,url}},auth)).status,400);
    assert.equal((await api("/api/cloud-credentials","POST",smart,auth)).status,200);
    const ketang={source:"ketangpai",recipe:{url:"https://openapiv5.ketangpai.com//FutureV2/CourseMeans/getCourseContent",method:"POST",page_url:"https://www.ketangpai.com/#/main/classDetail?courseid=test-course",headers:{token:"synthetic-class-token","content-type":"application/json"},body:JSON.stringify({courseid:"test-course",page:1})}};
    assert.equal((await api("/api/cloud-credentials","POST",ketang,auth)).status,200);
    const encrypted=database.prepare("SELECT value FROM settings WHERE key LIKE 'cloud_credential_%'").all();
    assert.equal(encrypted.length,2);assert.ok(encrypted.every(row=>!row.value.includes("synthetic")));
    const state=JSON.stringify((await api("/api/cloud")).data);assert.ok(!state.includes("synthetic") && !state.includes("cookie"));
    globalThis.fetch=async(url,options)=>{
      requests++;assert.equal(options.redirect,"manual");
      if(url==="https://smartestu.cn/api/auth/session") {
        assert.equal(options.method,"GET");assert.equal(options.headers.cookie,smart.recipe.headers.cookie);assert.equal(options.headers["x-auth-protocol"],"cookie-v1");
        return Response.json({sessionContext:"synthetic-context",csrfToken:"synthetic-csrf"});
      }
      if(url.includes("smartestu")){assert.equal(options.headers["x-session-context"],"synthetic-context");assert.equal(options.headers["x-csrf-token"],"synthetic-csrf");}
      if(url.includes("smartestu")){assert.equal(options.headers.authorization,smart.recipe.headers.authorization);if(failSmart)return new Response("login",{status:302,headers:{location:"https://evil.example/"}});const page=JSON.parse(options.body).pageNo;assert.ok([1,2].includes(page));return Response.json({data:{pageNo:page,pageTotal:2,courseHomeworkDTOList:[{studentCourseHomeworkDTOList:[{id:`one-page-${page}`,name:`云端读取的作业 ${page}`,submission_status:remoteStatus}]}]}});}
      assert.equal(options.headers.token,ketang.recipe.headers.token);
      return Response.json({list:[{contenttype:4,id:"two",title:"课堂派作业",mstatus:1}]});
    };
    let run=await api("/api/cloud/run","POST",{});assert.equal(run.status,200);assert.equal(run.data.smartestu.changed,2);assert.equal(run.data.smartestu.status_count,2);assert.equal(run.data.ketangpai.changed,1);
    database.exec("UPDATE tasks SET content=title"); // Old records must not be rewritten by unchanged imports.
    const beforeSingle=requests,otherState=database.prepare("SELECT value FROM settings WHERE key='cloud_state_smartestu'").get().value;
    const single=await api("/api/cloud/run","POST",{source:"ketangpai"});assert.deepEqual(Object.keys(single.data),["ketangpai"]);assert.equal(requests-beforeSingle,1);
    assert.equal(database.prepare("SELECT value FROM settings WHERE key='cloud_state_smartestu'").get().value,otherState);
    assert.equal((await api("/api/cloud/run","POST",{source:"ruc_courses"})).status,400);
    let tasks=(await api("/api/board")).data.tasks;assert.equal(tasks.length,3);assert.ok(tasks.every(task=>task.status==="done" && task.completed_at));
    const previous=tasks.map(task=>[task.id,task.revision,task.completed_at]);
    const waits=[];await worker.scheduled({},env,{waitUntil(p){waits.push(p);}});await Promise.all(waits);
    tasks=(await api("/api/board")).data.tasks;assert.deepEqual(tasks.map(task=>[task.id,task.revision,task.completed_at]),previous);
    remoteStatus="not_submitted";await api("/api/cloud/run","POST",{});
    tasks=(await api("/api/board")).data.tasks;assert.equal(tasks.find(task=>task.source==="smartestu").status,"todo");
    failSmart=true;run=await api("/api/cloud/run","POST",{});assert.match(run.data.smartestu.error,/登录授权/);assert.equal(run.data.ketangpai.error,null);assert.equal((await api("/api/board")).data.tasks.length,3);
    await api("/api/cloud","DELETE");assert.equal(database.prepare("SELECT count(*) AS n FROM settings WHERE key LIKE 'cloud_credential_%'").get().n,0);
    const before=requests;assert.equal((await api("/api/cloud/run","POST",{})).data.skipped,true);assert.equal(requests,before);
    assert.equal((await api("/api/cloud-credentials","POST",smart,auth)).status,403);
    const batch={source:"smartestu",tasks:Array.from({length:30},(_,i)=>({external_id:`batch:${i}`,title:`批量任务 ${i}`,status:"done"}))};
    assert.equal((await api("/api/import","POST",batch,auth)).data.changed,30);
    assert.equal((await api("/api/import","POST",batch,auth)).data.changed,0);
  }finally{globalThis.fetch=originalFetch;database.close();assert.equal(dirname(resolve(dir)),root);await rm(dir,{recursive:true,force:true});}
});

test("extension sends no cloud credentials without opt-in and scopes cookies to approved list URL",async()=>{
  let saved={boardURL:"https://campus-task-board.pages.dev",token:"synthetic-board-token",cloudEnabled:false},reads=0,sent=[];
  const noop={addListener(){}},context=vm.createContext({URL,URLSearchParams,TextEncoder,AbortSignal,crypto,
    fetch:async(url,options)=>{if(url.endsWith("/api/collector-config"))return Response.json({cloud_enabled:true});sent.push({url,value:JSON.parse(options.body)});return Response.json({ok:true});},
    chrome:{permissions:{contains:async()=>true},cookies:{getAll:async({url})=>{assert.equal(url,"https://smartestu.cn/api/homework/student/mark/queryHomeworks");reads++;return [{name:"test",value:"secret"}];}},storage:{local:{get:async()=>structuredClone(saved),set:async value=>{saved={...saved,...structuredClone(value)};}}},action:{onClicked:noop},runtime:{onMessage:noop,onStartup:noop,onInstalled:noop},alarms:{onAlarm:noop}}});
  for(const name of ["cloud-routes.js","background.js"])vm.runInContext(await readFile(new URL(`./extension/${name}`,import.meta.url),"utf8"),context);
  context.message={source:"smartestu",recipe:{url:"https://smartestu.cn/api/homework/student/mark/queryHomeworks",method:"GET",headers:{authorization:"Bearer test"}}};context.sender={url:"https://smartestu.cn/assignment",tab:{id:1}};
  await vm.runInContext("cloudRecipe(message,sender)",context);assert.equal(reads,0);assert.equal(sent.length,0);
  saved.cloudEnabled=true;await vm.runInContext("cloudRecipe(message,sender)",context);assert.equal(reads,1);assert.equal(sent.length,1);assert.equal(sent[0].value.recipe.headers.cookie,"test=secret");
  await vm.runInContext("cloudRecipe(message,sender)",context);assert.equal(sent.length,1);
  saved.boardURL="https://ruchecklist-trial.pages.dev";saved.cloudRecipeCache={};await vm.runInContext("cloudRecipe(message,sender)",context);assert.equal(sent.at(-1).url,"https://ruchecklist-trial.pages.dev/api/cloud-credentials");
  context.message.recipe.url="https://evil.example/";await assert.rejects(()=>vm.runInContext("cloudRecipe(message,sender)",context),/来源不匹配/);assert.equal(reads,3);
});
