import {cloudStatus,enableCloud,revokeCloud,saveCloudRecipe,runCloud} from "./cloud.mjs";
import "./extension/academic-parser.js";
export const SOURCES = {
  yoj: {name:"YOJ",url:"http://yoj.ruc.edu.cn/index.php/index/course/detail.html",browser_only:true},
  weilai: {name:"人大未来课堂",url:"https://k.ruc.edu.cn/UserClient/homePage.html"},
  tuoj: {name:"TUOJ",url:"https://ruc.thusaac.com/"},
  smartestu: {name: "SmartEstu", url: "https://smartestu.cn/assignment"},
  ketangpai: {name: "课堂派", url: "https://www.ketangpai.com/"},
  chaoxing: {name: "学习通", url: "https://mooc2-ans.chaoxing.com/"},
  zhifz: {name: "智夫子", url: "https://www.zhifz.com/#/zuoye"},
  ruc_courses: {name:"人大课表",url:"https://jw.ruc.edu.cn/Njw2017/index.html#/student/student-course-list/",kind:"academic"},
  ruc_exams: {name:"人大考试",url:"https://jw.ruc.edu.cn/Njw2017/index.html#/student/test-arrange-search/",kind:"academic"},
};
function configuredSources(env) {
  const urls=JSON.parse(env.SOURCE_URLS || "{}");
  return Object.fromEntries(Object.entries(SOURCES).map(([id,source])=>{
    const url=new URL(urls[id] || source.url);
    return [id,{...source,url:url.protocol==="https:" && url.hostname===new URL(source.url).hostname && !url.username && !url.password ? url.href : source.url}];
  }));
}
export function sourceLinks(values) {
  if(!Array.isArray(values) || values.length>12)fail(400,"最多保存 12 个网站链接");
  const unique=new Set();
  return values.map(value=>{
    const url=new URL(webURL(value,"作业页面链接"));
    if(url.protocol!=="https:" && !(url.protocol==="http:" && url.hostname==="yoj.ruc.edu.cn" && !url.port))fail(400,"请填写 HTTPS 链接；YOJ 支持其原有 HTTP 地址");
    const host=url.hostname;
    const source=({"yoj.ruc.edu.cn":"yoj","k.ruc.edu.cn":"weilai","ruc.thusaac.com":"tuoj"})[host] || (host==="smartestu.cn"?"smartestu":host==="www.ketangpai.com"?"ketangpai":host==="www.zhifz.com"?"zhifz":/(^|\.)chaoxing\.com$/.test(host)?"chaoxing":host==="jw.ruc.edu.cn"?"ruc_courses":null);
    return {url:url.href,source:source || `web:${url.origin}`,name:source?SOURCES[source].name:host,...(!source?{generic:true}:{})};
  }).filter(link=>{if(unique.has(link.url))return false;unique.add(link.url);return true;});
}
async function savedLinks(env) {
  const saved=await env.DB.prepare("SELECT value FROM settings WHERE key='source_links'").first();
  if(saved)return sourceLinks(JSON.parse(saved.value).map(link=>link.url));
  return env.TRIAL_MODE?[]:sourceLinks(Object.entries(configuredSources(env)).filter(([id,source])=>!["zhifz","yoj","weilai","tuoj"].includes(id) && (!source.kind || source.name==="人大课表")).map(([,source])=>source.url));
}
async function allSources(env) {
  const sources=configuredSources(env);
  for(const link of await savedLinks(env))if(link.generic && !sources[link.source])sources[link.source]={name:link.name,url:link.url,browser_only:true,generic:true};
  return sources;
}
const CATEGORIES = ["作业", "课程", "考试", "活动", "会议"];
const STATUSES = ["todo", "doing", "done"];
const FIELDS = ["category", "title", "content", "location", "todos", "links", "attachments", "due_at", "starts_at", "ends_at", "status", "details"];
const stored = (task, field) => ["todos","links","attachments","details"].includes(field) ? JSON.stringify(task[field]) : task[field];
const FILE_LIMIT=10*1024*1024, STORAGE_LIMIT=100*1024*1024, CHUNK_SIZE=512*1024;
const now = () => new Date().toISOString();
export const RELEASE={version:"2.14.0",title:"消息、反馈与手动归档已上线",items:["任务支持手动归档与恢复，停止 7 天自动归档","删除任务、待办、附件、链接或网站前都会确认","新增消息看板、管理员公告与私聊反馈，适配手机使用"]};
const completedAt = (status,previous,stamp) => status==="done" ? (previous?.status==="done" && previous.completed_at ? previous.completed_at : stamp) : null;
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2,"0")).join("");
export async function digest(text) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2,"0")).join(""); }
function equal(a, b) { if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false; let diff=0; for(let i=0;i<a.length;i++) diff |= a.charCodeAt(i)^b.charCodeAt(i); return diff===0; }
function fail(status, error) { throw Object.assign(new Error(error), {status}); }
const json = (value, status=200, headers={}) => Response.json(value, {status, headers});
function expose(row, files) {
  const {overrides, deleted, external_id, ...visible} = row;
  const attachments=JSON.parse(row.attachments);
  return {...visible,title:row.title || row.content,details:JSON.parse(row.details || "{}"),todos:JSON.parse(row.todos),links:JSON.parse(row.links),attachments:files ? attachments.map(id=>files.get(id)).filter(Boolean) : attachments};
}
async function withFiles(row, db) {
  const files=await fileReferences(JSON.parse(row.attachments),db);
  return expose(row,files);
}
async function fileReferences(ids,db) {
  if(!ids.length) return new Map();
  const {results}=await db.prepare(`SELECT id,name,type,size FROM files WHERE id IN (${ids.map(()=>"?").join(",")})`).bind(...ids).all();
  if(results.length!==ids.length) fail(400,"部分附件已失效，请重新上传");
  return new Map(results.map(file=>[file.id,file]));
}
const sessionHash = request => digest((request.headers.get("Cookie") || "").split(";").map(s => s.trim()).find(s => s.startsWith("board_session="))?.slice(14) || "");
function cookie(request, token, age) { return `board_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`; }
async function readLimited(request,limit) {
  const reader = request.body?.getReader();
  if (!reader) fail(400, "缺少请求内容");
  const chunks=[]; let size=0;
  for (;;) { const {done,value}=await reader.read(); if(done) break; size+=value.length; if(size>limit){await reader.cancel();fail(413,"请求内容过大，单个附件最多 10 MB");} chunks.push(value); }
  const bytes = new Uint8Array(size); let offset=0; for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return bytes;
}
async function body(request) {
  if (!(request.headers.get("Content-Type") || "").includes("application/json")) fail(400, "请求必须是 JSON 对象");
  let value; try { value=JSON.parse(new TextDecoder().decode(await readLimited(request,1024*1024))); } catch(error) { if(error.status) throw error; fail(400,"请求不是有效 JSON"); }
  if(!value || typeof value!=="object" || Array.isArray(value)) fail(400,"请求必须是 JSON 对象");
  return value;
}
function webURL(value, label="链接") {
  if(typeof value!=="string" || value.length>4000) fail(400,`${label}格式不正确`);
  let url; try { url=new URL(value); } catch { fail(400,`${label}需填写完整的 http 或 https 地址`); }
  if(!["https:","http:"].includes(url.protocol) || url.username || url.password) fail(400,`${label}需使用 http 或 https 且不能包含账号密码`);
  return url.href;
}
function sourceURL(source,value,fallback) {
  if(!value) return fallback;
  const url=new URL(webURL(value,"作业网页"));
  if(source.startsWith("web:")) {
    if(source!==`web:${url.origin}` || new URL(fallback).origin!==url.origin)fail(400,"通用作业链接必须来自已配置的网站");
    return url.href;
  }
  const domains={yoj:["yoj.ruc.edu.cn"],weilai:["k.ruc.edu.cn"],tuoj:["ruc.thusaac.com"],smartestu:["smartestu.cn"],ketangpai:["ketangpai.com"],chaoxing:["chaoxing.com"],zhifz:["www.zhifz.com"],ruc_courses:["jw.ruc.edu.cn"],ruc_exams:["jw.ruc.edu.cn"]}[source];
  if((url.protocol!=="https:" && !(source==="yoj" && url.protocol==="http:" && url.hostname==="yoj.ruc.edu.cn" && !url.port)) || !domains.some(host=>url.hostname===host || url.hostname.endsWith(`.${host}`))) fail(400,"作业网页与平台不匹配");
  return url.href;
}
function dateValue(value, label, required=false) {
  if(value===null || value===undefined || value===""){ if(required) fail(400,`请填写${label}`); return null; }
  if(typeof value!=="string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail(400,`${label}必须是带时区的日期时间`);
  return new Date(value).toISOString();
}
export function validate(value, imported=false) {
  const category=["科研","竞赛","组织"].includes(value.category)?"活动":value.category || "作业", status=value.status || "todo", title=value.title ?? value.content, location=value.location ?? "", todos=value.todos ?? [];
  if(!CATEGORIES.includes(category) || !STATUSES.includes(status)) fail(400,"任务分类或进度不正确");
  if(typeof title!=="string" || !title.trim() || title.length>4000) fail(400,"请填写标题（最多 4000 个字符）");
  const content=value.content ?? "";
  if(typeof content!=="string" || content.length>10000)fail(400,"内容最多 10000 个字符");
  if(typeof location!=="string" || location.length>300) fail(400,"地点最多 300 个字符");
  if(!Array.isArray(todos) || todos.length>100) fail(400,"待办事项最多 100 项");
  const ids=new Set();
  const checklist=todos.map(item=>{
    if(!item || typeof item.id!=="string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(item.id) || ids.has(item.id) || typeof item.text!=="string" || !item.text.trim() || item.text.length>500 || typeof item.done!=="boolean") fail(400,"待办事项格式不正确，文字限 1–500 字且编号不能重复");
    ids.add(item.id);return {id:item.id,text:item.text.trim(),done:item.done};
  });
  if(!Array.isArray(value.links ?? []) || (value.links ?? []).length>20) fail(400,"最多添加 20 个链接");
  const links=(value.links || []).map(link=>{
    if(!link || typeof link.label!=="string" || link.label.length>100) fail(400,"链接名称最多 100 字");
    return {label:link.label.trim(),url:webURL(link.url)};
  });
  const attachments=value.attachments ?? [];
  if(!Array.isArray(attachments) || attachments.length>20 || new Set(attachments).size!==attachments.length || attachments.some(id=>typeof id!=="string" || !/^[a-zA-Z0-9-]{1,50}$/.test(id))) fail(400,"附件格式不正确，每项任务最多 20 个文件");
  const homework=category==="作业";
  const due_at=homework ? dateValue(value.due_at,"截止时间",!imported) : null;
  const starts_at=!homework ? dateValue(value.starts_at,"开始时间",true) : null;
  const ends_at=!homework ? dateValue(value.ends_at,"结束时间",true) : null;
  if(starts_at && starts_at>ends_at) fail(400,"结束时间不能早于开始时间");
  if(value.details!=null && (typeof value.details!=="object" || Array.isArray(value.details))) fail(400,"日程信息格式不正确");
  const details={};
  for(const name of ["teacher","assistant","campus","semester","semester_label","course_id","weekday","week","period","seat","organizer"]) {
    const text=value.details?.[name];if(text===undefined)continue;
    if(typeof text!=="string" || text.length>300) fail(400,"日程信息最多 300 字");details[name]=text.trim();
  }
  return {category,title:title.trim(),content:content.trim(),location:location.trim(),todos:checklist,links,attachments,due_at,starts_at,ends_at,status:category==="课程"?"todo":category!=="作业" && status==="doing"?"todo":status,details};
}
async function collectorAuth(request,db) {
  const token=request.headers.get("Authorization")?.match(/^Bearer ([A-Za-z0-9_-]{20,100})$/)?.[1];
  const saved=await db.prepare("SELECT value FROM settings WHERE key='collector_hash'").first();
  if(!token || !saved || !equal(await digest(token),saved.value)) fail(401,"请重新配对作业导入扩展");
}
async function importTasks(request, db, sources) {
  await collectorAuth(request,db);
  const payload=await body(request);
  if(payload.academic!==undefined) {
    if(sources.trial)fail(400,"试用版请更新扩展后分批同步课表");
    if(payload.source!=="ruc_courses")fail(400,"课表数据来源不匹配");
    return json(await importCourseInput(payload.academic,db,sources));
  }
  return json(await applyImport(payload,db,sources));
}
async function importCourseInput(input,db,sources) {
  let clean;
  try {clean=globalThis.RUAcademic.courseInput(input);}catch(error){fail(400,error.message);}
  await db.prepare("INSERT INTO settings(key,value) VALUES ('academic_snapshot',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify({captured_at:now(),input:clean})).run();
  try {
    const tasks=globalThis.RUAcademic.courses(clean.rows,clean.calendar,clean.models,clean.semester,clean.semester_label);
    if(tasks.length>3000)throw new Error("本学期课次超过 3000，请分学期同步");
    for(const task of tasks)validate({...task,category:"课程"},true);
    let changed=0;
    for(let i=0;i<Math.max(tasks.length,1);i+=30) changed+=(await applyAcademicImport({source:"ruc_courses",tasks:tasks.slice(i,i+30),task_count:tasks.length},db,sources)).changed;
    const table=globalThis.RUAcademic.timetable(clean);
    await db.prepare("INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE settings.value IS NOT excluded.value").bind(`timetable:${clean.semester}`,JSON.stringify(table)).run();
    return {ok:true,changed,count:tasks.length};
  }catch(error) {
    const message=String(error.message).slice(0,300);
    await db.prepare("UPDATE sources SET last_seen=?,error=? WHERE id='ruc_courses'").bind(now(),message).run();
    return {ok:false,error:message};
  }
}
export async function applyImport(payload,db,sources) {
  const {source,tasks,error}=payload;
  if(typeof source!=="string" || !(Object.hasOwn(SOURCES,source) || source.startsWith("web:") && sources[source]?.generic) || !Array.isArray(tasks) || tasks.length>30) fail(400,"每批最多导入 30 项作业，且必须指定已配置来源");
  if(error!==undefined && (typeof error!=="string" || error.length>300 || tasks.length)) fail(400,"错误状态格式不正确");
  const count=payload.task_count ?? tasks.length;
  if(!Number.isInteger(count) || count<0 || count>10000) fail(400,"作业数量不正确");
  if(source==="ruc_courses" || source==="ruc_exams") return applyAcademicImport(payload,db,sources);
  const stamp=now();
  const remoteChanged="excluded.source_status IS NOT NULL AND tasks.source_status IS NOT excluded.source_status";
  const nextStatus=`CASE WHEN ${remoteChanged} THEN excluded.source_status ELSE tasks.status END`;
  const rows=tasks.map(item => {
    if(!item || typeof item!=="object" || typeof item.external_id!=="string" || !item.external_id || item.external_id.length>250) fail(400,"缺少稳定的作业编号");
    if(item.status!==undefined && !STATUSES.includes(item.status)) fail(400,"作业完成状态不正确");
    const task=validate({...item,category:"作业",status:item.status || "todo"},true), course=item.course || "";
    if(typeof course!=="string" || course.length>300) fail(400,"课程名称格式不正确");
    return [crypto.randomUUID(),"作业",task.title,task.content,task.due_at,task.status,source,item.external_id,sourceURL(source,item.source_url,sources[source].url),course,stamp,stamp,completedAt(task.status,null,stamp),item.status ?? null];
  });
  // JSON input keeps one batch to one upsert and avoids D1's 100-bound-parameter ceiling.
  const statements=[db.prepare(`INSERT INTO tasks(id,category,title,content,due_at,status,source,external_id,source_url,course,created_at,updated_at,completed_at,source_status)
      SELECT ${Array.from({length:14},(_,index)=>`json_extract(value,'$[${index}]')`).join(",")} FROM json_each(?) WHERE 1
      ON CONFLICT(source,external_id) DO UPDATE SET
      title=CASE WHEN instr(tasks.overrides,'"title"')=0 THEN excluded.title ELSE tasks.title END,
      content=CASE WHEN instr(tasks.overrides,'"content"')=0 THEN CASE WHEN excluded.content<>'' THEN excluded.content WHEN tasks.content=tasks.title THEN excluded.title ELSE tasks.content END ELSE tasks.content END,
      due_at=CASE WHEN tasks.category='作业' AND instr(tasks.overrides,'"due_at"')=0 THEN coalesce(excluded.due_at,tasks.due_at) ELSE tasks.due_at END,
      status=${nextStatus},
      completed_at=CASE WHEN (${nextStatus})='done' THEN CASE WHEN tasks.status='done' AND tasks.completed_at IS NOT NULL THEN tasks.completed_at ELSE excluded.updated_at END ELSE NULL END,
      source_status=coalesce(excluded.source_status,tasks.source_status),
      course=excluded.course, source_url=excluded.source_url, updated_at=excluded.updated_at, revision=tasks.revision+1
      WHERE tasks.deleted=0 AND ((instr(tasks.overrides,'"title"')=0 AND tasks.title IS NOT excluded.title) OR (instr(tasks.overrides,'"content"')=0 AND excluded.content<>'' AND tasks.content IS NOT excluded.content)
      OR (tasks.category='作业' AND instr(tasks.overrides,'"due_at"')=0 AND excluded.due_at IS NOT NULL AND tasks.due_at IS NOT excluded.due_at) OR tasks.course IS NOT excluded.course OR tasks.source_url IS NOT excluded.source_url OR (${remoteChanged}))`)
      .bind(JSON.stringify(rows))];
  statements.push(db.prepare("INSERT INTO sources(last_seen,task_count,error,id) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen,task_count=excluded.task_count,error=excluded.error").bind(stamp,count,error || null,source));
  const result=await db.batch(statements);
  return {changed:result.slice(0,-1).reduce((sum,r)=>sum+r.meta.changes,0)};
}
async function applyAcademicImport({source,tasks,error,task_count=tasks.length},db,sources) {
  const stamp=now(),category=source==="ruc_courses"?"课程":"考试";
  const fields=["title","content","location","starts_at","ends_at","details"];
  const rows=tasks.map(item=>{
    if(!item || typeof item.external_id!=="string" || !item.external_id || item.external_id.length>250) fail(400,"缺少稳定的日程编号");
    const task=validate({...item,category,status:"todo"},true);
    return [crypto.randomUUID(),category,task.title,task.content,task.location,task.starts_at,task.ends_at,JSON.stringify(task.details),source,item.external_id,sourceURL(source,item.source_url,sources[source].url),stamp,stamp];
  });
  const unmodified=field=>`instr(tasks.overrides,'"${field}"')=0`;
  const assignments=fields.map(field=>`${field}=CASE WHEN ${unmodified(field)} THEN ${field==="content"?"CASE WHEN excluded.content<>'' THEN excluded.content WHEN tasks.content=tasks.title THEN excluded.title ELSE tasks.content END":`excluded.${field}`} ELSE tasks.${field} END`);
  const changes=fields.map(field=>`(${unmodified(field)} ${field==="content"?"AND excluded.content<>'' ":""}AND tasks.${field} IS NOT excluded.${field})`);
  const results=await db.batch([
    db.prepare(`INSERT INTO tasks(id,category,title,content,location,starts_at,ends_at,details,source,external_id,source_url,created_at,updated_at)
      SELECT ${Array.from({length:13},(_,i)=>`json_extract(value,'$[${i}]')`).join(",")} FROM json_each(?) WHERE 1
      ON CONFLICT(source,external_id) DO UPDATE SET ${assignments.join(",")},source_url=excluded.source_url,updated_at=excluded.updated_at,revision=tasks.revision+1
      WHERE tasks.deleted=0 AND (${changes.join(" OR ")} OR tasks.source_url IS NOT excluded.source_url)`).bind(JSON.stringify(rows)),
    db.prepare("UPDATE sources SET last_seen=?,task_count=?,error=? WHERE id=?").bind(stamp,task_count,error || null,source)
  ]);
  return {changed:results[0].meta.changes};
}
async function uploadFile(request,db,fileLimit=FILE_LIMIT,storageLimit=STORAGE_LIMIT) {
  const contentType=request.headers.get("Content-Type") || "";
  if(!contentType.startsWith("multipart/form-data;")) fail(400,"请上传文件");
  if(Number(request.headers.get("Content-Length"))>fileLimit+65536) fail(413,`单个附件最多 ${fileLimit/1024/1024} MB`);
  const bytes=await readLimited(request,fileLimit+65536);
  let form; try { form=await new Response(bytes,{headers:{"Content-Type":contentType}}).formData(); } catch { fail(400,"文件上传格式不正确"); }
  const file=form.get("file");
  if(!file || typeof file.arrayBuffer!=="function" || form.getAll("file").length!==1) fail(400,"每次上传一个文件");
  if(!file.size || file.size>fileLimit) fail(413,`附件不能为空，单个文件最多 ${fileLimit/1024/1024} MB`);
  const data=new Uint8Array(await file.arrayBuffer());
  const name=(file.name || "附件").normalize("NFC").replace(/[\x00-\x1f\x7f/\\]/g,"_").slice(0,200);
  const head=new TextDecoder("latin1").decode(data.slice(0,12));
  let type="application/octet-stream";
  if(head.startsWith("%PDF-")) type="application/pdf";
  else if(data[0]===0x89 && head.slice(1,4)==="PNG" && data[4]===13 && data[5]===10 && data[6]===26 && data[7]===10) type="image/png";
  else if(data[0]===255 && data[1]===216 && data[2]===255) type="image/jpeg";
  else if(head.startsWith("GIF87a") || head.startsWith("GIF89a")) type="image/gif";
  else if(head.startsWith("RIFF") && head.slice(8,12)==="WEBP") type="image/webp";
  // ponytail: small personal files share D1; move binaries to R2 above the 100 MB cap.
  await db.prepare("DELETE FROM files WHERE created_at<? AND id NOT IN (SELECT value FROM tasks,json_each(tasks.attachments) WHERE tasks.deleted=0)").bind(new Date(Date.now()-86400000).toISOString()).run();
  const id=crypto.randomUUID();
  const statements=[db.prepare("INSERT INTO files(id,name,type,size,created_at) SELECT ?,?,?,?,? WHERE (SELECT coalesce(sum(size),0) FROM files)+?<=?").bind(id,name,type,file.size,now(),file.size,storageLimit)];
  for(let offset=0,part=0;offset<data.length;offset+=CHUNK_SIZE,part++) {
    statements.push(db.prepare("INSERT INTO file_chunks(file_id,part,data) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM files WHERE id=?)").bind(id,part,data.slice(offset,offset+CHUNK_SIZE).buffer,id));
  }
  const result=await db.batch(statements);
  if(result[0].meta.changes!==1) fail(413,`附件空间已满（${storageLimit/1024/1024} MB），请移除不需要的附件后稍后重试`);
  return json({id,name,type,size:file.size},201);
}
async function downloadFile(request,db,id) {
  const file=await db.prepare("SELECT * FROM files WHERE id=? AND EXISTS(SELECT 1 FROM tasks,json_each(tasks.attachments) WHERE tasks.deleted=0 AND json_each.value=files.id)").bind(id).first();
  if(!file) fail(404,"附件不存在或尚未保存到任务");
  let start=0,end=file.size-1,status=200;
  const range=request.headers.get("Range");
  if(range) {
    const parts=range.match(/^bytes=(\d*)-(\d*)$/);
    if(!parts || (!parts[1] && !parts[2])) return json({error:"不支持的文件范围"},416,{"Content-Range":`bytes */${file.size}`});
    if(!parts[1]) start=Math.max(0,file.size-Number(parts[2]));
    else { start=Number(parts[1]); if(parts[2]) end=Math.min(end,Number(parts[2])); }
    if(!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start>end || start>=file.size) return json({error:"文件范围超出大小"},416,{"Content-Range":`bytes */${file.size}`});
    status=206;
  }
  const preview=file.type!=="application/octet-stream" && new URL(request.url).searchParams.get("download")!=="1";
  const filename=encodeURIComponent(file.name).replace(/[!'()*]/g,character=>`%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  const headers={"Content-Type":file.type,"Content-Length":String(end-start+1),"Accept-Ranges":"bytes",
    "Content-Disposition":`${preview?"inline":"attachment"}; filename="attachment"; filename*=UTF-8''${filename}`,
    "Content-Security-Policy":"default-src 'none'; frame-ancestors 'self'; base-uri 'none'"};
  if(status===206) headers["Content-Range"]=`bytes ${start}-${end}/${file.size}`;
  let part=Math.floor(start/CHUNK_SIZE);
  const stream=new ReadableStream({async pull(controller) {
    try {
      const row=await db.prepare("SELECT data FROM file_chunks WHERE file_id=? AND part=?").bind(id,part).first();
      if(!row) throw new Error("附件分片缺失");
      const data=new Uint8Array(row.data), offset=part*CHUNK_SIZE;
      controller.enqueue(data.subarray(Math.max(0,start-offset),Math.min(data.length,end-offset+1)));
      part++; if(part*CHUNK_SIZE>end) controller.close();
    } catch(error) { controller.error(error); }
  }});
  return new Response(request.method==="HEAD" ? null:stream,{status,headers});
}
async function route(request, env) {
  const url=new URL(request.url), path=url.pathname, method=request.method, db=env.DB;
  if(!path.startsWith("/api/")) {
    if(method!=="GET" && method!=="HEAD") fail(405,"不支持此操作");
    if(path!=="/" && !["/static/app.js","/static/messages.js","/static/style.css","/static/icon.svg","/extension.zip"].includes(path)) fail(404,"页面不存在");
    const assetURL=new URL(request.url); assetURL.pathname=path.replace(/^\/static\//,"/");
    return env.ASSETS.fetch(new Request(assetURL,request));
  }
  if(!db || !env.BOARD_PASSWORD_HASH) fail(503,"看板尚未完成部署配置");
  if(!["GET","HEAD"].includes(method)) {
    const origin=request.headers.get("Origin");
    if(!["/api/import","/api/academic/timetable","/api/cloud-authorize","/api/cloud-credentials"].includes(path) && ((origin && origin!==url.origin) || request.headers.get("Sec-Fetch-Site")==="cross-site")) fail(403,"不允许跨站请求");
  }
  if(path==="/api/login" && method==="POST") {
    const data=await body(request);
    if(typeof data.password!=="string" || data.password.length>256) fail(400,"访问密码格式不正确");
    const ip=await digest(request.headers.get("CF-Connecting-IP") || "local");
    const stamp=Date.now(), cutoff=stamp-300000;
    const attempt=await db.prepare(`INSERT INTO login_attempts(ip,count,since) VALUES (?,1,?) ON CONFLICT(ip) DO UPDATE SET
      count=CASE WHEN since<? THEN 1 ELSE count+1 END, since=CASE WHEN since<? THEN excluded.since ELSE since END RETURNING count`).bind(ip,stamp,cutoff,cutoff).first();
    if(attempt.count>10) fail(429,"尝试次数较多，请 5 分钟后重试");
    if(!equal(await digest(data.password),env.BOARD_PASSWORD_HASH)) fail(401,"访问密码不正确");
    const token=randomToken();
    await db.batch([
      db.prepare("DELETE FROM sessions WHERE expires<?").bind(stamp),
      db.prepare("DELETE FROM login_attempts WHERE ip=? OR since<?").bind(ip,cutoff),
      db.prepare("INSERT INTO sessions(hash,expires) VALUES (?,?)").bind(await digest(token),stamp+30*86400000)
    ]);
    return json({ok:true},200,{"Set-Cookie":cookie(request,token,30*86400)});
  }
  if(path==="/api/import" && method==="POST") return importTasks(request,db,{...await allSources(env),...(env.TRIAL_MODE?{trial:true}:{})});
  if(path==="/api/academic/timetable" && method==="POST") {
    await collectorAuth(request,db);const input=globalThis.RUAcademic.courseInput((await body(request)).academic),table=globalThis.RUAcademic.timetable(input);
    await db.prepare("INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE settings.value IS NOT excluded.value").bind(`timetable:${input.semester}`,JSON.stringify(table)).run();return json({ok:true});
  }
  if(path==="/api/collector-config" && method==="GET") { await collectorAuth(request,db); return json({sources:await allSources(env),links:await savedLinks(env),account:env.TRIAL_USER || "personal",cloud_enabled:(await cloudStatus(env)).enabled}); }
  if(path==="/api/cloud-authorize" && method==="POST") {await collectorAuth(request,db);return json(await enableCloud(env));}
  if(path==="/api/cloud-credentials" && method==="POST") {await collectorAuth(request,db);const value=await body(request);return json(await saveCloudRecipe(env,value.source,value.recipe));}
  const hash=await sessionHash(request);
  const authenticated=env.TRIAL_AUTHENTICATED===true || !!(await db.prepare("SELECT 1 FROM sessions WHERE hash=? AND expires>?").bind(hash,Date.now()).first());
  if(path==="/api/session" && method==="GET") return json({authenticated});
  if(!authenticated) fail(401,"请先登录看板");
  if(path==="/api/notices" && method==="GET"){
    const row=await db.prepare("SELECT value FROM settings WHERE key='read_release'").first();return json({release:RELEASE,unread:row?.value!==RELEASE.version});
  }
  if(path==="/api/notices/read" && method==="POST"){
    if((await body(request)).version!==RELEASE.version)fail(400,"版本信息已更新，请刷新消息");
    await db.prepare("INSERT INTO settings(key,value) VALUES ('read_release',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(RELEASE.version).run();return json({ok:true});
  }
  if(path==="/api/source-links" && method==="GET")return json({links:await savedLinks(env)});
  if(path==="/api/source-links" && method==="PUT") {
    const links=sourceLinks((await body(request)).urls);
    await db.prepare("INSERT INTO settings(key,value) VALUES ('source_links',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(links)).run();
    if(env.TRIAL_MODE)for(const source of ["smartestu","ketangpai","chaoxing","zhifz","weilai","tuoj"])if(!links.some(link=>link.source===source))await db.prepare("DELETE FROM settings WHERE key IN (?,?)").bind(`cloud_credential_${source}`,`cloud_state_${source}`).run();
    return json({links});
  }
  if(path==="/api/cloud" && method==="GET") return json(await cloudStatus(env));
  if(path==="/api/cloud" && method==="DELETE") return json(await revokeCloud(env));
  if(path==="/api/cloud/run" && method==="POST") {
    const {source}=await body(request);
    return json(await runCloud(env,payload=>applyImport(payload,db,configuredSources(env)),{source}));
  }
  if(path==="/api/academic/snapshot" && method==="GET") {
    const saved=await db.prepare("SELECT value FROM settings WHERE key='academic_snapshot'").first();
    return json(saved?JSON.parse(saved.value):null);
  }
  if(path==="/api/academic/retry" && method==="POST") {
    const saved=await db.prepare("SELECT value FROM settings WHERE key='academic_snapshot'").first();
    if(!saved)fail(400,"尚未收到新版扩展的课表数据");
    const snapshot=JSON.parse(saved.value);if(Date.now()-Date.parse(snapshot.captured_at)>86400000)fail(400,"保存的课表数据已超过一天，请重新同步教务");
    return json(await importCourseInput(snapshot.input,db,configuredSources(env)));
  }
  if(path==="/api/files" && method==="POST") return uploadFile(request,db,env.TRIAL_MODE?1024*1024:FILE_LIMIT,env.TRIAL_MODE?5*1024*1024:STORAGE_LIMIT);
  const fileMatch=path.match(/^\/api\/files\/([a-zA-Z0-9-]{1,50})$/);
  if(fileMatch && ["GET","HEAD"].includes(method)) return downloadFile(request,db,fileMatch[1]);
  if(path==="/api/logout" && method==="POST") {
    await db.prepare("DELETE FROM sessions WHERE hash=?").bind(hash).run();
    return json({ok:true},200,{"Set-Cookie":cookie(request,"",0)});
  }
  if(path==="/api/board" && method==="GET") {
    const [tasks,sources,files,storage]=await db.batch([db.prepare("SELECT * FROM tasks WHERE deleted=0 AND archived_at IS NULL ORDER BY created_at DESC"),db.prepare("SELECT sources.*, (SELECT count(*) FROM tasks WHERE tasks.source=sources.id AND tasks.deleted=0) AS imported_count, (SELECT count(*) FROM tasks WHERE tasks.source=sources.id AND tasks.deleted=0 AND tasks.source_status IS NOT NULL) AS status_count FROM sources"),
      db.prepare("SELECT id,name,type,size FROM files WHERE id IN (SELECT value FROM tasks,json_each(tasks.attachments) WHERE tasks.deleted=0)"),db.prepare("SELECT coalesce(sum(size),0) AS used FROM files")]);
    const configuration=await allSources(env);
    const byId=new Map(files.results.map(file=>[file.id,file]));
    const tables=await db.prepare("SELECT value FROM settings WHERE key LIKE 'timetable:%'").all();
    return json({tasks:tasks.results.map(task=>expose(task,byId)),timetables:tables.results.map(row=>JSON.parse(row.value)),sources:Object.entries(configuration).map(([id,config])=>({id,last_seen:null,task_count:0,imported_count:0,status_count:0,...sources.results.find(source=>source.id===id),...config})),storage:{used:storage.results[0].used,limit:env.TRIAL_MODE?5*1024*1024:STORAGE_LIMIT,file_limit:env.TRIAL_MODE?1024*1024:FILE_LIMIT},server_time:now()});
  }
  if(path==="/api/archive" && method==="GET") {
    const category=url.searchParams.get("category") || "全部", offset=Number(url.searchParams.get("offset") || 0);
    if(category!=="全部" && !CATEGORIES.includes(category)) fail(400,"归档分类不正确");
    if(!Number.isSafeInteger(offset) || offset<0 || offset>1000000) fail(400,"归档页码不正确");
    const where="deleted=0 AND archived_at IS NOT NULL"+(category==="全部"?"":" AND category=?");
    const values=category==="全部"?[]:[category];
    const [items,count]=await db.batch([
      db.prepare(`SELECT id,title,category,due_at,starts_at,ends_at,completed_at,archived_at,revision FROM tasks WHERE ${where} ORDER BY archived_at DESC,id DESC LIMIT 100 OFFSET ?`).bind(...values,offset),
      db.prepare(`SELECT count(*) AS total FROM tasks WHERE ${where}`).bind(...values)
    ]);
    return json({tasks:items.results,total:count.results[0].total});
  }
  if(path==="/api/collector-token" && method==="POST") {
    const token=randomToken();
    await db.prepare("INSERT INTO settings(key,value) VALUES ('collector_hash',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(await digest(token)).run();
    return json({token});
  }
  if(path==="/api/tasks" && method==="POST") {
    const task=validate(await body(request)), id=crypto.randomUUID(), stamp=now();
    await fileReferences(task.attachments,db);
    const row=await db.prepare(`INSERT INTO tasks(id,${FIELDS.join(",")},created_at,updated_at,completed_at)
      VALUES (${Array(FIELDS.length+4).fill("?").join(",")}) RETURNING *`).bind(id,...FIELDS.map(f=>stored(task,f)),stamp,stamp,completedAt(task.status,null,stamp)).first();
    return json(await withFiles(row,db),201);
  }
  const archiveMatch=path.match(/^\/api\/tasks\/([a-zA-Z0-9-]{1,50})\/archive$/);
  if(archiveMatch && method==="PATCH"){
    const data=await body(request);
    if(typeof data.archived!=="boolean" || !Number.isInteger(data.revision))fail(400,"归档操作缺少状态或任务版本");
    const stamp=now(),row=await db.prepare("UPDATE tasks SET archived_at=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND deleted=0 RETURNING *").bind(data.archived?stamp:null,stamp,archiveMatch[1],data.revision).first();
    if(!row)fail(409,"任务已更新，请刷新后重试");return json(await withFiles(row,db));
  }
  const match=path.match(/^\/api\/tasks\/([a-zA-Z0-9-]{1,50})$/);
  if(match && method==="GET") {
    const row=await db.prepare("SELECT * FROM tasks WHERE id=? AND deleted=0").bind(match[1]).first();
    if(!row) fail(404,"任务已不存在");
    return json(await withFiles(row,db));
  }
  if(match && ["PATCH","DELETE"].includes(method)) {
    const id=match[1], data=await body(request);
    if(!Number.isInteger(data.revision)) fail(400,"缺少任务版本，请刷新重试");
    if(method==="DELETE") {
      const result=await db.prepare("UPDATE tasks SET deleted=1,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND deleted=0").bind(now(),id,data.revision).run();
      if(result.meta.changes!==1) fail(409,"此任务已在另一设备更新，请刷新后重试");
      return json({ok:true});
    }
    const previous=await db.prepare("SELECT * FROM tasks WHERE id=? AND deleted=0").bind(id).first();
    if(!previous) fail(404,"任务已不存在");
    if(previous.revision!==data.revision) fail(409,"此任务已在另一设备更新，请关闭编辑窗口并重新打开");
    const editable=Object.fromEntries(FIELDS.filter(f=>Object.hasOwn(data,f)).map(f=>[f,data[f]]));
    // Old records duplicated their title in content; preserve that compatibility until a memo is supplied.
    if(Object.hasOwn(editable,"title") && !Object.hasOwn(editable,"content") && previous.content===previous.title)editable.content=editable.title;
    const task=validate({...expose(previous),...editable},!!previous.source);
    await fileReferences(task.attachments,db);
    const overrides=[...new Set([...JSON.parse(previous.overrides),...Object.keys(editable).filter(f=>stored(task,f)!==previous[f])])];
    const updated=await db.prepare(`UPDATE tasks SET ${FIELDS.map(f=>`${f}=?`).join(",")},overrides=?,revision=revision+1,updated_at=?,completed_at=?
      WHERE id=? AND revision=? AND deleted=0 RETURNING *`).bind(...FIELDS.map(f=>stored(task,f)),JSON.stringify(overrides),now(),completedAt(task.status,previous,now()),id,data.revision).first();
    if(!updated) fail(409,"此任务已在另一设备更新，请关闭编辑窗口并重新打开");
    return json(await withFiles(updated,db));
  }
  fail(404,"接口不存在");
}
export default {
  async scheduled(event,env,ctx) {ctx.waitUntil(runCloud(env,payload=>applyImport(payload,env.DB,configuredSources(env))));},
  async fetch(request, env) {
    let response;
    try { response=await route(request,env); }
    catch(error) { response=json({error:error.status ? error.message : "服务器暂时无法处理请求，请稍后重试"},error.status || 500); if(!error.status) console.error("Board request failed:",error.message); }
    const headers=new Headers(response.headers);
    headers.set("Cache-Control","no-store"); headers.set("X-Content-Type-Options","nosniff"); headers.set("Referrer-Policy","no-referrer");
    if(!headers.has("Content-Security-Policy")) headers.set("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    return new Response(response.body,{status:response.status,headers});
  }
};
