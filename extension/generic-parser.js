// Local, declarative DOM rules only. Never evaluate website-provided code.
globalThis.CampusGeneric=(()=>{
  const compact=value=>String(value || "").replace(/\s+/g," ").trim();
  function pageKey(value) {
    const url=new URL(value);
    if(!["https:","http:"].includes(url.protocol) || url.username || url.password)throw new Error("页面地址不正确");
    for(const key of [...url.searchParams.keys()])if(/^(?:page|pageNum|pageNo|offset|utm_.*)$/i.test(key))url.searchParams.delete(key);
    url.searchParams.sort();return url.href;
  }
  function validateRule(rule) {
    if(!rule || typeof rule!=="object")throw new Error("请先识别列表或点选字段");
    const result={};
    for(const key of ["rows","title","due","status","course"]){
      const value=rule[key] || "";
      if(typeof value!=="string" || value.length>1200 || (!value && ["rows","title"].includes(key)))throw new Error("读取规则不完整，请重新点选");
      result[key]=value;
    }
    return result;
  }
  const visible=node=>node && !node.closest('[hidden],[aria-hidden="true"],script,style,input,textarea,select,nav,header,footer') && node.getClientRects().length>0;
  function text(node) {
    if(!node)return "";
    const parts=[],walker=node.ownerDocument.createTreeWalker(node,NodeFilter.SHOW_TEXT);
    while(walker.nextNode())if(visible(walker.currentNode.parentElement))parts.push(walker.currentNode.textContent);
    return compact(parts.join(' '));
  }
  function path(node,root) {
    const parts=[];
    while(node && node!==root && node.nodeType===1){
      const tag=node.tagName.toLowerCase(),siblings=[...(node.parentElement?.children || [])].filter(other=>other.tagName===node.tagName);
      parts.unshift(tag+(siblings.length>1?`:nth-of-type(${siblings.indexOf(node)+1})`:""));node=node.parentElement;
    }
    return root?parts.length?`:scope > ${parts.join(" > ")}`:":scope":parts.join(" > ");
  }
  function repeated(node) {
    const semantic=node.closest('tr,li,article,[role="row"],.assignment,.homework,.task-card');
    if(semantic)return semantic;
    for(let parent=node.parentElement;parent && parent!==document.body;parent=parent.parentElement){
      const siblings=[...parent.parentElement.children].filter(other=>other.tagName===parent.tagName && other.className===parent.className);
      if(siblings.length>=2 && parent.querySelector('a[href],h2,h3,h4'))return parent;
    }
    throw new Error("没有找到重复的任务行，请点选一条任务内的标题");
  }
  function rowSelector(row) {
    const classes=[...row.classList].filter(name=>!/active|selected|done|complete|pending|odd|even|hover/i.test(name));
    return `${path(row.parentElement)} > ${row.tagName.toLowerCase()}${classes.map(name=>'.'+CSS.escape(name)).join("")}`;
  }
  function pickTitle(node) {
    const row=repeated(node);
    return {rows:rowSelector(row),title:path(node,row),due:"",status:"",course:""};
  }
  function detect(doc=document) {
    const candidates=[];
    for(const table of doc.querySelectorAll('table,[role="table"]')){
      if(!visible(table))continue;
      const headers=[...table.querySelectorAll('thead th,thead td,[role="columnheader"]')];
      if(!headers.length)headers.push(...table.querySelectorAll('tr:first-child th'));
      const index=pattern=>headers.findIndex(node=>pattern.test(text(node)));
      const title=index(/作业|任务|名称|标题|assignment|homework|title/i),due=index(/截止|DDL|due|deadline|结束时间/i),status=index(/完成|提交|状态|status/i),course=index(/课程|科目|course/i);
      if(title<0)continue;
      const row=[...table.querySelectorAll('tbody tr,[role="row"]')].find(node=>visible(node) && node.querySelector('td,[role="cell"]'));
      if(!row)continue;
      const field=i=>i<0 || !row.children[i]?"":path(row.children[i],row);
      if(!row.children[title])continue;
      candidates.push({rows:rowSelector(row),title:field(title),due:field(due),status:field(status),course:field(course)});
    }
    if(candidates.length)return candidates[0];
    for(const title of doc.querySelectorAll('main h2,main h3,main h4,article h2,article h3,.assignment a,.homework a,.task-card a')){
      if(!visible(title))continue;
      try{
        const rule=pickTitle(title),rows=[...doc.querySelectorAll(rule.rows)].filter(visible);
        if(rows.length<2 || !rows.some(row=>/截止|DDL|deadline|due|作业|assignment/i.test(row.textContent)))continue;
        const row=rows[0],due=row.querySelector('time,.deadline,.due-date,[data-due]'),status=row.querySelector('.status,[data-status]');
        return {...rule,due:due?path(due,row):"",status:status?path(status,row):""};
      }catch{}
    }
    return null;
  }
  function deadline(node) {
    if(!visible(node))return null;
    const raw=node.getAttribute('datetime') || text(node);
    const match=raw.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?/);
    if(!match)return null;
    const [,year,month,day,hour,minute,second="00",zone="+08:00"]=match;
    if(+month<1 || +month>12 || +day<1 || +day>new Date(Date.UTC(+year,+month,0)).getUTCDate() || +hour>23 || +minute>59 || +second>59)return null;
    const date=new Date(`${year}-${month.padStart(2,"0")}-${day.padStart(2,"0")}T${hour.padStart(2,"0")}:${minute}:${second}${zone}`);
    return Number.isFinite(date.getTime())?date.toISOString():null;
  }
  async function extract(rule,address,doc=document) {
    rule=validateRule(rule);
    if(doc.querySelector('input[type="password"]'))throw new Error("请先完成网站登录，再读取列表");
    const rows=[...doc.querySelectorAll(rule.rows)].filter(visible);
    if(!rows.length)throw new Error("未找到原来的任务列表，请确认页面已加载，必要时重新点选字段");
    if(rows.length>200)throw new Error("当前页面超过 200 条，请分页面读取");
    const tasks=[],seen=new Set(),base=new URL(address);
    for(const row of rows){
      const get=key=>rule[key]===':scope'?row:rule[key]?row.querySelector(rule[key]):null,titleNode=get("title"),title=text(titleNode);
      if(!title || title.length>500)throw new Error("任务标题缺失或过长，请重新点选标题");
      const anchors=titleNode.matches('a[href]')?[titleNode]:[...titleNode.querySelectorAll('a[href]')];
      if(!anchors.length && titleNode.closest('a[href]') && row.contains(titleNode.closest('a[href]')))anchors.push(titleNode.closest('a[href]'));
      const links=[...new Set(anchors.map(a=>{try{const url=new URL(a.getAttribute('href'),base);return url.origin===base.origin && !url.username && !url.password && pageKey(url.href)!==pageKey(address)?url.href:null;}catch{return null;}}).filter(Boolean))];
      const link=links.length===1?links[0]:null;
      const identity=link?new URL(link):null;if(identity)identity.searchParams.sort();
      const key=identity?`link:${identity.href}`:`title:${pageKey(address)}:${title}`;
      const external_id='g:'+ [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)))].map(n=>n.toString(16).padStart(2,'0')).join('');
      if(seen.has(external_id))throw new Error("列表含同名且无法区分的任务，请点选各自的标题链接后重试");
      seen.add(external_id);
      const state=text(get('status')).replace(/^(?:提交状态|完成状态|状态)[:：]?\s*/,"");
      const status=/^(?:已完成|已提交|待批阅|已批阅|已批改|completed|submitted)$/i.test(state)?'done':/^(?:未完成|未提交|待提交|待重做|已退回|not submitted|incomplete)$/i.test(state)?'todo':null;
      tasks.push({external_id,title,content:"",due_at:deadline(get('due')),...(status?{status}:{}),course:text(get('course')).slice(0,300),source_url:link || address,stable:!!link});
    }
    return tasks;
  }
  return {pageKey,validateRule,path,pickTitle,detect,extract};
})();
