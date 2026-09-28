export const SOURCES = {
  smartestu: {name: "SmartEstu", url: "https://smartestu.cn/assignment"},
  ketangpai: {name: "课堂派", url: "https://www.ketangpai.com/"},
  chaoxing: {name: "学习通", url: "https://mooc2-ans.chaoxing.com/"},
};
function configuredSources(env) {
  const urls=JSON.parse(env.SOURCE_URLS || "{}");
  return Object.fromEntries(Object.entries(SOURCES).map(([id,source])=>{
    const url=new URL(urls[id] || source.url);
    return [id,{...source,url:url.protocol==="https:" && url.hostname===new URL(source.url).hostname && !url.username && !url.password ? url.href : source.url}];
  }));
}
const CATEGORIES = ["作业", "科研", "竞赛", "活动", "组织"];
const STATUSES = ["todo", "doing", "done"];
const FIELDS = ["category", "title", "content", "location", "todos", "links", "attachments", "due_at", "starts_at", "ends_at", "status"];
const stored = (task, field) => ["todos","links","attachments"].includes(field) ? JSON.stringify(task[field]) : task[field];
const FILE_LIMIT=10*1024*1024, STORAGE_LIMIT=100*1024*1024, CHUNK_SIZE=512*1024;
const now = () => new Date().toISOString();
const archiveCutoff = () => new Date(Date.now()-7*86400000).toISOString();
const completedAt = (status,previous,stamp) => status==="done" ? (previous?.status==="done" && previous.completed_at ? previous.completed_at : stamp) : null;
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2,"0")).join("");
export async function digest(text) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2,"0")).join(""); }
function equal(a, b) { if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false; let diff=0; for(let i=0;i<a.length;i++) diff |= a.charCodeAt(i)^b.charCodeAt(i); return diff===0; }
function fail(status, error) { throw Object.assign(new Error(error), {status}); }
const json = (value, status=200, headers={}) => Response.json(value, {status, headers});
function expose(row, files) {
  const {overrides, deleted, external_id, ...visible} = row;
  const attachments=JSON.parse(row.attachments);
  return {...visible,title:row.title || row.content,todos:JSON.parse(row.todos),links:JSON.parse(row.links),attachments:files ? attachments.map(id=>files.get(id)).filter(Boolean) : attachments};
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
  const domains={smartestu:["smartestu.cn"],ketangpai:["ketangpai.com"],chaoxing:["chaoxing.com"]}[source];
  if(url.protocol!=="https:" || !domains.some(host=>url.hostname===host || url.hostname.endsWith(`.${host}`))) fail(400,"作业网页与平台不匹配");
  return url.href;
}
function dateValue(value, label, required=false) {
  if(value===null || value===undefined || value===""){ if(required) fail(400,`请填写${label}`); return null; }
  if(typeof value!=="string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail(400,`${label}必须是带时区的日期时间`);
  return new Date(value).toISOString();
}
export function validate(value, imported=false) {
  const category=value.category || "作业", status=value.status || "todo", title=value.title ?? value.content, location=value.location ?? "", todos=value.todos ?? [];
  if(!CATEGORIES.includes(category) || !STATUSES.includes(status)) fail(400,"任务分类或进度不正确");
  if(typeof title!=="string" || !title.trim() || title.length>4000) fail(400,"请填写标题（最多 4000 个字符）");
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
  return {category,title:title.trim(),content:title.trim(),location:location.trim(),todos:checklist,links,attachments,due_at,starts_at,ends_at,status};
}
async function collectorAuth(request,db) {
  const token=request.headers.get("Authorization")?.match(/^Bearer ([A-Za-z0-9_-]{20,100})$/)?.[1];
  const saved=await db.prepare("SELECT value FROM settings WHERE key='collector_hash'").first();
  if(!token || !saved || !equal(await digest(token),saved.value)) fail(401,"请重新配对作业导入扩展");
}
async function importTasks(request, db, sources) {
  await collectorAuth(request,db);
  const payload=await body(request), {source,tasks,error}=payload;
  if(!Object.hasOwn(SOURCES,source) || !Array.isArray(tasks) || tasks.length>30) fail(400,"每批最多导入 30 项作业，且必须指定已配置来源");
  if(error!==undefined && (typeof error!=="string" || error.length>300 || tasks.length)) fail(400,"错误状态格式不正确");
  const count=payload.task_count ?? tasks.length;
  if(!Number.isInteger(count) || count<0 || count>10000) fail(400,"作业数量不正确");
  const stamp=now();
  const remoteChanged="excluded.source_status IS NOT NULL AND tasks.source_status IS NOT excluded.source_status";
  const nextStatus=`CASE WHEN ${remoteChanged} THEN excluded.source_status ELSE tasks.status END`;
  const statements=tasks.map(item => {
    if(!item || typeof item!=="object" || typeof item.external_id!=="string" || !item.external_id || item.external_id.length>250) fail(400,"缺少稳定的作业编号");
    if(item.status!==undefined && !STATUSES.includes(item.status)) fail(400,"作业完成状态不正确");
    const task=validate({...item,category:"作业",status:item.status || "todo"},true), course=item.course || "";
    if(typeof course!=="string" || course.length>300) fail(400,"课程名称格式不正确");
    return db.prepare(`INSERT INTO tasks(id,category,title,content,due_at,status,source,external_id,source_url,course,created_at,updated_at,completed_at,source_status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source,external_id) DO UPDATE SET
      title=CASE WHEN instr(tasks.overrides,'"title"')=0 AND instr(tasks.overrides,'"content"')=0 THEN excluded.title ELSE tasks.title END,
      content=CASE WHEN instr(tasks.overrides,'"title"')=0 AND instr(tasks.overrides,'"content"')=0 THEN excluded.content ELSE tasks.content END,
      due_at=CASE WHEN tasks.category='作业' AND instr(tasks.overrides,'"due_at"')=0 THEN coalesce(excluded.due_at,tasks.due_at) ELSE tasks.due_at END,
      status=${nextStatus},
      completed_at=CASE WHEN (${nextStatus})='done' THEN CASE WHEN tasks.status='done' AND tasks.completed_at IS NOT NULL THEN tasks.completed_at ELSE excluded.updated_at END ELSE NULL END,
      source_status=coalesce(excluded.source_status,tasks.source_status),
      course=excluded.course, source_url=excluded.source_url, updated_at=excluded.updated_at, revision=tasks.revision+1
      WHERE tasks.deleted=0 AND ((instr(tasks.overrides,'"title"')=0 AND instr(tasks.overrides,'"content"')=0 AND tasks.title IS NOT excluded.title)
      OR (tasks.category='作业' AND instr(tasks.overrides,'"due_at"')=0 AND excluded.due_at IS NOT NULL AND tasks.due_at IS NOT excluded.due_at) OR tasks.course IS NOT excluded.course OR tasks.source_url IS NOT excluded.source_url OR (${remoteChanged}))`)
      .bind(crypto.randomUUID(),"作业",task.title,task.content,task.due_at,task.status,source,item.external_id,sourceURL(source,item.source_url,sources[source].url),course,stamp,stamp,completedAt(task.status,null,stamp),item.status ?? null);
  });
  statements.push(db.prepare("UPDATE sources SET last_seen=?,task_count=?,error=? WHERE id=?").bind(stamp,count,error || null,source));
  const result=await db.batch(statements);
  return json({changed:result.slice(0,-1).reduce((sum,r)=>sum+r.meta.changes,0)});
}
async function uploadFile(request,db) {
  const contentType=request.headers.get("Content-Type") || "";
  if(!contentType.startsWith("multipart/form-data;")) fail(400,"请上传文件");
  if(Number(request.headers.get("Content-Length"))>FILE_LIMIT+65536) fail(413,"单个附件最多 10 MB");
  const bytes=await readLimited(request,FILE_LIMIT+65536);
  let form; try { form=await new Response(bytes,{headers:{"Content-Type":contentType}}).formData(); } catch { fail(400,"文件上传格式不正确"); }
  const file=form.get("file");
  if(!file || typeof file.arrayBuffer!=="function" || form.getAll("file").length!==1) fail(400,"每次上传一个文件");
  if(!file.size || file.size>FILE_LIMIT) fail(413,"附件不能为空，单个文件最多 10 MB");
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
  const statements=[db.prepare("INSERT INTO files(id,name,type,size,created_at) SELECT ?,?,?,?,? WHERE (SELECT coalesce(sum(size),0) FROM files)+?<=?").bind(id,name,type,file.size,now(),file.size,STORAGE_LIMIT)];
  for(let offset=0,part=0;offset<data.length;offset+=CHUNK_SIZE,part++) {
    statements.push(db.prepare("INSERT INTO file_chunks(file_id,part,data) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM files WHERE id=?)").bind(id,part,data.slice(offset,offset+CHUNK_SIZE).buffer,id));
  }
  const result=await db.batch(statements);
  if(result[0].meta.changes!==1) fail(413,"附件空间已满（100 MB），请移除不需要的附件后稍后重试");
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
    if(path!=="/" && !["/static/app.js","/static/style.css","/static/icon.svg"].includes(path)) fail(404,"页面不存在");
    const assetURL=new URL(request.url); assetURL.pathname=path.replace(/^\/static\//,"/");
    return env.ASSETS.fetch(new Request(assetURL,request));
  }
  if(!db || !env.BOARD_PASSWORD_HASH) fail(503,"看板尚未完成部署配置");
  if(!["GET","HEAD"].includes(method)) {
    const origin=request.headers.get("Origin");
    if(path!=="/api/import" && ((origin && origin!==url.origin) || request.headers.get("Sec-Fetch-Site")==="cross-site")) fail(403,"不允许跨站请求");
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
  if(path==="/api/import" && method==="POST") return importTasks(request,db,configuredSources(env));
  if(path==="/api/collector-config" && method==="GET") { await collectorAuth(request,db); return json({sources:configuredSources(env)}); }
  const hash=await sessionHash(request);
  const authenticated=!!(await db.prepare("SELECT 1 FROM sessions WHERE hash=? AND expires>?").bind(hash,Date.now()).first());
  if(path==="/api/session" && method==="GET") return json({authenticated});
  if(!authenticated) fail(401,"请先登录看板");
  if(path==="/api/files" && method==="POST") return uploadFile(request,db);
  const fileMatch=path.match(/^\/api\/files\/([a-zA-Z0-9-]{1,50})$/);
  if(fileMatch && ["GET","HEAD"].includes(method)) return downloadFile(request,db,fileMatch[1]);
  if(path==="/api/logout" && method==="POST") {
    await db.prepare("DELETE FROM sessions WHERE hash=?").bind(hash).run();
    return json({ok:true},200,{"Set-Cookie":cookie(request,"",0)});
  }
  if(path==="/api/board" && method==="GET") {
    const [tasks,sources,files,storage]=await db.batch([db.prepare("SELECT * FROM tasks WHERE deleted=0 AND (status<>'done' OR completed_at IS NULL OR completed_at>?) ORDER BY created_at DESC").bind(archiveCutoff()),db.prepare("SELECT * FROM sources"),
      db.prepare("SELECT id,name,type,size FROM files WHERE id IN (SELECT value FROM tasks,json_each(tasks.attachments) WHERE tasks.deleted=0)"),db.prepare("SELECT coalesce(sum(size),0) AS used FROM files")]);
    const configuration=configuredSources(env);
    const byId=new Map(files.results.map(file=>[file.id,file]));
    return json({tasks:tasks.results.map(task=>expose(task,byId)),sources:sources.results.map(source=>({...source,...configuration[source.id]})),storage:{used:storage.results[0].used,limit:STORAGE_LIMIT,file_limit:FILE_LIMIT},server_time:now()});
  }
  if(path==="/api/archive" && method==="GET") {
    const category=url.searchParams.get("category") || "全部", offset=Number(url.searchParams.get("offset") || 0);
    if(category!=="全部" && !CATEGORIES.includes(category)) fail(400,"归档分类不正确");
    if(!Number.isSafeInteger(offset) || offset<0 || offset>1000000) fail(400,"归档页码不正确");
    const where="deleted=0 AND status='done' AND completed_at<=?"+(category==="全部"?"":" AND category=?");
    const values=[archiveCutoff(),...(category==="全部"?[]:[category])];
    const [items,count]=await db.batch([
      db.prepare(`SELECT id,title,category,due_at,starts_at,ends_at,completed_at,revision FROM tasks WHERE ${where} ORDER BY completed_at DESC,id DESC LIMIT 100 OFFSET ?`).bind(...values,offset),
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
    // Keep older clients and the existing assignment extension compatible.
    if(Object.hasOwn(editable,"content") && !Object.hasOwn(editable,"title")) editable.title=editable.content;
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
