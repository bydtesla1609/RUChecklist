const SOURCES={smartestu:"https://smartestu.cn/assignment",ketangpai:"https://www.ketangpai.com/",chaoxing:"https://mooc2-ans.chaoxing.com/"};
const BOARD_ORIGIN="https://campus-task-board.pages.dev";
function sourceFor(url) {
  const host=new URL(url).hostname;
  return host==="smartestu.cn"?"smartestu":host==="www.ketangpai.com"?"ketangpai":/(^|\.)chaoxing\.com$/.test(host)?"chaoxing":null;
}
let queue=Promise.resolve(),scanning=null;
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
  const {boardURL,token,enabled,importCache={},sourceResults={}}=await chrome.storage.local.get(["boardURL","token","enabled","importCache","sourceResults"]);
  if(!enabled || !boardURL || !token) return {skipped:true};
  const tasks=message.tasks;
  if(!Array.isArray(tasks) || tasks.length>1000 || tasks.some(task=>!task || typeof task.external_id!=="string")) throw new Error("任务列表格式不正确");
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
async function performScan() {
  const {enabled,boardURL,token,managedTabs={},sourceURLs={}}=await chrome.storage.local.get(["enabled","boardURL","token","managedTabs","sourceURLs"]);
  if(!boardURL || !token) throw new Error("请先连接看板");
  if(!enabled) throw new Error("自动同步已暂停，请先开启同步");
  const response=await fetch(`${boardURL}/api/collector-config`,{headers:{Authorization:`Bearer ${token}`},credentials:"omit",signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw new Error("无法读取作业来源，请重新连接看板");
  const configuration=(await response.json()).sources;
  for(const [source,fallback] of Object.entries(SOURCES)) {
    const candidate=new URL(sourceURLs[source] || configuration?.[source]?.url || fallback);
    if(candidate.protocol!=="https:" || candidate.username || candidate.password || sourceFor(candidate.href)!==source) throw new Error(`${source} 作业页地址不正确`);
    const url=candidate.href;
    let tab;try{if(managedTabs[source]) tab=await chrome.tabs.get(managedTabs[source]);}catch{}
    if(tab && tab.url && sourceFor(tab.url)===source) {
      if(!tab.active) {
        if(source==="chaoxing") await chrome.tabs.update(tab.id,{url});
        else await chrome.tabs.reload(tab.id);
      }else await chrome.tabs.sendMessage(tab.id,{type:"read-current"}).catch(()=>{});
    }else {
      const created=await chrome.tabs.create({url:"about:blank",active:false});managedTabs[source]=created.id;
      await chrome.storage.local.set({managedTabs});await chrome.tabs.update(created.id,{url});
    }
  }
  await chrome.storage.local.set({managedTabs});return {ok:true};
}
function scan() {return scanning ||= performScan().finally(()=>{scanning=null;});}
async function configure() {
  const {enabled}=await chrome.storage.local.get("enabled");await chrome.alarms.clear("collect");
  if(enabled) await chrome.alarms.create("collect",{periodInMinutes:15});return {ok:true};
}
async function boardControl(message,sender) {
  if(!sender.tab || sender.frameId!==0 || new URL(sender.url).origin!==BOARD_ORIGIN) throw new Error("不允许此网页控制导入扩展");
  if(message.command==="options") {await chrome.runtime.openOptionsPage();return {ok:true};}
  if(message.command==="pair") {
    if(typeof message.token!=="string" || !/^[A-Za-z0-9_-]{20,100}$/.test(message.token)) throw new Error("配对码格式不正确");
    const response=await fetch(`${BOARD_ORIGIN}/api/collector-config`,{credentials:"omit",headers:{Authorization:`Bearer ${message.token}`},signal:AbortSignal.timeout(15000)});
    if(!response.ok) throw new Error("配对码已失效，请重新连接");
    await chrome.storage.local.set({boardURL:BOARD_ORIGIN,token:message.token,enabled:true,importCache:{}});await configure();
  }
  const data=await chrome.storage.local.get(["boardURL","token","enabled","sourceResults","lastResult"]);
  const connected=data.boardURL===BOARD_ORIGIN && !!data.token;
  if(message.command==="status" || message.command==="pair") return {version:chrome.runtime.getManifest().version,connected,enabled:!!data.enabled,sourceResults:connected?data.sourceResults || {}:{},lastResult:connected?data.lastResult || "":""};
  if(!connected) throw new Error("请先在此看板连接扩展");
  if(message.command==="configure") {
    if(typeof message.enabled!=="boolean") throw new Error("同步设置不正确");
    await chrome.storage.local.set({enabled:message.enabled});return configure();
  }
  if(message.command==="scan") return scan();
  throw new Error("未知操作");
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(message.type==="collection-context" && sender.tab) {
    chrome.storage.local.get("managedTabs").then(({managedTabs={}})=>reply({managed:Object.values(managedTabs).includes(sender.tab.id)}));return true;
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
chrome.runtime.onStartup.addListener(()=>configure().then(async()=>{const {enabled}=await chrome.storage.local.get("enabled");if(enabled) await scan();}).catch(reportError));
chrome.runtime.onInstalled.addListener(()=>configure().catch(reportError));
