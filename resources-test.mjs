import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import worker from "./worker.mjs";
import {createEnvironment} from "./local.mjs";

test("private attachments, links, byte ranges, persistence, cleanup and import URLs",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"campus-resources-"));
  let {env,database}=await createEnvironment(directory,"resource-test-only"), cookie="";
  const request=(path,method="GET",body,headers={})=>worker.fetch(new Request(`https://board.example${path}`,{method,headers:{Cookie:cookie,...headers},...(body!==undefined?{body}:{})}),env);
  const json=async(path,method,payload)=>{const response=await request(path,method,JSON.stringify(payload),{"Content-Type":"application/json"});return {status:response.status,value:await response.json()};};
  async function upload(name,bytes,mime="application/octet-stream") { const form=new FormData();form.set("file",new File([bytes],name,{type:mime}));return request("/api/files","POST",form); }
  try {
    assert.equal((await upload("hidden.txt","x")).status,401);
    const login=await request("/api/login","POST",JSON.stringify({password:"resource-test-only"}),{"Content-Type":"application/json"});
    cookie=login.headers.get("set-cookie").split(";")[0];
    const bytes=Uint8Array.from({length:700000},(_,index)=>index%251); bytes.set(new TextEncoder().encode("%PDF-1.4\n"));
    const uploaded=await upload("课程资料.pdf",bytes,"application/pdf"); assert.equal(uploaded.status,201);
    const file=await uploaded.json(); assert.equal(file.type,"application/pdf");
    assert.equal((await request(`/api/files/${file.id}`)).status,404);
    assert.equal((await upload("空文件.docx",new Uint8Array())).status,413);
    assert.equal((await upload("过大.pdf",new Uint8Array(10*1024*1024+1))).status,413);
    const payload={title:"附件与链接",category:"作业",due_at:"2026-10-01T12:00:00Z",attachments:[file.id],links:[{label:"课程资料",url:"https://example.com/materials"}]};
    assert.equal((await json("/api/tasks","POST",{...payload,links:[{label:"bad",url:"javascript:alert(1)"}]})).status,400);
    assert.equal((await json("/api/tasks","POST",{...payload,attachments:["missing"]})).status,400);
    let created=await json("/api/tasks","POST",payload); assert.equal(created.status,201);
    assert.equal(created.value.attachments[0].name,"课程资料.pdf");
    let response=await request(`/api/files/${file.id}`); assert.equal(response.status,200);assert.match(response.headers.get("Content-Disposition"),/^inline;/);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
    response=await request(`/api/files/${file.id}`,"GET",undefined,{Range:"bytes=524270-524310"});assert.equal(response.status,206);assert.equal(response.headers.get("Content-Range"),"bytes 524270-524310/700000");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes.slice(524270,524311));
    response=await request(`/api/files/${file.id}`,"GET",undefined,{Range:"bytes=-12"});assert.equal(response.status,206);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes.slice(-12));
    assert.equal((await request(`/api/files/${file.id}`,"GET",undefined,{Range:"bytes=999999-"})).status,416);
    response=await request(`/api/files/${file.id}?download=1`,"HEAD");assert.match(response.headers.get("Content-Disposition"),/^attachment;/);assert.equal((await response.arrayBuffer()).byteLength,0);
    const savedCookie=cookie;cookie="";assert.equal((await request(`/api/files/${file.id}`)).status,401);cookie=savedCookie;
    let board=await (await request("/api/board")).json(); assert.deepEqual(board.tasks[0].links,payload.links);assert.equal(board.storage.used,700000);
    const token=(await json("/api/collector-token","POST",{})).value.token;
    const sourceURL="https://smartestu.cn/assignment?homeworkId=test-item";
    const batch={source:"smartestu",tasks:[{external_id:"resource-hw",content:"网络课程作业",source_url:sourceURL}]};
    const imported=await request("/api/import","POST",JSON.stringify(batch),{"Content-Type":"application/json",Authorization:`Bearer ${token}`});assert.equal(imported.status,200);
    assert.equal((await (await request("/api/board")).json()).tasks.find(t=>t.source).source_url,sourceURL);
    batch.tasks[0].source_url="https://attacker.example/work";
    assert.equal((await request("/api/import","POST",JSON.stringify(batch),{"Content-Type":"application/json",Authorization:`Bearer ${token}`})).status,400);
    database.close();({env,database}=await createEnvironment(directory,"resource-test-only"));
    assert.deepEqual(new Uint8Array(await (await request(`/api/files/${file.id}`)).arrayBuffer()),bytes);
    const changed=await json(`/api/tasks/${created.value.id}`,"PATCH",{revision:created.value.revision,attachments:[],links:[]});assert.equal(changed.status,200);
    assert.equal((await request(`/api/files/${file.id}`)).status,404);
    database.prepare("UPDATE files SET created_at='2000-01-01'").run();
    const other=await upload("report.docx","PK-test-word");assert.equal(other.status,201);assert.equal((await other.json()).type,"application/octet-stream");
    assert.equal(database.prepare("SELECT count(*) AS n FROM file_chunks WHERE file_id=?").get(file.id).n,0);
    assert.equal(database.prepare("SELECT count(*) AS n FROM files WHERE id=?").get(file.id).n,0);
  } finally { database.close();await rm(directory,{recursive:true,force:true}); }
});
