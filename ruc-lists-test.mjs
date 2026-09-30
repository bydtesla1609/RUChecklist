import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import vm from "node:vm";
import {createEnvironment} from "./local.mjs";
import {SOURCES,applyImport,sourceLinks} from "./worker.mjs";
import {enableCloud,saveCloudRecipe,runCloud,validateRecipe} from "./cloud.mjs";

const kRoot="https://k.ruc.edu.cn/jiakt/adminApi/course/getMyLearnCourse",kList="https://k.ruc.edu.cn/jiakt/historyApi/courseReleaseInfo/studentGlobalSearch";
const kRecipe={url:kRoot,method:"POST",headers:{authorization:"Bearer synthetic","content-type":"application/json"},body:'{"keyword":""}',page_url:SOURCES.weilai.url};
const tuRecipe={url:"https://ruc.thusaac.com/api/course/list",method:"GET",headers:{cookie:"session=synthetic"},page_url:SOURCES.tuoj.url};
const example=(id,status)=>({courseReleaseInfoId:id,name:`示例作业 ${id}`,type:10,submitStatus:status,endTime:"2026-10-10 22:00:00",score:"do-not-import",answers:"do-not-import"});

test("new site URLs are classified narrowly and unsafe/write routes are excluded",()=>{
  assert.deepEqual(sourceLinks([SOURCES.yoj.url,SOURCES.weilai.url,SOURCES.tuoj.url]).map(link=>link.source),["yoj","weilai","tuoj"]);
  assert.throws(()=>sourceLinks(["http://k.ruc.edu.cn/UserClient/homePage.html"]),/HTTPS/);
  assert.throws(()=>sourceLinks(["http://yoj.ruc.edu.cn.evil.example/index.php"]),/HTTPS/);
  assert.equal(sourceLinks(["https://ruc.thusaac.com.evil.example/"])[0].source,"web:https://ruc.thusaac.com.evil.example");
  assert.equal(validateRecipe("weilai",kRecipe).url,kRoot);
  assert.equal(validateRecipe("tuoj",tuRecipe).url,tuRecipe.url);
  for(const url of [kRoot.replace("getMyLearnCourse","getTeachCourseWeb"),kList.replace("studentGlobalSearch","studentViewNotify"),"https://ruc.thusaac.com/api/course/1/rank","https://ruc.thusaac.com/api/course/1/contest/2/submission/list","https://ruc.thusaac.com/api/course/list?token=not-allowed",SOURCES.yoj.url])assert.equal(CampusCloudRoutes.source(url),null);
  assert.throws(()=>validateRecipe("tuoj",{...tuRecipe,method:"POST"}),/方法/);
  assert.throws(()=>validateRecipe("weilai",{...kRecipe,method:"GET"}),/方法/);
});

test("Future Classroom reads enrolled classes and all pages; completion is incremental, TUOJ ended is not completed",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"ruc-lists-")),{env,database}=await createEnvironment(dir,"synthetic-ruc");env.CLOUD_ENCRYPTION_KEY="9a".repeat(32);
  try {
    await enableCloud(env);await saveCloudRecipe(env,"weilai",kRecipe);await saveCloudRecipe(env,"tuoj",tuRecipe);
    let returned=false;const requested=[];
    const fetcher=async(url,options)=>{
      assert.ok(CampusCloudRoutes.source(url));requested.push(url);
      if(url===kRoot)return Response.json({stat:1,fieldErrors:[],data:[{id:11,name:"课程甲",classesList:[{id:12}]}]});
      if(url===kList){
        const body=JSON.parse(options.body);assert.equal(body.params.status,0);assert.equal(body.params.typeStr,"10");assert.equal(body.params.classesId,12);
        return Response.json({stat:1,data:{totalPages:2,page:body.page.current,list:body.page.current===1?[example(101,returned?2:1),{type:11,courseReleaseInfoId:199,name:"考试"}]:[example(102,0)]}});
      }
      if(url===tuRecipe.url)return Response.json({courses:[{_id:1,role:"student",archieved:false},{_id:2,role:"none"},{_id:3,role:"teacher"},{_id:4,role:"student",archieved:true}]});
      assert.equal(url,"https://ruc.thusaac.com/api/course/1/info");
      return Response.json({info:{title:"课程乙",contests:[{_id:20,title:"作业一",status:"ended",endTime:Date.parse("2026-10-01T14:00:00Z")},{_id:21,title:"未发布",hidden:true}]}});
    };
    const run=()=>runCloud(env,payload=>applyImport(payload,env.DB,SOURCES),{fetcher});
    let result=await run();assert.equal(result.weilai.changed,2,result.weilai.error);assert.equal(result.tuoj.changed,1,result.tuoj.error);assert.equal(requested.length,5);
    const before=database.prepare("SELECT id,revision,completed_at,status FROM tasks ORDER BY id").all();
    result=await run();assert.equal(result.weilai.changed,0);assert.equal(result.tuoj.changed,0);assert.deepEqual(database.prepare("SELECT id,revision,completed_at,status FROM tasks ORDER BY id").all(),before);
    assert.equal(database.prepare("SELECT status FROM tasks WHERE source='tuoj'").get().status,"todo");
    database.prepare("UPDATE tasks SET status='done',completed_at='2026-09-29T10:00:00.000Z' WHERE source='tuoj'").run();
    returned=true;result=await run();assert.equal(result.weilai.changed,1);assert.equal(result.tuoj.changed,0);
    assert.equal(database.prepare("SELECT status FROM tasks WHERE external_id='101'").get().status,"todo");
    assert.equal(database.prepare("SELECT status FROM tasks WHERE source='tuoj'").get().status,"done");
    assert.ok(!JSON.stringify(database.prepare("SELECT * FROM tasks").all()).includes("do-not-import"));
    assert.equal(database.prepare("SELECT count(*) AS n FROM tasks").get().n,3);
    result=await runCloud(env,()=>assert.fail("expired authorization must not import"),{source:"weilai",fetcher:async()=>Response.json({stat:0,fieldErrors:[{field:"500000"}]})});
    assert.equal(result.weilai.error_code,"auth_expired");
    assert.throws(()=>RUCLists.kPage({stat:1,data:{list:[],totalPages:21}}),/分页/);
    assert.throws(()=>RUCLists.tuCourse({info:{title:"changed"}},1),/无法识别/);
  }finally{database.close();await rm(dir,{recursive:true,force:true});}
});

test("new course sites require fresh cloud consent; ordinary collection remains account configured",async()=>{
  let stored={enabled:true,configuredSources:["weilai","tuoj"],boardURL:"https://campus-task-board.pages.dev",token:"synthetic",cloudEnabled:true,cloudZhifzEnabled:true},reads=0,sent=0;
  const noop={addListener(){}},context=vm.createContext({URL,URLSearchParams,TextEncoder,AbortSignal,crypto,
    fetch:async url=>{if(url.endsWith("/api/collector-config"))return Response.json({cloud_enabled:true});sent++;return Response.json({ok:true});},
    chrome:{permissions:{contains:async()=>true},cookies:{getAll:async()=>{reads++;return [{name:"session",value:"synthetic"}];}},storage:{local:{get:async()=>structuredClone(stored),set:async value=>{stored={...stored,...structuredClone(value)};}}},action:{onClicked:noop},runtime:{onMessage:noop,onStartup:noop,onInstalled:noop},alarms:{onAlarm:noop}}});
  for(const file of ["cloud-routes.js","background.js"])vm.runInContext(await readFile(new URL(`./extension/${file}`,import.meta.url),"utf8"),context);
  for(const [source,recipe] of [["weilai",kRecipe],["tuoj",tuRecipe]]){
    context.message={source,recipe};context.sender={url:SOURCES[source].url,tab:{id:1}};
    await vm.runInContext("cloudRecipe(message,sender)",context);
  }
  assert.equal(reads,0);assert.equal(sent,0);
  stored.cloudRucListsEnabled=true;await vm.runInContext("cloudRecipe(message,sender)",context);assert.equal(reads,1);assert.equal(sent,1);
});
