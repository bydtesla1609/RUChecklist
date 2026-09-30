// Verified list routes only; never request answers, submissions, rankings or grading APIs.
globalThis.RUCLists=(()=>{
  const kOrigin="https://k.ruc.edu.cn",tuOrigin="https://ruc.thusaac.com";
  const kCourses="/jiakt/adminApi/course/getMyLearnCourse",kTasks="/jiakt/historyApi/courseReleaseInfo/studentGlobalSearch";
  const id=value=>/^[1-9]\d{0,19}$/.test(String(value));
  const fail=message=>{throw new Error(message);};
  function unwrap(value) {
    if(value?.stat!==undefined){
      if(Number(value.stat)!==1)fail("未来课堂列表请求失败，请检查登录状态后重试");
      const payloads=Object.entries(value).filter(([key,item])=>key!=="fieldErrors" && (Array.isArray(item) || item && Array.isArray(item.list))).map(([,item])=>item);
      if(payloads.length!==1)fail("未来课堂列表响应格式无法识别");
      return payloads[0];
    }
    return value;
  }
  function kPage(value,course="") {
    const data=unwrap(value);
    if(!data || !Array.isArray(data.list))fail("未来课堂作业列表格式无法识别");
    const pages=Number(data.totalPages ?? 1);
    if(!Number.isSafeInteger(pages) || pages<0 || pages>20)fail("未来课堂作业分页超出同步范围，请按课程同步");
    const tasks=[];
    for(const item of data.list) {
      if(String(item.type)!=="10")continue;
      if(!id(item.courseReleaseInfoId) || typeof item.name!=="string" || !item.name.trim())fail("未来课堂作业字段无法识别");
      const status={"0":"todo","1":"done","2":"todo"}[String(item.submitStatus)] ?? null;
      tasks.push({external_id:String(item.courseReleaseInfoId),content:item.name.trim(),course:String(item.courseName || course),due_at:CampusParsers.date(item.endTime),...(status?{status}:{}),source_url:kOrigin+"/UserClient/homePage.html"});
    }
    return {tasks,pages};
  }
  function tuCourse(value,courseId) {
    const info=value?.info;
    if(!id(courseId) || !info || typeof info.title!=="string" || !Array.isArray(info.contests))fail("TUOJ 课程作业列表无法识别，请登录并进入课程");
    return info.contests.filter(item=>!item.hidden).map(item=>{
      if(!id(item._id) || typeof item.title!=="string" || !item.title.trim())fail("TUOJ 作业字段无法识别");
      // pending/running/ended describe availability, not the student's completion.
      return {external_id:`${courseId}:${item._id}`,content:item.title.trim(),course:info.title,due_at:CampusParsers.date(item.endTime),source_url:`${tuOrigin}/course/${courseId}/contest/${item._id}/home`};
    });
  }
  async function collect(source,recipe,read,initial) {
    const url=new URL(recipe.url),tasks=[];
    if(source==="tuoj") {
      const match=url.pathname.match(/^\/api\/course\/(\d+)\/info$/);
      if(match)return tuCourse(initial ?? await read(recipe),match[1]);
      const data=initial ?? await read(recipe);
      if(!Array.isArray(data?.courses) || data.courses.some(course=>!id(course._id) || typeof course.role!=="string"))fail("TUOJ 课程列表无法识别，请确认已登录");
      const courses=data.courses.filter(course=>course.role==="student" && !course.archieved);
      if(courses.length>20)fail("TUOJ 课程较多，请添加具体课程链接同步");
      for(const course of courses)tasks.push(...tuCourse(await read({...recipe,url:`${tuOrigin}/api/course/${course._id}/info`}),course._id));
    } else if(source==="weilai") {
      async function courseTasks(parameters,course) {
        // Request all completion states, without changing the site's selected filters.
        const body={page:{current:1,size:100},params:{coursewareId:parameters.coursewareId,classesId:parameters.classesId ?? "",status:0,typeStr:"10",keyword:""}};
        if(!id(body.params.coursewareId))fail("未来课堂缺少课程编号，请打开课程中的自主学习页面");
        let pages=1;
        for(let page=1;page<=pages;page++) {
          body.page.current=page;
          const data=kPage(await read({...recipe,url:kOrigin+kTasks,method:"POST",headers:{...recipe.headers,"content-type":"application/json"},body:JSON.stringify(body)}),course);
          pages=Math.max(1,data.pages);tasks.push(...data.tasks);
        }
      }
      if(url.pathname===kTasks) {
        let body;try{body=JSON.parse(recipe.body);}catch{fail("未来课堂列表参数无法识别");}
        await courseTasks(body?.params || {},"");
      } else {
        const courses=unwrap(initial ?? await read(recipe));
        if(!Array.isArray(courses) || courses.some(course=>!id(course.id) || !Array.isArray(course.classesList)))fail("未来课堂课程列表无法识别");
        if(courses.length>20)fail("未来课堂课程较多，请进入具体课程同步");
        for(const course of courses)for(const group of course.classesList) {
          if(!id(group.id))fail("未来课堂班级编号无法识别");
          await courseTasks({coursewareId:course.id,classesId:group.id},String(course.name || ""));
        }
      }
    } else fail("不支持的课程来源");
    return [...new Map(tasks.map(task=>[task.external_id,task])).values()];
  }
  function yoj(doc,address) {
    const base=new URL(address);
    if(base.hostname!=="yoj.ruc.edu.cn" || !/^\/index\.php\/index\/course\/(?:detail|index)(?:[/.]|$)/.test(base.pathname))return null;
    if(/请登[录陆]/.test(doc.querySelector(".system-message")?.textContent || "") || doc.querySelector('input[type="password"]'))fail("YOJ 登录已过期，请重新登录");
    const tasks=[],pages=new Set(),course=doc.querySelector("h1,h2,.ui.header")?.textContent.trim() || "";
    let recognized=false;
    for(const table of doc.querySelectorAll("table")) {
      const heading=table.querySelector("thead tr") || table.querySelector("tr:has(th)");
      const headers=[...(heading?.children || [])].map(node=>node.textContent.trim());
      if(!headers.some(text=>/作业|考试|名称|标题/.test(text)))continue;
      recognized=true;
      const dueIndex=headers.findIndex(text=>/截止|结束/.test(text)),statusIndex=headers.findIndex(text=>/完成|提交|状态/.test(text));
      for(const row of table.querySelectorAll("tbody tr")) {
        const link=[...row.querySelectorAll("a[href]")].find(node=>/^\/index\.php\/index\/contest\/detail\/pno\/\d+\.html$/.test(new URL(node.getAttribute("href"),base).pathname) && node.textContent.trim() && !/^\d+$/.test(node.textContent.trim()));
        if(!link)continue;
        const target=new URL(link.getAttribute("href"),base);if(target.origin!==base.origin)continue;
        const text=link.textContent.trim(),cells=[...row.children];
        if(!text)continue;
        const state=statusIndex<0?"":cells[statusIndex]?.textContent.trim();
        const status=/^(?:已完成|已提交|全部通过|Accepted|AC)$/i.test(state)?"done":/^(?:未完成|未提交|待提交)$/.test(state)?"todo":null;
        const deadline=dueIndex<0?null:cells[dueIndex]?.textContent.match(/\d{4}[-/]\d{2}[-/]\d{2}\s+\d{2}:\d{2}(?::\d{2})?/g)?.at(-1);
        tasks.push({external_id:target.pathname.match(/\/pno\/(\d+)/)[1],content:text,course,due_at:CampusParsers.date(deadline),...(status?{status}:{}),source_url:target.href});
      }
    }
    for(const link of doc.querySelectorAll('a[href]')) {
      const target=new URL(link.getAttribute("href"),base);
      if(target.origin!==base.origin || target.href===base.href)continue;
      if(base.pathname.includes("/course/index") && /^\/index\.php\/index\/course\/detail(?:[/.]|$)/.test(target.pathname))pages.add(target.href);
      if(target.pathname===base.pathname && (link.closest('.pagination,.pager,.pagination-menu') || /^(?:下一页|下页|Next|»|›)$/i.test(link.textContent.trim())))pages.add(target.href);
    }
    if(!recognized && !pages.size)return null;
    return {tasks,pages:[...pages]};
  }
  return {collect,kPage,tuCourse,yoj};
})();
