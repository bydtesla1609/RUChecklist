// Only these read-only list endpoints may be replayed by the cloud collector.
globalThis.CampusCloudRoutes={
  source(value) {
    let url;try{url=new URL(value);}catch{return null;}
    if(url.protocol!=="https:" || url.username || url.password || url.port) return null;
    if(url.hostname==="k.ruc.edu.cn" && ["/jiakt/adminApi/course/getMyLearnCourse","/jiakt/historyApi/courseReleaseInfo/studentGlobalSearch"].includes(url.pathname) && [...url.searchParams].every(([name,value])=>name==="t" && /^\d{10,13}$/.test(value)))return "weilai";
    if(url.hostname==="ruc.thusaac.com" && /^\/api\/course\/(?:list|[1-9]\d*\/info)$/.test(url.pathname) && !url.search)return "tuoj";
    if(url.hostname==="smartestu.cn" && url.pathname==="/api/homework/student/mark/queryHomeworks") return "smartestu";
    if(url.hostname==="www.zhifz.com" && url.pathname==="/yonghu_ceyan" && url.searchParams.size===3 && /^\d{1,20}$/.test(url.searchParams.get("UID") || "") && url.searchParams.get("类型")==="2") {
      try {const states=JSON.parse(url.searchParams.get("状态"));if(Array.isArray(states) && states.length>0 && states.length<=4 && states.every(value=>Number.isInteger(value) && value>=0 && value<=3) && new Set(states).size===states.length)return "zhifz";}catch{}
    }
    // The platform joins a base URL ending in / with routes beginning in /.
    if(["www.ketangpai.com","openapiv5.ketangpai.com"].includes(url.hostname) && /^\/+Futurev2\/(CourseMeans\/getCourseContent|Homework\/getListByCourseToStudent)$/i.test(url.pathname)) return "ketangpai";
    if(["mooc2-ans.chaoxing.com","mooc1.chaoxing.com","mooc1-api.chaoxing.com","mooc1-1.chaoxing.com","mooc1-2.chaoxing.com"].includes(url.hostname) && /^\/(?:mooc-ans\/)?mooc2\/work\/(list|all-task)$/.test(url.pathname)) return "chaoxing";
    return null;
  },
  zhifzLists(value) {
    if(this.source(value)!=="zhifz")throw new Error("智夫子作业列表地址不正确");
    return ["[0,1]","[2,3]"].map(states=>{const url=new URL(value);url.searchParams.set("状态",states);return url.href;});
  },
  headers:["authorization","token","x-token","x-csrf-token","x-xsrf-token","content-type","accept","accesstoken"],
};
