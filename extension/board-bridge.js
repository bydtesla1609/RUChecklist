(() => {
  if(window.top!==window || location.origin!=="https://campus-task-board.pages.dev") return;
  window.addEventListener("message",async event=>{
    const data=event.data;
    if(event.source!==window || event.origin!==location.origin || data?.kind!=="campus-board-command" || typeof data.id!=="string" || data.id.length>80) return;
    if(!["status","pair","configure","scan","options"].includes(data.command)) return;
    let result;
    try {result=await chrome.runtime.sendMessage({type:"board-control",command:data.command,token:data.token,enabled:data.enabled});}
    catch {result={error:"扩展已更新，请刷新看板页面后重试"};}
    window.postMessage({kind:"campus-board-reply",id:data.id,result},location.origin);
  });
})();
