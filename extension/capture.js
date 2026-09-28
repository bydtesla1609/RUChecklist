(() => {
  if(window.top!==window) return;
  const source=location.hostname==="smartestu.cn" ? "smartestu":"ketangpai";
  const collected=new Map();
  const allowed=url=>source==="smartestu" ? /\/api\/homework\/student\/mark\/queryHomeworks(?:\?|$)/.test(url) : /\/(?:FutureV2\/CourseMeans\/getCourseContent|Futurev2\/Homework\/getListByCourseToStudent)(?:\?|$)/i.test(url);
  function publish(url,value) {
    try {
      const tasks=CampusParsers.parse(source,url,value,location.href);
      if(tasks) {
        for(const task of tasks) collected.set(task.external_id,task);
        window.postMessage({kind:"campus-assignments-v1",source,tasks:[...collected.values()]},location.origin);
      }
    } catch(error) { window.postMessage({kind:"campus-assignments-v1",source,tasks:[],error:error.message},location.origin); }
  }
  const originalFetch=window.fetch;
  window.fetch=async function(...args) {
    const response=await originalFetch.apply(this,args);
    const url=response.url || String(args[0]?.url || args[0]);
    if(allowed(url) && response.ok) response.clone().json().then(value=>publish(url,value)).catch(()=>{});
    return response;
  };
  const open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send;
  const urls=new WeakMap();
  XMLHttpRequest.prototype.open=function(method,url,...rest){urls.set(this,String(url));return open.call(this,method,url,...rest);};
  XMLHttpRequest.prototype.send=function(...args){
    const url=urls.get(this) || "";
    if(allowed(url)) this.addEventListener("load",()=>{
      if(this.status<200 || this.status>=300) return;
      try {publish(url,this.responseType==="json"?this.response:JSON.parse(this.responseText));} catch {}
    },{once:true});
    return send.apply(this,args);
  };
})();
