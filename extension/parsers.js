/* Fields checked against the platforms' public frontend bundles on 2026-09-25.
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
      if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text)) text+="+08:00";
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
  function parse(source,url,value) {
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
            due_at:date(task.personalLateDeadlineAt || task.endTime),course:String(course.courseName || "")};
          output.set(item.external_id,item);
        }
      });
    }
    if(source==="ketangpai" && /\/(?:FutureV2\/CourseMeans\/getCourseContent|Futurev2\/Homework\/getListByCourseToStudent)(?:\?|$)/i.test(url)) {
      const homeworkOnly=/getListByCourseToStudent/i.test(url);
      walk(value,task=>{
        if(String(task.contenttype)!=="4" && !(homeworkOnly && task.title && Object.hasOwn(task,"endtime"))) return;
        if(typeof task.title!=="string" || (task.id===undefined && task.homeworkid===undefined)) throw new Error("课堂派作业字段发生变化");
        recognized=true;
        const item={external_id:String(task.homeworkid || task.id),content:task.title,due_at:date(task.endtime),course:String(task.coursename || "")};
        output.set(item.external_id,item);
      });
    }
    if(!recognized) return null;
    return [...output.values()];
  }
  return {parse,date};
})();
