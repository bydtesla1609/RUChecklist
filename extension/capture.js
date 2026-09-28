(() => {
  if(window.top!==window) return;
  const source=location.hostname==="smartestu.cn" ? "smartestu":"ketangpai";
  const collected=new Map();
  let cloudEnabled=false;
  window.addEventListener("message",event=>{if(event.source===window && event.origin===location.origin && event.data?.kind==="campus-cloud-mode") cloudEnabled=event.data.enabled===true;});
  function recipe(url,method,headers,body) {
    if(!cloudEnabled || !CampusCloudRoutes.source(new URL(url,location.href).href))return;
    return {url:new URL(url,location.href).href,method:String(method || "GET").toUpperCase(),headers:Object.fromEntries([...new Headers(headers)].filter(([name])=>CampusCloudRoutes.headers.includes(name))),body:body || ""};
  }
  const allowed=url=>source==="smartestu" ? /\/api\/homework\/student\/mark\/queryHomeworks(?:\?|$)/.test(url) : /\/(?:FutureV2\/CourseMeans\/getCourseContent|Futurev2\/Homework\/getListByCourseToStudent)(?:\?|$)/i.test(url);
  function publish(url,value,request) {
    try {
      const tasks=CampusParsers.parse(source,url,value,location.href);
      if(tasks) {
        for(const task of tasks) collected.set(task.external_id,task);
        window.postMessage({kind:"campus-assignments-v1",source,tasks:[...collected.values()]},location.origin);
        if(cloudEnabled && request) window.postMessage({kind:"campus-cloud-recipe-v1",source,recipe:request},location.origin);
      }
    } catch(error) { window.postMessage({kind:"campus-assignments-v1",source,tasks:[],error:error.message},location.origin); }
  }
  const originalFetch=window.fetch;
  window.fetch=async function(...args) {
    let snapshot;
    if(cloudEnabled && allowed(String(args[0]?.url || args[0]))) {
      try{const req=new Request(args[0],args[1]);snapshot=req.clone().text().then(body=>recipe(req.url,req.method,req.headers,body)).catch(()=>undefined);}catch{}
    }
    const response=await originalFetch.apply(this,args);
    const url=response.url || String(args[0]?.url || args[0]);
    if(allowed(url) && response.ok) response.clone().json().then(async value=>publish(url,value,await snapshot)).catch(()=>{});
    return response;
  };
  const open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send;
  const urls=new WeakMap(),requests=new WeakMap(),setHeader=XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open=function(method,url,...rest){urls.set(this,String(url));requests.set(this,{method,headers:{}});return open.call(this,method,url,...rest);};
  XMLHttpRequest.prototype.setRequestHeader=function(name,value){const req=requests.get(this);if(cloudEnabled && req && CampusCloudRoutes.headers.includes(name.toLowerCase()))req.headers[name]=String(value);return setHeader.call(this,name,value);};
  XMLHttpRequest.prototype.send=function(...args){
    const url=urls.get(this) || "";
    if(allowed(url)) this.addEventListener("load",()=>{
      if(this.status<200 || this.status>=300) return;
      try {const req=requests.get(this);publish(url,this.responseType==="json"?this.response:JSON.parse(this.responseText),typeof args[0]==="string" || !args[0]?recipe(url,req.method,req.headers,args[0]):undefined);} catch {}
    },{once:true});
    return send.apply(this,args);
  };
})();
