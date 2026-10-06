import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {sqliteBinding} from "./local.mjs";
import trial,{runTrialCloud} from "./trial-worker.mjs";
import {trialSchema,partition} from "./trial-schema.mjs";
import {digest,sourceLinks} from "./worker.mjs";
import vm from "node:vm";
import {readFile} from "node:fs/promises";

export async function trialFixture() {
  const database=new DatabaseSync(":memory:");database.exec("PRAGMA foreign_keys=ON");database.exec(trialSchema());
  const identities=new Map(),invites=Array.from({length:30},(_,i)=>(i+1).toString(16).padStart(48,"0"));
  for(const [i,code] of invites.entries())database.prepare("INSERT INTO trial_invites(hash,slot) VALUES (?,?)").run(await digest(code),i+1);
  const env={DB:sqliteBinding(database),SUPABASE_URL:"https://testonly.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service-key",REGISTRATION_OPEN:"true",AUTH_FETCH:async(input,init)=>{
    assert.equal(init.redirect,"manual");
    const path=new URL(input).pathname,value=JSON.parse(init.body);
    if(path==="/auth/v1/admin/users" && init.method==="POST"){
      if(identities.has(value.email))return Response.json({error:"exists"},{status:422});
      const id=crypto.randomUUID();identities.set(value.email,{id,password:value.password});return Response.json({id});
    }
    if(path.startsWith("/auth/v1/admin/users/") && init.method==="PUT"){
      const user=[...identities.values()].find(user=>user.id===path.split("/").at(-1));if(!user)return Response.json({},{status:404});user.password=value.password;return Response.json({id:user.id});
    }
    const identity=identities.get(value.email);
    return identity?.password===value.password?Response.json({user:{id:identity.id},access_token:"must-not-be-forwarded"}):Response.json({error:"bad password"},{status:400});
  }};
  const client=()=>{
    let cookie="";
    return {async api(path,method="GET",data,headers={}){
      const result=await trial.fetch(new Request(`https://ruchecklist-trial.pages.dev${path}`,{method,headers:{Cookie:cookie,...(!(data instanceof FormData)?{"Content-Type":"application/json"}:{}),...headers},...(data!==undefined?{body:data instanceof FormData?data:JSON.stringify(data)}:{})}),env);
      if(result.headers.has("set-cookie"))cookie=result.headers.get("set-cookie").split(";")[0];
      const text=await result.text();let value;try{value=JSON.parse(text);}catch{value=text;}
      return {status:result.status,data:value,headers:result.headers};
    }};
  };
  return {database,env,invites,client,identities};
}

if(!process.env.TRIAL_UI_FIXTURE) test("trial accounts enforce invitations, isolate all board data and scope import tokens",async()=>{
  const {database:db,env,invites,client}=await trialFixture();
  const a=client(),b=client(),anonymous=client(),password="Ab1234";
  try {
    assert.equal((await anonymous.api("/api/board")).status,401);
    assert.equal((await a.api("/api/register","POST",{username:"alice",password,invite:"bad"})).status,400);
    assert.equal((await a.api("/api/register","POST",{username:"alice",password,invite:invites[0]},{Origin:"https://evil.example"})).status,403);
    for(const weak of ["Ab123","abcdef","123456"])assert.equal((await a.api("/api/register","POST",{username:"alice",password:weak,invite:invites[0]})).status,400);
    const registered=await a.api("/api/register","POST",{username:"alice",password,invite:invites[0]});assert.equal(registered.status,200);assert.match(registered.data.recovery,/^[a-f0-9]{48}$/);
    assert.ok(!JSON.stringify(registered.data).includes("access_token"));assert.match(registered.headers.get("set-cookie"),/HttpOnly; Secure; SameSite=Strict/);
    assert.equal((await b.api("/api/register","POST",{username:"bob",password,invite:invites[0]})).status,409);
    assert.equal((await b.api("/api/register","POST",{username:"bob",password,invite:invites[1]})).status,200);
    assert.equal((await a.api("/api/source-links")).data.links.length,0);
    assert.equal((await a.api("/api/source-links","PUT",{urls:["https://smartestu.cn/assignment","https://course.example/homework"]})).status,200);
    assert.equal((await b.api("/api/source-links")).data.links.length,0);
    const file=new FormData();file.set("file",new Blob(["%PDF-test"],{type:"application/pdf"}),"test.pdf");
    const upload=await a.api("/api/files","POST",file);assert.equal(upload.status,201);const fileId=upload.data.id;
    const oversized=new FormData();oversized.set("file",new Blob([new Uint8Array(1024*1024+1)]),"large.bin");
    assert.equal((await a.api("/api/files","POST",oversized)).status,413);
    assert.equal((await b.api(`/api/files/${fileId}`)).status,404);
    const created=await a.api("/api/tasks","POST",{title:"Alice private task",category:"作业",due_at:"2026-10-01T00:00:00Z",attachments:[fileId]});assert.equal(created.status,201);
    const task=created.data;
    for(const [method,value] of [["GET",undefined],["PATCH",{title:"Bob injection",revision:task.revision}],["DELETE",{revision:task.revision}]])assert.ok([404,409].includes((await b.api(`/api/tasks/${task.id}`,method,value)).status));
    assert.equal((await b.api("/api/tasks","POST",{title:"bad reference",due_at:"2026-10-01T00:00:00Z",attachments:[fileId]})).status,400);
    assert.equal((await b.api("/api/board")).data.tasks.length,0);
    const ta=(await a.api("/api/collector-token","POST",{})).data.token,tb=(await b.api("/api/collector-token","POST",{})).data.token;
    const imported={source:"smartestu",tasks:[{external_id:"same-course-work",title:"Imported work",due_at:"2026-10-01T00:00:00Z",status:"todo"}]};
    for(const token of [ta,tb])assert.equal((await anonymous.api("/api/import","POST",imported,{Authorization:`Bearer ${token}`})).data.changed,1);
    assert.equal((await anonymous.api("/api/import","POST",imported,{Authorization:`Bearer ${tb}`})).data.changed,0);
    assert.equal((await a.api("/api/board")).data.tasks.length,2);assert.equal((await b.api("/api/board")).data.tasks.length,1);
    assert.equal((await anonymous.api("/api/board","GET",undefined,{Authorization:`Bearer ${ta}`})).status,401);
    assert.equal((await anonymous.api("/api/collector-config","GET",undefined,{Authorization:`Bearer ${ta}`})).data.account,registered.data.account);
    assert.equal((await b.api("/api/academic/snapshot")).data,null);
    db.prepare("UPDATE u1_tasks SET status='done',completed_at='2026-01-01T00:00:00Z',archived_at='2026-01-09T00:00:00Z' WHERE id=?").run(task.id);
    assert.equal((await a.api("/api/archive")).data.total,1);assert.equal((await b.api("/api/archive")).data.total,0);
    assert.equal((await a.api("/api/cloud")).data.enabled,false);assert.equal((await a.api("/api/cloud-authorize","POST",{})).status,401);
    const renewal=(await a.api("/api/collector-token","POST",{})).data.token;
    assert.equal((await anonymous.api("/api/collector-config","GET",undefined,{Authorization:`Bearer ${ta}`})).status,401);
    const recovered=await anonymous.api("/api/recover","POST",{username:"alice",password:"Replacement-password-123",recovery:registered.data.recovery});assert.equal(recovered.status,200);
    assert.equal((await a.api("/api/board")).status,401);
    assert.equal((await anonymous.api("/api/collector-config","GET",undefined,{Authorization:`Bearer ${renewal}`})).status,401);
    assert.equal((await client().api("/api/recover","POST",{username:"alice",password,recovery:registered.data.recovery})).status,401);
    assert.equal((await a.api("/api/login","POST",{username:"alice",password})).status,401);
    assert.equal((await a.api("/api/login","POST",{username:"alice",password:"Replacement-password-123"})).status,200);
    const regenerated=await a.api("/api/recovery-code","POST",{password:"Replacement-password-123"});assert.equal(regenerated.status,200);
    await a.api("/api/logout","POST",{});assert.equal((await a.api("/api/board")).status,401);
    for(let i=2;i<30;i++)assert.equal((await client().api("/api/register","POST",{username:`tester_${i}`,password,invite:invites[i]})).status,200);
    assert.equal(db.prepare("SELECT count(*) n FROM trial_users WHERE status='active'").get().n,30);
    assert.equal((await client().api("/api/register","POST",{username:"extra_user",password,invite:"f".repeat(48)})).status,400);
    assert.throws(()=>partition(env.DB,301));assert.throws(()=>partition(env.DB,"1; DROP TABLE trial_users"));
    env.REGISTRATION_OPEN="false";assert.equal((await client().api("/api/register","POST",{username:"extra_user",password,invite:invites[0]})).status,403);
  }finally{db.close();}
});
if(!process.env.TRIAL_UI_FIXTURE) test("generic website input validates URLs, distinguishes local-only recognition and deduplicates",()=>{
  const links=sourceLinks(["https://smartestu.cn/assignment","https://smartestu.cn/assignment","https://course.example/homework"]);
  assert.equal(links.length,2);assert.equal(links[1].source,"web:https://course.example");assert.equal(links[1].generic,true);
  for(const url of ["javascript:alert(1)","http://example.com","https://user:password@example.com"]){assert.throws(()=>sourceLinks([url]));}
  assert.throws(()=>sourceLinks(Array(13).fill("https://example.com")));
});
if(!process.env.TRIAL_UI_FIXTURE) test("trial cloud grants, encrypted recipes and scheduled imports stay within each account",async()=>{
  const {database:db,env,invites,client}=await trialFixture();env.CLOUD_ENCRYPTION_KEY="12".repeat(32);
  const a=client(),b=client(),anonymous=client();
  try {
    for(const [i,c] of [a,b].entries())await c.api("/api/register","POST",{username:`cloud_${i}`,password:"Ab1234",invite:invites[i]});
    const ta=(await a.api("/api/collector-token","POST",{})).data.token,tb=(await b.api("/api/collector-token","POST",{})).data.token;
    const grant={Authorization:`Bearer ${ta}`},grantB={Authorization:`Bearer ${tb}`};
    const recipe={source:"smartestu",recipe:{url:"https://smartestu.cn/api/homework/student/mark/queryHomeworks",method:"POST",page_url:"https://smartestu.cn/assignment",headers:{cookie:"session=synthetic-trial-cookie","content-type":"application/json"},body:JSON.stringify({pageNo:1,pageSize:20})}};
    assert.equal((await anonymous.api("/api/cloud-credentials","POST",recipe,grant)).status,403);
    assert.equal((await anonymous.api("/api/cloud-authorize","POST",{},grant)).status,200);
    assert.equal((await anonymous.api("/api/cloud-credentials","POST",recipe,grant)).status,400);
    await a.api("/api/source-links","PUT",{urls:["https://smartestu.cn/assignment"]});
    await b.api("/api/source-links","PUT",{urls:["https://smartestu.cn/assignment"]});
    assert.equal((await anonymous.api("/api/cloud-credentials","POST",recipe,grant)).status,200);
    assert.equal((await b.api("/api/cloud")).data.enabled,false);
    assert.equal((await a.api("/api/cloud")).data.interval_minutes,30);
    const ciphertext=db.prepare("SELECT value FROM u1_settings WHERE key='cloud_credential_smartestu'").get().value;
    assert.ok(!ciphertext.includes("synthetic"));assert.ok(!JSON.stringify((await a.api("/api/cloud")).data).includes("cookie"));
    let reads=0;const fetcher=async(url,options)=>{reads++;assert.equal(options.headers.cookie,"session=synthetic-trial-cookie");return url.endsWith("/api/auth/session")?Response.json({sessionContext:"synthetic-context",csrfToken:"synthetic-csrf"}):Response.json({data:{pageNo:1,pageTotal:1,courseHomeworkDTOList:[{studentCourseHomeworkDTOList:[{id:"trial-cloud-work",name:"Cloud assignment",submission_status:"completed"}]}]}});};
    assert.equal((await runTrialCloud(env,0,{fetcher})).smartestu.changed,1);
    const task=(await a.api("/api/board")).data.tasks[0];assert.equal(task.status,"done");assert.equal((await b.api("/api/board")).data.tasks.length,0);
    const requests=reads;await runTrialCloud(env,60000,{fetcher});assert.equal(reads,requests);
    assert.equal((await runTrialCloud(env,1800000,{fetcher})).smartestu.changed,0);
    assert.equal((await a.api("/api/board")).data.tasks[0].revision,task.revision);
    await anonymous.api("/api/cloud-authorize","POST",{},grantB);
    db.prepare("INSERT INTO u2_settings(key,value) VALUES ('cloud_credential_smartestu',?)").run(ciphertext);
    const beforeReplay=reads;const replay=await runTrialCloud(env,60000,{fetcher});assert.ok(replay.smartestu.error);assert.equal(reads,beforeReplay);
    await a.api("/api/cloud","DELETE");assert.equal((await runTrialCloud(env,0,{fetcher})).skipped,true);
    assert.equal(db.prepare("SELECT count(*) n FROM u1_settings WHERE key LIKE 'cloud_credential_%'").get().n,0);
    await b.api("/api/source-links","PUT",{urls:[]});assert.equal(db.prepare("SELECT count(*) n FROM u2_settings WHERE key LIKE 'cloud_credential_%'").get().n,0);
  }finally{db.close();}
});
if(!process.env.TRIAL_UI_FIXTURE) test("extension pairs to the correct pilot account and scans only configured supported links",async()=>{
  let saved={boardURL:"https://campus-task-board.pages.dev",token:"f".repeat(48),enabled:true,cloudEnabled:true,importCache:{private:true},sourceResults:{private:true}},nextId=1;
  let configuration={account:"alice-id",links:[{source:"smartestu",url:"https://smartestu.cn/assignment?course=one"},{source:"smartestu",url:"https://smartestu.cn/assignment?course=two"},{source:null,url:"https://other.example/work"}],sources:{}};
  const opened=[],noop={addListener(){}};
  const context=vm.createContext({URL,AbortSignal,fetch:async()=>({ok:true,json:async()=>structuredClone(configuration)}),
    chrome:{storage:{local:{get:async()=>structuredClone(saved),set:async value=>{saved={...saved,...structuredClone(value)};}}},
      action:{onClicked:noop,setBadgeText:async()=>{}},runtime:{onMessage:noop,onStartup:noop,onInstalled:noop,getManifest:()=>({version:"1.5.0"})},alarms:{onAlarm:noop,clear:async()=>{},create:async()=>{}},
      tabs:{create:async()=>({id:nextId++}),get:async()=>({id:1,active:false,url:"https://smartestu.cn/assignment?course=old"}),update:async(id,{url})=>opened.push(url)}}});
  vm.runInContext(await readFile(new URL("./extension/background.js",import.meta.url),"utf8"),context);
  context.sender={url:"https://ruchecklist-trial.pages.dev/",tab:{id:1},frameId:0};context.pair={command:"pair",token:"a".repeat(48),account:"alice-id"};
  const paired=await vm.runInContext("boardControl(pair,sender)",context);assert.equal(paired.connected,true);assert.equal(saved.cloudEnabled,false);assert.deepEqual(saved.importCache,{});assert.deepEqual(saved.sourceResults,{});
  assert.equal((await vm.runInContext("boardControl({command:'status',account:'bob-id'},sender)",context)).connected,false);
  await assert.rejects(()=>vm.runInContext("boardControl({command:'scan',account:'bob-id'},sender)",context),/连接/);
  await vm.runInContext("performScan()",context);assert.deepEqual(opened,configuration.links.slice(0,2).map(l=>l.url));
  configuration.links[0].url="https://smartestu.cn/assignment?course=replaced";opened.length=0;
  await vm.runInContext("performScan()",context);assert.equal(opened[0],configuration.links[0].url);
  configuration.links.push({source:"ketangpai",url:"https://www.ketangpai.com/#/main/classDetail?courseid=one"});opened.length=0;
  await vm.runInContext("boardControl({command:'scan',source:'ketangpai',account:'alice-id'},sender)",context);
  assert.deepEqual(opened,[configuration.links.at(-1).url]);
  await assert.rejects(()=>vm.runInContext("performScan(false,false,'unknown')",context),/未知/);
  configuration={...configuration,links:[]};await assert.rejects(()=>vm.runInContext("performScan()",context),/第 3 步/);
  configuration.account="bob-id";await assert.rejects(()=>vm.runInContext("boardControl(pair,sender)",context),/不属于/);
  await assert.rejects(()=>vm.runInContext("boardControl(pair,{url:'https://evil.example',tab:{id:2},frameId:0})",context),/不允许/);
});
