const SOURCES={
  smartestu:"https://smartestu.cn/assignment",
  ketangpai:"https://www.ketangpai.com/",
  chaoxing:"https://mooc2-ans.chaoxing.com/"
};
const HOSTS={"smartestu.cn":"smartestu","www.ketangpai.com":"ketangpai","mooc2-ans.chaoxing.com":"chaoxing"};
let queue=Promise.resolve();
async function upload(message,sender) {
  const source=HOSTS[new URL(sender.url).hostname];
  if(!source || source!==message.source) throw new Error("来源不匹配");
  const {boardURL,token}=await chrome.storage.local.get(["boardURL","token"]);
  if(!boardURL || !token) return;
  const tasks=message.tasks;
  if(!Array.isArray(tasks) || tasks.length>1000) throw new Error("任务列表格式不正确");
  const batches=[];
  for(let i=0;i<tasks.length;i+=30) batches.push(tasks.slice(i,i+30));
  if(!batches.length) batches.push([]);
  for(const batch of batches) {
    const response=await fetch(`${boardURL}/api/import`,{method:"POST",credentials:"omit",headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
      body:JSON.stringify({source,tasks:batch,task_count:tasks.length,...(message.error ? {error:message.error}:{})}),signal:AbortSignal.timeout(15000)});
    if(!response.ok){let error;try{error=(await response.json()).error;}catch{}throw new Error(error || `导入失败 (${response.status})`);}
  }
  await chrome.storage.local.set({lastResult:message.error || `已导入 ${tasks.length} 项作业`,lastTime:new Date().toISOString()});
  await chrome.action.setBadgeText({text:message.error?"!":""});
}
async function scan() {
  const {enabled,boardURL,token,managedTabs={},sourceURLs={}}=await chrome.storage.local.get(["enabled","boardURL","token","managedTabs","sourceURLs"]);
  if(!enabled || !boardURL || !token) return;
  for(const [source,fallback] of Object.entries(SOURCES)) {
    const candidate=new URL(sourceURLs[source] || fallback);
    const url=candidate.protocol==="https:" && candidate.hostname===new URL(fallback).hostname ? candidate.href : fallback;
    let tab;try{if(managedTabs[source]) tab=await chrome.tabs.get(managedTabs[source]);}catch{}
    // Only refresh tabs created by this extension, and never refresh an active tab.
    if(tab){if(!tab.active && tab.url && new URL(tab.url).hostname===new URL(url).hostname) await chrome.tabs.reload(tab.id);}
    else {const created=await chrome.tabs.create({url,active:false});managedTabs[source]=created.id;}
  }
  await chrome.storage.local.set({managedTabs});
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(message.type==="capture" && sender.tab) {
    queue=queue.then(()=>upload(message,sender)).catch(async error=>{
      await chrome.storage.local.set({lastResult:error.message,lastTime:new Date().toISOString()});
      await chrome.action.setBadgeText({text:"!"});
    });
    queue.then(()=>reply({ok:true}));return true;
  }
  if(sender.url?.startsWith(chrome.runtime.getURL("")) && message.type==="scan") {
    scan().then(()=>reply({ok:true})).catch(error=>reply({error:error.message}));return true;
  }
  if(sender.url?.startsWith(chrome.runtime.getURL("")) && message.type==="configure") {
    chrome.storage.local.get("enabled").then(async({enabled})=>{await chrome.alarms.clear("collect");if(enabled) await chrome.alarms.create("collect",{periodInMinutes:15});reply({ok:true});});return true;
  }
});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==="collect") scan().catch(()=>{});});
chrome.runtime.onStartup.addListener(async()=>{const {enabled}=await chrome.storage.local.get("enabled");if(enabled){await chrome.alarms.create("collect",{periodInMinutes:15});await scan();}});
