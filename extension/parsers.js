/* SmartEstu / Ketangpai states checked against public frontend bundles on 2026-09-28.
 * Chaoxing reads explicit list DOM metadata; see README integration limitations.
 * Only assignment-list responses are processed; cookies, tokens, answers and grades are never copied.
 */
globalThis.CampusParsers = (() => {
  function date(value) {
    if(value===null || value===undefined || value==="" || value===0 || value==="0") return null;
    let parsed;
    if(typeof value==="number" || /^\d{10,13}$/.test(String(value))) {
      const n=Number(value); parsed=new Date(n<1e12 ? n*1000:n);
    } else if(typeof value==="string") {
      let text=value.trim().replaceAll("/","-").replace(" ","T");
      if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(?:\.\d{1,3})?)?$/.test(text)) text+="+08:00";
      if(!/(Z|[+-]\d{2}:\d{2})$/.test(text)) throw new Error("无法确认作业截止时间，请人工核对");
      parsed=new Date(text);
    }
    if(!parsed || !Number.isFinite(parsed.getTime())) throw new Error("作业截止时间格式发生变化");
    return parsed.toISOString();
  }
  function walk(value,visit,depth=0) {
    if(depth>12 || !value || typeof value!=="object") return;
    visit(value);
    for(const child of Object.values(value)) if(child && typeof child==="object") walk(child,visit,depth+1);
  }
  function parse(source,url,value,pageURL="") {
    const output=new Map(); let recognized=false;
    if(source==="smartestu" && /\/api\/homework\/student\/mark\/queryHomeworks(?:\?|$)/.test(url)) {
      walk(value,course=>{
        if(!Object.hasOwn(course,"studentCourseHomeworkDTOList")) return;
        recognized=true;
        const list=course.studentCourseHomeworkDTOList;
        if(list===null) return;
        for(const task of Array.isArray(list)?list:[list]) {
          if(!task || task.scene==="online_exam") continue;
          if(task.id===undefined || typeof task.name!=="string") throw new Error("SmartEstu 作业字段发生变化");
          const item={external_id:`${course.courseId || ""}:${task.id}`,content:task.name,
            due_at:date(task.personalLateDeadlineAt || task.endTime),course:String(course.courseName || ""),source_url:"https://smartestu.cn/assignment?tab=assignments"};
          const status={not_submitted:"todo",submitted:"doing",completed:"done"}[task.submission_status];
          if(status) item.status=status;
          output.set(item.external_id,item);
        }
      });
    }
    if(source==="ketangpai" && /\/(?:FutureV2\/CourseMeans\/getCourseContent|Futurev2\/Homework\/getListByCourseToStudent)(?:\?|$)/i.test(url)) {
      const homeworkOnly=/getListByCourseToStudent/i.test(url);
      if(Array.isArray(value?.data?.list) && !value.data.list.length) recognized=true;
      walk(value,task=>{
        if(String(task.contenttype)!=="4" && !(homeworkOnly && task.title && Object.hasOwn(task,"endtime"))) return;
        if(typeof task.title!=="string" || (task.id===undefined && task.homeworkid===undefined)) throw new Error("课堂派作业字段发生变化");
        recognized=true;
        let pageCourse="";
        try { pageCourse=new URLSearchParams(new URL(pageURL).hash.split("?")[1] || "").get("courseid") || ""; } catch {}
        const id=String(task.homeworkid || task.id),course=task.courseid || pageCourse;
        // Route verified in the platform's public frontend bundle, 2026-09-25.
        const source_url=course ? `https://www.ketangpai.com/#/homework?${new URLSearchParams({courseid:String(course),courserole:"0",homeworkId:id})}` : "https://www.ketangpai.com/";
        const item={external_id:id,content:task.title,due_at:date(task.endtime),course:String(task.coursename || ""),source_url};
        const status={"0":"todo","1":"done","2":"done","3":"todo","4":"done"}[String(task.mstatus)];
        if(status) item.status=status;
        output.set(item.external_id,item);
      });
    }
    if(!recognized) return null;
    return [...output.values()];
  }
  function chaoxingRows(rows,pageURL) {
    const result=new Map();
    for(const row of rows) {
      const url=new URL(row.url,pageURL);
      if(url.protocol!=="https:" || !/(^|\.)chaoxing\.com$/.test(url.hostname) || !/\/work\/(task|eval-list)$/.test(url.pathname)) continue;
      const id=url.searchParams.get("workId"),course=url.searchParams.get("courseId") || new URL(pageURL).searchParams.get("courseId");
      if(!id || !course || !row.title.trim()) continue;
      const statusText=row.status.trim();
      let status;
      if(/未交|未提交|打回|退回|重做/.test(statusText)) status="todo";
      else if(/待互[评評]/.test(statusText)) status="doing";
      else if(/已完成|已提交|已交|待批[阅閱改]|已批[阅閱改]|已互[评評]/.test(statusText)) status="done";
      const absolute=row.time.match(/\d{4}[-/]\d{2}[-/]\d{2}\s+\d{2}:\d{2}(?::\d{2})?/);
      const task={external_id:`${course}:${id}`,content:row.title.trim(),due_at:absolute?date(absolute[0]):null,course:"",source_url:url.href};
      if(status) task.status=status;
      result.set(task.external_id,task);
    }
    return [...result.values()];
  }
  function chaoxing(document,pageURL) {
    if(!/\/work\/(?:list|all-task)(?:\?|$)/.test(pageURL)) return null;
    const rows=[...document.querySelectorAll("li[data]")].filter(row=>row.querySelector(".overHidden2") && row.querySelector(".status")).map(row=>{
      const time=row.querySelector(".time");
      return {url:row.getAttribute("data"),title:row.querySelector(".overHidden2").textContent,status:row.querySelector(".status").textContent,time:[time?.getAttribute("title"),time?.getAttribute("data-time"),time?.textContent].filter(Boolean).join(" ")};
    });
    const tasks=chaoxingRows(rows,pageURL);
    if(tasks.length) return tasks;
    if(document.querySelector(".ulDiv, .work-list") && /暂无作业|没有作业|暂无相关/.test(document.body?.textContent || "")) return [];
    return null;
  }
  return {parse,date,chaoxing,chaoxingRows};
})();
