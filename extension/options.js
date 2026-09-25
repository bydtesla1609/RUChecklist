const $=id=>document.getElementById(id);
const sourceHosts={smartestu:"smartestu.cn",ketangpai:"www.ketangpai.com",chaoxing:"mooc2-ans.chaoxing.com"};
chrome.storage.local.get(["boardURL","token","enabled","lastResult","lastTime","sourceURLs"]).then(data=>{
  $("url").value=data.boardURL || "";$("token").value=data.token || "";$("enabled").checked=!!data.enabled;
  $("result").textContent=data.lastResult ? `${data.lastResult} · ${new Date(data.lastTime).toLocaleString()}` : "尚未连接";
  for(const source of Object.keys(sourceHosts)) $(source).value=data.sourceURLs?.[source] || "";
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
    $("result").textContent="已保存。请点击“立即打开作业页”进行首次导入。";
  }catch(error){$("result").textContent=error.message;}
};
$("scan").onclick=async()=>{
  const {enabled}=await chrome.storage.local.get("enabled");
  if(!enabled){$("result").textContent="请先勾选自动检查并保存设置。";return;}
  const result=await chrome.runtime.sendMessage({type:"scan"});$("result").textContent=result.error || "已打开专用作业页，请确认已登录并打开作业栏目。";
};
