/* Fields verified against RUC's public student-course-list and test-arrange-search components. */
(() => {
  const courseURL="https://jw.ruc.edu.cn/Njw2017/index.html#/student/student-course-list/";
  const examURL="https://jw.ruc.edu.cn/Njw2017/index.html#/student/test-arrange-search/";
  function weeks(value) {
    const text=String(value || "").replace(/周/g,"").replace(/[，、]/g,",");
    if(!text.trim()) throw new Error("课表未提供教学周，未推测上课日期");
    const odd=/单/.test(text),even=/双/.test(text),result=new Set();
    for(const part of text.replace(/[()（）单双\s]/g,"").split(",")) {
      const match=part.match(/^(\d{1,2})(?:[-~—至](\d{1,2}))?$/);if(!match)throw new Error("无法识别教学周，请在教务课表中检查周次");
      const first=Number(match[1]),last=Number(match[2] || match[1]);
      if(first<1 || last>60 || first>last)throw new Error("教学周超出可识别范围");
      for(let n=first;n<=last;n++)if((!odd || n%2===1) && (!even || n%2===0))result.add(n);
    }
    return [...result];
  }
  function day(value) {
    if(/^\d{10}$|^\d{13}$/.test(String(value))) {
      const date=new Date(Number(value)*(String(value).length===10?1000:1)+8*3600000);
      return Number.isFinite(+date)?date.toISOString().slice(0,10):null;
    }
    const match=String(value || "").trim().match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
    if(!match)return null;return `${match[1]}-${match[2].padStart(2,"0")}-${match[3].padStart(2,"0")}`;
  }
  function clock(value) {
    const match=String(value || "").trim().match(/(?:^|[ T])(\d{1,2}):(\d{2})(?::\d{2})?(?:$|\s)/);
    return match && Number(match[1])<24 && Number(match[2])<60 ? `${match[1].padStart(2,"0")}:${match[2]}`:null;
  }
  function stamp(date,time) {
    if(!date || !time)throw new Error("教务日程缺少准确日期或起止时间，未导入不确定的安排");
    const value=new Date(`${date}T${time}:00+08:00`);
    if(!Number.isFinite(+value) || new Date(+value+8*3600000).toISOString().slice(0,10)!==date)throw new Error("教务日期格式无法识别");return value.toISOString();
  }
  function courses(rows,calendar,models,semester="",semesterLabel="") {
    if(!Array.isArray(rows) || !Array.isArray(calendar?.jxzllist) || !Array.isArray(models))throw new Error("课表或教学周历尚未加载完整");
    const slots=models.flatMap(model=>model.pkgl00201List || []),result=[];
    for(const row of rows) {
      if(row.pkztcode==="8" || row.sftkcode==="1")continue;
      if(!row.id || !row.kc_name || !/^[1-7]\d{4,}$/.test(row.pksj || ""))throw new Error("课表记录格式不完整");
      const weekday=Number(row.pksj[0]);
      const times=slots.filter(slot=>Number(slot.idjkssj)<Number(row.idjjssj) && Number(row.idjkssj)<Number(slot.idjjssj)).sort((a,b)=>Number(a.idjkssj)-Number(b.idjkssj));
      const start=clock(row.djkssj) || clock(times[0]?.djkssj),end=clock(row.djjssj) || clock(times.at(-1)?.djjssj);
      if(!start || !end)throw new Error(`课表节次 ${Number(row.pksj.slice(1,3))}–${Number(row.pksj.slice(-2))} 未匹配起止时间（匹配 ${times.length} 个节次）`);
      for(const week of weeks(row.pkzc)) {
        const entry=calendar.jxzllist.find(entry=>Number(entry.zc)===week && Number(entry.xq)===weekday);
        const date=day(entry?.rq);
        if(!date)throw new Error(`第 ${week} 周、星期 ${weekday} 未取得日期（周历 ${calendar.jxzllist.length} 条，日期类型 ${typeof entry?.rq}）`);
        const starts_at=stamp(date,start),ends_at=stamp(date,end);if(ends_at<=starts_at)throw new Error("课表节次时间顺序异常");
        result.push({external_id:`${row.jczy013id || semester}:${row.id}:${week}`,title:row.kc_name,location:row.js_name || "",starts_at,ends_at,source_url:courseURL,
          details:{teacher:row.teachernames || "",assistant:row.zjls_name || "",campus:row.xq_name || "",semester:String(semester || row.jczy013id || ""),semester_label:semesterLabel || String(semester),course_id:String(row.id),weekday:String(weekday),week:String(week),period:`${Number(row.pksj.slice(1,3))}–${Number(row.pksj.slice(-2))}节`}});
      }
    }
    return [...new Map(result.map(item=>[item.external_id,item])).values()];
  }
  function exams(rows,semester="",examId="") {
    if(!Array.isArray(rows))throw new Error("考试查询尚未返回日程列表");
    const records=rows.flatMap(row=>row.kc_name?[row]:Array.from({length:7},(_,i)=>row[`xq${i+1}`] || []).flat());
    if(rows.length && !records.length && rows.some(row=>!Object.keys(row).some(key=>/^xq[1-7]$/.test(key))))throw new Error("考试日程格式无法识别");
    return [...new Map(records.map(row=>{
      const formatted=String(row.newformatkssj || ""),times=[...formatted.matchAll(/(\d{1,2}:\d{2})/g)].map(match=>clock(match[1]));
      const date=day(row.ksrq) || day(row.kskssj) || day(formatted);
      const start=clock(row.kskssj) || times[0],end=clock(row.ksjssj) || times[1];
      if(!row.kc_name || !(row.id || row.kth))throw new Error("考试日程缺少名称或稳定编号");
      const starts_at=stamp(date,start),ends_at=stamp(day(row.ksjssj) || date,end);if(ends_at<=starts_at)throw new Error("考试结束时间异常");
      const item={external_id:`${semester}:${examId}:${row.id || row.kth}`,title:row.kc_name,location:row.kcmc_name || "",starts_at,ends_at,source_url:examURL,details:{semester:String(semester),seat:String(row.zwh || "")}};
      return [item.external_id,item];
    })).values()];
  }
  function courseInput(input) {
    if(!input || !Array.isArray(input.rows) || input.rows.length>1000 || !Array.isArray(input.calendar?.jxzllist) || input.calendar.jxzllist.length>1000 || !Array.isArray(input.models) || input.models.length>20)throw new Error("课表、周历或节次列表不完整");
    const pick=(row,keys)=>Object.fromEntries(keys.filter(key=>["string","number"].includes(typeof row?.[key])).map(key=>{
      const value=row[key];if(String(value).length>500)throw new Error("教务字段内容过长");return [key,value];
    }));
    const selected=pick(input,["semester","semester_label"]);
    if(!selected.semester)throw new Error("缺少课表学期");
    return {...selected,rows:input.rows.map(row=>pick(row,["id","jczy013id","kc_name","pksj","idjkssj","idjjssj","pkzc","djkssj","djjssj","pkztcode","sftkcode","teachernames","js_name","xq_name","zjls_name"])),
      calendar:{jxzllist:input.calendar.jxzllist.map(row=>pick(row,["zc","xq","rq"]))},
      models:input.models.map(model=>{
        if(!Array.isArray(model.pkgl00201List) || model.pkgl00201List.length>50)throw new Error("节次时间表不完整");
        return {...pick(model,["id"]),pkgl00201List:model.pkgl00201List.map(slot=>pick(slot,["idjkssj","idjjssj","djkssj","djjssj","zyxjs","djname1"]))};
      })};
  }
  function timetable(input) {
    const slots=input.models.flatMap(model=>model.pkgl00201List).map(slot=>({start:clock(slot.djkssj),end:clock(slot.djjssj),period:String(slot.zyxjs || "").replace(",","–"),label:String(slot.djname1 || "")})).filter(slot=>slot.start && slot.end).sort((a,b)=>a.start.localeCompare(b.start));
    return {semester:String(input.semester),label:input.semester_label || String(input.semester),slots,
      days:input.calendar.jxzllist.map(entry=>({week:Number(entry.zc),weekday:Number(entry.xq),date:day(entry.rq)})).filter(entry=>entry.date && entry.week>0 && entry.weekday>=1 && entry.weekday<=7)};
  }
  globalThis.RUAcademic={weeks,courses,exams,courseInput,timetable};
})();
