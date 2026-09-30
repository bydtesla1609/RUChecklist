(() => {
  const source=location.hostname==="k.ruc.edu.cn"?"weilai":location.hostname==="ruc.thusaac.com"?"tuoj":null;
  if(!source)return;
  const nativeFetch=window.fetch.bind(window),open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send,setHeader=XMLHttpRequest.prototype.setRequestHeader;
  const requests=new WeakMap(),tasks=new Map(),busy=new Set();
  let enabled=false,cloudEnabled=false,pending;
  const allowed=(url,method)=>CampusCloudRoutes.source(new URL(url,location.href).href)===source && method===(source==="weilai"?"POST":"GET");
  function snapshot(url,method,headers,body) {
    return {url:new URL(url,location.href).href,method,headers:Object.fromEntries([...new Headers(headers)].filter(([name])=>CampusCloudRoutes.headers.includes(name))),body:body || ""};
  }
  async function publish(recipe,value) {
    if(!enabled){pending={recipe,value};return;}
    const key=recipe.url+recipe.body;if(busy.has(key))return;busy.add(key);
    try {
      let count=0;
      const list=await RUCLists.collect(source,recipe,async request=>{
        if(!allowed(request.url,request.method) || ++count>30)throw new Error("课程列表较多，请打开具体课程后同步");
        const response=await nativeFetch(request.url,{method:request.method,headers:request.headers,...(request.method==="POST"?{body:request.body}:{}),credentials:"same-origin",redirect:"error",signal:AbortSignal.timeout(15000)});
        if(response.status===401)throw new Error("网站登录已过期，请重新登录");
        if(!response.ok)throw new Error("课程列表暂时读取失败，请稍后重试");
        return response.json();
      },value);
      for(const task of list)tasks.set(task.external_id,task);
      window.postMessage({kind:"campus-assignments-v1",source,tasks:[...tasks.values()]},location.origin);
      if(cloudEnabled)window.postMessage({kind:"campus-cloud-recipe-v1",source,recipe},location.origin);
    }catch(error){window.postMessage({kind:"campus-assignments-v1",source,tasks:[],error:error.message},location.origin);}
    finally{busy.delete(key);}
  }
  window.addEventListener("message",event=>{
    if(event.source!==window || event.origin!==location.origin || event.data?.kind!=="campus-ruc-mode")return;
    enabled=event.data.enabled===true;cloudEnabled=event.data.cloudEnabled===true;
    if(enabled && pending){const value=pending;pending=null;publish(value.recipe,value.value);}
  });
  window.fetch=async function(input,init) {
    let recipe;
    try {const request=new Request(typeof input==="string"?new URL(input,location.href):input,init);if(allowed(request.url,request.method))recipe=request.clone().text().then(body=>snapshot(request.url,request.method,request.headers,body));}catch{}
    const response=await nativeFetch(input,init);
    if(recipe && response.ok)response.clone().json().then(async value=>publish(await recipe,value)).catch(()=>{});
    return response;
  };
  XMLHttpRequest.prototype.open=function(method,url,...rest){requests.set(this,{url:String(url),method:String(method).toUpperCase(),headers:{}});return open.call(this,method,url,...rest);};
  XMLHttpRequest.prototype.setRequestHeader=function(name,value){const request=requests.get(this);if(request && allowed(request.url,request.method) && CampusCloudRoutes.headers.includes(name.toLowerCase()))request.headers[name]=String(value);return setHeader.call(this,name,value);};
  XMLHttpRequest.prototype.send=function(body){
    const request=requests.get(this);
    if(request && allowed(request.url,request.method) && (!body || typeof body==="string"))this.addEventListener("load",()=>{
      if(this.status<200 || this.status>=300)return;
      try{publish(snapshot(request.url,request.method,request.headers,body),this.responseType==="json"?this.response:JSON.parse(this.responseText));}catch{}
    },{once:true});
    return send.call(this,body);
  };
})();
