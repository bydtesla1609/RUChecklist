// Only these read-only list endpoints may be replayed by the cloud collector.
globalThis.CampusCloudRoutes={
  source(value) {
    let url;try{url=new URL(value);}catch{return null;}
    if(url.protocol!=="https:" || url.username || url.password || url.port) return null;
    if(url.hostname==="smartestu.cn" && url.pathname==="/api/homework/student/mark/queryHomeworks") return "smartestu";
    // The platform joins a base URL ending in / with routes beginning in /.
    if(["www.ketangpai.com","openapiv5.ketangpai.com"].includes(url.hostname) && /^\/+Futurev2\/(CourseMeans\/getCourseContent|Homework\/getListByCourseToStudent)$/i.test(url.pathname)) return "ketangpai";
    if(["mooc2-ans.chaoxing.com","mooc1.chaoxing.com","mooc1-api.chaoxing.com","mooc1-1.chaoxing.com","mooc1-2.chaoxing.com"].includes(url.hostname) && /^\/(?:mooc-ans\/)?mooc2\/work\/(list|all-task)$/.test(url.pathname)) return "chaoxing";
    return null;
  },
  headers:["authorization","token","x-token","x-csrf-token","x-xsrf-token","content-type","accept"],
};
