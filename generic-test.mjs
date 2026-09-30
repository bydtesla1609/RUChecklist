import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFile} from "node:fs/promises";
process.env.TRIAL_UI_FIXTURE="1";
const {trialFixture}=await import("./trial-test.mjs");

test("generic imports require a configured origin, isolate users and preserve unchanged/manual/deleted tasks",async()=>{
  const {database,client,invites}=await trialFixture(),a=client(),b=client(),collector=client();
  try {
    for(const [index,user] of [a,b].entries())await user.api("/api/register","POST",{username:`generic_${index}`,password:"Ab1234",invite:invites[index]});
    const token=(await a.api("/api/collector-token","POST",{})).data.token,headers={Authorization:`Bearer ${token}`};
    const source="web:https://class.example",task={external_id:"g:"+"a".repeat(64),title:"测试作业",content:"",due_at:"2026-10-12T14:00:00Z",source_url:"https://class.example/work/1"};
    const send=tasks=>collector.api("/api/import","POST",{source,tasks},headers);
    assert.equal((await send([task])).status,400);
    const links=await a.api("/api/source-links","PUT",{urls:["https://class.example/list"]});assert.equal(links.data.links[0].generic,true);
    const config=(await collector.api("/api/collector-config","GET",undefined,headers)).data;
    assert.equal(config.sources[source].browser_only,true);
    assert.equal((await send([{...task,source_url:"https://other.example/work/1"}])).status,400);
    assert.equal((await send([task])).data.changed,1);
    const before=(await a.api("/api/board")).data.tasks[0];assert.equal((await b.api("/api/board")).data.tasks.length,0);
    assert.equal((await send([task])).data.changed,0);
    assert.equal((await a.api("/api/board")).data.tasks[0].revision,before.revision);
    database.prepare("UPDATE u1_tasks SET title='我的备注标题',overrides='[\"title\"]',status='done',completed_at='2026-09-30T10:00:00Z' WHERE id=?").run(before.id);
    assert.equal((await send([{...task,title:"网站改名",due_at:null}])).data.changed,0);
    const saved=database.prepare("SELECT * FROM u1_tasks WHERE id=?").get(before.id);assert.equal(saved.title,"我的备注标题");assert.equal(saved.status,"done");assert.equal(saved.due_at,"2026-10-12T14:00:00.000Z");
    assert.equal((await send([{...task,status:"todo"}])).data.changed,1,"explicit platform state updates original task");
    database.prepare("UPDATE u1_tasks SET deleted=1 WHERE id=?").run(before.id);
    assert.equal((await send([{...task,status:"done"}])).data.changed,0);
    await a.api("/api/source-links","PUT",{urls:[]});assert.equal((await send([task])).status,400);
    assert.equal(database.prepare("SELECT count(*) n FROM u1_tasks").get().n,1);
  }finally{database.close();}
});

test("generic extension requires per-origin permission, preview approval and the original account binding",async()=>{
  const url="https://class.example/list",source="web:https://class.example",rule={rows:".row",title:".title",due:"",status:"",course:""},posts=[],registrations=[];
  let allowed=false,stored={boardURL:"https://ruchecklist-trial.pages.dev",account:"alice",token:"a".repeat(48),enabled:true},configured=true;
  const noop={addListener(){}},context=vm.createContext({URL,URLSearchParams,AbortSignal,TextEncoder,crypto,
    fetch:async(address,options)=>{if(address.endsWith("/api/collector-config"))return Response.json({account:stored.account,links:configured?[{url,source,generic:true}]:[]});posts.push(JSON.parse(options.body));return Response.json({changed:1});},
    chrome:{permissions:{contains:async()=>allowed},scripting:{getRegisteredContentScripts:async()=>[],registerContentScripts:async values=>registrations.push(values),unregisterContentScripts:async()=>{}},storage:{local:{get:async()=>structuredClone(stored),set:async value=>{stored={...stored,...structuredClone(value)};},remove:async key=>{delete stored[key];}}},action:{onClicked:noop,setBadgeText:async()=>{}},runtime:{onMessage:noop,onStartup:noop,onInstalled:noop,getURL:part=>`chrome-extension://synthetic/${part}`},alarms:{onAlarm:noop}}});
  for(const name of ["background.js","generic-parser.js","generic-background.js"])vm.runInContext(await readFile(new URL(`./extension/${name}`,import.meta.url),"utf8"),context);
  context.sender={url,tab:{id:1},frameId:0};context.msg={type:"generic-context"};
  const call=()=>vm.runInContext("genericMessage(msg,sender)",context);
  await assert.rejects(call,/撤销/);allowed=true;
  const initial=await call();assert.equal(initial.rule,null);
  const task={external_id:"g:"+"b".repeat(64),title:"Test",source_url:"https://class.example/work/1",stable:true,cookie:"never-upload",html:"never-upload",answers:"never-upload"};
  context.msg={type:"generic-import",binding:initial.binding,rule,tasks:[task],confirmed:false};
  await assert.rejects(call,/预览确认/);assert.equal(posts.length,0);
  context.msg.confirmed=true;await call();assert.equal(posts.length,1);assert.ok(!JSON.stringify(posts).includes("never-upload"));
  for(const saved of Object.values(stored.genericRules))saved.fields=Object.fromEntries(Object.entries(saved.fields).reverse());
  context.msg.confirmed=false;await call();assert.deepEqual(posts[1].tasks,[],"unchanged tasks reuse import cache");
  allowed=false;await assert.rejects(call,/撤销/);allowed=true;
  stored.account="bob";await assert.rejects(call,/账号已切换/);stored.account="alice";
  context.msg.tasks=[{...task,stable:false}];await assert.rejects(call,/稳定链接/);
  configured=false;await assert.rejects(call,/未配置/);
  context.links=[{url}];await vm.runInContext("registerGeneric(links)",context);assert.deepEqual(JSON.parse(JSON.stringify(registrations[0][0].matches)),["https://class.example/*"]);
});
