const SOURCES={zhifz:"https://www.zhifz.com/#/zuoye",smartestu:"https://smartestu.cn/assignment",ketangpai:"https://www.ketangpai.com/",chaoxing:"https://mooc2-ans.chaoxing.com/"};
SOURCES.ruc_courses="https://jw.ruc.edu.cn/Njw2017/index.html#/student/student-course-list/";
SOURCES.ruc_exams="https://jw.ruc.edu.cn/Njw2017/index.html#/student/test-arrange-search/";
const BOARD_ORIGIN="https://campus-task-board.pages.dev";
const BOARD_ORIGINS=[BOARD_ORIGIN,"https://ruchecklist-trial.pages.dev"];
if(typeof importScripts==="function") importScripts("cloud-routes.js","academic-parser.js");
function sourceFor(url) {
  const host=new URL(url).hostname;
  if(host==="jw.ruc.edu.cn") {
    const parsed=new URL(url);
    if(parsed.pathname!=="/Njw2017/index.html")return null;
    if(/^#\/student\/test-arrange-search(?:\/|$)/.test(parsed.hash))return "ruc_exams";
    if(/^#\/student\/student-course-list(?:\/|$)/.test(parsed.hash))return "ruc_courses";
    return null;
  }
  return host==="www.zhifz.com"?"zhifz":host==="smartestu.cn"?"smartestu":host==="www.ketangpai.com"?"ketangpai":/(^|\.)chaoxing\.com$/.test(host)?"chaoxing":null;
}
let queue=Promise.resolve(),cloudQueue=Promise.resolve(),scanning=null;
async function cloudResult(source,message) {
  const {cloudSourceResults={}}=await chrome.storage.local.get("cloudSourceResults");
  cloudSourceResults[source]=message;await chrome.storage.local.set({cloudSourceResults});
}
async function cloudAPI(path,value) {
  const {boardURL,token}=await chrome.storage.local.get(["boardURL","token"]);
  if(!BOARD_ORIGINS.includes(boardURL) || !token) throw new Error("请先连接自己的看板，再授权云端采集");
  const response=await fetch(`${boardURL}${path}`,{method:"POST",credentials:"omit",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify(value),signal:AbortSignal.timeout(20000)});
  const data=await response.json();if(!response.ok)throw new Error(data.error || "云端授权失败");return data;
}
async function cloudRecipe(message,sender) {
  const {cloudEnabled,cloudZhifzEnabled,cloudRecipeCache={}}=await chrome.storage.local.get(["cloudEnabled","cloudZhifzEnabled","cloudRecipeCache"]);
  if(!cloudEnabled || message.source==="zhifz" && !cloudZhifzEnabled) return {skipped:true};
  if(!sender.tab || sourceFor(sender.url)!==message.source || CampusCloudRoutes.source(message.recipe?.url)!==message.source) throw new Error("云端授权来源不匹配");
  const {boardURL,token}=await chrome.storage.local.get(["boardURL","token"]);
  if(!BOARD_ORIGINS.includes(boardURL) || !token)throw new Error("请先连接自己的看板");
  const response=await fetch(`${boardURL}/api/collector-config`,{credentials:"omit",headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error("无法确认云端授权，请重新连接看板");
  if(!(await response.json()).cloud_enabled){await chrome.storage.local.set({cloudEnabled:false,cloudZhifzEnabled:false,cloudRecipeCache:{}});return {skipped:true};}
  if(!await chrome.permissions.contains({permissions:["cookies"]})) throw new Error("请在扩展设置中授权云端采集");
  if(!await chrome.permissions.contains({origins:[`${new URL(message.recipe.url).origin}/*`,...(message.source==="chaoxing"?["http://*.chaoxing.com/*","https://*.chaoxing.com/*"]:[])]})) throw new Error("缺少此平台的登录读取权限，请点击“授权并启用云端采集”补充权限");
  const cookies=await chrome.cookies.getAll({url:message.recipe.url});
  const recipe={...message.recipe,page_url:sender.url,headers:{...message.recipe.headers,cookie:cookies.map(cookie=>`${cookie.name}=${cookie.value}`).join("; ")}};
  const fingerprint=[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(recipe))))].map(x=>x.toString(16).padStart(2,"0")).join("");
  if(cloudRecipeCache[fingerprint]) return {skipped:true};
  await cloudAPI("/api/cloud-credentials",{source:message.source,recipe});
  cloudRecipeCache[fingerprint]=Date.now();
  await chrome.storage.local.set({cloudRecipeCache:Object.fromEntries(Object.entries(cloudRecipeCache).slice(-50)),cloudLastResult:"授权已保存，请回到看板点击“一键同步”。"});
  await cloudResult(message.source,"授权已保存，等待云端验证");
  return {ok:true};
}
chrome.action.onClicked.addListener(()=>chrome.runtime.openOptionsPage());
async function reportError(error,source) {
  const message=String(error.message || error).slice(0,300),time=new Date().toISOString();
  const {sourceResults={}}=await chrome.storage.local.get("sourceResults");
  if(source) sourceResults[source]={error:message,time};
  await chrome.storage.local.set({lastResult:message,lastTime:time,sourceResults});
  await chrome.action.setBadgeText({text:"!"});
}
async function upload(message,sender) {
  const source=sourceFor(sender.url);
  if(!source || source!==message.source) throw new Error("来源不匹配");
  const {boardURL,token,enabled,configuredSources,importCache={},sourceResults={}}=await chrome.storage.local.get(["boardURL","token","enabled","configuredSources","importCache","sourceResults"]);
  if(!enabled || !boardURL || !token) return {skipped:true};
  if(Array.isArray(configuredSources) && !configuredSources.includes(source))return {skipped:true};
  if(source==="ruc_courses" && message.academic && boardURL!=="https://ruchecklist-trial.pages.dev") {
    const response=await fetch(`${boardURL}/api/import`,{method:"POST",credentials:"omit",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({source,academic:message.academic}),signal:AbortSignal.timeout(45000)});
    const data=await response.json();if(!response.ok || data.error)throw new Error(data.error || "课表导入失败");
    const time=new Date().toISOString();sourceResults[source]={time,count:data.count,changed:data.changed,error:null};
    await chrome.storage.local.set({sourceResults,lastResult:`已读取 ${data.count} 个课次 · 更新 ${data.changed} 项`,lastTime:time});
    await chrome.action.setBadgeText({text:Object.values(sourceResults).some(value=>value.error)?"!":""});return data;
  }
  let tasks=message.tasks;
  if(source==="ruc_courses" && message.academic) {
    const input=RUAcademic.courseInput(message.academic);
    tasks=RUAcademic.courses(input.rows,input.calendar,input.models,input.semester,input.semester_label);
    const response=await fetch(`${boardURL}/api/academic/timetable`,{method:"POST",credentials:"omit",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({academic:input}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error("课表节次保存失败，请重新同步");
  }
  if(!Array.isArray(tasks) || tasks.length>3000 || tasks.some(task=>!task || typeof task.external_id!=="string")) throw new Error("任务列表格式不正确");
  const cache=importCache[source] || {},changedTasks=tasks.filter(task=>cache[task.external_id]!==JSON.stringify(task));
  const batches=[];for(let i=0;i<changedTasks.length;i+=30) batches.push(changedTasks.slice(i,i+30));
  if(!batches.length) batches.push([]);
  let changed=0;
  for(const batch of batches) {
    const response=await fetch(`${boardURL}/api/import`,{method:"POST",credentials:"omit",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({source,tasks:batch,task_count:tasks.length,...(message.error?{error:message.error}:{})}),signal:AbortSignal.timeout(15000)});
    const data=await response.json();if(!response.ok) throw new Error(data.error || `导入失败 (${response.status})`);
    changed+=data.changed || 0;for(const task of batch) cache[task.external_id]=JSON.stringify(task);
  }
  const time=new Date().toISOString();
  importCache[source]=Object.fromEntries(Object.entries(cache).slice(-1500));
  sourceResults[source]={time,count:tasks.length,changed,error:message.error || null,missingDates:tasks.filter(task=>!task.due_at).length};
  await chrome.storage.local.set({importCache,sourceResults,lastResult:message.error || `已读取 ${tasks.length} 项 · 更新 ${changed} 项`,lastTime:time});
  await chrome.action.setBadgeText({text:Object.values(sourceResults).some(value=>value.error)?"!":""});
  return {ok:true,changed};
}
async function performScan(force=false,academicOnly=false,onlySource) {
  if(onlySource!==undefined && !Object.hasOwn(SOURCES,onlySource))throw new Error("未知同步来源");
  const {enabled,boardURL,token,managedTabs={},sourceURLs={}}=await chrome.storage.local.get(["enabled","boardURL","token","managedTabs","sourceURLs"]);
  if(!boardURL || !token) throw new Error("请先连接看板");
  if(!enabled && !force) throw new Error("自动同步已暂停，请先开启同步");
  const response=await fetch(`${boardURL}/api/collector-config`,{headers:{Authorization:`Bearer ${token}`},credentials:"omit",signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw new Error("无法读取作业来源，请重新连接看板");
  const config=await response.json(),configuration=config.sources;
  const entries=config.links===undefined?Object.entries(SOURCES).filter(([source])=>source!=="zhifz" || sourceURLs[source] || configuration?.[source]).map(([source,url])=>({source,url:sourceURLs[source] || configuration?.[source]?.url || url})):
    config.links.filter(link=>link.source).flatMap(link=>link.source==="ruc_courses"?[{source:"ruc_courses",url:SOURCES.ruc_courses},{source:"ruc_exams",url:SOURCES.ruc_exams}]:[link]);
  const selected=[...new Map(entries.filter(link=>(!academicOnly || link.source.startsWith("ruc_")) && (!onlySource || link.source===onlySource)).map(link=>[link.url,link])).values()];
  if(!selected.length)throw new Error("请在网页的第 3 步保存已适配网站的链接");
  await chrome.storage.local.set({configuredSources:[...new Set(entries.map(link=>link.source))]});
  for(const [index,{source,url:address}] of selected.entries()) {
    const candidate=new URL(address);
    if(candidate.protocol!=="https:" || candidate.username || candidate.password || sourceFor(candidate.href)!==source) throw new Error(`${source} 作业页地址不正确`);
    const url=candidate.href;
    const key=config.links===undefined?source:`${source}:${url}`;
    let tab;try{if(managedTabs[key]) tab=await chrome.tabs.get(managedTabs[key]);}catch{}
    if(tab && !tab.active && tab.url && sourceFor(tab.url)===source) {
      if(source==="chaoxing" || tab.url!==url) await chrome.tabs.update(tab.id,{url});
      else await chrome.tabs.reload(tab.id);
    }else {
      const created=await chrome.tabs.create({url:"about:blank",active:false});managedTabs[key]=created.id;
      await chrome.storage.local.set({managedTabs});await chrome.tabs.update(created.id,{url});
    }
  }
  await chrome.storage.local.set({managedTabs});return {ok:true};
}
function scan(force=false,source) {
  if(scanning) return Promise.reject(new Error("正在打开同步页面，请稍后重试"));
  return scanning=performScan(force,false,source).finally(()=>{scanning=null;});
}
async function configure() {
  const {enabled}=await chrome.storage.local.get("enabled");await chrome.alarms.clear("collect");
  if(enabled) await chrome.alarms.create("collect",{periodInMinutes:15});return {ok:true};
}
async function boardControl(message,sender) {
  const origin=new URL(sender.url).origin;
  if(!sender.tab || sender.frameId!==0 || !BOARD_ORIGINS.includes(origin)) throw new Error("不允许此网页控制导入扩展");
  if(message.command==="options") {await chrome.runtime.openOptionsPage();return {ok:true};}
  if(message.command==="pair") {
    if(typeof message.token!=="string" || !/^[A-Za-z0-9_-]{20,100}$/.test(message.token)) throw new Error("配对码格式不正确");
    const response=await fetch(`${origin}/api/collector-config`,{credentials:"omit",headers:{Authorization:`Bearer ${message.token}`},signal:AbortSignal.timeout(15000)});
    if(!response.ok) throw new Error("配对码已失效，请重新连接");
    const configuration=await response.json();
    if(message.account && (configuration.account || "personal")!==message.account)throw new Error("配对码不属于当前账号，请刷新网页重试");
    await queue;await cloudQueue;
    const previous=await chrome.storage.local.get(["boardURL","account"]);
    const changed=previous.boardURL!==origin || (previous.account || "personal")!==(configuration.account || "personal");
    const configured=(configuration.links || Object.keys(SOURCES).map(source=>({source}))).flatMap(link=>link.source==="ruc_courses"?["ruc_courses","ruc_exams"]:link.source?[link.source]:[]);
    await chrome.storage.local.set({boardURL:origin,account:configuration.account || "personal",token:message.token,enabled:true,configuredSources:configured,importCache:{},sourceResults:{},managedTabs:{},sourceURLs:{},...(changed?{cloudEnabled:false,cloudZhifzEnabled:false,cloudRecipeCache:{},cloudSourceResults:{}}:{})});await configure();
  }
  const data=await chrome.storage.local.get(["boardURL","token","enabled","sourceResults","lastResult","account"]);
  const connected=data.boardURL===origin && !!data.token && (data.account || "personal")===(message.account || "personal");
  if(message.command==="status" || message.command==="pair") return {version:chrome.runtime.getManifest().version,connected,enabled:!!data.enabled,sourceResults:connected?data.sourceResults || {}:{},lastResult:connected?data.lastResult || "":""};
  if(!connected) throw new Error("请先在此看板连接扩展");
  if(message.command==="configure") {
    if(typeof message.enabled!=="boolean") throw new Error("同步设置不正确");
    await chrome.storage.local.set({enabled:message.enabled});return configure();
  }
  if(message.command==="scan") return scan(false,message.source);
  if(message.command==="academic-scan")return performScan(false,true);
  throw new Error("未知操作");
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(message.type==="collection-context" && sender.tab) {
    chrome.storage.local.get(["managedTabs","cloudEnabled","cloudZhifzEnabled"]).then(({managedTabs={},cloudEnabled=false,cloudZhifzEnabled=false})=>reply({managed:Object.values(managedTabs).includes(sender.tab.id),cloudEnabled:cloudEnabled && (sourceFor(sender.url)!=="zhifz" || cloudZhifzEnabled)}));return true;
  }
  if(message.type==="cloud-recipe" && sender.tab) {
    const current=cloudQueue.then(()=>cloudRecipe(message,sender));cloudQueue=current.catch(error=>cloudResult(message.source,error.message));
    current.then(reply).catch(error=>reply({error:error.message}));return true;
  }
  if(message.type==="cloud-authorize" && sender.url?.startsWith(chrome.runtime.getURL(""))) {
    (async()=>{if(!await chrome.permissions.contains({permissions:["cookies"]}))throw new Error("需要先允许云端登录授权");await cloudAPI("/api/cloud-authorize",{});await chrome.storage.local.set({cloudEnabled:true,cloudZhifzEnabled:true,cloudRecipeCache:{},cloudLastResult:"正在读取已配置网站的登录授权…"});await scan(true);return {ok:true};})().then(reply).catch(error=>reply({error:error.message}));return true;
  }
  if(message.type==="capture" && sender.tab) {
    const current=queue.then(()=>upload(message,sender));
    queue=current.catch(error=>reportError(error,message.source));
    current.then(reply).catch(error=>reply({error:error.message}));return true;
  }
  if(message.type==="board-control") {
    boardControl(message,sender).then(reply).catch(error=>reply({error:error.message}));return true;
  }
  if(sender.url?.startsWith(chrome.runtime.getURL("")) && ["scan","configure"].includes(message.type)) {
    (message.type==="scan"?scan():configure()).then(reply).catch(error=>{reportError(error);reply({error:error.message});});return true;
  }
});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==="collect") scan().catch(reportError);});
async function start() {await configure();const {enabled}=await chrome.storage.local.get("enabled");if(enabled) await scan();}
chrome.runtime.onStartup.addListener(()=>start().catch(reportError));
chrome.runtime.onInstalled.addListener(async()=>{
  const {reopenAfterReload}=await chrome.storage.local.get("reopenAfterReload");
  if(reopenAfterReload){await chrome.storage.local.set({reopenAfterReload:false});await chrome.runtime.openOptionsPage();}
  start().catch(reportError);
});
