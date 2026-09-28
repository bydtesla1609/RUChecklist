const $=id=>document.getElementById(id);
$("version").textContent=`· v${chrome.runtime.getManifest().version}`;
$("reload-extension").onclick=async()=>{await chrome.storage.local.set({reopenAfterReload:true});chrome.runtime.reload();};
// Also handles an already-loaded manifest that still opens the old popup.
if(chrome.extension.getViews({type:"popup"}).includes(window)) {
  chrome.runtime.openOptionsPage().then(()=>window.close());
}
const sourceHosts={smartestu:"smartestu.cn",ketangpai:"www.ketangpai.com",chaoxing:"mooc2-ans.chaoxing.com"};
const draftKey="settingsDraft";
const fields=["url","token",...Object.keys(sourceHosts)];
function saveDraft() {
  try {
    const draft=Object.fromEntries(fields.map(id=>[id,$(id).value]));
    draft.enabled=$("enabled").checked;
    localStorage.setItem(draftKey,JSON.stringify(draft));
    $("draft-state").textContent="输入已保留在本机，点击“保存设置”后生效。";
  } catch { $("draft-state").textContent="草稿保存失败，请保持此标签页打开并保存设置。"; }
}
chrome.storage.local.get(["boardURL","token","enabled","lastResult","lastTime","sourceURLs"]).then(data=>{
  $("url").value=data.boardURL || "https://campus-task-board.pages.dev";$("token").value=data.token || "";$("enabled").checked=!!data.enabled;
  $("result").textContent=data.lastResult ? `${data.lastResult} · ${new Date(data.lastTime).toLocaleString()}` : "尚未连接";
  for(const source of Object.keys(sourceHosts)) $(source).value=data.sourceURLs?.[source] || "";
  try {
    const draft=JSON.parse(localStorage.getItem(draftKey));
    if(draft) {
      for(const id of fields) if(typeof draft[id]==="string") $(id).value=draft[id];
      if(typeof draft.enabled==="boolean") $("enabled").checked=draft.enabled;
      $("draft-state").textContent="已恢复上次未保存的输入，点击“保存设置”后生效。";
    }
  } catch { $("draft-state").textContent="上次草稿无法读取，已载入保存的设置。"; }
  $("settings").addEventListener("input",saveDraft);
  $("settings").addEventListener("change",saveDraft);
});
$("settings").onsubmit=async event=>{
  event.preventDefault();
  try {
    const url=new URL($("url").value.trim());
    if(url.username || url.password || !(url.protocol==="https:" || (url.protocol==="http:" && ["localhost","127.0.0.1"].includes(url.hostname)))) throw new Error("请使用 HTTPS 看板地址，或本机 localhost 地址");
    const sourceURLs={};
    for(const [source,host] of Object.entries(sourceHosts)) {
      if(!$(source).value.trim()) continue;
      const course=new URL($(source).value.trim());
      if(course.protocol!=="https:" || (source==="chaoxing"?!/(^|\.)chaoxing\.com$/.test(course.hostname):course.hostname!==host) || course.username || course.password) throw new Error(`作业页需使用 https://${host} 的地址`);
      sourceURLs[source]=course.href;
    }
    const permitted=await chrome.permissions.request({origins:[`${url.origin}/*`]});
    if(!permitted) throw new Error("需要允许扩展连接你指定的看板");
    await chrome.storage.local.set({boardURL:url.origin,token:$("token").value.trim(),enabled:$("enabled").checked,sourceURLs,importCache:{}});
    const result=await chrome.runtime.sendMessage({type:"configure"});
    if(result?.error) throw new Error(result.error);
    localStorage.removeItem(draftKey);
    $("draft-state").textContent="设置已生效。";
    $("result").textContent="已保存。请点击“立即打开作业页”进行首次导入。";
  }catch(error){$("result").textContent=error.message;}
};
$("scan").onclick=async()=>{
  const {enabled}=await chrome.storage.local.get("enabled");
  if(!enabled){$("result").textContent="请先勾选自动检查并保存设置。";return;}
  const result=await chrome.runtime.sendMessage({type:"scan"});$("result").textContent=result.error || "已打开专用作业页，请确认已登录并打开作业栏目。";
};
chrome.storage.local.get("cloudLastResult").then(data=>{if(data.cloudLastResult)$("cloud-result").textContent=data.cloudLastResult;});
function showCloudSources(results={}) {
  $("cloud-sources").replaceChildren(...Object.entries({smartestu:"SmartEstu",ketangpai:"课堂派",chaoxing:"学习通"}).map(([source,label])=>{
    const row=document.createElement("p");row.textContent=`${label}：${results[source] || "尚未保存授权"}`;return row;
  }));
}
chrome.storage.local.get("cloudSourceResults").then(data=>showCloudSources(data.cloudSourceResults));
chrome.storage.onChanged?.addListener((changes,area)=>{if(area==="local" && changes.cloudSourceResults)showCloudSources(changes.cloudSourceResults.newValue);});
$("cloud-authorize").onclick=async()=>{
  if(!$("cloud-consent").checked){$("cloud-result").textContent="请先阅读并勾选云端登录授权说明。";return;}
  try {
    if(!chrome.runtime.getManifest().optional_host_permissions?.includes("http://*.chaoxing.com/*")) throw new Error("扩展后台尚未加载新增权限。请点击顶部“重新加载此扩展”，确认版本 v1.3.4 后再授权。");
    const allowed=await chrome.permissions.request({permissions:["cookies"],origins:["https://openapiv5.ketangpai.com/*","http://*.chaoxing.com/*","https://*.chaoxing.com/*","https://ketangpai.com/*"]});
    if(!allowed)throw new Error("未获得登录授权读取权限，云端采集未启用。");
    $("cloud-authorize").disabled=true;
    const result=await chrome.runtime.sendMessage({type:"cloud-authorize"});
    if(result?.ok!==true)throw new Error(result?.error || "扩展后台未确认授权。请点击顶部“重新加载此扩展”，重新打开后再授权。");
    $("cloud-result").textContent="已启用。正在打开三个作业列表保存授权；加载完成后，到看板点击“云端立即同步”检查结果。";
  }catch(error){$("cloud-result").textContent=error.message;}finally{$("cloud-authorize").disabled=false;}
};
