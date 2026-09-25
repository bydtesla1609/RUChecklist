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
const FIELDS = ["category", "title", "content", "location", "todos", "due_at", "starts_at", "ends_at", "status"];
const stored = (task, field) => field==="todos" ? JSON.stringify(task.todos) : task[field];
const now = () => new Date().toISOString();
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2,"0")).join("");
export async function digest(text) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2,"0")).join(""); }
function equal(a, b) { if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false; let diff=0; for(let i=0;i<a.length;i++) diff |= a.charCodeAt(i)^b.charCodeAt(i); return diff===0; }
function fail(status, error) { throw Object.assign(new Error(error), {status}); }
const json = (value, status=200, headers={}) => Response.json(value, {status, headers});
function expose(row) { const {overrides, deleted, external_id, ...visible} = row; return {...visible,title:row.title || row.content,todos:JSON.parse(row.todos)}; }
const sessionHash = request => digest((request.headers.get("Cookie") || "").split(";").map(s => s.trim()).find(s => s.startsWith("board_session="))?.slice(14) || "");
function cookie(request, token, age) { return `board_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`; }
async function body(request) {
  if (!(request.headers.get("Content-Type") || "").includes("application/json")) fail(400, "请求必须是 JSON 对象");
  const reader = request.body?.getReader();
  if (!reader) fail(400, "缺少请求内容");
  const chunks=[]; let size=0;
  for (;;) { const {done,value}=await reader.read(); if(done) break; size+=value.length; if(size>1024*1024){await reader.cancel();fail(413,"请求内容过大");} chunks.push(value); }
  const bytes = new Uint8Array(size); let offset=0; for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let value; try { value=JSON.parse(new TextDecoder().decode(bytes)); } catch { fail(400,"请求不是有效 JSON"); }
  if(!value || typeof value!=="object" || Array.isArray(value)) fail(400,"请求必须是 JSON 对象");
  return value;
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
  const homework=category==="作业";
  const due_at=homework ? dateValue(value.due_at,"截止时间",!imported) : null;
  const starts_at=!homework ? dateValue(value.starts_at,"开始时间",true) : null;
  const ends_at=!homework ? dateValue(value.ends_at,"结束时间",true) : null;
  if(starts_at && starts_at>ends_at) fail(400,"结束时间不能早于开始时间");
  return {category,title:title.trim(),content:title.trim(),location:location.trim(),todos:checklist,due_at,starts_at,ends_at,status};
}
async function importTasks(request, db, sources) {
  const token=request.headers.get("Authorization")?.match(/^Bearer ([A-Za-z0-9_-]{20,100})$/)?.[1];
  const saved=await db.prepare("SELECT value FROM settings WHERE key='collector_hash'").first();
  if(!token || !saved || !equal(await digest(token),saved.value)) fail(401,"请重新配对作业导入扩展");
  const payload=await body(request), {source,tasks,error}=payload;
  if(!Object.hasOwn(SOURCES,source) || !Array.isArray(tasks) || tasks.length>30) fail(400,"每批最多导入 30 项作业，且必须指定已配置来源");
  if(error!==undefined && (typeof error!=="string" || error.length>300 || tasks.length)) fail(400,"错误状态格式不正确");
  const count=payload.task_count ?? tasks.length;
  if(!Number.isInteger(count) || count<0 || count>10000) fail(400,"作业数量不正确");
  const stamp=now();
  const statements=tasks.map(item => {
    if(!item || typeof item!=="object" || typeof item.external_id!=="string" || !item.external_id || item.external_id.length>250) fail(400,"缺少稳定的作业编号");
    const task=validate({...item,category:"作业",status:"todo"},true), course=item.course || "";
    if(typeof course!=="string" || course.length>300) fail(400,"课程名称格式不正确");
    return db.prepare(`INSERT INTO tasks(id,category,title,content,due_at,status,source,external_id,source_url,course,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source,external_id) DO UPDATE SET
      title=CASE WHEN instr(tasks.overrides,'"title"')=0 AND instr(tasks.overrides,'"content"')=0 THEN excluded.title ELSE tasks.title END,
      content=CASE WHEN instr(tasks.overrides,'"title"')=0 AND instr(tasks.overrides,'"content"')=0 THEN excluded.content ELSE tasks.content END,
      due_at=CASE WHEN tasks.category='作业' AND instr(tasks.overrides,'"due_at"')=0 THEN excluded.due_at ELSE tasks.due_at END,
      course=excluded.course, updated_at=excluded.updated_at, revision=tasks.revision+1
      WHERE tasks.deleted=0 AND ((instr(tasks.overrides,'"title"')=0 AND instr(tasks.overrides,'"content"')=0 AND tasks.title IS NOT excluded.title)
      OR (tasks.category='作业' AND instr(tasks.overrides,'"due_at"')=0 AND tasks.due_at IS NOT excluded.due_at) OR tasks.course IS NOT excluded.course)`)
      .bind(crypto.randomUUID(),"作业",task.title,task.content,task.due_at,"todo",source,item.external_id,sources[source].url,course,stamp,stamp);
  });
  statements.push(db.prepare("UPDATE sources SET last_seen=?,task_count=?,error=? WHERE id=?").bind(stamp,count,error || null,source));
  const result=await db.batch(statements);
  return json({changed:result.slice(0,-1).reduce((sum,r)=>sum+r.meta.changes,0)});
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
  const hash=await sessionHash(request);
  const authenticated=!!(await db.prepare("SELECT 1 FROM sessions WHERE hash=? AND expires>?").bind(hash,Date.now()).first());
  if(path==="/api/session" && method==="GET") return json({authenticated});
  if(!authenticated) fail(401,"请先登录看板");
  if(path==="/api/logout" && method==="POST") {
    await db.prepare("DELETE FROM sessions WHERE hash=?").bind(hash).run();
    return json({ok:true},200,{"Set-Cookie":cookie(request,"",0)});
  }
  if(path==="/api/board" && method==="GET") {
    const [tasks,sources]=await db.batch([db.prepare("SELECT * FROM tasks WHERE deleted=0 ORDER BY created_at DESC"),db.prepare("SELECT * FROM sources")]);
    const configuration=configuredSources(env);
    return json({tasks:tasks.results.map(expose),sources:sources.results.map(source=>({...source,...configuration[source.id]})),server_time:now()});
  }
  if(path==="/api/collector-token" && method==="POST") {
    const token=randomToken();
    await db.prepare("INSERT INTO settings(key,value) VALUES ('collector_hash',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(await digest(token)).run();
    return json({token});
  }
  if(path==="/api/tasks" && method==="POST") {
    const task=validate(await body(request)), id=crypto.randomUUID(), stamp=now();
    const row=await db.prepare(`INSERT INTO tasks(id,${FIELDS.join(",")},created_at,updated_at)
      VALUES (${Array(FIELDS.length+3).fill("?").join(",")}) RETURNING *`).bind(id,...FIELDS.map(f=>stored(task,f)),stamp,stamp).first();
    return json(expose(row),201);
  }
  const match=path.match(/^\/api\/tasks\/([a-zA-Z0-9-]{1,50})$/);
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
    const overrides=[...new Set([...JSON.parse(previous.overrides),...Object.keys(editable).filter(f=>stored(task,f)!==previous[f])])];
    const updated=await db.prepare(`UPDATE tasks SET ${FIELDS.map(f=>`${f}=?`).join(",")},overrides=?,revision=revision+1,updated_at=?
      WHERE id=? AND revision=? AND deleted=0 RETURNING *`).bind(...FIELDS.map(f=>stored(task,f)),JSON.stringify(overrides),now(),id,data.revision).first();
    if(!updated) fail(409,"此任务已在另一设备更新，请关闭编辑窗口并重新打开");
    return json(expose(updated));
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
    headers.set("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    return new Response(response.body,{status:response.status,headers});
  }
};
