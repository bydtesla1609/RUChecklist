(() => {
  if(window.top!==window || location.hostname!=="jw.ruc.edu.cn")return;
  let running=false,last="",completedContext="",retryAfter=0;
  function findView(name,node=window.app) {
    if(!node)return null;if(node.$options?.name===name)return node;
    for(const child of node.$children || []) {const found=findView(name,child);if(found)return found;}return null;
  }
  async function collect() {
    const course=location.hash.includes("/student/student-course-list"),exam=location.hash.includes("/student/test-arrange-search");
    if(running || (!course && !exam))return;
    const view=findView(course?"student-student-course-list":"test-arrange-search");
    if(!view)return;
    const semester=course?view.form?.jczy013id:view.model?.term;
    if(!semester || (course && !view.form.pkgl002id))return;
    const context=`${location.hash}:${semester}:${view.form?.pkgl002id || ""}`;
    if(context===completedContext || Date.now()<retryAfter)return;
    running=true;const source=course?"ruc_courses":"ruc_exams";
    try {
      let tasks;
      if(course) {
        const service=window.student?.studentCourseListService;if(!service)return;
        const model=view.form.pkgl002id;
        const [rows,calendar,models]=await Promise.all([
          service.searchOneXskbList({jczy013id:semester,pkgl002id:model}),
          service.findWeekCalendarList({xnxq:semester}),
          service.searchPkgl002List({jczy013id:semester,dwcheck:"1"})
        ]);
        tasks=RUAcademic.courses(rows,calendar,models.filter(item=>item.id===model),semester);
      } else {
        const service=window.student?.testArrangeSearch;if(!service)return;
        const listing=await service.findKwglPkcsszlb();
        if(!Array.isArray(listing?.items))throw new Error("考试批次查询未返回有效结果");
        const sessions=listing.items.filter(item=>item.jczy013id===semester);
        if(!sessions.length) tasks=[];
        else {
          if(sessions.length>20)throw new Error("本学期考试批次较多，请分批查询");
          tasks=[];
          for(const session of sessions)tasks.push(...RUAcademic.exams(await service.findXsksapNew({jczy013id:semester,kwgl001id:session.id,kcbh:""}),semester,session.id));
        }
      }
      const signature=JSON.stringify(tasks);
      if(signature!==last) {window.postMessage({kind:"ru-academic-result",source,tasks},location.origin);last=signature;}
      completedContext=context;
    }catch(error){retryAfter=Date.now()+30000;window.postMessage({kind:"ru-academic-result",source,tasks:[],error:String(error.message).slice(0,300)},location.origin);}
    finally{running=false;}
  }
  window.addEventListener("message",event=>{if(event.source===window && event.origin===location.origin && event.data?.kind==="ru-academic-read") {last="";completedContext="";retryAfter=0;collect();}});
  let tries=0;const timer=setInterval(()=>{collect();if(++tries>=15)clearInterval(timer);},4000);
  window.addEventListener("hashchange",()=>{last="";collect();});
})();
