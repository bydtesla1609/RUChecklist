const $=id=>document.getElementById(id);
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
      if(course.protocol!=="https:" || course.hostname!==host || course.username || course.password) throw new Error(`作业页需使用 https://${host} 的地址`);
      sourceURLs[source]=course.href;
    }
    const permitted=await chrome.permissions.request({origins:[`${url.origin}/*`]});
    if(!permitted) throw new Error("需要允许扩展连接你指定的看板");
    await chrome.storage.local.set({boardURL:url.origin,token:$("token").value.trim(),enabled:$("enabled").checked,sourceURLs});
    await chrome.runtime.sendMessage({type:"configure"});
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
