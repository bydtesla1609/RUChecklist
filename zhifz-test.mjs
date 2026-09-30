import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import vm from "node:vm";
import {createEnvironment} from "./local.mjs";
import worker,{SOURCES,applyImport,sourceLinks} from "./worker.mjs";
import {enableCloud,saveCloudRecipe,runCloud,cloudStatus,validateRecipe} from "./cloud.mjs";

const list=states=>`https://www.zhifz.com/yonghu_ceyan?${new URLSearchParams({UID:"123",类型:"2",状态:JSON.stringify(states)})}`;
const rows=()=>[0,1,2,3].map((status,index)=>({测验ID:100+index,测验名称:`示例作业 ${index}`,科目名称:"示例课程",状态:status,答题时间:"2026-10-01T10:00:00+08:00",答案:"must-not-be-imported",成绩:99}));

test("Zhifz imports list metadata and updates completion across latest/past lists without rewriting unchanged tasks",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"ruchecklist-zhifz-")),{env,database}=await createEnvironment(dir,"synthetic-zhifz-test");
  env.CLOUD_ENCRYPTION_KEY="78".repeat(32);
  try {
    assert.equal(sourceLinks(["https://www.zhifz.com/#/zuoye"])[0].source,"zhifz");
    assert.equal(sourceLinks(["https://www.zhifz.com.evil.example/#/zuoye"])[0].source,"web:https://www.zhifz.com.evil.example");
    const recipe={url:list([0,1]),method:"GET",page_url:SOURCES.zhifz.url,headers:{cookie:"session=synthetic-only"}};
    for(const value of ["https://www.zhifz.com/yonghu_dati",list([0,1]).replace("%E7%B1%BB%E5%9E%8B=2","%E7%B1%BB%E5%9E%8B=1"),list([0,1])+"&password=not-permitted",list([9])])assert.equal(CampusCloudRoutes.source(value),null);
    assert.throws(()=>validateRecipe("zhifz",{...recipe,method:"POST"}),/方法/);
    const original=rows(),parsed=CampusParsers.parse("zhifz",recipe.url,{result:true,data:original});
    assert.deepEqual(parsed.map(task=>task.status),["todo","todo","done","done"]);
    assert.ok(parsed.every(task=>task.due_at===null && task.source_url===SOURCES.zhifz.url));
    assert.ok(!JSON.stringify(parsed).includes("must-not-be-imported"));
    assert.equal(CampusParsers.parse("zhifz",recipe.url,{result:false,error:"未登录"}),null);
    assert.deepEqual(CampusParsers.parse("zhifz",recipe.url,{result:true,data:[]}),[]);
    assert.throws(()=>CampusParsers.parse("zhifz",recipe.url,{result:true,data:[{...original[0],状态:5}]}),/状态/);
    await enableCloud(env);await saveCloudRecipe(env,"zhifz",recipe);
    await saveCloudRecipe(env,"zhifz",{...recipe,url:list([2,3])});
    assert.equal((await cloudStatus(env)).sources.zhifz.entries,1,"two tabs share one credential entry");
    let calls=[];
    const fetcher=async(url,options)=>{
      assert.equal(options.method,"GET");assert.equal(options.redirect,"manual");assert.equal(options.headers.cookie,recipe.headers.cookie);
      const states=JSON.parse(new URL(url).searchParams.get("状态"));calls.push(states);
      return Response.json({result:true,data:original.filter(row=>states.includes(row.状态))});
    };
    const run=()=>runCloud(env,payload=>applyImport(payload,env.DB,SOURCES),{source:"zhifz",fetcher});
    assert.equal((await run()).zhifz.changed,4);assert.deepEqual(calls,[[0,1],[2,3]]);
    const before=database.prepare("SELECT id,revision,completed_at FROM tasks ORDER BY external_id").all();
    assert.equal((await run()).zhifz.changed,0);assert.deepEqual(database.prepare("SELECT id,revision,completed_at FROM tasks ORDER BY external_id").all(),before);
    original[0].状态=2;
    assert.equal((await run()).zhifz.changed,1);
    const after=database.prepare("SELECT id,status,completed_at FROM tasks WHERE external_id='123:100'").get();
    assert.equal(after.id,before[0].id);assert.equal(after.status,"done");assert.ok(after.completed_at);
    assert.equal(database.prepare("SELECT count(*) AS n FROM tasks").get().n,4);
    assert.equal(database.prepare("SELECT task_count FROM sources WHERE id='zhifz'").get().task_count,4,"new source is created without database migration");
    const expired=await runCloud(env,()=>assert.fail("expired session must not import"),{source:"zhifz",fetcher:async()=>Response.json({result:false,error:"请重新登录"})});
    assert.equal(expired.zhifz.error_code,"auth_expired");assert.equal(database.prepare("SELECT count(*) AS n FROM tasks").get().n,4);
  }finally{database.close();await rm(dir,{recursive:true,force:true});}
});

test("existing cloud consent does not upload Zhifz cookies until the new source is explicitly authorized",async()=>{
  let saved={boardURL:"https://campus-task-board.pages.dev",token:"synthetic",cloudEnabled:true},reads=0,sent=0;
  const noop={addListener(){}},context=vm.createContext({URL,URLSearchParams,TextEncoder,AbortSignal,crypto,
    fetch:async url=>{if(url.endsWith("/api/collector-config"))return Response.json({cloud_enabled:true});sent++;return Response.json({ok:true});},
    chrome:{permissions:{contains:async()=>true},cookies:{getAll:async()=>{reads++;return [{name:"test",value:"synthetic"}];}},storage:{local:{get:async()=>structuredClone(saved),set:async value=>{saved={...saved,...structuredClone(value)};}}},action:{onClicked:noop},runtime:{onMessage:noop,onStartup:noop,onInstalled:noop},alarms:{onAlarm:noop}}});
  for(const name of ["cloud-routes.js","background.js"])vm.runInContext(await readFile(new URL(`./extension/${name}`,import.meta.url),"utf8"),context);
  context.message={source:"zhifz",recipe:{url:list([0,1]),method:"GET",headers:{}}};context.sender={url:SOURCES.zhifz.url,tab:{id:1}};
  await vm.runInContext("cloudRecipe(message,sender)",context);assert.equal(reads,0);assert.equal(sent,0);
  saved.cloudZhifzEnabled=true;await vm.runInContext("cloudRecipe(message,sender)",context);assert.equal(reads,1);assert.equal(sent,1);
});
