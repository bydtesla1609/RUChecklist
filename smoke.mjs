import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const origin=process.argv[2] || "http://127.0.0.1:8766";
const password=(await readFile(new URL("./data/access-code.txt",import.meta.url),"utf8")).trim();
function device(){return {cookie:"",async call(path,method="GET",payload){
  const response=await fetch(origin+path,{method,headers:{"Content-Type":"application/json",Cookie:this.cookie},...(payload!==undefined?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(15000)});
  if(response.headers.has("set-cookie"))this.cookie=response.headers.get("set-cookie").split(";")[0];
  return {status:response.status,value:await response.json()};
}};}
const desktop=device(),mobile=device();let created,uploaded;
try {
  for(const path of ["/","/static/app.js","/static/style.css","/static/icon.svg"]){
    const r=await fetch(origin+path,{signal:AbortSignal.timeout(15000)});assert.equal(r.status,200,path);assert.ok((await r.text()).length>100,path);
  }
  assert.equal((await mobile.call("/api/board")).status,401);
  for(const client of [desktop,mobile])assert.equal((await client.call("/api/login","POST",{password})).status,200);
  const attachment=Uint8Array.from({length:600000},(_,i)=>i%251),form=new FormData();
  form.set("file",new File([attachment],"同步验证-自动清理.docx"));
  const upload=await fetch(origin+"/api/files",{method:"POST",headers:{Cookie:desktop.cookie},body:form,signal:AbortSignal.timeout(120000)});
  assert.equal(upload.status,201);uploaded=await upload.json();
  const todos=[{id:"first",text:"第一步",done:false},{id:"second",text:"第二步",done:false}];
  const response=await desktop.call("/api/tasks","POST",{category:"活动",title:"连接验证（自动清理）",location:"测试地点",todos,attachments:[uploaded.id],links:[{label:"测试资料",url:"https://example.com/notes"}],starts_at:"2026-10-01T10:00:00+08:00",ends_at:"2026-10-01T11:00:00+08:00"});
  assert.equal(response.status,201);created=response.value;
  assert.ok((await mobile.call("/api/board")).value.tasks.some(t=>t.id===created.id));
  const download=await fetch(origin+`/api/files/${uploaded.id}`,{headers:{Cookie:mobile.cookie},signal:AbortSignal.timeout(120000)});
  assert.equal(download.status,200);assert.deepEqual(new Uint8Array(await download.arrayBuffer()),attachment);
  const partial=await fetch(origin+`/api/files/${uploaded.id}`,{headers:{Cookie:mobile.cookie,Range:"bytes=524280-524300"},signal:AbortSignal.timeout(30000)});
  assert.equal(partial.status,206);assert.deepEqual(new Uint8Array(await partial.arrayBuffer()),attachment.slice(524280,524301));
  assert.equal((await fetch(origin+`/api/files/${uploaded.id}`)).status,401);
  const edit=await mobile.call(`/api/tasks/${created.id}`,"PATCH",{status:"done",todos:[{...todos[1],done:true,text:"完成第二步"},todos[0]],revision:created.revision});assert.equal(edit.status,200);created=edit.value;
  assert.equal((await desktop.call("/api/board")).value.tasks.find(t=>t.id===created.id).status,"done");
  const synced=(await desktop.call("/api/board")).value.tasks.find(t=>t.id===created.id);
  assert.equal(synced.location,"测试地点");assert.deepEqual(synced.todos,created.todos);assert.equal(synced.todos[0].id,"second");
  assert.equal(synced.links[0].url,"https://example.com/notes");assert.equal(synced.attachments[0].id,uploaded.id);
  assert.equal((await desktop.call(`/api/tasks/${created.id}`,"PATCH",{status:"doing",revision:1})).status,409);
  console.log("PASS: static assets, authentication, two independent sessions, create/edit/read synchronization, stale-write rejection, private file upload/download/ranges and shared links.");
} finally {
  if(created){const removed=await desktop.call(`/api/tasks/${created.id}`,"DELETE",{revision:created.revision});assert.equal(removed.status,200);console.log("PASS: temporary verification task removed.");}
  if(desktop.cookie)await desktop.call("/api/logout","POST",{});
  if(mobile.cookie)await mobile.call("/api/logout","POST",{});
}
