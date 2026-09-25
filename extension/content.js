(() => {
  const source={"smartestu.cn":"smartestu","www.ketangpai.com":"ketangpai","mooc2-ans.chaoxing.com":"chaoxing"}[location.hostname];
  if(!source) return;
  let seen=false;
  window.addEventListener("message",event=>{
    if(event.source!==window || event.origin!==location.origin || event.data?.kind!=="campus-assignments-v1" || event.data.source!==source) return;
    if(!Array.isArray(event.data.tasks) || event.data.tasks.length>1000) return;
    seen=true;
    chrome.runtime.sendMessage({type:"capture",source,tasks:event.data.tasks,error:event.data.error}).catch(()=>{});
  });
  // Fail closed: never mistake a login page or an unrecognized list for zero homework.
  setTimeout(()=>{
    if(seen || window.top!==window) return;
    const text=document.body?.innerText || "";
    const login=/登录|登 录/.test(text) && !!document.querySelector('input[type="password"]');
    const error=login ? "登录已失效，请在 Edge 中重新登录此教学网站" : source==="chaoxing"
      ? "学习通适配器待验证：需要读取登录后的作业列表，目前未自动导入"
      : "未识别到作业列表，请打开作业栏目；分页或折叠内容需要加载后才能导入";
    chrome.runtime.sendMessage({type:"capture",source,tasks:[],error}).catch(()=>{});
  },25000);
})();
