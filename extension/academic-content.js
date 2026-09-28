(() => {
  if(window.top!==window || location.hostname!=="jw.ruc.edu.cn")return;
  let received=false;
  window.addEventListener("message",event=>{
    const data=event.data;
    if(event.source!==window || event.origin!==location.origin || data?.kind!=="ru-academic-result" || !["ruc_courses","ruc_exams"].includes(data.source))return;
    if(!Array.isArray(data.tasks) || data.tasks.length>3000)return;
    received=true;chrome.runtime.sendMessage({type:"capture",source:data.source,tasks:data.tasks,...(data.error?{error:data.error}:{})}).catch(()=>{});
  });
  chrome.runtime.onMessage.addListener(message=>{if(message.type==="read-current")window.postMessage({kind:"ru-academic-read"},location.origin);});
  setTimeout(()=>{
    if(received || !/\/student\/(student-course-list|test-arrange-search)(?:\/|$)/.test(location.hash))return;
    const source=location.hash.includes("test-arrange-search")?"ruc_exams":"ruc_courses";
    chrome.runtime.sendMessage({type:"capture",source,tasks:[],error:"教务查询未加载完成，请确认已登录并打开当前学期的课表 / 考试安排"}).catch(()=>{});
  },65000);
})();
