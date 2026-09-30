(() => {
  if(window.top!==window || globalThis.ruGenericMounted)return;
  globalThis.ruGenericMounted=true;
  let context,rule,items=[],excluded=new Set(),sequence=0,picking=null,signature="",busy=false,timer,closed=false,observer;
  const host=document.createElement("div");host.id="ruchecklist-reader";
  const shadow=host.attachShadow({mode:"closed"}),style=document.createElement("style");
  style.textContent=`:host{all:initial;position:fixed;right:18px;bottom:18px;z-index:2147483647;color-scheme:dark;font:15px/1.6 system-ui,"Microsoft YaHei",sans-serif;color:#f0f1ff}*{box-sizing:border-box}section{width:600px;max-width:calc(100vw - 28px);max-height:80vh;overflow:auto;padding:22px;background:#1c203d;border:1px solid #a79bff66;border-radius:18px;box-shadow:0 16px 65px #0008}h2{margin:0;font-size:22px}p{margin:12px 0;color:#aeb7d8}button{font:inherit;min-height:40px;padding:7px 12px;margin:3px;border:1px solid #a79bff50;border-radius:9px;background:#292d50;color:#e4dfff;cursor:pointer}button.primary{background:#a99afa;color:#14152d;font-weight:600}button:disabled{opacity:.5;cursor:wait}button:focus-visible,a:focus-visible,input:focus-visible{outline:2px solid #a99afa;outline-offset:2px}header,footer{display:flex;align-items:center;justify-content:space-between;gap:8px}header button{margin-left:auto}a{color:#c6bcff;text-decoration:none}label{display:flex;gap:10px;align-items:flex-start;padding:12px 0;border-bottom:1px solid #ffffff16}input{margin-top:6px;accent-color:#a99afa;flex:none}strong{display:block;overflow-wrap:anywhere}small{display:block;color:#aeb7d8;font-size:13px}.error{color:#bbc4e4}.controls{display:flex;flex-wrap:wrap;gap:3px}.list{margin:14px 0;max-height:35vh;overflow:auto}.notice{font-size:13px}.outline{position:fixed;border:2px solid #a99afa;pointer-events:none;background:#a99afa22}button.launcher{box-shadow:0 8px 30px #0006;background:#262a4c}[hidden]{display:none!important}@media(max-width:480px){:host{right:8px;bottom:8px}section{padding:16px;max-height:85vh}h2{font-size:20px}.list{max-height:30vh}}`;
  shadow.append(style);
  const el=(tag,text)=>{const node=document.createElement(tag);if(text)node.textContent=text;return node;};
  const button=(text,fn)=>{const node=el("button",text);node.type="button";node.onclick=fn;return node;};
  const panel=el("section"),header=el("header"),title=el("h2","RUChecklist · 识别预览"),note=el("p"),error=el("p"),controls=el("div"),list=el("div"),footer=el("footer"),outline=el("div");
  panel.setAttribute("aria-label","RUChecklist 通用网页识别");error.className="error";error.setAttribute("role","status");controls.className="controls";list.className="list";outline.className="outline";outline.hidden=true;
  const launcher=button("RUChecklist · 读取任务",()=>{closed=false;panel.hidden=false;launcher.hidden=true;refresh(true);});launcher.className="launcher";launcher.hidden=true;
  const close=button("收起",()=>{stopPick();closed=true;panel.hidden=true;launcher.hidden=false;launcher.focus();});close.setAttribute("aria-label","收起识别预览");
  header.append(title,close);note.textContent="只读取当前已加载的列表。请核对标题、时间和状态，取消勾选不需要的条目。确认后保存规则，用于后续浏览器同步。未标时区的时间按北京时间处理。";
  for(const [field,label] of [["title","标题"],["due","截止时间"],["status","完成状态"],["course","课程"]])controls.append(button(`点选${label}`,()=>startPick(field,label)));
  controls.append(button("自动识别",()=>{rule=CampusGeneric.detect();excluded.clear();refresh(true);}),button("清除时间 / 状态",()=>{if(rule){rule.due="";rule.status="";refresh(true);}}));
  const save=button("确认导入并保存规则",confirm);save.className="primary";
  footer.append(button("重新读取",()=>refresh(true)),save);
  panel.append(header,note,controls,error,list,footer);shadow.append(panel,launcher,outline);
  const ask=async message=>{const result=await chrome.runtime.sendMessage(message);if(result?.error)throw new Error(result.error);return result;};
  function stopPick(){picking=null;outline.hidden=true;document.removeEventListener("click",pick,true);document.removeEventListener("pointermove",highlight,true);}
  function startPick(field,label){
    if(field!=="title" && !rule){error.textContent="请先点选一个任务标题。";return;}
    stopPick();picking=field;error.textContent=`请点击网页中的${label}。按 Esc 取消；不会打开链接或提交表单。`;
    document.addEventListener("click",pick,true);document.addEventListener("pointermove",highlight,true);
  }
  function highlight(event){
    if(event.composedPath().includes(host))return;
    const box=event.target.getBoundingClientRect();outline.hidden=false;
    Object.assign(outline.style,{left:`${box.left}px`,top:`${box.top}px`,width:`${box.width}px`,height:`${box.height}px`});
  }
  function pick(event){
    if(event.composedPath().includes(host))return;
    event.preventDefault();event.stopImmediatePropagation();
    try{
      if(event.target.closest('input,textarea,select,nav,header,footer'))throw new Error("请点选任务列表中的文字，不读取表单输入");
      if(picking==="title")rule=CampusGeneric.pickTitle(event.target);
      else {const row=event.target.closest(rule.rows);if(!row)throw new Error("请在同一任务列表内点选该字段");rule[picking]=CampusGeneric.path(event.target,row);}
      stopPick();excluded.clear();refresh(true);
    }catch(cause){error.textContent=cause.message;}
  }
  document.addEventListener("keydown",event=>{if(event.key==="Escape" && picking){event.preventDefault();stopPick();error.textContent="已取消点选。";}});
  function render(){
    list.replaceChildren();
    for(const item of items){
      const row=el("label"),check=el("input"),body=el("span");check.type="checkbox";check.checked=!excluded.has(item.external_id);check.setAttribute("aria-label",`导入：${item.title}`);
      check.onchange=()=>{if(check.checked)excluded.delete(item.external_id);else excluded.add(item.external_id);save.disabled=busy || items.every(item=>excluded.has(item.external_id));};
      body.append(el("strong",item.title),el("small",`${item.due_at?new Date(item.due_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):"截止时间未识别"} · ${item.status==="done"?"已完成":item.status==="todo"?"未完成":"完成状态未识别"}${item.course?` · ${item.course}`:""}`));
      if(!item.stable)body.append(el("small","缺少独立任务链接，后续读取仍需确认；同名任务无法可靠区分。"));
      row.append(check,body);list.append(row);
    }
    save.disabled=busy || !items.length || items.every(item=>excluded.has(item.external_id));
  }
  async function refresh(show=false){
    if(!context || busy || picking)return;
    const current=++sequence;
    try{
      if(!rule)rule=CampusGeneric.detect();
      if(!rule)throw new Error("暂未识别到作业表格或卡片。请先打开 / 加载列表，再点“自动识别”；也可以点选字段。嵌入页面请在独立标签页打开。 ");
      const parsed=await CampusGeneric.extract(rule,location.href);if(current!==sequence)return;
      items=parsed;render();error.textContent=`识别到 ${items.length} 项。未识别的时间和状态不会覆盖已有值。`;
      if(!show && context.rule?.automatic && JSON.stringify(context.rule.fields)===JSON.stringify(rule)){
        const selected=items.filter(item=>!excluded.has(item.external_id)),next=JSON.stringify(selected);
        if(!selected.length || next===signature)return;
        if(selected.some(item=>!item.stable))throw new Error("列表结构或任务链接发生变化，请重新预览确认。");
        busy=true;
        try{await ask({type:"generic-import",binding:context.binding,rule,tasks:selected,confirmed:false});signature=next;launcher.textContent=`RUChecklist · 已读取 ${selected.length} 项`;}
        finally{busy=false;render();}
      }
    }catch(cause){if(current!==sequence)return;items=[];render();error.textContent=cause.message;launcher.textContent="RUChecklist · 需要检查";}
  }
  async function confirm(){
    if(busy)return;busy=true;render();error.textContent="正在保存…";
    try{
      const selected=items.filter(item=>!excluded.has(item.external_id));
      await ask({type:"generic-import",binding:context.binding,rule,tasks:selected,excluded:[...excluded],confirmed:true});
      context.rule={fields:CampusGeneric.validateRule(rule),automatic:selected.every(item=>item.stable),excluded:[...excluded]};signature=JSON.stringify(selected);
      error.textContent=`已导入 ${selected.length} 项并保存规则。${context.rule.automatic?"此页面之后按规则自动读取。":"此页面之后仍需预览确认。"} 翻页后会读取新加载的列表；电脑休眠或关机时暂停。`;
    }catch(cause){error.textContent=cause.message;}
    finally{busy=false;render();}
  }
  async function start(){
    const address=location.href;
    try{context=await ask({type:"generic-context"});}catch{return;}
    if(address!==location.href){context=null;return;}
    document.body.append(host);rule=context.rule?.fields || null;excluded=new Set(context.rule?.excluded || []);
    closed=!!context.rule && !context.review;panel.hidden=closed;launcher.hidden=!closed;
    await refresh(!closed);
    observer=new MutationObserver(changes=>{
      if(changes.every(change=>change.target===host || host.contains(change.target)))return;
      clearTimeout(timer);timer=setTimeout(()=>refresh(!closed),900);
    });observer.observe(document.body,{subtree:true,childList:true,characterData:true});
  }
  let address=location.href;
  setInterval(()=>{if(location.href===address)return;address=location.href;sequence++;context=null;signature="";observer?.disconnect();stopPick();host.remove();start();},1000);
  chrome.runtime.onMessage.addListener(message=>{if(message.type==="generic-review" && context){panel.hidden=false;launcher.hidden=true;closed=false;refresh(true);}});
  start();
})();
