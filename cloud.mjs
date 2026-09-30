import "./extension/parsers.js";
import "./extension/cloud-routes.js";

const sources=["smartestu","ketangpai","chaoxing"],stamp=()=>new Date().toISOString();
const error=(status,message)=>Object.assign(new Error(message),{status});
const loginExpired=()=>Object.assign(error(401,"网站登录已过期，请重新登录后同步"),{code:"auth_expired"});
function loginURL(value,base) {
  try {
    const url=new URL(value,base),host=new URL(base).hostname;
    const trusted=url.hostname===host || ["ketangpai.com","chaoxing.com"].some(domain=>host.endsWith(`.${domain}`) && (url.hostname===domain || url.hostname.endsWith(`.${domain}`)));
    return trusted && /^https?:$/.test(url.protocol) && /(?:^|\/)(?:login|signin|sso|cas\/login)(?:[/.?;]|$)/i.test(url.pathname+url.hash.replace(/^#/,""));
  }catch{return false;}
}
function jsonData(raw) {
  let data;try{data=JSON.parse(raw);}catch{throw error(502,"教学网站返回的内容无法识别，请稍后重试");}
  // Inspect the response envelope only: assignment titles may themselves mention login.
  const code=data?.code ?? data?.status ?? data?.errorCode;
  const message=[data?.message,data?.msg,data?.info,data?.error_description,typeof data?.error==="string"?data.error:null].filter(value=>typeof value==="string").join(" ");
  if(String(code)==="401" || /未登[录陆]|(?:登[录陆]|会话|身份认证).{0,12}(?:过期|失效)|请.{0,5}(?:重新登[录陆]|先登[录陆])|(?:token|session).{0,20}(?:expired|invalid)|not[ _-]?logged[ _-]?in|unauthenticated/i.test(message)) throw loginExpired();
  return data;
}
async function get(env,key) {return (await env.DB.prepare("SELECT value FROM settings WHERE key=?").bind(key).first())?.value;}
async function put(env,key,value) {await env.DB.prepare("INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key,value).run();}
async function key(env) {
  if(!/^[a-f0-9]{64}$/i.test(env.CLOUD_ENCRYPTION_KEY || "")) throw error(503,"云端采集尚未配置加密密钥");
  return crypto.subtle.importKey("raw",Uint8Array.from(env.CLOUD_ENCRYPTION_KEY.match(/../g),x=>parseInt(x,16)),"AES-GCM",false,["encrypt","decrypt"]);
}
async function seal(env,source,value) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const bytes=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:new TextEncoder().encode(env.TRIAL_USER?`${env.TRIAL_USER}:${source}`:source)},await key(env),new TextEncoder().encode(JSON.stringify(value)));
  const data=new Uint8Array(bytes);let binary="";for(let i=0;i<data.length;i+=8192)binary+=String.fromCharCode(...data.subarray(i,i+8192));
  return JSON.stringify({iv:[...iv],data:btoa(binary)});
}
async function open(env,source,value) {
  const {iv,data}=JSON.parse(value);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:new Uint8Array(iv),additionalData:new TextEncoder().encode(env.TRIAL_USER?`${env.TRIAL_USER}:${source}`:source)},await key(env),Uint8Array.from(atob(data),x=>x.charCodeAt(0)))));
}
export function validateRecipe(source,recipe) {
  if(!sources.includes(source) || !recipe || CampusCloudRoutes.source(recipe.url)!==source || recipe.url.length>4000) throw error(400,"只允许授权三个平台的作业列表接口");
  if(!["GET","POST"].includes(recipe.method) || (source==="chaoxing" && recipe.method!=="GET")) throw error(400,"不允许此请求方法");
  const headers={};
  for(const [name,value] of Object.entries(recipe.headers || {})) {
    if(![...CampusCloudRoutes.headers,"cookie"].includes(name.toLowerCase()) || typeof value!=="string" || value.length>16000 || /[\r\n]/.test(value)) throw error(400,"授权请求头格式不正确");
    headers[name.toLowerCase()]=value;
  }
  const body=recipe.body || "";
  if(JSON.stringify(headers).length+body.length>30000) throw error(400,"授权参数过大");
  if(typeof body!=="string" || body.length>16000 || (recipe.method==="GET" && body)) throw error(400,"列表请求参数格式不正确");
  if(body && !/^(application\/json|application\/x-www-form-urlencoded)(;|$)/i.test(headers["content-type"] || "")) throw error(400,"仅支持 JSON 或表单列表参数");
  if(/(?:["&]|^)(?:password|passwd|pwd)["=\s:]/i.test(body)) throw error(400,"禁止上传账号密码");
  const page=new URL(recipe.page_url || recipe.url);
  const allowed=source==="smartestu"?page.hostname==="smartestu.cn":source==="ketangpai"?page.hostname==="www.ketangpai.com":/(^|\.)chaoxing\.com$/.test(page.hostname);
  if(!allowed || page.protocol!=="https:" || page.username || page.password || page.href.length>4000) throw error(400,"课程页面与来源不匹配");
  return {url:new URL(recipe.url).href,method:recipe.method,headers,body,page_url:page.href};
}
function recipeId(recipe) {
  const clean=value=>Array.isArray(value)?value.map(clean):value && typeof value==="object"?Object.fromEntries(Object.entries(value).filter(([name])=>!/token|authorization|cookie|enc|timestamp|^t$|^_$|^_t$/i.test(name)).sort(([a],[b])=>a.localeCompare(b)).map(([name,v])=>[name,clean(v)])):value;
  const url=new URL(recipe.url);let body=recipe.body;
  if(body) {try{body=JSON.parse(body);}catch{body=Object.fromEntries(new URLSearchParams(body));}}
  if(CampusCloudRoutes.source(url.href)==="smartestu" && body && typeof body==="object") delete body.pageNo;
  if(CampusCloudRoutes.source(url.href)==="chaoxing") url.searchParams.delete("pageNum");
  return JSON.stringify([url.origin,url.pathname,clean(Object.fromEntries(url.searchParams)),clean(body)]);
}
export async function cloudStatus(env) {
  const {results}=await env.DB.prepare("SELECT key,value FROM settings WHERE key='cloud_enabled' OR key LIKE 'cloud_state_%'").all();
  const values=Object.fromEntries(results.map(row=>[row.key,row.value]));
  return {available:!!env.CLOUD_ENCRYPTION_KEY,enabled:values.cloud_enabled==="1",interval_minutes:env.TRIAL_MODE?30:15,sources:Object.fromEntries(sources.map(source=>[source,JSON.parse(values[`cloud_state_${source}`] || "{}")]))};
}
export async function enableCloud(env) {await key(env);await put(env,"cloud_enabled","1");return {ok:true};}
export async function revokeCloud(env) {
  await env.DB.batch([env.DB.prepare("INSERT INTO settings(key,value) VALUES ('cloud_enabled','0') ON CONFLICT(key) DO UPDATE SET value='0'"),env.DB.prepare("DELETE FROM settings WHERE key LIKE 'cloud_credential_%' OR key LIKE 'cloud_state_%'")]);
  return {ok:true};
}
export async function saveCloudRecipe(env,source,input) {
  if(await get(env,"cloud_enabled")!=="1") throw error(403,"云端授权已关闭，请主动重新启用");
  if(env.TRIAL_MODE && !JSON.parse(await get(env,"source_links") || "[]").some(link=>link.source===source))throw error(400,"请先在网页添加此网站，再授权采集");
  const recipe=validateRecipe(source,input),stored=await get(env,`cloud_credential_${source}`);
  const recipes=stored?await open(env,source,stored):[];
  const id=recipeId(recipe),index=recipes.findIndex(item=>recipeId(item)===id);
  if(index>=0) recipes[index]=recipe;else recipes.push(recipe);
  if(recipes.length>5) throw error(400,"每个平台最多授权 5 个列表入口，请关闭云端后按课程重新授权");
  const encrypted=await seal(env,source,recipes),state=JSON.parse(await get(env,`cloud_state_${source}`) || "{}");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO settings(key,value) SELECT ?,? WHERE EXISTS (SELECT 1 FROM settings WHERE key='cloud_enabled' AND value='1') ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(`cloud_credential_${source}`,encrypted),
    env.DB.prepare("INSERT INTO settings(key,value) SELECT ?,? WHERE EXISTS (SELECT 1 FROM settings WHERE key='cloud_enabled' AND value='1') ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(`cloud_state_${source}`,JSON.stringify({...state,authorized:true,saved_at:stamp(),entries:recipes.length}))]);
  return {ok:true};
}
export async function learningHTML(html,url,Rewriter=globalThis.HTMLRewriter) {
  if(html.trimStart().startsWith("{"))jsonData(html);
  if(!Rewriter) throw error(503,"云端 HTML 解析不可用");
  const rows=[];let row=null,hasList=false,emptyText="",pages="";
  const text=field=>({text(chunk){if(row)row[field]+=chunk.text;}});
  const parser=new Rewriter().on("li[data]",{element(el){row={url:el.getAttribute("data"),title:"",status:"",time:""};rows.push(row);el.onEndTag(()=>{row=null;});}})
    .on("li[data] .overHidden2",text("title")).on("li[data] .status",text("status"))
    .on("li[data] .time",{element(el){if(row)row.time+=" "+(el.getAttribute("title") || "")+" "+(el.getAttribute("data-time") || "");},...text("time")})
    .on(".ulDiv,.work-list",{element(){hasList=true;},text(chunk){emptyText+=chunk.text;}})
    .on("#page li",{text(chunk){pages+=chunk.text;},element(el){el.onEndTag(()=>{pages+=" ";});}});
  await parser.transform(new Response(html)).text();
  const decode=value=>value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(raw,entity)=>{
    if(entity[0]==="#"){const n=entity[1].toLowerCase()==="x"?parseInt(entity.slice(2),16):Number(entity.slice(1));return n>0 && n<=0x10ffff && !(n>=0xd800 && n<=0xdfff)?String.fromCodePoint(n):"\ufffd";}
    return ({amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" "})[entity.toLowerCase()];
  });
  for(const item of rows)for(const name of ["url","title","status","time"])item[name]=decode(item[name]);
  const tasks=CampusParsers.chaoxingRows(rows,url);
  if(!tasks.length && !(hasList && /暂无作业|没有作业|暂无相关/.test(emptyText))) throw error(502,"学习通未返回可识别的作业列表，请重新授权或检查页面");
  return {tasks,pages:Math.max(1,...pages.trim().split(/\s+/).map(Number).filter(Number.isSafeInteger))};
}
async function fetchList(recipe,fetcher) {
  const response=await fetcher(recipe.url,{method:recipe.method,headers:recipe.headers,...(recipe.body?{body:recipe.body}:{}),redirect:"manual",signal:AbortSignal.timeout(20000)});
  if(response.status===401) throw loginExpired();
  if(response.status>=300 && response.status<400) {
    if(loginURL(response.headers.get("location") || "",recipe.url)) throw loginExpired();
    throw error(502,"网站跳转至其他页面，请在浏览器检查入口后重试");
  }
  if(response.status===403) throw error(403,"网站拒绝云端访问，请稍后重试或使用浏览器同步");
  if(!response.ok) throw error(502,`教学网站暂时不可用（HTTP ${response.status}）`);
  const reader=response.body.getReader(),chunks=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4*1024*1024){await reader.cancel();throw error(502,"作业列表过大，请按课程授权");}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const raw=new TextDecoder().decode(bytes);
  if(raw.trimStart().startsWith("<") && /<input\b[^>]*\btype\s*=\s*["']?password\b/i.test(raw) && /登[录陆]|sign[ -]?in|log[ -]?in/i.test(raw)) throw loginExpired();
  return raw;
}
async function smartSession(recipe,fetcher) {
  // SmartEstu binds list requests to the current cookie session and CSRF token.
  const raw=await fetchList({url:"https://smartestu.cn/api/auth/session",method:"GET",headers:{cookie:recipe.headers.cookie || "","x-auth-protocol":"cookie-v1"}},fetcher);
  const session=jsonData(raw);
  if(session===null || session?.authenticated===false || session && !Object.keys(session).length) throw loginExpired();
  if(!session || [session.sessionContext,session.csrfToken].some(value=>typeof value!=="string" || !value || value.length>16000 || /[\r\n]/.test(value))) throw error(502,"SmartEstu 登录验证返回格式异常，请稍后重试");
  return {...recipe,headers:{...recipe.headers,"x-auth-protocol":"cookie-v1","x-session-context":session.sessionContext,"x-csrf-token":session.csrfToken}};
}
export async function runCloud(env,importBatch,{fetcher=fetch,Rewriter=globalThis.HTMLRewriter,source:onlySource}={}) {
  if(onlySource!==undefined && !sources.includes(onlySource)) throw error(400,"不支持此云端来源");
  if(await get(env,"cloud_enabled")!=="1") return {skipped:true};
  // One board, one collector at a time; the lease also protects overlapping manual and scheduled runs.
  const expiry=String(Date.now()+600000);
  const locked=await env.DB.prepare("INSERT INTO settings(key,value) VALUES ('cloud_lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(settings.value AS INTEGER)<? RETURNING value").bind(expiry,Date.now()).first();
  if(!locked) return {running:true};
  const result={};
  try {
    for(const source of sources) {
      if(onlySource && source!==onlySource)continue;
      if(await get(env,"cloud_enabled")!=="1") break;
      if(env.TRIAL_MODE && !JSON.parse(await get(env,"source_links") || "[]").some(link=>link.source===source))continue;
      const encrypted=await get(env,`cloud_credential_${source}`);if(!encrypted) continue;
      const state=JSON.parse(await get(env,`cloud_state_${source}`) || "{}"),started=stamp();
      try {
        const tasks=new Map(),recipes=await open(env,source,encrypted);let requestCount=0;
        for(const stored of recipes) {
          let recipe=validateRecipe(source,stored);
          if(source==="smartestu") recipe=await smartSession(recipe,fetcher);
          if(++requestCount>5) throw error(502,"此平台列表超过云端单次 5 页上限，请分课程授权");
          const raw=await fetchList(recipe,fetcher);let parsed;
          if(source==="chaoxing") {
            const first=await learningHTML(raw,recipe.url,Rewriter);parsed=first.tasks;
            for(let page=1;page<=first.pages;page++) {
              const url=new URL(recipe.url);if(page===Number(url.searchParams.get("pageNum") || 1))continue;
              if(++requestCount>5) throw error(502,"学习通列表超过云端单次 5 页上限，请分课程授权");
              url.searchParams.set("pageNum",page);const more=await learningHTML(await fetchList({...recipe,url:url.href},fetcher),url.href,Rewriter);parsed.push(...more.tasks);
            }
          } else {
            const data=jsonData(raw);
            parsed=CampusParsers.parse(source,recipe.url,data,recipe.page_url);
            if(parsed===null) throw error(502,"未识别到作业列表，请重新授权并确认课程入口");
            if(source==="smartestu" && Number(data.data?.pageTotal)>1) {
              const total=Number(data.data.pageTotal);
              if(!Number.isSafeInteger(total) || total>5) throw error(502,"SmartEstu 作业超过云端单次 5 页上限，请分课程授权");
              let parameters;try{parameters=JSON.parse(recipe.body);}catch{}
              if(recipe.method!=="POST" || !parameters || typeof parameters!=="object") throw error(502,"SmartEstu 分页参数缺失，请重新授权");
              for(let page=1;page<=total;page++) {
                if(page===Number(data.data.pageNo || parameters.pageNo || 1)) continue;
                if(++requestCount>5) throw error(502,"SmartEstu 作业超过云端单次 5 页上限，请分课程授权");
                const more=jsonData(await fetchList({...recipe,body:JSON.stringify({...parameters,pageNo:page})},fetcher));
                const tasks=CampusParsers.parse(source,recipe.url,more,recipe.page_url);
                if(tasks===null) throw error(502,`SmartEstu 第 ${page} 页未返回作业列表`);
                parsed.push(...tasks);
              }
            }
          }
          for(const task of parsed) tasks.set(task.external_id,task);
        }
        if(await get(env,"cloud_enabled")!=="1") break;
        const all=[...tasks.values()];let changed=0;
        for(let start=0;start<Math.max(1,all.length);start+=30) changed+=(await importBatch({source,tasks:all.slice(start,start+30),task_count:all.length})).changed;
        result[source]={...state,last_attempt:started,last_success:stamp(),count:all.length,status_count:all.filter(task=>task.status).length,changed,error:null,error_code:null,auth_expired_at:null};
      } catch(cause) {
        const expired=cause.code==="auth_expired";
        result[source]={...state,last_attempt:started,error:cause.status?cause.message:"云端采集暂时失败，请稍后重试",error_code:expired?"auth_expired":null,auth_expired_at:state.auth_expired_at || (expired?started:null)};
      }
      // Revocation must never resurrect stored credentials or an enabled status.
      await env.DB.prepare("INSERT INTO settings(key,value) SELECT ?,? WHERE EXISTS (SELECT 1 FROM settings WHERE key='cloud_enabled' AND value='1') ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(`cloud_state_${source}`,JSON.stringify(result[source])).run();
    }
    return result;
  } finally {await env.DB.prepare("DELETE FROM settings WHERE key='cloud_lock' AND value=?").bind(expiry).run();}
}
