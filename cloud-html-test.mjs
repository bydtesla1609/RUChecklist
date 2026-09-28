// Optional: use the installed Wrangler/Miniflare runtime, without a browser or real account.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
const {Miniflare}=await import(process.env.MINIFLARE_MODULE || "miniflare");
const modules=await Promise.all(["cloud.mjs","extension/parsers.js","extension/cloud-routes.js"].map(async path=>({type:"ESModule",path:resolve(path),contents:await readFile(path,"utf8")})));
const mf=new Miniflare({compatibilityDate:"2026-05-15",modules:[{type:"ESModule",path:resolve("cloud-html-entry.mjs"),contents:`import {learningHTML} from './cloud.mjs';export default {async fetch(request){try{return Response.json(await learningHTML(await request.text(),'https://mooc1.chaoxing.com/mooc-ans/mooc2/work/list?courseId=test-course'));}catch(error){return Response.json({error:error.message},{status:502});}}}`},...modules]});
try {
  const html=`<div class="ulDiv"><ul><li data="/mooc-ans/mooc2/work/task?workId=one&amp;courseId=test-course"><a class="overHidden2">云端 &amp; 作业</a><span class="status">待批阅</span><span class="time" title="2026-10-02 20:00">剩余 2 天</span></li><li data="/mooc-ans/mooc2/work/task?workId=two&amp;courseId=test-course"><a class="overHidden2">第二项</a><span class="status">未交</span></li></ul></div><ul id="page"><li>1</li><li>2</li></ul>`;
  const response=await mf.dispatchFetch("http://test.local",{method:"POST",body:html});
  assert.equal(response.status,200);const data=await response.json();
  assert.equal(data.tasks.length,2);assert.equal(data.tasks[0].content,"云端 & 作业");assert.equal(data.tasks[0].status,"done");assert.equal(data.tasks[0].due_at,"2026-10-02T12:00:00.000Z");assert.equal(data.tasks[1].status,"todo");assert.equal(data.pages,2);
  assert.equal(new URL(data.tasks[0].source_url).searchParams.get("courseId"),"test-course");
  const empty=await mf.dispatchFetch("http://test.local",{method:"POST",body:'<div class="ulDiv">暂无作业</div>'});assert.deepEqual((await empty.json()).tasks,[]);
  const login=await mf.dispatchFetch("http://test.local",{method:"POST",body:'<form>请登录</form>'});assert.equal(login.status,502);
  console.log("PASS: actual Workers HTMLRewriter extracts learning task states, decodes URLs/entities, reads pagination and rejects login pages.");
}finally{await mf.dispose();}
