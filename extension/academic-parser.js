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
    const match=String(value || "").match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
    if(!match)return null;return `${match[1]}-${match[2].padStart(2,"0")}-${match[3].padStart(2,"0")}`;
  }
  function clock(value) {
    const match=String(value || "").match(/(?:^|[ T])(\d{1,2}):(\d{2})(?::\d{2})?(?:$|\s)/);
    return match && Number(match[1])<24 && Number(match[2])<60 ? `${match[1].padStart(2,"0")}:${match[2]}`:null;
  }
  function stamp(date,time) {
    if(!date || !time)throw new Error("教务日程缺少准确日期或起止时间，未导入不确定的安排");
    const value=new Date(`${date}T${time}:00+08:00`);
    if(!Number.isFinite(+value) || new Date(+value+8*3600000).toISOString().slice(0,10)!==date)throw new Error("教务日期格式无法识别");return value.toISOString();
  }
  function courses(rows,calendar,models,semester="") {
    if(!Array.isArray(rows) || !Array.isArray(calendar?.jxzllist) || !Array.isArray(models))throw new Error("课表或教学周历尚未加载完整");
    const slots=models.flatMap(model=>model.pkgl00201List || []),result=[];
    for(const row of rows) {
      if(row.pkztcode==="8" || row.sftkcode==="1")continue;
      if(!row.id || !row.kc_name || !/^[1-7]\d{4,}$/.test(row.pksj || ""))throw new Error("课表记录格式不完整");
      const weekday=Number(row.pksj[0]);
      const times=slots.filter(slot=>Number(slot.idjkssj)<Number(row.idjjssj) && Number(row.idjkssj)<Number(slot.idjjssj)).sort((a,b)=>Number(a.idjkssj)-Number(b.idjkssj));
      const start=clock(row.djkssj) || clock(times[0]?.djkssj),end=clock(row.djjssj) || clock(times.at(-1)?.djjssj);
      for(const week of weeks(row.pkzc)) {
        const entry=calendar.jxzllist.find(entry=>Number(entry.zc)===week && Number(entry.xq)===weekday);
        const date=day(entry?.rq);
        const starts_at=stamp(date,start),ends_at=stamp(date,end);if(ends_at<=starts_at)throw new Error("课表节次时间顺序异常");
        result.push({external_id:`${row.jczy013id || semester}:${row.id}:${week}`,title:row.kc_name,location:row.js_name || "",starts_at,ends_at,source_url:courseURL,
          details:{teacher:row.teachernames || "",semester:String(semester || row.jczy013id || ""),week:String(week),period:`${Number(row.pksj.slice(1,3))}–${Number(row.pksj.slice(-2))}节`}});
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
  globalThis.RUAcademic={weeks,courses,exams};
})();
