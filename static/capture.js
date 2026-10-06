"use strict";
let editingAxis=null,axisScene=null;
const cardTime=task=>task.category==="作业"?task.due_at:task.starts_at;
const chronological=(a,b)=>(cardTime(a)||"9999").localeCompare(cardTime(b)||"9999") || a.id.localeCompare(b.id);
function resetAxisScene(){axisScene=null;}
function fillAxisSelect(value){
  $("task-axis").replaceChildren(...[{id:"",title:"不归轴"},...axes].map(axis=>{const option=element("option",axis.title);option.value=axis.id;return option;}));
  $("task-axis").value=value || "";enhanceSelect($("task-axis"));
}
function renderRecords(records){
  $("board").className="record-board";
  const ordered=[...records].sort((a,b)=>-chronological(a,b));
  if(!ordered.length){$("board").replaceChildren(element("p","还没有记录","day-empty"));return;}
  const groups=new Map();
  for(const task of ordered){const day=localInput(task.starts_at).slice(0,10);if(!groups.has(day))groups.set(day,[]);groups.get(day).push(task);}
  $("board").replaceChildren(...[...groups].map(([day,items])=>{const section=element("section",null,"record-day"),grid=element("div",null,"record-cards");section.append(element("h2",day.replaceAll("-"," / ")));grid.append(...items.map(card));section.append(grid);return section;}));
}
function renderAxisMembers(){
  const items=axisItems.filter(task=>task.axis_id===editingAxis?.id).sort(chronological),root=$("axis-members");
  root.replaceChildren();if(!editingAxis)return;
  root.append(element("h3",`卡片 · ${items.length}`));
  if(!items.length)root.append(element("p","尚无卡片","hint"));
  for(const task of items){
    const row=element("div",null,"axis-member"),info=element("div");info.append(element("strong",task.title),element("small",`${task.category} · ${formatTime(cardTime(task))}${task.archived_at?" · 已归档":""}`));
    const edit=element("button","编辑","text-button"),detach=element("button","离轴","text-button");edit.type=detach.type="button";
    edit.onclick=()=>openTask(task);detach.onclick=async()=>{detach.disabled=true;try{await api(`/api/tasks/${task.id}`,"PATCH",{axis_id:null,revision:task.revision});lastPayload="";await refresh();renderAxisMembers();}catch(error){notice(error.message);detach.disabled=false;}};
    row.append(info,edit,detach);root.append(row);
  }
}
function openAxis(axis=null){
  if(hasDraft()){notice("请先保存待办草稿");return;}
  editingAxis=axis;$("axis-form").reset();$("axis-error").textContent="";$("axis-dialog-title").textContent=axis?"编辑轴线":"添加轴线";
  $("axis-title").value=axis?.title || "";$("axis-content").value=axis?.content || "";$("axis-start").value=localInput(axis?.starts_at);$("axis-end").value=localInput(axis?.ends_at);$("axis-delete").hidden=!axis;
  renderAxisMembers();$("axis-dialog").showModal();
}
$("axis-form").onsubmit=async event=>{
  event.preventDefault();$("axis-save").disabled=true;$("axis-error").textContent="";
  try{await api(editingAxis?`/api/axes/${editingAxis.id}`:"/api/axes",editingAxis?"PATCH":"POST",{title:$("axis-title").value,content:$("axis-content").value,starts_at:inputTime($("axis-start").value),ends_at:inputTime($("axis-end").value),...(editingAxis?{revision:editingAxis.revision}:{})});$("axis-dialog").close();lastPayload="";await refresh();}
  catch(error){$("axis-error").textContent=error.message;}finally{$("axis-save").disabled=false;}
};
$("axis-delete").onclick=async()=>{
  if(!editingAxis || !confirm(`删除轴线“${editingAxis.title}”？其中的卡片会保留。`))return;
  $("axis-delete").disabled=true;try{await api(`/api/axes/${editingAxis.id}`,"DELETE",{revision:editingAxis.revision});$("axis-dialog").close();lastPayload="";await refresh();}catch(error){$("axis-error").textContent=error.message;}finally{$("axis-delete").disabled=false;}
};
const axisAdd=element("dialog",null,"axis-add-dialog");axisAdd.id="axis-add-dialog";
const addHeading=element("div",null,"dialog-heading"),closeAxisAdd=element("button","×","icon-button");closeAxisAdd.setAttribute("aria-label","关闭添加卡片");closeAxisAdd.onclick=()=>axisAdd.close();addHeading.append(element("h2","添加卡片"),closeAxisAdd);axisAdd.append(addHeading);
for(const category of CATEGORIES){const button=element("button",category,"axis-add-type");button.prepend(navigationIcon(category));button.onclick=()=>{newTaskCategory=category;axisAdd.close();openTask();};axisAdd.append(button);}
document.body.append(axisAdd);
function addOnAxis(id){newTaskAxis=id;newTaskCategory=null;axisAdd.showModal();}
document.querySelectorAll("[data-view]").forEach(button=>button.onclick=()=>{if(hasDraft()){notice("请先保存待办草稿");return;}if(overviewView!==button.dataset.view)resetAxisScene();overviewView=button.dataset.view;render();});

function svgElement(tag,attributes={},text){const node=document.createElementNS("http://www.w3.org/2000/svg",tag);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,value);if(text!==undefined)node.textContent=text;return node;}
function renderAxes(){
  const board=$("board");board.className="axes-board";
  const toolbar=element("div",null,"axes-toolbar"),add=element("button","＋ 添加轴线","secondary");add.onclick=()=>openAxis();toolbar.append(element("span",`${axes.length} 条轴线`,"hint"),add);
  const canvas=element("div",null,"axes-canvas"),svg=svgElement("svg",{role:"group","aria-label":"轴线画布",tabindex:"0"}),world=svgElement("g");svg.append(world);canvas.append(svg);
  const controls=element("div",null,"canvas-controls");const buttons={};for(const [key,label] of [["minus","−"],["reset","复位"],["plus","＋"]]){const button=element("button",label);button.setAttribute("aria-label",{minus:"缩小画布",reset:"复位画布",plus:"放大画布"}[key]);buttons[key]=button;controls.append(button);}
  canvas.append(element("span","拖动画布 · 滚轮缩放","canvas-hint"),controls);board.replaceChildren(toolbar,canvas);
  if(!axes.length){const empty=element("button","＋ 添加第一条轴线","canvas-empty");empty.onclick=()=>openAxis();canvas.append(empty);return;}
  const signature=JSON.stringify(axes.map(axis=>[axis.id,...axisItems.filter(t=>t.axis_id===axis.id).sort(chronological).map(t=>[t.id,cardTime(t)])]));
  if(axisScene?.signature!==signature){axisScene={signature,camera:{x:125,y:110,z:1},pivot:0,lines:axes.map((axis,i)=>{const members=axisItems.filter(t=>t.axis_id===axis.id).sort(chronological);return {id:axis.id,nodes:[{id:"head",x:0,y:i*220},...members.map((task,j)=>({id:task.id,x:(j+1)*220,y:i*220})),{id:"tail",x:(members.length+1)*220,y:i*220}]};})};}
  const scene=axisScene,groups=[];let paths=[],gesture=null;const pointers=new Map();
  scene.lines.forEach((line,i)=>{
    const axis=axes.find(a=>a.id===line.id),group=svgElement("g",{class:`axis-line axis-color-${i%5}`}),path=svgElement("path",{class:"axis-path"});group.append(path);
    const nodes=line.nodes.map((node,j)=>{
      const kind=j===0?"head":j===line.nodes.length-1?"tail":"card",task=axisItems.find(t=>t.id===node.id),label=kind==="head"?axis.title:kind==="tail"?"添加卡片":task.title;
      const g=svgElement("g",{class:`axis-node axis-${kind}`,"data-line":i,"data-node":j,"data-kind":kind,role:"button",tabindex:"0","aria-label":`${kind==="head"?"编辑轴线":kind==="tail"?"添加卡片到轴线":"编辑卡片"}：${kind==="tail"?axis.title:label}`});
      g.append(svgElement("title",{},label));
      if(kind==="head"){g.append(svgElement("rect",{x:-88,y:-25,width:176,height:50,rx:13}),svgElement("text",{"text-anchor":"middle",y:5},label.length>12?label.slice(0,12)+"…":label));}
      else{g.append(svgElement("circle",{r:kind==="tail"?18:9,class:task?.category==="记录"?"record-dot":""}));g.append(svgElement("text",kind==="tail"?{"text-anchor":"middle",y:6}:{x:18,y:-16},kind==="tail"?"＋":label.length>18?label.slice(0,18)+"…":label));}
      group.append(g);return g;
    });world.append(group);groups.push({path,nodes});
  });
  function paint(){
    paths=CaptureLayout.project(scene.lines,scene.pivot);
    groups.forEach((group,i)=>{group.path.setAttribute("d",paths[i].map((p,j)=>`${j?"L":"M"}${p.x},${p.y}`).join(" "));scene.lines[i].nodes.forEach((node,j)=>group.nodes[j].setAttribute("transform",`translate(${node.x},${CaptureLayout.interpolate(paths[i],node.x)})`));});
    world.setAttribute("transform",`translate(${scene.camera.x},${scene.camera.y}) scale(${scene.camera.z})`);
    canvas.style.backgroundPosition=`${scene.camera.x}px ${scene.camera.y}px`;canvas.style.backgroundSize=`${28*scene.camera.z}px ${28*scene.camera.z}px`;
  }
  const local=event=>{const rect=svg.getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top};};
  const worldPoint=p=>({x:(p.x-scene.camera.x)/scene.camera.z,y:(p.y-scene.camera.y)/scene.camera.z});
  function zoom(factor,p){const before=worldPoint(p);scene.camera.z=Math.max(.25,Math.min(2.5,scene.camera.z*factor));scene.camera.x=p.x-before.x*scene.camera.z;scene.camera.y=p.y-before.y*scene.camera.z;paint();}
  const center=()=>({x:svg.clientWidth/2,y:svg.clientHeight/2});buttons.plus.onclick=()=>zoom(1.2,center());buttons.minus.onclick=()=>zoom(1/1.2,center());buttons.reset.onclick=()=>{resetAxisScene();renderAxes();};
  svg.addEventListener("wheel",event=>{event.preventDefault();if(event.shiftKey){scene.camera.x-=event.deltaY;paint();}else zoom(Math.exp(-event.deltaY*.0015),local(event));},{passive:false});
  function activate(target){const line=scene.lines[+target.dataset.line],node=line.nodes[+target.dataset.node];if(target.dataset.kind==="head")openAxis(axes.find(a=>a.id===line.id));else if(target.dataset.kind==="tail")addOnAxis(line.id);else openTask(axisItems.find(t=>t.id===node.id));}
  function moveNode(i,j,point){const nodes=scene.lines[i].nodes;nodes[j].x=Math.max(nodes[j-1].x+64,Math.min(nodes[j+1].x-64,point.x));nodes[j].y=Math.max(-20000,Math.min(20000,point.y));scene.pivot=i;paint();}
  svg.onpointerdown=event=>{
    if(event.button!==0)return;const p=local(event);pointers.set(event.pointerId,p);svg.setPointerCapture(event.pointerId);
    if(pointers.size===2){const [a,b]=[...pointers.values()];gesture={kind:"pinch",distance:Math.hypot(a.x-b.x,a.y-b.y),center:{x:(a.x+b.x)/2,y:(a.y+b.y)/2}};return;}
    const target=event.target.closest(".axis-node");gesture={kind:target?.dataset.kind==="card"?"node":"pan",target,start:p,last:p,moved:false};
    if(gesture.kind==="node"){const i=+target.dataset.line,j=+target.dataset.node;const node=scene.lines[i].nodes[j];gesture.offset={x:worldPoint(p).x-node.x,y:worldPoint(p).y-CaptureLayout.interpolate(paths[i],node.x)};}
    canvas.classList.add("grabbing");
  };
  svg.onpointermove=event=>{
    if(!pointers.has(event.pointerId)||!gesture)return;const p=local(event);pointers.set(event.pointerId,p);
    if(gesture.kind==="pinch" && pointers.size===2){const [a,b]=[...pointers.values()],c={x:(a.x+b.x)/2,y:(a.y+b.y)/2},d=Math.hypot(a.x-b.x,a.y-b.y);if(gesture.distance>0)zoom(d/gesture.distance,gesture.center);scene.camera.x+=c.x-gesture.center.x;scene.camera.y+=c.y-gesture.center.y;gesture.distance=d;gesture.center=c;paint();return;}
    if(gesture.kind==="pinch")return;
    if(Math.hypot(p.x-gesture.start.x,p.y-gesture.start.y)>5)gesture.moved=true;if(!gesture.moved)return;
    if(gesture.kind==="node"){const point=worldPoint(p);moveNode(+gesture.target.dataset.line,+gesture.target.dataset.node,{x:point.x-gesture.offset.x,y:point.y-gesture.offset.y});}
    else{scene.camera.x+=p.x-gesture.last.x;scene.camera.y+=p.y-gesture.last.y;paint();}gesture.last=p;
  };
  svg.onpointerup=event=>{pointers.delete(event.pointerId);if(gesture && gesture.kind!=="pinch" && !gesture.moved && gesture.target)activate(gesture.target);gesture=null;canvas.classList.remove("grabbing");};
  svg.onpointercancel=()=>{pointers.clear();gesture=null;canvas.classList.remove("grabbing");};
  svg.onkeydown=event=>{const target=event.target.closest(".axis-node");if(target && ["Enter"," "].includes(event.key)){event.preventDefault();activate(target);}else if(target?.dataset.kind==="card" && ["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(event.key)){event.preventDefault();const i=+target.dataset.line,j=+target.dataset.node,node=scene.lines[i].nodes[j];moveNode(i,j,{x:node.x+({ArrowLeft:-20,ArrowRight:20}[event.key]||0),y:CaptureLayout.interpolate(paths[i],node.x)+({ArrowUp:-20,ArrowDown:20}[event.key]||0)});}};
  paint();
}

// Native select remains the form control; its visible picker shares the app theme.
function enhanceSelect(select){
  if(select.dataset.enhanced){select.dispatchEvent(new Event("capture-refresh"));return;}
  select.dataset.enhanced="true";select.classList.add("custom-select-native");select.tabIndex=-1;select.setAttribute("aria-hidden","true");
  const wrap=element("div",null,"custom-select"),button=element("button",null,"select-trigger"),menu=element("div",null,"select-menu");button.type="button";button.setAttribute("aria-haspopup","listbox");button.setAttribute("aria-expanded","false");menu.hidden=true;menu.setAttribute("role","listbox");
  select.before(wrap);wrap.append(select,button,menu);
  const label=()=>select.getAttribute("aria-label") || document.querySelector(`label[for="${select.id}"]`)?.textContent.trim() || "选择";
  const sync=()=>{button.textContent=(select.selectedOptions[0]?.textContent || "请选择")+" ⌄";button.disabled=select.disabled;button.setAttribute("aria-label",label());menu.replaceChildren(...[...select.options].map(option=>{const entry=element("button",option.textContent,"select-option");entry.type="button";entry.setAttribute("role","option");entry.setAttribute("aria-selected",String(option.selected));entry.disabled=option.disabled;entry.onclick=()=>{select.value=option.value;select.dispatchEvent(new Event("change",{bubbles:true}));close();sync();button.focus();};return entry;}));};
  const close=()=>{menu.hidden=true;button.setAttribute("aria-expanded","false");};
  button.onclick=()=>{const open=menu.hidden;document.querySelectorAll(".select-menu").forEach(node=>node.hidden=true);menu.hidden=!open;button.setAttribute("aria-expanded",String(open));if(open){sync();menu.querySelector('[aria-selected="true"]')?.focus();}};
  wrap.onkeydown=event=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();close();button.focus();}if(["ArrowDown","ArrowUp","Home","End"].includes(event.key)){event.preventDefault();menu.hidden=false;button.setAttribute("aria-expanded","true");const choices=[...menu.querySelectorAll("button:not(:disabled)")],index=choices.indexOf(document.activeElement);choices[event.key==="Home"?0:event.key==="End"?choices.length-1:Math.max(0,Math.min(choices.length-1,index+(event.key==="ArrowDown"?1:-1)))]?.focus();}};
  wrap.addEventListener("focusout",event=>{if(!wrap.contains(event.relatedTarget))close();});select.addEventListener("change",sync);select.addEventListener("capture-refresh",sync);sync();
}
document.addEventListener("click",event=>{document.querySelectorAll(".custom-select").forEach(wrap=>{if(!wrap.contains(event.target)){wrap.querySelector(".select-menu").hidden=true;wrap.querySelector(".select-trigger").setAttribute("aria-expanded","false");}});});
const toggle=$("sidebar-toggle"),workspace=$("workspace");
function sidebarState(collapsed){workspace.classList.toggle("sidebar-collapsed",collapsed);toggle.setAttribute("aria-expanded",String(!collapsed));toggle.title=collapsed?"展开侧栏":"收起侧栏";toggle.setAttribute("aria-label",toggle.title);}
sidebarState(localStorage.getItem("rucapture-sidebar")==="collapsed");toggle.onclick=()=>{const collapsed=!workspace.classList.contains("sidebar-collapsed");sidebarState(collapsed);localStorage.setItem("rucapture-sidebar",collapsed?"collapsed":"expanded");closeUserMenu();};

document.querySelectorAll("select").forEach(enhanceSelect);
