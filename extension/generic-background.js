const genericBinding=data=>`${data.boardURL}|${data.account || "personal"}`;
async function genericConfig() {
  const data=await chrome.storage.local.get(["boardURL","account","token","enabled","genericRules","genericPending"]);
  if(!BOARD_ORIGINS.includes(data.boardURL) || !data.token)throw new Error("请先在看板连接扩展");
  const response=await fetch(`${data.boardURL}/api/collector-config`,{credentials:"omit",headers:{Authorization:`Bearer ${data.token}`},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error("看板连接已失效，请重新连接扩展");
  const config=await response.json();
  if((config.account || "personal")!==(data.account || "personal"))throw new Error("账号已改变，请重新连接扩展");
  const links=(config.links || []).filter(link=>link.generic && link.source===`web:${new URL(link.url).origin}` && !BOARD_ORIGINS.includes(new URL(link.url).origin));
  return {...data,links,binding:genericBinding(data)};
}
async function registerGeneric(links) {
  const matches=[];
  for(const origin of new Set(links.map(link=>`${new URL(link.url).origin}/*`)))if(await chrome.permissions.contains({origins:[origin]}))matches.push(origin);
  const existing=await chrome.scripting.getRegisteredContentScripts({ids:["ru-generic"]});
  if(existing.length)await chrome.scripting.unregisterContentScripts({ids:["ru-generic"]});
  if(matches.length)await chrome.scripting.registerContentScripts([{id:"ru-generic",matches,js:["generic-parser.js","generic-content.js"],runAt:"document_idle",persistAcrossSessions:true}]);
}
async function genericSetup(url) {
  const data=await genericConfig(),link=data.links.find(link=>link.url===url);
  if(!link)throw new Error("请先在看板保存此网站链接");
  await chrome.storage.local.set({genericPending:{url:link.url,binding:data.binding}});
  if(await chrome.permissions.contains({origins:[`${new URL(link.url).origin}/*`]}))return genericOpen();
  await chrome.tabs.create({url:chrome.runtime.getURL("options.html?generic=1"),active:true});
  return {ok:true,permission:true};
}
async function genericOpen() {
  const data=await genericConfig(),pending=data.genericPending,link=data.links.find(link=>link.url===pending?.url);
  if(!link || pending.binding!==data.binding)throw new Error("配置请求已失效，请从看板重新打开识别设置");
  if(!await chrome.permissions.contains({origins:[`${new URL(link.url).origin}/*`]}))throw new Error("需要先允许读取此网站");
  await registerGeneric(data.links);
  await chrome.storage.local.set({genericReview:{url:CampusGeneric.pageKey(link.url),binding:data.binding}});
  await chrome.tabs.create({url:link.url,active:true});return {ok:true};
}
async function genericContext(sender) {
  if(!sender.tab || sender.frameId!==0)throw new Error("请将列表在独立标签页中打开后配置");
  const data=await genericConfig(),key=CampusGeneric.pageKey(sender.url),link=data.links.find(link=>CampusGeneric.pageKey(link.url)===key);
  if(!link || !data.enabled)throw new Error("此页面未配置同步，或浏览器导入已暂停");
  if(!await chrome.permissions.contains({origins:[`${new URL(sender.url).origin}/*`]}))throw new Error("此网站的读取权限已撤销，请从看板重新授权");
  const ruleKey=`${data.binding}|${key}`,rule=data.genericRules?.[ruleKey];
  return {...data,link,key,ruleKey,rule};
}
async function genericMessage(message,sender) {
  if(["generic-permission","generic-open"].includes(message.type)){
    if(!sender.url?.startsWith(chrome.runtime.getURL("")))throw new Error("请从扩展设置页授权");
    if(message.type==="generic-open")return genericOpen();
    const data=await genericConfig(),pending=data.genericPending;
    if(pending?.binding!==data.binding || !data.links.some(link=>link.url===pending.url))throw new Error("请从看板重新打开识别设置");
    return {url:pending.url,origin:new URL(pending.url).origin};
  }
  const context=await genericContext(sender);
  if(message.type==="generic-context"){
    const {genericReview}=await chrome.storage.local.get("genericReview");
    const review=genericReview?.binding===context.binding && genericReview.url===context.key;
    if(review)await chrome.storage.local.remove("genericReview");
    return {binding:context.binding,rule:context.rule || null,review};
  }
  if(message.binding!==context.binding)throw new Error("账号已切换，请刷新此页面再配置");
  if(message.type!=="generic-import")throw new Error("未知通用识别操作");
  const rule=CampusGeneric.validateRule(message.rule);
  if(!Array.isArray(message.tasks) || !message.tasks.length || message.tasks.length>200)throw new Error("请选择 1–200 项任务");
  const previous=context.rule;
  if(!message.confirmed && (!previous?.automatic || JSON.stringify(CampusGeneric.validateRule(previous.fields))!==JSON.stringify(rule)))throw new Error("此列表需要先预览确认");
  const tasks=message.tasks.map(item=>{
    if(!/^g:[a-f0-9]{64}$/.test(item.external_id) || typeof item.title!=="string" || !item.title.trim() || item.title.length>500 || new URL(item.source_url).origin!==new URL(sender.url).origin)throw new Error("读取结果格式不正确，请重新识别");
    if(!message.confirmed && !item.stable)throw new Error("任务缺少稳定链接，请重新预览确认");
    return {external_id:item.external_id,title:item.title,content:"",due_at:item.due_at || null,course:String(item.course || "").slice(0,300),source_url:item.source_url,...(["todo","done"].includes(item.status)?{status:item.status}:{})};
  });
  const current=await chrome.storage.local.get(["boardURL","account"]);
  if(genericBinding(current)!==context.binding)throw new Error("账号已切换，请刷新后重试");
  // Use the existing import queue and upsert; never upload page HTML or cookies.
  const result=await upload({source:context.link.source,tasks},sender,true);
  if(message.confirmed){
    const excluded=Array.isArray(message.excluded)?message.excluded.filter(id=>/^g:[a-f0-9]{64}$/.test(id)).slice(0,200):[];
    const {genericRules={}}=await chrome.storage.local.get("genericRules");
    genericRules[context.ruleKey]={fields:rule,automatic:message.tasks.every(item=>item.stable===true),excluded};
    await chrome.storage.local.set({genericRules});
  }
  return result;
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(!["generic-context","generic-permission","generic-open","generic-import"].includes(message.type))return;
  const current=queue.then(()=>genericMessage(message,sender));queue=current.catch(()=>{});
  current.then(reply).catch(error=>reply({error:error.message}));return true;
});
