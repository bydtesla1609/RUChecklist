"use strict";
const $ = id => document.getElementById(id);
const CATEGORIES = ["作业", "课程", "考试", "活动", "会议", "记录"];
const NAV_CATEGORIES=CATEGORIES.filter(category=>category!=="课程");
let savedAxisLayout=null,axisLayoutRevision=0;
let axes=[],axisItems=[],overviewView="calendar",newTaskAxis=null,newTaskCategory=null;
const STATES = {todo: "待开始", doing: "进行中", done: "已完成"};
let tasks = [], sources = [], categoryFilter = "全部", editing = null, deleting = null;
let refreshSequence = 0, lastPayload = "", toastTimer, taskCategory = "作业", draftTodos = [];
let draftAttachments = [], uploading = false;
let timetables=[], courseSemester=null, courseWeek="all";
let collectorState=null, cloudState=null, syncing=false;
let syncSession=0, cloudCheckSequence=0, collectorCheckSequence=0, lastCloudCheck=0;
const loginRemindersSeen=new Set();
let sourceLinksState=null, boardAccount="personal", trialMode=false;
let publicRegistration=false;
let authMode="login", accountName="", registrationOpen=false, isAdmin=false;
let editingWebsite=-1, websiteBusy=false;
let syncStep=1,syncVisited=1,syncExecuted=false,cloudPanelLoading=false;
const syncGuideVersion=document.getElementById("app-version").textContent+":1.9.3";
let archiveCategory="全部", archiveItems=[], archiveTotal=0, archiveSequence=0;
let selectedDay = localInput(new Date()).slice(0,10), calendarMonth = selectedDay.slice(0,7);

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== null && text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function notice(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").hidden = true, 4000);
}
async function api(path, method = "GET", payload, timeout = 15000) {
  const session=syncSession;
  const response = await fetch(path, {method, cache: "no-store", headers: {"Content-Type": "application/json"},
    ...(payload !== undefined ? {body: JSON.stringify(payload)} : {}), signal: AbortSignal.timeout(timeout)});
  let data;
  try { data = await response.json(); } catch { throw new Error("服务器暂时不可用，请稍后重试"); }
  if (!response.ok) {
    if (response.status === 401 && session===syncSession && !["/api/login","/api/register","/api/recover","/api/recovery-code"].includes(path)) showLogin();
    throw Object.assign(new Error(data.error || "请求未完成，请重试"), {status: response.status});
  }
  return data;
}
function showLogin() {
  refreshSequence++;closeUserMenu();
  if(typeof resetMessages==="function")resetMessages();
  syncSession++;lastCloudCheck=0;loginRemindersSeen.clear();
  $("expired-sites").replaceChildren();
  $("workspace").hidden = true;
  $("login").hidden = false;
  document.querySelectorAll("dialog[open]").forEach(dialog => dialog.close());
  tasks = [];savedAxisLayout=null;axisLayoutRevision=0; axes=[];axisItems=[];resetAxisScene();sources = []; timetables=[]; archiveItems=[]; lastPayload = "";
  $("archive-list").replaceChildren(); $("archive-detail").replaceChildren();
  $("board").replaceChildren(); $("sources-list").replaceChildren(); collectorState=null; cloudState=null;
  sourceLinksState=null;if(trialMode)boardAccount="";
  syncStep=syncVisited=1;syncExecuted=false;cloudPanelLoading=false;$("cloud-panel").replaceChildren();
  editing=null;deleting=null;draftTodos=[];draftAttachments=[];
  $("task-form").reset();$("task-todos").replaceChildren();$("task-links").replaceChildren();$("task-attachments").replaceChildren();$("source-url").value="";$("website-list").replaceChildren();$("source-links-form").hidden=true;$("recovery-value").textContent="";$("account-password").value="";
}
function formatTime(value, includeYear = false) {
  if (!value) return "待补充时间";
  return new Intl.DateTimeFormat("zh-CN", {timeZone: "Asia/Shanghai", ...(includeYear ? {year:"numeric"} : {}),
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false}).format(new Date(value));
}
function localInput(value) {
  return value ? new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0,16) : "";
}
function inputTime(value) { return value ? new Date(`${value}:00+08:00`).toISOString() : null; }
function deadline(task) { return task.category === "作业" ? task.due_at : task.ends_at; }
function fileSize(size) { return size === 0 ? "0 KB" : size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(size / 1024))} KB`; }
function externalLink(label, url) {
  const link = element("a", label); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; return link;
}
function fileRow(file, removable = false) {
  const row = element("div", null, "resource-row");
  const suffix = file.name.split(".").pop().slice(0, 5).toUpperCase();
  row.append(element("span", suffix || "文件", "resource-kind"));
  if (file.pending) { const name=element("span", file.name); name.append(element("small", `${fileSize(file.size)} · 保存任务后可打开`)); row.append(name); }
  else {
    const link=externalLink(file.name, `/api/files/${file.id}`); link.setAttribute("aria-label", `打开附件：${file.name}`);
    link.append(element("small", fileSize(file.size))); row.append(link);
    const download=externalLink("下载", `/api/files/${file.id}?download=1`); download.className="file-download"; download.setAttribute("aria-label", `下载附件：${file.name}`); row.append(download);
  }
  if (removable) {
    const remove=element("button", "×"); remove.type="button"; remove.setAttribute("aria-label", `移除附件：${file.name}`); remove.disabled=uploading;
    remove.onclick=()=>{ if(!confirm(`移除附件“${file.name}”？保存任务后生效。`))return; draftAttachments=draftAttachments.filter(value=>value.id!==file.id); renderAttachments(); }; row.append(remove);
  }
  return row;
}
function renderAttachments() {
  $("task-attachments").replaceChildren(...draftAttachments.map(file=>fileRow(file,true)));
  if (!draftAttachments.length) $("task-attachments").append(element("p", "还没有附件", "resource-empty"));
}
function addLinkRow(link = {label:"",url:""}) {
  if ($("task-links").querySelectorAll(".link-edit-row").length >= 20) { notice("最多添加 20 个链接"); return; }
  $("task-links").querySelector(".resource-empty")?.remove();
  const row=element("div", null, "link-edit-row"), label=element("input"), url=element("input"), remove=element("button", "×");
  label.placeholder="链接名称（选填）"; label.maxLength=100; label.value=link.label; label.setAttribute("aria-label", "链接名称"); label.className="link-label";
  url.type="url"; url.placeholder="https://…"; url.maxLength=4000; url.value=link.url; url.setAttribute("aria-label", "链接地址"); url.className="link-url";
  remove.type="button"; remove.setAttribute("aria-label", "移除链接"); remove.onclick=()=>{if(confirm("移除这条链接？保存任务后生效。"))row.remove();}; row.append(label,url,remove); $("task-links").append(row);
}
$("add-link").onclick=()=>addLinkRow();
$("attachment-input").onchange=async () => {
  const selected=[...$("attachment-input").files]; if (!selected.length) return;
  $("task-error").textContent="";
  if (selected.length + draftAttachments.length > 20) { $("task-error").textContent="每项任务最多 20 个附件"; $("attachment-input").value=""; return; }
  if (selected.some(file=>!file.size || file.size>10*1024*1024)) { $("task-error").textContent="附件不能为空，单个文件最多 10 MB"; $("attachment-input").value=""; return; }
  uploading=true; $("save-task").disabled=true; $("attachment-input").disabled=true;
  $("task-dialog").querySelectorAll(".close-dialog").forEach(button=>button.disabled=true); renderAttachments();
  try {
    for (const [index,file] of selected.entries()) {
      $("upload-state").textContent=`正在上传 ${index+1}/${selected.length}：${file.name}`;
      const form=new FormData(); form.set("file",file);
      const response=await fetch("/api/files",{method:"POST",body:form,signal:AbortSignal.timeout(120000)});
      let data; try { data=await response.json(); } catch { throw new Error("文件上传失败，请重试"); }
      if (!response.ok) throw new Error(data.error || "文件上传失败，请重试");
      draftAttachments.push({...data,pending:true}); renderAttachments();
    }
    $("upload-state").textContent="上传完成，保存任务后即可在所有设备打开。";
  } catch (error) { $("task-error").textContent=error.message; $("upload-state").textContent="未上传成功的文件可重新选择，已上传部分会保留。"; }
  finally { uploading=false; $("save-task").disabled=false; $("attachment-input").disabled=false; $("attachment-input").value=""; $("task-dialog").querySelectorAll(".close-dialog").forEach(button=>button.disabled=false); renderAttachments(); }
};
$("task-dialog").addEventListener("cancel",event=>{if(uploading) event.preventDefault();});
function hasDraft() { return !!document.querySelector("#board [data-dirty], #board [data-busy], #board .dragging, #course-detail [data-dirty], #course-detail [data-busy], #course-detail .dragging"); }
function checklist(initial, persist, inDialog = false) {
  const root = element("div", null, "checklist");
  let items = structuredClone(initial), saved = structuredClone(initial), editingId = null, adding = "", pendingCommit=false;
  const list = element("div", null, "todo-list"), progress = element("span", null, "checklist-count");
  const error = element("p", "", "error checklist-error"); error.setAttribute("role", "alert");
  const recovery = element("div", null, "checklist-recovery"); recovery.hidden = true;
  const retry = element("button", "重试保存", "text-button"), discard = element("button", "放弃草稿并刷新", "text-button");
  retry.type = discard.type = "button";
  retry.onclick = () => commit();
  discard.onclick = () => { items = structuredClone(saved); editingId = null; adding = ""; delete root.dataset.dirty; recovery.hidden = true; draw(); if (!inDialog) refresh(); };
  recovery.append(retry, discard);
  const addRow = element("div", null, "todo-add"), input = element("input"), add = element("button", "+", "todo-add-button");
  input.placeholder = "添加待办事项…"; input.maxLength = 500; input.setAttribute("aria-label", "新的待办事项");
  add.type = "button"; add.setAttribute("aria-label", "添加待办事项");
  input.oninput = () => { adding = input.value; markDirty(); };
  input.onkeydown = event => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); add.click(); } if (event.key === "Escape") { adding = input.value = ""; markDirty(); } };
  add.onclick = async () => {
    if (!input.value.trim() || root.dataset.busy || editingId) return;
    if (items.length >= 100) { error.textContent = "每项任务最多 100 条待办"; return; }
    items.push({id: crypto.randomUUID(), text: input.value.trim(), done: false});
    adding = input.value = ""; await commit(); input.focus();
  };
  addRow.append(input, add); root.append(progress, list, addRow, error, recovery);
  function markDirty() {
    if (editingId || adding || JSON.stringify(items) !== JSON.stringify(saved)) root.dataset.dirty = "true";
    else delete root.dataset.dirty;
  }
  async function commit(quiet=false) {
    if (root.dataset.busy) {if(quiet)pendingCommit=true;return;}
    const submitted=structuredClone(items);let succeeded=false;
    markDirty(); root.dataset.busy = "true"; error.textContent = ""; recovery.hidden = true;
    root.setAttribute("aria-busy","true");
    try { await persist(submitted); saved = submitted;succeeded=true; }
    catch (failure) { error.textContent = `${failure.message}。草稿已保留。`; recovery.hidden = false; retry.disabled = failure.status === 409; }
    finally { delete root.dataset.busy;root.removeAttribute("aria-busy");if(pendingCommit && succeeded){pendingCommit=false;await commit(true);}else{pendingCommit=false;draw();markDirty();} }
  }
  function draw() {
    progress.textContent = `待办事项 · ${items.filter(item => item.done).length} / ${items.length}`;
    list.replaceChildren(...items.map(item => {
      const row = element("div", null, "todo-row" + (item.done ? " checked" : "")); row.dataset.id = item.id;
      const handle = element("button", "⋮⋮", "drag-handle"); handle.type = "button";
      handle.setAttribute("aria-label", `拖动排序：${item.text}，也可按上下方向键`);
      handle.title = "拖动排序 / 上下方向键";
      handle.onkeydown = async event => {
        if (event.key === "Escape" && drag) { event.preventDefault(); event.stopPropagation(); finishDrag(false); return; }
        if (drag) return;
        if (!["ArrowUp", "ArrowDown"].includes(event.key) || editingId || root.dataset.busy) return;
        event.preventDefault(); const from = items.indexOf(item), to = from + (event.key === "ArrowUp" ? -1 : 1);
        if (to < 0 || to >= items.length) return;
        items.splice(to, 0, items.splice(from, 1)[0]); await commit();
        list.querySelector(`[data-id="${item.id}"] .drag-handle`)?.focus();
      };
      let drag = null;
      const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
      async function finishDrag(saveOrder) {
        if (!drag || drag.ending) return;
        const current = drag; current.ending = true;
        if (handle.hasPointerCapture(current.pointerId)) handle.releasePointerCapture(current.pointerId);
        if (saveOrder && !reducedMotion()) {
          const landing = row.animate([{transform:row.style.transform}, {transform:`translateY(${current.placeholder.offsetTop}px) scale(1)`}],
            {duration:150,easing:"cubic-bezier(.2,.7,.25,1)",fill:"forwards"});
          await landing.finished.catch(()=>{}); landing.cancel();
        }
        current.placeholder.replaceWith(row);
        row.classList.remove("dragging"); row.style.removeProperty("transform");
        list.querySelectorAll(".todo-row").forEach(node=>node.getAnimations().forEach(animation=>animation.cancel()));
        drag = null;
        if (!saveOrder) { draw(); markDirty(); return; }
        const order = new Map(items.map(item => [item.id, item]));
        items = [...list.children].map(node => order.get(node.dataset.id));
        if (JSON.stringify(items) !== JSON.stringify(saved)) await commit(); else markDirty();
        list.querySelector(`[data-id="${item.id}"] .drag-handle`)?.focus({preventScroll:true});
      }
      handle.onpointerdown = event => {
        if (event.button !== 0 || editingId || adding || root.dataset.busy || list.querySelector(".dragging")) return;
        event.preventDefault(); handle.focus({preventScroll:true});
        const rect = row.getBoundingClientRect(), top = row.offsetTop;
        const placeholder = element("div",null,"todo-placeholder");
        placeholder.style.height = `${rect.height}px`; placeholder.setAttribute("aria-hidden","true");
        row.before(placeholder);
        drag = {placeholder,offsetY:event.clientY-rect.top,pointerId:event.pointerId,ending:false};
        row.classList.add("dragging"); row.style.transform = `translateY(${top}px) scale(1.015)`;
        root.dataset.dirty = "true";
        handle.setPointerCapture(event.pointerId);
      };
      handle.onpointermove = event => {
        if (!drag || drag.ending) return;
        const y = event.clientY-list.getBoundingClientRect().top;
        row.style.transform = `translateY(${y-drag.offsetY}px) scale(1.015)`;
        const siblings = [...list.querySelectorAll(".todo-row:not(.dragging)")];
        const next = siblings.find(node => y < node.offsetTop + node.offsetHeight / 2);
        let after = drag.placeholder.nextElementSibling;
        if (after === row) after = after.nextElementSibling;
        if (after === (next || null)) return;
        const positions = siblings.map(node => node.getBoundingClientRect().top);
        siblings.forEach(node=>node.getAnimations().forEach(animation=>animation.cancel()));
        list.insertBefore(drag.placeholder,next || null);
        if (!reducedMotion()) siblings.forEach((node,index)=>{
          const offset = positions[index]-node.getBoundingClientRect().top;
          if (offset) node.animate([{transform:`translateY(${offset}px)`},{transform:"translateY(0)"}],{duration:180,easing:"cubic-bezier(.2,.7,.25,1)"});
        });
      };
      handle.onpointerup = () => finishDrag(true);
      handle.onpointercancel = handle.onlostpointercapture = () => finishDrag(false);
      const check = element("input"); check.type = "checkbox"; check.checked = item.done; check.setAttribute("aria-label", `完成：${item.text}`);
      check.onchange = () => { item.done = check.checked;row.classList.toggle("checked",item.done);progress.textContent=`待办事项 · ${items.filter(value=>value.done).length} / ${items.length}`;commit(true); };
      row.append(handle, check);
      if (editingId === item.id) {
        handle.disabled = check.disabled = true;
        const edit = element("input", null, "todo-edit"); edit.value = item.text; edit.maxLength = 500; edit.setAttribute("aria-label", "编辑待办事项");
        edit.oninput = () => { item.text = edit.value; };
        const save = element("button", "✓", "todo-action"), cancel = element("button", "↶", "todo-action"); save.type = cancel.type = "button";
        save.setAttribute("aria-label", "确认待办修改"); cancel.setAttribute("aria-label", "取消待办修改");
        save.onclick = () => { if (!item.text.trim()) { error.textContent = "待办事项不能为空"; edit.focus(); return; } item.text = item.text.trim(); editingId = null; commit(); };
        cancel.onclick = () => { item.text = row.originalText; editingId = null; error.textContent = ""; draw(); markDirty(); };
        edit.onkeydown = event => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); save.click(); } if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel.click(); } };
        row.originalText = item.text; row.append(edit, save, cancel);
      } else {
        const text = element("button", item.text, "todo-text"); text.type = "button"; text.title = "点击编辑";
        text.setAttribute("aria-label", `编辑待办：${item.text}`);
        text.onclick = () => { if(root.dataset.busy)return;editingId = item.id; draw(); markDirty(); list.querySelector(".todo-edit").focus(); };
        const remove = element("button", "×", "todo-action"); remove.type = "button"; remove.setAttribute("aria-label", `删除待办：${item.text}`);
        remove.onclick = () => { if(root.dataset.busy)return;if(!confirm(`删除待办“${item.text}”？`))return; items = items.filter(value => value.id !== item.id); commit(); };
        row.append(text, remove);
      }
      if (editingId && editingId !== item.id) row.querySelectorAll("button,input").forEach(node => node.disabled = true);
      return row;
    }));
    input.disabled = add.disabled = !!editingId; discard.disabled = false;
    if (recovery.hidden) retry.disabled = false;
  }
  draw(); return root;
}
function navigationIcon(category) {
  const paths={
    "全部":"M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    "作业":"M8 3h8l3 3v15H5V3h3 M8 11l2 2 5-5 M8 17h7",
    "课程":"M3 5c3-1 6-1 9 1 3-2 6-2 9-1v14c-3-1-6-1-9 1-3-2-6-2-9-1z M12 6v14",
    "考试":"M8 3h8 M12 3v3 M18 6l2-2 M12 10v5l3 2 M21 15a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
    "活动":"m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z",
    "记录":"M4 3h12l4 4v14H4z M8 10h8 M8 14h8 M8 18h5",
    "会议":"M15 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M5 21v-2a7 7 0 0 1 14 0v2 M19 7a3 3 0 0 1 0 6 M22 20v-2a5 5 0 0 0-3-4",
    "消息":"M18 8a6 6 0 0 0-12 0v5l-2 4h16l-2-4z M10 21h4",
    "反馈":"M4 4h16v12H9l-5 4z M8 8h8 M8 12h5",
    "归档":"M4 8h16v13H4z M3 3h18v5H3z M9 12h6",
    "账户":"M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21a8 8 0 0 1 16 0",
    "退出":"M9 3H4v18h5 M10 12h11 M17 8l4 4-4 4",
    "演示":"M9 7l8 5-8 5z M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
    "同步":"M20 10a8 8 0 0 0-14-4L3 9 M3 4v5h5 M4 14a8 8 0 0 0 14 4l3-3 M21 20v-5h-5"
  };
  const svg=document.createElementNS("http://www.w3.org/2000/svg","svg"),path=document.createElementNS(svg.namespaceURI,"path");
  svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("aria-hidden","true");svg.setAttribute("class",`nav-icon cat-${CATEGORIES.indexOf(category)}`);
  path.setAttribute("d",paths[category]);svg.append(path);return svg;
}
function animateView() {
  if(matchMedia("(prefers-reduced-motion: reduce)").matches)return;
  [document.querySelector(".heading"),document.querySelector(".summary"),$("board")].filter(node=>!node.hidden).forEach((node,index)=>{
    node.getAnimations().forEach(animation=>animation.cancel());
    node.animate([{opacity:0,transform:"translateY(10px)"},{opacity:1,transform:"translateY(0)"}],{duration:260,delay:index*35,easing:"cubic-bezier(.2,.7,.25,1)",fill:"backwards"});
  });
}
function updateAccountCard() {
  const name=accountName || "我的账户",role=trialMode?(isAdmin?"管理员":"个人账户"):"个人空间";
  $("user-card-name").textContent=$("user-menu-name").textContent=name;
  $("user-card-role").textContent=$("user-menu-role").textContent=role;
  $("user-avatar").textContent=accountName?Array.from(accountName).slice(0,2).join("").toUpperCase():"RU";
  $("user-menu-toggle").setAttribute("aria-label",`${name}，打开账户菜单`);
}
function closeUserMenu(){if($("user-menu").matches(":popover-open"))$("user-menu").hidePopover();}
function positionUserMenu(){
  const menu=$("user-menu");if(!menu.matches(":popover-open"))return;
  const rect=$("user-menu-toggle").getBoundingClientRect(),gap=10,pad=12,height=menu.offsetHeight;
  const top=rect.top>=height+gap+pad?rect.top-height-gap:Math.min(rect.bottom+gap,innerHeight-height-pad);
  menu.style.left=`${Math.max(pad,Math.min(rect.left,innerWidth-menu.offsetWidth-pad))}px`;
  menu.style.top=`${Math.max(pad,top)}px`;
}
$("user-menu").addEventListener("beforetoggle",event=>{
  $("user-menu-toggle").setAttribute("aria-expanded",String(event.newState==="open"));if(event.newState==="open")requestAnimationFrame(positionUserMenu);
});
$("user-menu").addEventListener("click",event=>{if(event.target.closest("button"))closeUserMenu();});
window.addEventListener("resize",positionUserMenu);document.addEventListener("scroll",positionUserMenu,true);
for(const [id,icon] of [["demo-button","演示"],["sources-button","同步"],["messages-button","消息"],["feedback-button","反馈"],["archive-button","归档"],["account-button","账户"],["logout","退出"]])$(id).prepend(navigationIcon(icon));
function renderNavigation() {
  $("categories").replaceChildren(...["全部", ...NAV_CATEGORIES].map(category => {
    const button = element("button", null, "nav-button" + (categoryFilter === category ? " active" : ""));
    button.setAttribute("aria-pressed", String(categoryFilter === category));button.title=category==="全部"?"总览":category;button.setAttribute("aria-label",button.title);
    button.append(navigationIcon(category), element("span", category === "全部" ? "总览" : category),
      element("span", String(tasks.filter(t => category==="记录"?t.category==="记录":!["课程","记录"].includes(t.category) && t.status !== "done" && (category === "全部" || t.category === category)).length), "count"));
    button.onclick = () => { if (hasDraft()) { notice("请先保存或取消正在编辑的待办事项"); return; } const changed=categoryFilter!==category;categoryFilter = category; closeAddMenu(); render();if(changed)animateView(); };
    return button;
  }));
}
function taskContent(task) {
  const content=task?.content && task.content!==task.title?task.content:"";
  return [content,task?.details?.organizer?`组织者 / 主持人：${task.details.organizer}`:""].filter(Boolean).join("\n");
}
function timeRange(task) {
  if(task.category==="记录")return formatTime(task.starts_at,true);
  const start=localInput(task.starts_at),end=localInput(task.ends_at);
  return `${formatTime(task.starts_at,start.slice(0,4)!==end.slice(0,4))} – ${start.slice(0,10)===end.slice(0,10)?end.slice(11):formatTime(task.ends_at,start.slice(0,4)!==end.slice(0,4))}`;
}
function syllabusURL(task) {
  const url=task.source_url?.includes("/student/student-choice-center/syllabus-entry-check.html#/?param=")?task.source_url:null;
  if(!url)return null;
  try{const parsed=new URL(url);return parsed.protocol==="https:" && parsed.hostname==="jw.ruc.edu.cn"?parsed.href:null;}catch{return null;}
}
function taskSourceLink(task) {
  if(task.category==="课程") {const url=syllabusURL(task);return url?externalLink("教学大纲 ↗",url):null;}
  return task.source_url?externalLink(task.source?.startsWith("ruc_")?"教务原页面 ↗":"查看原作业 ↗",task.source_url):null;
}
function card(task) {
  const article = element("article", null, "task");
  article.dataset.taskId = task.id;
  const meta = element("div", null, "task-meta");
  meta.append(element("span", task.category, `badge cat-${CATEGORIES.indexOf(task.category)}`),
    element("span", task.source ? sources.find(s => s.id === task.source)?.name || task.source : "手动添加", "source-label"));
  const title = element("h3", task.title, "task-title");
  article.append(meta, title);
  const isOverdue = task.category === "作业" && task.status !== "done" && deadline(task) && new Date(deadline(task)) < new Date();
  const time = element("div", null, "task-time" + (isOverdue ? " overdue" : ""));
  const completedHomework=task.category==="作业" && task.status==="done";
  time.append(element("p", (isOverdue ? "已逾期 · " : "") + (completedHomework ? "完成时间" : task.category === "作业" ? "截止时间" : task.category==="记录"?"时间":"起止时间"), "time-label"));
  if (task.category === "作业") time.append(element("p", formatTime(completedHomework ? task.completed_at : task.due_at, true)));
  else time.append(element("p", timeRange(task), "time-range"));
  article.append(time);
  if(task.location)article.append(element("p", `⌖ ${task.location}`, "task-location"));
  if(taskContent(task))article.append(element("p",taskContent(task),"task-content"));
  for(const [key,label] of [["teacher","教师"],["seat","座位"]])if(task.details?.[key])article.append(element("p",`${label} · ${task.details[key]}`,"event-detail"));
  if(task.details?.period)article.append(element("p",`第 ${task.details.week} 周 · ${task.details.period}`,"event-detail"));
  if(task.course)article.append(element("p",task.course,"course"));
  const footer = element("div", null, "task-footer");
  const status=element(task.category==="作业"?"select":"input",null,"task-status");
  status.setAttribute("aria-label",`任务状态：${task.title}`);
  if(task.category==="作业") {for(const [value,label] of Object.entries(STATES)) {const option=element("option",label);option.value=value;status.append(option);}status.value=task.status;}
  else {status.type="checkbox";status.checked=task.status==="done";status.setAttribute("aria-label",`${task.category==="记录"?"已完善":"已完成"}：${task.title}`);}
  status.onchange=async()=>{
    if(hasDraft()) {status.value=task.status;status.checked=task.status==="done";notice("请先保存或取消正在编辑的待办事项");return;}
    article.dataset.busy="true";
    article.querySelectorAll("button,input,select").forEach(node=>node.disabled=true);
    try {
      const updated=await api(`/api/tasks/${task.id}`,"PATCH",{status:task.category==="作业"?status.value:status.checked?"done":"todo",revision:task.revision});
      tasks=tasks.map(value=>value.id===updated.id?updated:value);lastPayload="";
      task=current=updated;
      notice(`已设为${task.category==="作业"?STATES[updated.status]:updated.status==="done"?(task.category==="记录"?"已完善":"已完成"):(task.category==="记录"?"待完善":"未完成")}`);
    } catch(error) {notice(error.message);}
    finally {
      delete article.dataset.busy;status.value=task.status;status.checked=task.status==="done";
      article.querySelectorAll("button,input,select").forEach(node=>node.disabled=false);
      if(!hasDraft()) render();await refresh();
    }
  };
  if(task.category==="作业")footer.append(status);
  else if(task.category!=="课程") {const label=element("label",null,"completion-control");label.append(status,document.createTextNode(task.category==="记录"?"已完善":"已完成"));footer.append(label);}
  const footerMain=element("div",null,"task-footer-main");footerMain.append(...footer.childNodes);const original=taskSourceLink(task);if(original)footerMain.append(original);footer.append(footerMain);
  const actions = element("div", null, "task-actions");
  const edit = element("button", "编辑", "edit-task");
  edit.type = "button";
  edit.setAttribute("aria-label", `编辑：${task.title}`);
  edit.onclick = () => openTask(task);
  const remove = element("button", "删除", "delete-task");
  remove.type = "button";
  remove.setAttribute("aria-label", `删除：${task.title}`);
  remove.onclick = () => { if (hasDraft()) { notice("请先保存或取消正在编辑的待办事项"); return; } deleting = task; $("delete-dialog").showModal(); };
  const archive=element("button","归档","archive-task");archive.type="button";archive.setAttribute("aria-label",`归档：${task.title}`);archive.onclick=()=>archiveTask(task,true);
  actions.append(edit,archive,remove); footer.append(actions);
  let current = task;
  const list = checklist(task.todos, async todos => {
    current = await api(`/api/tasks/${task.id}`, "PATCH", {todos, revision: current.revision});
    tasks = tasks.map(value => value.id === current.id ? current : value);
    task = current; lastPayload = "";
  });
  if(task.category!=="课程" || task.todos.length) article.append(list);
  if (task.attachments?.length || task.links?.length) {
    const resources=element("div", null, "resources");
    resources.append(...(task.attachments || []).map(file=>fileRow(file)));
    for (const link of task.links || []) { const row=element("div",null,"resource-row"); row.append(element("span","链接","resource-kind"),externalLink(`${link.label || new URL(link.url).hostname} ↗`,link.url)); resources.append(row); }
    article.append(resources);
  }
  article.append(footer);
  return article;
}
function render() {
  queueMicrotask(()=>document.querySelectorAll("select:not([data-enhanced])").forEach(enhanceSelect));
  renderNavigation();
  document.querySelector(".summary").hidden=false;
  document.querySelector(".summary").removeAttribute("data-schedule");
  const visible = tasks.filter(t => categoryFilter === "全部" || categoryFilter === t.category);
  $("view-title").textContent = categoryFilter === "全部" ? "总览" : categoryFilter;
  $("add-task").textContent = categoryFilter === "全部" ? "＋ 添加卡片" : `＋ 添加${categoryFilter}`;
  const taskItems=visible.filter(t=>!["课程","记录"].includes(t.category)),open = taskItems.filter(t => t.status !== "done");
  $("count-open").textContent = open.length;
  $("count-done").textContent = taskItems.length - open.length;
  const current = Date.now();
  $("count-soon").textContent = open.filter(t => deadline(t) && new Date(deadline(t)).getTime() >= current && new Date(deadline(t)).getTime() <= current + 7 * 86400000).length;
  $("count-overdue").textContent = open.filter(t => deadline(t) && new Date(deadline(t)).getTime() < current).length;
  $("board").className="board"+(categoryFilter==="全部"?" calendar-board":categoryFilter!=="作业"?" schedule-board":"");
  document.querySelectorAll(".summary>div").forEach((node,index)=>{
    node.querySelector("span").textContent=["待完成","未来 7 天到期","已逾期","已完成"][index];
    node.querySelector("small").textContent=[categoryFilter==="作业"?"按截止时间从近到远":"课程与记录不计入任务统计","未来 7 天内到期的未完成任务","到期仍未完成的任务","按完成时间倒序 · 满 7 天自动归档"][index];
  });
  $("overview-views").hidden=categoryFilter!=="全部";
  document.querySelectorAll("[data-view]").forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.view===overviewView)));
  if(categoryFilter==="全部") {overviewView==="axes"?renderAxes():renderCalendar();renderSources();return;}
  if(categoryFilter==="记录") {renderRecords(visible);renderSources();return;}
  if(categoryFilter!=="作业") {renderSchedule(visible);renderSources();return;}
  $("board").replaceChildren(...Object.entries(STATES).map(([state, label]) => {
    const column = element("section", null, `column ${state}`);
    const matching = visible.filter(t => t.status === state).sort((a,b) => state==="done"
      ? (b.completed_at || b.updated_at).localeCompare(a.completed_at || a.updated_at) || b.id.localeCompare(a.id)
      : (deadline(a) || "9999").localeCompare(deadline(b) || "9999") || a.created_at.localeCompare(b.created_at));
    const header = element("div", null, "column-heading");
    header.append(element("span", null, "line"), element("h3", label), element("span", String(matching.length), "count"));
    column.append(header);
    if (matching.length) column.append(...matching.map(card));
    else {
      const empty = element("div", null, "empty");
      empty.append(element("b", state === "done" ? "期待下一次完成" : state === "doing" ? "专注一件事" : "从一件小事开始"),
        element("p", state === "done" ? "完成的任务会留在这里" : state === "doing" ? "开始后，将任务进度设为进行中" : "记录作业或接下来的安排"));
      if (state === "todo") { const add = element("button", "＋ 添加任务"); add.onclick = () => startAdd(); empty.append(add); }
      column.append(empty);
    }
    return column;
  }));
  renderSources();
}
function shiftDay(day,amount) { return new Date(Date.parse(`${day}T00:00:00Z`)+amount*86400000).toISOString().slice(0,10); }
function monday(day) { return shiftDay(day,-((new Date(`${day}T00:00:00Z`).getUTCDay()+6)%7)); }
function shortDay(day) { return `${Number(day.slice(5,7))} 月 ${Number(day.slice(8))} 日`; }
function scheduleStats(labels,values,hints) {
  document.querySelector(".summary").dataset.schedule=categoryFilter;
  document.querySelectorAll(".summary>div").forEach((node,index)=>{
    node.querySelector("span").textContent=labels[index];node.querySelector("strong").textContent=values[index];node.querySelector("small").textContent=hints[index];
  });
}
function weekRanges(values) {
  const weeks=[...new Set(values.map(Number).filter(n=>Number.isInteger(n) && n>0))].sort((a,b)=>a-b),ranges=[];
  for(let i=0;i<weeks.length;i++) {const first=weeks[i];while(weeks[i+1]===weeks[i]+1)i++;ranges.push(first===weeks[i]?`${first}`:`${first}–${weeks[i]}`);}
  return ranges.join("、");
}
function renderTimetable(courses) {
  const root=$("board"),terms=new Map(timetables.map(table=>[table.semester,table.label]));
  for(const task of courses)if(!terms.has(task.details?.semester || "manual"))terms.set(task.details?.semester || "manual",task.details?.semester_label || task.details?.semester || "手动课程");
  const choices=[...terms.entries()].sort((a,b)=>b[1].localeCompare(a[1],"zh-CN",{numeric:true}));
  if(!terms.has(courseSemester))courseSemester=choices[0]?.[0] || "manual";
  const table=timetables.find(t=>t.semester===courseSemester),matching=courses.filter(t=>(t.details?.semester || "manual")===courseSemester);
  const weekOf=task=>String(table?.days.find(day=>day.date===localInput(task.starts_at).slice(0,10))?.week || (!table && task.details?.week) || `date:${monday(localInput(task.starts_at).slice(0,10))}`);
  const weeks=[...new Set([...(table?.days || []).map(day=>String(day.week)),...matching.map(weekOf)])].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  if(courseWeek!=="all" && !weeks.includes(courseWeek))courseWeek="all";
  const panel=element("section",null,"timetable-panel"),toolbar=element("div",null,"timetable-toolbar"),controls=element("div",null,"timetable-controls");
  const semester=element("select"),week=element("select");semester.id="course-semester";week.id="course-week";semester.setAttribute("aria-label","选择学期");week.setAttribute("aria-label","选择周次");
  for(const [value,label] of choices){const option=element("option",label);option.value=value;semester.append(option);}semester.value=courseSemester;semester.disabled=!choices.length;
  const all=element("option","全部周次");all.value="all";week.append(all);
  for(const value of weeks){const option=element("option",value.startsWith("date:")?`${shortDay(value.slice(5))}起的一周`:`第 ${value} 周`);option.value=value;week.append(option);}week.value=courseWeek;
  semester.onchange=()=>{courseSemester=semester.value;courseWeek="all";render();};week.onchange=()=>{courseWeek=week.value;render();};
  controls.append(semester,week);toolbar.append(element("h2","个人课表"),controls);panel.append(toolbar);root.replaceChildren(panel);
  const visible=matching.filter(task=>courseWeek==="all" || weekOf(task)===courseWeek);
  const slots=new Map((table?.slots || []).map(slot=>[`${slot.start}-${slot.end}`,slot]));
  for(const task of matching) {
    const start=localInput(task.starts_at).slice(11),end=localInput(task.ends_at).slice(11);
    if(![...slots.values()].some(slot=>start<slot.end && end>slot.start))slots.set(`${start}-${end}`,{start,end,period:task.details?.period || "",label:""});
  }
  const ordered=[...slots.values()].sort((a,b)=>a.start.localeCompare(b.start));
  if(!ordered.length) {panel.append(element("p","尚未导入课表，请在“来源与同步”同步课表与考试。","day-empty"));return;}
  const groups=new Map();
  for(const task of visible) {
    const weekday=new Date(`${localInput(task.starts_at).slice(0,10)}T00:00:00Z`).getUTCDay() || 7,start=localInput(task.starts_at).slice(11),end=localInput(task.ends_at).slice(11);
    const key=JSON.stringify([task.title,task.location,task.details?.teacher,task.details?.assistant,task.details?.campus,weekday,start,end,task.details?.period]);
    if(!groups.has(key))groups.set(key,{weekday,start,end,items:[]});groups.get(key).items.push(task);
  }
  const scroll=element("div",null,"timetable-scroll"),grid=element("table",null,"timetable"),head=element("thead"),headRow=element("tr"),body=element("tbody");
  scroll.tabIndex=0;scroll.setAttribute("aria-label","课程表，可左右滚动查看周一至周日");grid.setAttribute("aria-label","每周课程表");
  const corner=element("th","节次 / 时间");corner.scope="col";headRow.append(corner);
  for(let day=1;day<=7;day++) {
    const th=element("th",`周${"一二三四五六日"[day-1]}`);th.scope="col";
    const date=table?.days.find(entry=>String(entry.week)===courseWeek && entry.weekday===day)?.date;
    if(date)th.append(element("small",`${Number(date.slice(5,7))}/${Number(date.slice(8))}`));headRow.append(th);
  }
  head.append(headRow);grid.append(head);
  ordered.forEach((slot,index)=>{
    const tr=element("tr"),label=element("th");label.scope="row";
    label.append(element("span",slot.label || `第 ${index+1} 大节`));
    if(slot.period)label.append(element("small",`${slot.period.replace(/节$/,"").replace(/\b0(?=\d)/g,"")}节`));label.append(element("small",`${slot.start}–${slot.end}`));tr.append(label);
    for(let day=1;day<=7;day++) {
      const cell=element("td");cell.dataset.weekday=String(day);cell.dataset.start=slot.start;
      for(const group of groups.values()) {
        if(group.weekday!==day || group.start>=slot.end || group.end<=slot.start)continue;
        const task=group.items[0],color=[...task.title].reduce((n,ch)=>(n*31+ch.codePointAt(0))>>>0,0)%6,block=element("div",null,`course-block course-color-${color}`);
        const title=element("h3",task.title);title.title=task.title;block.append(title);
        for(const [key,name] of [["teacher","教师"],["assistant","助教"],["campus","校区"]])if(task.details?.[key])block.append(element("p",`${name}：${task.details[key]}`));
        if(task.location)block.append(element("p",`地点：${task.location}`));
        const range=weekRanges(group.items.map(weekOf));block.append(element("p",range?`周次：${range}周`:`日期：${group.items.map(t=>shortDay(localInput(t.starts_at).slice(0,10))).join("、")}`,"course-weeks"));
        const url=syllabusURL(task);
        if(url){const view=externalLink("查看教学大纲 ↗",url);view.className="course-view";view.setAttribute("aria-label",`查看教学大纲：${task.title}`);block.append(view);}
        else block.append(element("span","尚无教学大纲链接","course-view muted"));
        cell.append(block);
      }
      tr.append(cell);
    }
    body.append(tr);
  });
  grid.append(body);scroll.append(grid);panel.append(scroll,element("p","左右滑动查看完整课表 · 点击“查看教学大纲”进入教务系统","timetable-hint"));
}
function renderSchedule(visible) {
  const root=$("board"),today=localInput(new Date()).slice(0,10),now=Date.now();
  const sorted=[...visible].sort((a,b)=>(a.starts_at || "9999").localeCompare(b.starts_at || "9999") || a.id.localeCompare(b.id));
  root.replaceChildren();
  if(categoryFilter==="课程") {renderTimetable(sorted);return;}
  const pending=sorted.filter(t=>t.status!=="done"),done=sorted.filter(t=>t.status==="done").sort((a,b)=>(b.completed_at || "").localeCompare(a.completed_at || ""));
  scheduleStats(["未完成","未来 7 天","今天","已完成"],
    [pending.length,pending.filter(t=>Date.parse(t.starts_at)>=now && Date.parse(t.starts_at)<=now+7*86400000).length,pending.filter(t=>onCalendarDay(t,today)).length,done.length],
    ["按开始时间从近到远","未来一周开始的安排","全部时间均为北京时间","按完成时间倒序 · 满 7 天自动归档"]);
  const columns=element("div",null,"schedule-columns");
  for(const [label,items,state] of [["未完成",pending,"todo"],["已完成",done,"done"]]) {
    const column=element("section",null,`column ${state}`),heading=element("h2",label);
    heading.append(element("span",String(items.length),"count"));column.append(heading);
    const list=element("div",null,`schedule-list ${categoryFilter==="考试"?"exam-group":categoryFilter==="会议"?"meeting-group":"activity-group"}`);
    list.append(...items.map(card));if(!items.length)list.append(element("p",`暂无${label}的${categoryFilter}`,"day-empty"));column.append(list);columns.append(column);
  }
  root.append(columns);
}
function calendarDates(task) {
  if(task.category==="作业") {
    const day=localInput(task.due_at).slice(0,10);
    return [day,day];
  }
  return [localInput(task.starts_at || task.ends_at).slice(0,10),localInput(task.ends_at || task.starts_at).slice(0,10)];
}
function onCalendarDay(task,day) {
  if(task.category==="作业" && task.status==="done") return false;
  const [start,end]=calendarDates(task);
  return day ? !!start && start<=day && day<=end : !start;
}
function calendarSelect(day) {
  if(hasDraft()) {notice("请先保存或取消正在编辑的待办事项");return;}
  selectedDay=day;if(day)calendarMonth=day.slice(0,7);renderCalendar();
}
function renderCalendar() {
  const root=$("board"), calendar=element("section",null,"calendar"),toolbar=element("div",null,"calendar-toolbar");
  const [year,month]=calendarMonth.split("-").map(Number);
  const previous=element("button","‹","secondary"),next=element("button","›","secondary"),today=element("button","今天","secondary");
  previous.setAttribute("aria-label","上个月");next.setAttribute("aria-label","下个月");
  function moveMonth(offset) {
    if(hasDraft()) {notice("请先保存或取消正在编辑的待办事项");return;}
    calendarMonth=new Date(Date.UTC(year,month-1+offset,1)).toISOString().slice(0,7);
    selectedDay=`${calendarMonth}-01`;renderCalendar();
    $("board").querySelector(offset<0?'[aria-label="上个月"]':'[aria-label="下个月"]').focus();
  }
  previous.onclick=()=>moveMonth(-1);next.onclick=()=>moveMonth(1);today.onclick=()=>calendarSelect(localInput(new Date()).slice(0,10));
  const controls=element("div",null,"calendar-controls");controls.append(previous,today,next);
  toolbar.append(element("h2",`${year} 年 ${month} 月`),controls);calendar.append(toolbar);
  const grid=element("div",null,"calendar-grid");grid.setAttribute("aria-label",`${year}年${month}月`);
  for(const name of ["一","二","三","四","五","六","日"]) grid.append(element("span",name,"calendar-weekday"));
  const first=new Date(Date.UTC(year,month-1,1)),offset=(first.getUTCDay()+6)%7;
  const days=new Date(Date.UTC(year,month,0)).getUTCDate(),cells=Math.ceil((offset+days)/7)*7;
  const todayKey=localInput(new Date()).slice(0,10);
  for(let i=0;i<cells;i++) {
    const date=new Date(Date.UTC(year,month-1,1-offset+i)),key=date.toISOString().slice(0,10);
    const matching=tasks.filter(task=>onCalendarDay(task,key)).sort((a,b)=>(deadline(a)||"9999").localeCompare(deadline(b)||"9999") || a.id.localeCompare(b.id));
    const day=element("button",null,"calendar-day"+(key.slice(0,7)!==calendarMonth?" outside":"")+(key===selectedDay?" selected":""));
    day.dataset.date=key;day.setAttribute("aria-label",`${key}，${matching.length} 项安排`);
    day.setAttribute("aria-pressed",String(key===selectedDay));day.setAttribute("aria-controls","day-list");
    if(key===todayKey) day.setAttribute("aria-current","date");
    day.append(element("span",String(date.getUTCDate()),"day-number"));
    for(const task of matching.slice(0,2)) {
      const title=element("span",task.title,`day-task cat-${CATEGORIES.indexOf(task.category)}`+(task.status==="done"?" is-done":""));title.title=task.title;day.append(title);
    }
    if(matching.length>2)day.append(element("span",`+${matching.length-2} 项`,"day-more"));
    day.onclick=()=>{
      calendarSelect(key);$("board").querySelector(`[data-date="${key}"]`)?.focus({preventScroll:true});
    };
    day.onkeydown=event=>{
      const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[event.key];if(!delta)return;
      event.preventDefault();const target=new Date(date.getTime()+delta*86400000).toISOString().slice(0,10);calendarSelect(target);$("board").querySelector(`[data-date="${target}"]`)?.focus();
    };
    grid.append(day);
  }
  calendar.append(grid);
  const undated=tasks.filter(task=>onCalendarDay(task,""));
  if(undated.length) {const button=element("button",`未定日期 · ${undated.length} 项`,"undated-button secondary");button.setAttribute("aria-pressed",String(selectedDay===""));button.onclick=()=>calendarSelect("");calendar.append(button);}
  const agenda=element("section",null,"day-agenda"),list=element("div",null,"day-list");list.id="day-list";
  const matching=tasks.filter(task=>onCalendarDay(task,selectedDay)).sort((a,b)=>a.status==="done" && b.status==="done"
    ? (b.completed_at||b.updated_at).localeCompare(a.completed_at||a.updated_at)
    : (a.status==="done")-(b.status==="done") || (deadline(a)||"9999").localeCompare(deadline(b)||"9999"));
  agenda.append(element("h2",`${selectedDay ? `${Number(selectedDay.slice(5,7))} 月 ${Number(selectedDay.slice(8))} 日` : "未定日期"} · ${matching.length} 项安排`));
  if(matching.length)list.append(...matching.map(card));else list.append(element("p","这一天没有安排。","day-empty"));
  agenda.append(list);root.replaceChildren(calendar,agenda);
}
function renderArchive() {
  $("archive-categories").replaceChildren(...["全部",...CATEGORIES].map(category=>{
    const button=element("button",category,"archive-tab"+(category===archiveCategory?" active":""));
    button.setAttribute("aria-pressed",String(category===archiveCategory));
    button.onclick=()=>{archiveCategory=category;loadArchive();};return button;
  }));
  $("archive-list").replaceChildren(...archiveItems.map(task=>{
    const row=element("div",null,"archive-row"),info=element("div",null,"archive-info");
    info.append(element("h3",task.title));
    info.append(element("p",task.category==="作业" ? `截止时间 · ${formatTime(task.due_at,true)}` : `${formatTime(task.starts_at,true)} 至 ${formatTime(task.ends_at,true)}`,"muted"));
    const actions=element("div",null,"task-actions"),view=element("button","查看","edit-task"),remove=element("button","删除","delete-task");
    view.setAttribute("aria-label",`查看归档：${task.title}`);
    view.onclick=async()=>{view.disabled=true;try{showArchiveDetail(await api(`/api/tasks/${task.id}`));}catch(error){$("archive-error").textContent=error.message;}finally{view.disabled=false;}};
    remove.setAttribute("aria-label",`删除归档：${task.title}`);remove.onclick=()=>{deleting=task;$("delete-dialog").showModal();};
    const restore=element("button","恢复","text-button");restore.setAttribute("aria-label",`恢复归档：${task.title}`);restore.onclick=()=>archiveTask(task,false);actions.append(view,restore,remove);row.append(info,actions);return row;
  }));
  if(!archiveItems.length) $("archive-list").append(element("p","此板块暂无归档任务。","archive-empty"));
  $("archive-more").hidden=archiveItems.length>=archiveTotal;
}
async function loadArchive(more=false) {
  const sequence=++archiveSequence;$("archive-error").textContent="";$("archive-more").disabled=true;
  try {
    const data=await api(`/api/archive?${new URLSearchParams({category:archiveCategory,offset:more?archiveItems.length:0})}`);
    if(sequence!==archiveSequence) return;
    archiveItems=more?[...archiveItems,...data.tasks]:data.tasks;archiveTotal=data.total;renderArchive();
  }catch(error){$("archive-error").textContent=error.message;}
  finally{if(sequence===archiveSequence) $("archive-more").disabled=false;}
}
function showArchiveDetail(task) {
  const root=$("archive-detail");root.replaceChildren(element("span",task.category,`badge cat-${CATEGORIES.indexOf(task.category)}`),element("h3",task.title,"archive-title"));
  root.append(element("p",task.category==="作业"?`原截止时间 · ${formatTime(task.due_at,true)}`:`起止时间 · ${timeRange(task)}`,"task-time"));
  if(task.location)root.append(element("p",`地点 · ${task.location}`,"task-location"));
  if(taskContent(task))root.append(element("p",taskContent(task),"task-content"));
  if(task.course)root.append(element("p",task.course,"course"));
  for(const [key,label] of [["teacher","教师"],["week","教学周"],["period","节次"],["seat","座位"]])if(task.details?.[key])root.append(element("p",`${label} · ${task.details[key]}`,"event-detail"));
  if(task.completed_at)root.append(element("p",`完成时间 · ${formatTime(task.completed_at,true)}`,"task-time"));
  root.append(element("p",`归档时间 · ${formatTime(task.archived_at,true)}`,"task-time"));
  if(task.todos.length) {const list=element("ul",null,"archive-todos");for(const todo of task.todos) list.append(element("li",`${todo.done?"☑":"☐"} ${todo.text}`));root.append(list);}
  const resources=element("div",null,"resources");resources.append(...task.attachments.map(file=>fileRow(file)));
  for(const link of task.links) {const row=element("div",null,"resource-row");row.append(externalLink(`${link.label || new URL(link.url).hostname} ↗`,link.url));resources.append(row);}
  root.append(resources);const original=taskSourceLink(task);if(original)root.append(original);
  $("archive-detail-dialog").showModal();
}
$("archive-button").onclick=()=>{$("archive-dialog").showModal();loadArchive();};
$("archive-more").onclick=()=>loadArchive(true);
const collectorRequests=new Map();
window.addEventListener("message",event=>{
  if(event.source!==window || event.origin!==location.origin || event.data?.kind!=="campus-board-reply") return;
  const pending=collectorRequests.get(event.data.id);if(!pending) return;
  clearTimeout(pending.timer);collectorRequests.delete(event.data.id);
  if(event.data.result?.error) pending.reject(new Error(event.data.result.error));else pending.resolve(event.data.result);
});
function collectorCommand(command,extra={},timeout=18000) {
  return new Promise((resolve,reject)=>{
    const id=crypto.randomUUID(),timer=setTimeout(()=>{collectorRequests.delete(id);reject(new Error("此浏览器未连接新版扩展。请在浏览器重新加载扩展，再刷新看板；手机端可查看电脑同步的结果。"));},timeout);
    collectorRequests.set(id,{resolve,reject,timer});window.postMessage({kind:"campus-board-command",id,command,account:boardAccount,...extra},location.origin);
  });
}
function saveSyncProgress(){
  if($("demo-dialog").open)return;
  try{localStorage.setItem(`rucapture-sync-guide:${boardAccount}`,JSON.stringify({version:syncGuideVersion,step:syncStep,visited:syncVisited,executed:syncExecuted}));}catch{}
}
function loadSyncProgress(){
  syncStep=syncVisited=1;syncExecuted=false;
  try{const saved=JSON.parse(localStorage.getItem(`rucapture-sync-guide:${boardAccount}`));
    if(saved?.version===syncGuideVersion && Number.isInteger(saved.step) && saved.step>=1 && saved.step<=5 && Number.isInteger(saved.visited) && saved.visited>=saved.step && saved.visited<=5){syncStep=saved.step;syncVisited=saved.visited;syncExecuted=saved.executed===true;}
  }catch{}
}
function syncStepStates(){
  return [!!collectorState && (collectorState.version || "0").localeCompare("1.9.3",undefined,{numeric:true})>=0,!!collectorState?.connected,!!sourceLinksState?.length,!!cloudState?.enabled,syncExecuted];
}
function updateSyncSteps(){
  const states=syncStepStates();
  // Old website/cloud settings do not complete steps the user has not reached in this version.
  document.querySelectorAll("#sync-progress li").forEach((point,i)=>{const done=i<syncVisited && states[i] && (i===4 || states[0]);point.classList.toggle("complete",done);if(syncStep===i+1)point.setAttribute("aria-current","step");else point.removeAttribute("aria-current");point.setAttribute("aria-label",`第 ${i+1} 步：${point.lastElementChild.textContent}，${done?"已完成":"未完成"}`);});
  $("sync-prev").disabled=syncStep===1;
  $("sync-next").textContent=syncStep===5?"完成":syncStep===4 && !states[3]?"暂不开启，继续":"下一步";
  $("sync-next").disabled=syncing || syncStep!==4 && !states[syncStep-1];
}
function setSyncStep(step){
  syncStep=step;
  if(!$("demo-dialog").open){syncVisited=Math.max(syncVisited,step);saveSyncProgress();}
  document.querySelectorAll("#sources-dialog .guide-step").forEach(panel=>panel.hidden=Number(panel.dataset.step)!==step);
  updateSyncSteps();
  if(step===4 && $("sources-dialog").open)ensureCloudPanel();
}
$("sync-prev").onclick=()=>setSyncStep(Math.max(1,syncStep-1));
$("sync-existing").onclick=()=>setSyncStep(5);
$("sync-next").onclick=()=>{if($("sync-next").disabled)return;if(syncStep===5){$("sources-dialog").close();return;}setSyncStep(syncStep+1);};
async function ensureCloudPanel(){
  if(cloudPanelLoading || !collectorState?.connected || !cloudState?.available || !syncStepStates()[0])return;
  if(document.querySelector("#cloud-panel iframe"))return;
  const session=syncSession;cloudPanelLoading=true;
  try{
    const result=await collectorCommand("cloud-panel");if(session!==syncSession)return;
    const url=new URL(result.url);
    if(!/^chrome-extension:\/\/[a-p]{32}\/cloud-panel\.html\?/.test(url.href))throw new Error("请重新加载扩展，再刷新本网页。");
    const frame=element("iframe");frame.title="云端同步";frame.src=url.href;$("cloud-panel").replaceChildren(frame);$("cloud-authorize").hidden=true;
  }catch(error){if(session===syncSession){$("source-error").textContent=error.message;$("cloud-authorize").hidden=false;}}
  finally{if(session===syncSession)cloudPanelLoading=false;}
}
window.addEventListener("message",async event=>{
  const frame=document.querySelector("#cloud-panel iframe");
  if(!frame || event.source!==frame.contentWindow || event.origin!==frame.src.split("/").slice(0,3).join("/"))return;
  if(event.data?.kind==="rucapture-cloud-size"){if(Number.isFinite(event.data.height))$("cloud-panel").style.setProperty("--cloud-height",`${Math.max(140,Math.min(360,event.data.height))}px`);return;}
  if(event.data?.kind!=="rucapture-cloud-enabled")return;
  const session=syncSession;await checkCloud();if(session!==syncSession)return;
  if(cloudState?.enabled)notice("云端同步已开启，点击“下一步”继续。");
});
function updateSyncControls() {
  const connected=!!collectorState?.connected;
  $("collector-controls").hidden=!collectorState || connected;
  $("install-state").textContent=collectorState?`已安装 v${collectorState.version} · ${syncStepStates()[0]?"已是最新版本":"请更新至 v1.9.3"}`:"仅需在电脑上安装一次";
  $("collector-options").disabled=!collectorState;
  $("sync-existing").hidden=!!collectorState || !cloudState?.enabled;
  $("browser-settings").hidden=!connected;
  $("collector-scan").disabled=syncing || !(cloudState?.enabled || (connected && collectorState.enabled));
  $("collector-scan").textContent=syncing?"正在同步…":"一键同步";
  $("cloud-authorize").disabled=!connected || !cloudState?.available;
  $("cloud-authorize").textContent=syncStepStates()[0]?"载入云端同步":"先更新扩展至 v1.9.3";
  if(!connected){$("cloud-panel").replaceChildren();$("cloud-authorize").hidden=false;}
  $("cloud-revoke").hidden=!cloudState?.enabled;
  $("cloud-revoke").disabled=syncing || !cloudState?.enabled;
  updateSyncSteps();if(syncStep===4 && $("sources-dialog").open)ensureCloudPanel();
}
async function checkCollector() {
  const session=syncSession,sequence=++collectorCheckSequence;
  try {
    const result=await collectorCommand("status",{},1800);
    if(session!==syncSession || sequence!==collectorCheckSequence)return;
    const previousVersion=collectorState?.version;collectorState=result;
    if(!syncStepStates()[0] && previousVersion!==result.version){syncVisited=1;syncExecuted=false;saveSyncProgress();}
    $("collector-state").textContent=collectorState.connected?`浏览器扩展已连接 · v${collectorState.version}${collectorState.enabled?"":" · 浏览器导入已暂停"}`:"已检测到扩展，点击下方按钮连接。";
    $("collector-enabled").checked=collectorState.enabled;
  }catch {
    if(session!==syncSession || sequence!==collectorCheckSequence)return;
    collectorState=null;
    $("collector-state").textContent="此浏览器未连接扩展。手机可直接查看已同步的任务。";
  }
  updateSyncControls();renderSources();
}
function websiteName(link) {return link.source==="ruc_courses"?"微人大 · 课表与考试":link.name;}
async function setupGeneric(link) {
  if(!collectorState?.connected)throw new Error("请先完成第 2 步连接扩展，再点击此网站的识别设置。");
  requireSelectiveSync(link.source);
  await collectorCommand("generic-setup",{url:link.url});
  notice("已打开识别设置，请允许读取网站并在原页面确认预览。");
}
function renderWebsiteLinks() {
  $("website-list").replaceChildren(...(sourceLinksState || []).map((link,index)=>{
    const row=element("div",null,link.generic?"website-row generic":"website-row"),text=element("div");
    text.append(element("strong",websiteName(link)),externalLink(link.url,link.url));
    const edit=element("button","编辑","text-button"),remove=element("button","移除","text-button");
    edit.type=remove.type="button";edit.disabled=remove.disabled=websiteBusy;
    edit.setAttribute("aria-label",`编辑网站：${websiteName(link)}`);remove.setAttribute("aria-label",`移除网站：${websiteName(link)}`);
    edit.onclick=()=>openWebsiteInput(index);remove.onclick=()=>{if(confirm(`移除网站“${websiteName(link)}”？将停止同步此网站，已导入的卡片会保留。`))saveWebsiteLinks(sourceLinksState.filter((_,i)=>i!==index).map(link=>link.url));};
    row.append(text);
    if(link.generic){const setup=element("button","识别设置","secondary");setup.type="button";setup.setAttribute("aria-label",`识别设置：${link.name}`);setup.onclick=()=>setupGeneric(link).catch(error=>{$("source-error").textContent=error.message;});row.append(setup);}
    row.append(edit,remove);return row;
  }));
}
function openWebsiteInput(index=-1) {editingWebsite=index;$("source-url").value=index<0?"":sourceLinksState[index].url;$("source-links-form").hidden=false;$("add-source-link").hidden=true;$("source-url").focus();}
function closeWebsiteInput() {editingWebsite=-1;$("source-url").value="";$("source-links-form").hidden=true;$("add-source-link").hidden=false;}
async function loadSourceLinks() {
  const session=syncSession;
  try {const data=await api("/api/source-links");if(session!==syncSession)return;sourceLinksState=data.links;renderWebsiteLinks();renderSources();updateSyncSteps();}
  catch(error){if(session===syncSession)$("source-links-result").textContent=error.message;}
}
async function saveWebsiteLinks(urls,submitted=null) {
  if(websiteBusy)return;websiteBusy=true;$("save-source-link").disabled=true;renderWebsiteLinks();
  try {
    const data=await api("/api/source-links","PUT",{urls});sourceLinksState=data.links;closeWebsiteInput();renderSources();
    const added=submitted?data.links.find(link=>link.url===new URL(submitted).href):null;
    $("source-links-result").textContent=added?.generic?"链接已保存，首次请打开识别设置并确认预览。":"网站配置已保存。";
    if(added?.generic){await refresh();if(collectorState?.connected){try{await setupGeneric(added);}catch(error){$("source-links-result").textContent=error.message;}}return;}
    if(added?.source && collectorState?.connected && collectorState.enabled) {
      try {requireSelectiveSync(added.source);await collectorCommand(added.source==="ruc_courses"?"academic-scan":"scan",{source:added.source});$("source-links-result").textContent="已配置，正在读取网站内容。";}
      catch(error){$("source-links-result").textContent=`已保存，可点击一键同步重试：${error.message}`;}
    }
  }catch(error){$("source-links-result").textContent=error.message;}
  finally{websiteBusy=false;$("save-source-link").disabled=false;renderWebsiteLinks();updateSyncSteps();}
}
$("add-source-link").onclick=()=>openWebsiteInput();$("cancel-source-link").onclick=closeWebsiteInput;
$("source-links-form").onsubmit=event=>{
  event.preventDefault();const url=$("source-url").value.trim(),urls=(sourceLinksState || []).map(link=>link.url);
  if(editingWebsite>=0)urls[editingWebsite]=url;else urls.push(url);
  saveWebsiteLinks(urls,url);
};
$("collector-recheck").onclick=async()=>{
  await checkCollector();
  if(collectorState){if(syncStepStates()[0])notice("已检测到新版扩展，点击“下一步”继续。");}
  else {sessionStorage.setItem("resume-setup","1");location.reload();}
};
$("copy-extension-page").onclick=async()=>{const url=/Edg\//.test(navigator.userAgent)?"edge://extensions":"chrome://extensions";try{await navigator.clipboard.writeText(url);notice("已复制，请粘贴到浏览器地址栏打开");}catch{notice(`请复制 ${url} 到浏览器地址栏`);}};
$("collector-connect").onclick=async()=>{
  $("collector-connect").disabled=true;$("source-error").textContent="";
  try {
    await collectorCommand("status",{},1800);
    const {token}=await api("/api/collector-token","POST",{});
    await collectorCommand("pair",{token});await checkCollector();
    notice("已连接，点击“下一步”添加网站。");
  }catch(error){$("source-error").textContent=error.message;}finally{$("collector-connect").disabled=false;}
};
function requireSelectiveSync(source) {
  const generic=source?.startsWith("web:") || !source && sourceLinksState?.some(link=>link.generic);
  const modern=["yoj","weilai","tuoj"].includes(source) || !source && sourceLinksState?.some(link=>["yoj","weilai","tuoj"].includes(link.source));
  const zhifz=source==="zhifz" || !source && sourceLinksState?.some(link=>link.source==="zhifz"),version=generic?"1.9.0":modern?"1.8.0":zhifz?"1.7.0":"1.6.0";
  if((collectorState?.version || "0").localeCompare(version,undefined,{numeric:true})<0) {
    setSyncStep(1);
    throw new Error(`${modern?"此网站":zhifz?"智夫子":"单独"}同步需要扩展 v${version}，请按第 1 步替换文件、重新加载，再刷新看板。`);
  }
}
async function syncSources(source) {
  if(syncing)return;
  const session=syncSession,markExecuted=()=>{if(session!==syncSession)return;syncExecuted=true;syncVisited=Math.max(syncVisited,syncStep);saveSyncProgress();updateSyncSteps();};
  syncing=true;updateSyncControls();renderSources();$("source-error").textContent="";
  try {
    const jobs=[],cloudEligible=!source || !source.startsWith("web:") && !source.startsWith("ruc_") && !sources.find(item=>item.id===source)?.browser_only;
    if(collectorState?.connected && collectorState.enabled && (source || sourceLinksState?.some(link=>link.generic || ["zhifz","yoj","weilai","tuoj"].includes(link.source))))requireSelectiveSync(source);
    if(cloudState?.enabled && cloudEligible)jobs.push(api("/api/cloud/run","POST",source?{source}:{},60000).then(result=>{
      if(result.running)throw new Error("云端正在同步，请稍后再试");
      markExecuted();
      const errors=Object.values(result).filter(item=>item?.error).map(item=>item.error);if(errors.length)throw new Error(errors.join("；"));
    }));
    if(collectorState?.connected && collectorState.enabled && sourceLinksState?.some(link=>link.source))jobs.push(collectorCommand("scan",source?{source}:{}).then(markExecuted));
    if(!jobs.length)throw new Error(source?.startsWith("ruc_")?"教务同步需要在电脑浏览器连接扩展并开启浏览器导入。":"请先连接扩展并添加需要同步的网站。");
    const results=await Promise.allSettled(jobs),errors=results.filter(r=>r.status==="rejected").map(r=>r.reason.message);
    await refresh();await checkCloud();
    if(errors.length)$("source-error").textContent=errors.join("；");
    else notice(source?"已开始同步此来源，读取结果会显示在下方。":"已开始同步全部可用来源，读取结果会显示在下方。");
  }catch(error){$("source-error").textContent=error.message;}
  finally{syncing=false;updateSyncControls();renderSources();}
}
$("collector-scan").onclick=()=>syncSources();
$("collector-enabled").onchange=async()=>{
  const enabled=$("collector-enabled").checked;$("collector-enabled").disabled=true;
  try{await collectorCommand("configure",{enabled});await checkCollector();}
  catch(error){$("source-error").textContent=error.message;$("collector-enabled").checked=!enabled;}
  finally{$("collector-enabled").disabled=false;}
};
$("collector-options").onclick=()=>collectorCommand("options").catch(error=>{$("source-error").textContent=error.message;});
$("cloud-authorize").onclick=()=>{
  if(!syncStepStates()[0]){setSyncStep(1);return;}ensureCloudPanel();
};
async function checkCloud() {
  const session=syncSession,sequence=++cloudCheckSequence;lastCloudCheck=Date.now();
  try {
    const data=await api("/api/cloud");
    if(session!==syncSession || sequence!==cloudCheckSequence)return;
    if(sourceLinksState===null)await loadSourceLinks();
    if(session!==syncSession || sequence!==cloudCheckSequence)return;
    cloudState=data;
    $("cloud-status").textContent=cloudState.enabled?`云端自动同步已开启 · 每 ${cloudState.interval_minutes || (trialMode?30:15)} 分钟`:"浏览器自动同步 · 每 15 分钟";
    $("cloud-grant-state").textContent=!cloudState.available?"暂不可用，可跳过此步":cloudState.enabled?`已开启 · 每 ${cloudState.interval_minutes || (trialMode?30:15)} 分钟更新`:"尚未开启";
    $("sync-mode-note").textContent="登录过期的网站，可点击下方“重新登录”。";
    updateSyncControls();renderSources();maybeLoginReminder();
  }catch(error){if(session!==syncSession || sequence!==cloudCheckSequence)return;$("cloud-status").textContent=error.message;$("cloud-grant-state").textContent="暂时无法读取授权状态，请重新打开此清单重试。";}
}
function needsLogin(source) {
  const state=cloudState?.sources?.[source.id];
  return /(?:登录|登陆)(?:已)?(?:失效|过期)/.test(source.error || "") || !!(cloudState?.enabled && (state?.error_code==="auth_expired" || state?.auth_expired_at));
}
function sourceURL(source) {return sourceLinksState?.find(link=>link.source===source.id)?.url || source.url;}
function loginLink(source) {
  const link=externalLink("重新登录 ↗",sourceURL(source));link.className="secondary source-login";
  link.setAttribute("aria-label",`重新登录：${source.name}`);return link;
}
function maybeLoginReminder() { if(typeof maybeMessageBoard==="function")maybeMessageBoard(); }
$("expired-open-sources").onclick=()=>{$("login-expired-dialog").close();$("sources-button").click();setSyncStep(5);};
document.querySelectorAll("dialog").forEach(dialog=>dialog.addEventListener("close",()=>queueMicrotask(maybeLoginReminder)));
$("cloud-revoke").onclick=async()=>{
  if(!confirm("关闭云端同步？保存的网站登录状态会删除，已导入的卡片会保留。"))return;
  try{await api("/api/cloud","DELETE");$("cloud-panel").replaceChildren();$("cloud-authorize").hidden=false;await checkCloud();}catch(error){$("source-error").textContent=error.message;}
};
function renderSources() {
  updateSyncSteps();
  const selected=new Set((sourceLinksState || []).map(link=>link.source));
  if(selected.has("ruc_courses"))selected.add("ruc_exams");
  $("unsupported-links").replaceChildren();
  $("sources-list").replaceChildren(...sources.filter(source=>sourceLinksState===null || selected.has(source.id)).map(source=>{
    const row=element("div",null,"source-row"),header=element("div");
    const academic=source.kind==="academic",browserOnly=academic || source.browser_only;
    const cloud=!browserOnly && cloudState?.enabled?cloudState.sources?.[source.id]:null;
    const local=collectorState?.sourceResults?.[source.id];
    const seen=cloud?.last_success || source.last_seen;
    const fresh=seen && Date.now()-Date.parse(seen)<30*60000;
    const error=cloud?.authorized ? cloud.error : (local?.error && (!seen || Date.parse(local.time)>Date.parse(seen)) ? local.error:source.error);
    const incomplete=!academic && (cloud?.last_success ? cloud.status_count<cloud.count : source.imported_count>source.status_count);
    const expired=needsLogin(source);
    const label=expired?"登录过期":error?"需处理":incomplete?"状态不完整":fresh?"已同步":seen?"等待更新":"待连接";
    header.append(expired?element("strong",source.name):externalLink(`${source.name} ↗`,sourceURL(source)),element("span",label,"state"+(fresh && !error && !incomplete?" connected":"")));
    const sync=element("button","同步","secondary source-sync");sync.type="button";sync.setAttribute("aria-label",`同步：${source.name}`);
    sync.disabled=syncing || !(collectorState?.connected && collectorState.enabled || !browserOnly && cloudState?.enabled && cloud?.authorized);
    sync.onclick=()=>syncSources(source.id);
    if(expired){const actions=element("div",null,"source-actions");actions.append(loginLink(source),sync);header.append(actions);}else header.append(sync);
    row.append(header);
    const total=cloud?.last_success?cloud.count:source.task_count;
    row.append(element("p",expired?"重新登录后，点击此网站的“同步”。仍未恢复时，回第 4 步更新。":error || (seen?`${formatTime(seen)} · ${total} 项${academic?"日程":"作业"}${incomplete?" · 部分完成状态未识别":""}`:cloud?.authorized?"已连接云端，等待同步":"等待首次同步")));
    if(source.generic)row.append(element("p","通过浏览器同步；识别结果可在第 3 步调整。","hint"));
    else if(source.browser_only)row.append(element("p","此网站通过电脑浏览器同步。","hint"));
    if(!browserOnly && cloudState?.enabled && !cloud?.authorized)row.append(element("p","尚未开启此网站的云端同步，可回第 4 步更新。","hint"));
    return row;
  }));
}
async function refresh() {
  if (hasDraft() || document.querySelector(".checklist[data-busy]")) return;
  const sequence = ++refreshSequence;
  try {
    const data = await api("/api/board");
    if (sequence !== refreshSequence || hasDraft() || document.querySelector(".checklist[data-busy]")) return;
    $("login").hidden = true; $("workspace").hidden = false;
    tasks = data.tasks;if(axisLayoutRevision!==(data.axis_layout?.revision || 0) && !axisScene?.dirty)resetAxisScene();savedAxisLayout=data.axis_layout?.layout || null;axisLayoutRevision=data.axis_layout?.revision || 0; axes=data.axes || [];axisItems=data.axis_items || [];sources = data.sources; timetables=data.timetables || [];
    if($("sources-dialog").open && collectorState)checkCollector();
    if(Date.now()-lastCloudCheck>=60000)checkCloud();
    const signature = JSON.stringify([tasks, axes, axisItems, sources, timetables, data.axis_layout, categoryFilter, Math.floor(Date.now()/60000)]);
    if (signature !== lastPayload) { render(); lastPayload = signature; }
    $("load-error").textContent = "";
    maybeLoginReminder();
  } catch (error) {
    $("load-error").textContent = `无法同步：${error.message}。页面上的内容可能不是最新的。`;
  }
}
function toggleDates() {
  const homework = taskCategory === "作业",record=taskCategory==="记录";
  $("record-time-field").hidden=!record;$("record-time").required=record;
  $("deadline-field").hidden = !homework; $("range-fields").hidden = homework || record;
  $("due-at").required = homework && !editing?.source;
  $("starts-at").required = !homework && !record; $("ends-at").required = !homework && !record;
}
function openTask(task = null) {
  if (hasDraft()) { notice("请先保存或取消正在编辑的待办事项"); return; }
  editing = task; $("task-form").reset(); $("task-error").textContent = "";
  taskCategory = task?.category || newTaskCategory || (categoryFilter==="全部"?"作业":categoryFilter);
  $("record-time").value=localInput(task?.starts_at || new Date());
  fillAxisSelect(task ? task.axis_id : newTaskAxis);
  newTaskAxis=null;newTaskCategory=null;
  $("dialog-title").textContent = task ? `编辑${taskCategory}` : `添加${taskCategory}`;
  $("task-title").value = task?.title || "";
  $("task-location").value = task?.location || "";
  $("task-content").value=taskContent(task);
  $("task-content").placeholder={作业:"记录作业要求、思路或需要注意的事项",课程:"记录课程备忘、学习重点或需要携带的资料",考试:"记录考试范围、复习提醒或需要携带的物品",活动:"记录活动议程、举办人、报名信息或其他备忘",会议:"记录会议议程、主持人、讨论要点或会前准备",记录:"今天做了什么，有什么感受？"}[taskCategory];
  $("homework-status").hidden=taskCategory!=="作业";$("done-field").hidden=["作业","课程"].includes(taskCategory);$("done-label").textContent=taskCategory==="记录"?"已完善":"已完成";$("task-done").checked=task?.status==="done";
  $("schedule-fields").hidden=!["课程","考试"].includes(taskCategory);
  $("schedule-person-label").hidden=$("schedule-person").hidden=taskCategory!=="课程";
  $("schedule-person").value=task?.details?.teacher || "";
  $("schedule-seat").value=task?.details?.seat || "";
  $("schedule-seat").hidden=taskCategory!=="考试";
  document.querySelector('label[for="schedule-seat"]').hidden=taskCategory!=="考试";
  draftTodos = structuredClone(task?.todos || []);
  draftAttachments = structuredClone(task?.attachments || []); renderAttachments(); $("upload-state").textContent="";
  $("task-links").replaceChildren(); for (const link of task?.links || []) addLinkRow(link);
  if (!(task?.links || []).length) $("task-links").append(element("p", "可添加课程资料、会议或文档链接", "resource-empty"));
  $("task-source").hidden=!task?.source_url; $("task-source").replaceChildren();
  if(task){const link=taskSourceLink(task);if(link)$("task-source").append(link);}
  $("task-todos").replaceChildren(checklist(draftTodos, async todos => { draftTodos = todos; }, true));
  $("status").value = task?.status || "todo";enhanceSelect($("status"));
  $("task-completed").hidden=["课程","记录"].includes(taskCategory) || !task?.completed_at; $("task-completed").textContent=task?.completed_at ? `完成时间 · ${formatTime(task.completed_at,true)}（再次从未完成状态更改为已完成后会重新统计时间。）` : "";
  $("due-at").value = localInput(task?.due_at); $("starts-at").value = localInput(task?.starts_at); $("ends-at").value = localInput(task?.ends_at);
  toggleDates(); $("task-dialog").showModal();
}
function closeAddMenu() { $("add-menu").hidden = true; $("add-task").setAttribute("aria-expanded", "false"); }
function startAdd() {
  newTaskAxis=null;newTaskCategory=null;
  if (categoryFilter !== "全部") return openTask();
  $("add-menu").hidden = !$("add-menu").hidden;
  $("add-task").setAttribute("aria-expanded", String(!$("add-menu").hidden));
  if (!$("add-menu").hidden) $("add-menu").querySelector("button").focus();
}
$("add-menu").replaceChildren(...CATEGORIES.map(category => {
  const button = element("button", `＋ ${category}`);
  button.onclick = () => { if (hasDraft()) { notice("请先保存或取消待办输入"); return; } newTaskCategory = category; closeAddMenu(); openTask(); };
  return button;
}));
document.addEventListener("click", event => { if (!event.target.closest(".add-control") && !event.target.closest(".empty")) closeAddMenu(); });
document.addEventListener("keydown", event => { if (event.key === "Escape" && !$("add-menu").hidden) { closeAddMenu(); $("add-task").focus(); } });
$("add-task").onclick = startAdd;
$("sources-button").onclick = async () => {
  renderSources();$("sources-dialog").showModal();$("source-error").textContent="";setSyncStep(syncStep);
  await Promise.all([loadSourceLinks(),checkCollector(),checkCloud()]);
};
document.querySelectorAll(".close-dialog").forEach(button => button.onclick = () => button.closest("dialog").close());
$("task-form").onsubmit = async event => {
  event.preventDefault(); $("save-task").disabled = true; $("task-error").textContent = "";
  try {
    if (uploading) throw new Error("请等待附件上传完成");
    const homework = taskCategory === "作业";
    if ($("task-todos").querySelector("[data-dirty], [data-busy]")) throw new Error("请先确认或取消正在输入的待办事项");
    const links=[...$("task-links").querySelectorAll(".link-edit-row")].map(row=>({label:row.querySelector(".link-label").value.trim(),url:row.querySelector(".link-url").value.trim()})).filter(link=>link.label || link.url);
    const payload = {category: taskCategory, title: $("task-title").value.trim(), content:$("task-content").value.trim(), location: $("task-location").value.trim(), todos: draftTodos, links, attachments:draftAttachments.map(file=>file.id), axis_id:$("task-axis").value || null,status:homework?$("status").value:taskCategory==="课程"?"todo":$("task-done").checked?"done":"todo",
      due_at: homework ? inputTime($("due-at").value) : null, starts_at: homework ? null : inputTime($(taskCategory==="记录"?"record-time":"starts-at").value),
      ends_at: homework ? null : inputTime($(taskCategory==="记录"?"record-time":"ends-at").value)};
    payload.details={...(editing?.details || {})};delete payload.details.organizer;
    if(taskCategory==="课程" && (!editing || payload.starts_at!==editing.starts_at || payload.ends_at!==editing.ends_at)) {
      const table=timetables.find(t=>t.semester===(editing?.details?.semester || courseSemester));
      if(table && !editing)Object.assign(payload.details,{semester:table.semester,semester_label:table.label});
      const date=$("starts-at").value.slice(0,10),start=$("starts-at").value.slice(11),end=$("ends-at").value.slice(11);
      payload.details.week=String(table?.days.find(day=>day.date===date)?.week || "");
      payload.details.weekday=String(new Date(`${date}T00:00:00Z`).getUTCDay() || 7);
      payload.details.period=(table?.slots || []).filter(slot=>start<slot.end && end>slot.start).map(slot=>slot.period).filter(Boolean).join("、");
    }
    if(taskCategory==="课程")payload.details.teacher=$("schedule-person").value.trim();
    if(taskCategory==="考试")payload.details.seat=$("schedule-seat").value.trim();
    if (editing) payload.revision = editing.revision;
    await api(editing ? `/api/tasks/${editing.id}` : "/api/tasks", editing ? "PATCH" : "POST", payload);
    $("task-dialog").close(); notice("卡片已保存"); await refresh();if($("axis-dialog").open)renderAxisMembers();
  } catch (error) { $("task-error").textContent = error.message; }
  finally { $("save-task").disabled = false; }
};
$("confirm-delete").onclick = async () => {
  $("confirm-delete").disabled = true;
  try { await api(`/api/tasks/${deleting.id}`, "DELETE", {revision: deleting.revision}); $("delete-dialog").close(); notice("任务已删除"); await refresh(); if($("archive-dialog").open) await loadArchive(); }
  catch (error) { notice(error.message); }
  finally { $("confirm-delete").disabled = false; }
};
const demoSteps=[
  {category:"全部",target:"#board",title:"总览：从日期找到任务",text:"在日历中按日期查看安排，或切换轴线整理目标与记录。课程继续显示在总览。"},
  {category:"作业",target:"#board",title:"作业：进度一目了然",text:"待开始、进行中、已完成分栏展示。卡片上的待办事项可以增删、修改和拖动排序；其他详情通过“编辑”修改。"},
  {category:"记录",target:"#board",title:"记录",text:"记下做过的事和当时的感受。记录也会出现在总览。"},
  {target:"#add-task",title:"随时补充自己的安排",text:"填写标题和时间，再按需要补充地点、内容、待办、附件和链接。"},
  {target:"#sources-button",title:"网站配置在这里",text:"点击侧栏的“来源与同步”，安装并连接同步扩展，就可以接入自己的校园网站。下一步带你查看配置位置。"},
  {target:"#add-source-link",sources:true,title:"一个网站，一条配置",text:"点击“添加网站”，粘贴列表页面的网址并确认。上方五个点显示配置进度，可随时点回之前的步骤。"},
  {target:"#cloud-settings > h3",sources:true,title:"云端同步：电脑关机也能更新",text:"在第 4 步直接开启云端同步，电脑关机后也能更新。微人大、YOJ 和通用识别网站仍需浏览器运行。完成后会进入第 5 步查看结果。"},
  {target:"#user-menu-toggle",title:"账户菜单：消息与归档",text:"点击头像和用户名，打开消息看板、归档处、反馈与账号设置。可以随时手动归档；已完成任务满 7 天也会自动归档，课程除外。归档后可查看、恢复或删除。"}
];
let demoIndex=0,demoOriginal=null;
const demoKey=()=>`ruchecklist-demo:${boardAccount}`;
function positionDemo() {
  if(!$("demo-dialog").open)return;
  const target=document.querySelector(demoSteps[demoIndex].target);if(!target)return;
  const rect=target.getBoundingClientRect(),frame=$("demo-highlight"),card=$("demo-card"),pad=8;
  const left=Math.max(pad,rect.left-5),top=Math.max(pad,rect.top-5),width=Math.max(0,Math.min(innerWidth-pad,rect.right+5)-left),height=Math.max(0,Math.min(innerHeight-pad,rect.bottom+5)-top);
  Object.assign(frame.style,{left:`${left}px`,top:`${top}px`,width:`${width}px`,height:`${height}px`});
  const cardWidth=Math.min(400,innerWidth-32),cardHeight=card.offsetHeight;
  const cardTop=top+height+16+cardHeight<innerHeight?top+height+16:top-cardHeight-16>=16?top-cardHeight-16:Math.max(16,innerHeight-cardHeight-20);
  Object.assign(card.style,{width:`${cardWidth}px`,left:`${Math.max(16,Math.min(left,innerWidth-cardWidth-16))}px`,top:`${cardTop}px`});
}
async function showDemoStep() {
  const step=demoSteps[demoIndex];
  $("demo-next").disabled=true;$("demo-prev").disabled=true;
  if(step.sources) {
    if(!$("sources-dialog").open){$("demo-dialog").close();$("sources-dialog").showModal();$("demo-dialog").showModal();await Promise.all([loadSourceLinks(),checkCloud(),checkCollector()]);}
    setSyncStep(step.target==="#add-source-link"?3:4);
  }else {
    $("sources-dialog").close();
    if(step.category){categoryFilter=step.category;render();}
  }
  $("demo-title").textContent=step.title;$("demo-description").textContent=step.text;$("demo-progress").textContent=`${demoIndex+1} / ${demoSteps.length}`;
  await new Promise(requestAnimationFrame);
  if(step.sources)await Promise.all($("sources-dialog").getAnimations({subtree:true}).filter(animation=>animation.effect.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})));
  if(!$("demo-dialog").open || demoSteps[demoIndex]!==step)return;
  $("demo-prev").disabled=demoIndex===0;$("demo-next").disabled=false;$("demo-next").textContent=demoIndex===demoSteps.length-1?"开始使用":"下一步";
  document.querySelector(step.target)?.scrollIntoView({block:step.sources?"center":"nearest",behavior:"instant"});
  positionDemo();requestAnimationFrame(positionDemo);$("demo-next").focus({preventScroll:true});
}
function startDemo() {if($("workspace").hidden)return;demoIndex=0;demoOriginal={category:categoryFilter,scroll:scrollY};$("demo-dialog").showModal();showDemoStep();}
function endDemo() {
  try{localStorage.setItem(demoKey(),"seen");}catch{}
  $("demo-dialog").close();$("sources-dialog").close();
  loadSyncProgress();
  if(demoOriginal){categoryFilter=demoOriginal.category;render();window.scrollTo({top:demoOriginal.scroll,behavior:"instant"});demoOriginal=null;}
  $("demo-button").focus({preventScroll:true});
}
function maybeDemo() {if(typeof maybeMessageBoard==="function")maybeMessageBoard();let seen=false;try{seen=localStorage.getItem(demoKey())==="seen";}catch{}if(!seen&&!document.querySelector("dialog[open]")&&!$("workspace").hidden)startDemo();}
$("demo-button").onclick=startDemo;$("demo-skip").onclick=endDemo;
$("demo-next").onclick=()=>{if(demoIndex===demoSteps.length-1)endDemo();else{demoIndex++;showDemoStep();}};
$("demo-prev").onclick=()=>{if(demoIndex){demoIndex--;showDemoStep();}};
$("demo-dialog").addEventListener("cancel",event=>{event.preventDefault();endDemo();});
window.addEventListener("resize",positionDemo);document.addEventListener("scroll",positionDemo,true);
const demoLayout=new ResizeObserver(()=>{
  if(!$("demo-dialog").open)return;
  document.querySelector(demoSteps[demoIndex].target)?.scrollIntoView({block:demoSteps[demoIndex].sources?"center":"nearest",behavior:"instant"});requestAnimationFrame(positionDemo);
});
for(const id of ["guide-install","website-setup","collector-controls","collector-state","cloud-settings","sources-list","sources-dialog"])demoLayout.observe($(id));

function setAuthMode(mode) {
  $("auth-heading").textContent=mode==="register"?"开启你的空间":mode==="recover"?"找回账号":"欢迎回来";
  $("auth-login").className=mode==="login"?"secondary":"text-button";$("auth-register").className=mode==="register"?"secondary":"text-button";
  authMode=mode;$("invite-field").hidden=mode!=="register" || publicRegistration;$("recovery-field").hidden=mode!=="recover";
  $("invite-code").required=mode==="register" && !publicRegistration;$("recovery-code").required=mode==="recover";
  $("password").autocomplete=mode==="login"?"current-password":"new-password";
  $("password-label").textContent=mode==="recover"?"新密码":"密码";
  $("password").placeholder="至少 6 位，含英文和数字";
  document.querySelector("#login-form button[type=submit]").textContent=mode==="register"?"创建我的账号":mode==="recover"?"重设密码":"登录看板";
  $("login-error").textContent="";
}
function configureAccount(data) {
  publicRegistration=!!data.public_registration;$("public-user-count").textContent=Number.isInteger(data.registered)?String(data.registered):"—";
  trialMode=!!data.trial;isAdmin=!!data.admin;boardAccount=data.account || (trialMode?"":"personal");accountName=data.username || accountName;registrationOpen=!!data.registration_open;
  loadSyncProgress();
  updateAccountCard();
  $("trial-auth").hidden=!trialMode;$("auth-recover").hidden=!trialMode;$("account-button").hidden=!trialMode;
  $("username").required=trialMode;$("password").minLength=trialMode?6:0;
  if(trialMode){setAuthMode("login");$("auth-register").disabled=!registrationOpen;$("trial-notice").hidden=registrationOpen;$("trial-notice").textContent=registrationOpen?"":"暂未开放新注册，已有账号可登录";$("file-limit-hint").textContent="单个文件 ≤ 1 MB · 每人 5 MB";}
}
function showRecovery(code) {
  $("account-dialog").close();$("recovery-value").textContent=code;$("recovery-done").disabled=true;$("recovery-dialog").showModal();
}
$("auth-login").onclick=()=>setAuthMode("login");$("auth-register").onclick=()=>setAuthMode("register");$("auth-recover").onclick=()=>setAuthMode("recover");
$("recovery-dialog").addEventListener("cancel",event=>{if($("recovery-done").disabled)event.preventDefault();});
$("download-recovery").onclick=()=>{
  const url=URL.createObjectURL(new Blob([`RUCapture\n网站：${location.origin}\n用户名：${accountName}\n恢复码：${$("recovery-value").textContent}\n请勿分享此文件。\n`],{type:"text/plain;charset=utf-8"}));
  const link=element("a");link.href=url;link.download="RUCapture-账号恢复码.txt";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$("recovery-done").disabled=false;
};
$("recovery-done").onclick=()=>{$("recovery-dialog").close();$("recovery-value").textContent="";maybeMessageBoard();maybeDemo();};
$("account-button").onclick=()=>{$("account-name").textContent=`用户名：${accountName}`;$("account-password").value="";$("account-error").textContent="";$("account-dialog").showModal();};
$("recovery-form").onsubmit=async event=>{event.preventDefault();event.submitter.disabled=true;try{const result=await api("/api/recovery-code","POST",{password:$("account-password").value});$("account-password").value="";showRecovery(result.recovery);}catch(error){$("account-error").textContent=error.message;}finally{event.submitter.disabled=false;}};
$("login-form").onsubmit = async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true; $("login-error").textContent = "";
  try {
    const result=await api(trialMode?`/api/${authMode==="register"?"register":authMode==="recover"?"recover":"login"}`:"/api/login", "POST", {password: $("password").value,remember:$("remember-login").checked,...(trialMode?{username:$("username").value,invite:$("invite-code").value.trim(),recovery:$("recovery-code").value.trim()}:{})},30000);
    $("password").value="";$("invite-code").value="";$("recovery-code").value="";
    if(trialMode){boardAccount=result.account;accountName=result.username;isAdmin=!!result.admin;}
    updateAccountCard();await refresh();await startMessages();if(result.recovery)showRecovery(result.recovery);else maybeDemo();
  }
  catch (error) { $("login-error").textContent = error.message; }
  finally { button.disabled = false; }
};
$("logout").onclick=()=>{$("logout-error").textContent="";$("logout-dialog").showModal();};
$("confirm-logout").onclick=async()=>{try{await api("/api/logout","POST",{});showLogin();}catch(error){$("logout-error").textContent=error.message;}};
document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("workspace").hidden) refresh(); });
let lastPoll=0;
setInterval(() => { if (!document.hidden && !$("workspace").hidden && !document.activeElement.matches("#board input, #board select") && Date.now()-lastPoll>=(trialMode?60000:6000)) {lastPoll=Date.now();refresh();} }, 6000);
document.addEventListener("DOMContentLoaded",()=>{
api("/api/session").then(async data => {
  configureAccount(data);
  if(!data.authenticated)return showLogin();
  await refresh();await startMessages();
  if(sessionStorage.getItem("resume-setup")){sessionStorage.removeItem("resume-setup");$("sources-button").click();}else maybeDemo();
}).catch(() => { showLogin(); $("login-error").textContent = "服务器暂时无法连接，请刷新重试"; });
});
