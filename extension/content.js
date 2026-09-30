(() => {
  const source=({"k.ruc.edu.cn":"weilai","ruc.thusaac.com":"tuoj","yoj.ruc.edu.cn":"yoj"})[location.hostname] || (location.hostname==="www.zhifz.com"?"zhifz":location.hostname==="smartestu.cn"?"smartestu":location.hostname==="www.ketangpai.com"?"ketangpai":/(^|\.)chaoxing\.com$/.test(location.hostname)?"chaoxing":null);
  if(!source) return;
  let seen=false,running=false,navigated=false,lastDocument="",managed=false,cloudEnabled=false;
  const send=(tasks,error)=>chrome.runtime.sendMessage({type:"capture",source,tasks,...(error?{error}:{})}).catch(()=>{});
  async function readYOJ() {
    if(source!=="yoj" || running)return;
    running=true;
    try {
      const first=RUCLists.yoj(document,location.href);
      if(first===null){if(/\/index\.php\/index\/course\/(?:detail|index)/.test(location.pathname))throw new Error("YOJ 课程结构未识别，请打开作业列表后同步");return;}
      const tasks=new Map(first.tasks.map(task=>[task.external_id,task])),visited=new Set([location.href]),pending=[...first.pages];
      while(pending.length) {
        const url=pending.shift();if(visited.has(url))continue;
        if(visited.size>=25)throw new Error("YOJ 课程页面较多，请添加具体课程链接同步");
        visited.add(url);
        const response=await fetch(url,{credentials:"same-origin",redirect:"error",signal:AbortSignal.timeout(15000)});
        if(!response.ok)throw new Error("YOJ 列表读取失败，请登录后重新同步");
        const page=RUCLists.yoj(new DOMParser().parseFromString(await response.text(),"text/html"),url);
        if(page===null)throw new Error("YOJ 课程结构未识别，请打开作业列表后同步");
        for(const task of page.tasks)tasks.set(task.external_id,task);pending.push(...page.pages);
      }
      seen=true;send([...tasks.values()]);
    }catch(error){seen=true;send([],error.message);}finally{running=false;}
  }
  window.addEventListener("message",event=>{
    if(source==="weilai" && event.source!==window && event.origin===location.origin && event.data?.kind==="campus-ruc-frame-seen" && event.data.source===source){seen=true;return;}
    if(event.source===window && event.origin===location.origin && event.data?.kind==="campus-cloud-recipe-v1" && event.data.source===source && cloudEnabled) {
      chrome.runtime.sendMessage({type:"cloud-recipe",source,recipe:event.data.recipe}).catch(()=>{});return;
    }
    if(event.source!==window || event.origin!==location.origin || event.data?.kind!=="campus-assignments-v1" || event.data.source!==source) return;
    if(!Array.isArray(event.data.tasks) || event.data.tasks.length>1000) return;
    seen=true;if(source==="weilai" && window.top!==window)window.top.postMessage({kind:"campus-ruc-frame-seen",source},location.origin);
    send(event.data.tasks,event.data.error);
  });
  async function readLearning() {
    if(source!=="chaoxing" || running) return;
    const listRoute=/\/work\/(list|all-task)(?:\?|$)/.test(location.href);
    if(!listRoute) {
      const tab=[...document.querySelectorAll("a[data-url]")].find(node=>node.textContent.trim()==="作业");
      if(tab && managed && !navigated) {navigated=true;seen=true;tab.click();}
      return;
    }
    running=true;
    try {
      const first=CampusParsers.chaoxing(document,location.href);
      if(first===null) return;
      if(cloudEnabled) chrome.runtime.sendMessage({type:"cloud-recipe",source,recipe:{url:location.href,method:"GET",headers:{}}}).catch(()=>{});
      const signature=JSON.stringify(first);
      if(signature===lastDocument) return;
      const collected=new Map(first.map(task=>[task.external_id,task]));
      const pageNumbers=[...document.querySelectorAll("#page li")].map(node=>Number(node.textContent.trim())).filter(Number.isSafeInteger);
      const total=Math.max(1,...pageNumbers);
      if(total>50) throw new Error("学习通作业超过 50 页，请分课程同步");
      for(let page=1;page<=total;page++) {
        const url=new URL(location.href);
        if(page===Number(url.searchParams.get("pageNum") || 1)) continue;
        url.searchParams.set("pageNum",page);
        const response=await fetch(url,{credentials:"same-origin",signal:AbortSignal.timeout(15000)});
        if(!response.ok) throw new Error(`学习通第 ${page} 页读取失败，请重新同步`);
        const parsed=CampusParsers.chaoxing(new DOMParser().parseFromString(await response.text(),"text/html"),url.href);
        if(parsed===null) throw new Error(`学习通第 ${page} 页无法识别，请确认登录状态`);
        for(const task of parsed) collected.set(task.external_id,task);
      }
      seen=true;const result=await send([...collected.values()]);
      if(result?.error) throw new Error(result.error);
      lastDocument=signature;
    } catch(error) {seen=true;send([],error.message);}
    finally {running=false;}
  }
  function observe() {
    if(source!=="chaoxing") return;
    readLearning();let timer;
    new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(readLearning,600);}).observe(document.body,{childList:true,subtree:true,characterData:true});
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",observe,{once:true});else observe();
  chrome.runtime.sendMessage({type:"collection-context"}).then(result=>{
    managed=!!result?.managed;cloudEnabled=!!result?.cloudEnabled;
    window.postMessage({kind:"campus-cloud-mode",enabled:cloudEnabled},location.origin);
    window.postMessage({kind:"campus-ruc-mode",enabled:!!result?.enabled,cloudEnabled},location.origin);
    if(result?.enabled){if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",readYOJ,{once:true});else readYOJ();}
    readLearning();
  }).catch(()=>{});
  chrome.runtime.onMessage.addListener(message=>{if(message.type==="read-current") {lastDocument="";readLearning();readYOJ();}});
  setTimeout(()=>{
    if(seen || !managed || (window.top!==window && (source!=="chaoxing" || !/\/work\/(list|all-task)(?:\?|$)/.test(location.href)))) return;
    const text=document.body?.innerText || "";
    const login=/登录|登 录/.test(text) && !!document.querySelector('input[type="password"]');
    send([],login?"登录已失效，请在 Edge 中重新登录此教学网站":source==="chaoxing"
      ?"学习通尚未识别到作业列表：请进入课程的“作业”栏目后再同步；如有权限提示，请允许扩展读取学习通页面"
      :"未识别到作业列表，请打开作业栏目；分页或折叠内容需要加载后才能导入");
  },25000);
})();
