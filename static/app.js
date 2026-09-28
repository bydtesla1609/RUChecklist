"use strict";
const $ = id => document.getElementById(id);
const CATEGORIES = ["作业", "课程", "考试", "活动", "会议"];
const STATES = {todo: "待开始", doing: "进行中", done: "已完成"};
let tasks = [], sources = [], categoryFilter = "全部", editing = null, deleting = null;
let refreshSequence = 0, lastPayload = "", toastTimer, taskCategory = "作业", draftTodos = [];
let draftAttachments = [], uploading = false;
let timetables=[], courseSemester=null, courseWeek="all", courseIds=[], courseOccurrence="";
let collectorState=null, cloudState=null, syncing=false;
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
  const response = await fetch(path, {method, cache: "no-store", headers: {"Content-Type": "application/json"},
    ...(payload !== undefined ? {body: JSON.stringify(payload)} : {}), signal: AbortSignal.timeout(timeout)});
  let data;
  try { data = await response.json(); } catch { throw new Error("服务器暂时不可用，请稍后重试"); }
  if (!response.ok) {
    if (response.status === 401 && path !== "/api/login") showLogin();
    throw Object.assign(new Error(data.error || "请求未完成，请重试"), {status: response.status});
  }
  return data;
}
function showLogin() {
  $("workspace").hidden = true;
  $("login").hidden = false;
  document.querySelectorAll("dialog[open]").forEach(dialog => dialog.close());
  tasks = []; sources = []; timetables=[]; courseIds=[]; archiveItems=[]; lastPayload = "";
  $("archive-list").replaceChildren(); $("archive-detail").replaceChildren();
  $("board").replaceChildren(); $("sources-list").replaceChildren(); collectorState=null; cloudState=null;
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
  row.append(element("span", suffix || "FILE", "resource-kind"));
  if (file.pending) { const name=element("span", file.name); name.append(element("small", `${fileSize(file.size)} · 保存任务后可打开`)); row.append(name); }
  else {
    const link=externalLink(file.name, `/api/files/${file.id}`); link.setAttribute("aria-label", `打开附件：${file.name}`);
    link.append(element("small", fileSize(file.size))); row.append(link);
    const download=externalLink("下载", `/api/files/${file.id}?download=1`); download.className="file-download"; download.setAttribute("aria-label", `下载附件：${file.name}`); row.append(download);
  }
  if (removable) {
    const remove=element("button", "×"); remove.type="button"; remove.setAttribute("aria-label", `移除附件：${file.name}`); remove.disabled=uploading;
    remove.onclick=()=>{ draftAttachments=draftAttachments.filter(value=>value.id!==file.id); renderAttachments(); }; row.append(remove);
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
  remove.type="button"; remove.setAttribute("aria-label", "移除链接"); remove.onclick=()=>row.remove(); row.append(label,url,remove); $("task-links").append(row);
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
  let items = structuredClone(initial), saved = structuredClone(initial), editingId = null, adding = "";
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
  async function commit() {
    if (root.dataset.busy) return;
    markDirty(); root.dataset.busy = "true"; error.textContent = ""; recovery.hidden = true;
    root.querySelectorAll("button,input").forEach(node => node.disabled = true);
    try { await persist(structuredClone(items)); saved = structuredClone(items); }
    catch (failure) { error.textContent = `${failure.message}。草稿已保留。`; recovery.hidden = false; retry.disabled = failure.status === 409; }
    finally { delete root.dataset.busy; draw(); markDirty(); }
  }
  function draw() {
    progress.textContent = `待办事项 · ${items.filter(item => item.done).length} / ${items.length}`;
    list.replaceChildren(...items.map(item => {
      const row = element("div", null, "todo-row" + (item.done ? " checked" : "")); row.dataset.id = item.id;
      const handle = element("button", "⋮⋮", "drag-handle"); handle.type = "button";
      handle.setAttribute("aria-label", `拖动排序：${item.text}，也可按上下方向键`);
      handle.title = "拖动排序 / 上下方向键";
      handle.onkeydown = async event => {
        if (!["ArrowUp", "ArrowDown"].includes(event.key) || editingId || root.dataset.busy) return;
        event.preventDefault(); const from = items.indexOf(item), to = from + (event.key === "ArrowUp" ? -1 : 1);
        if (to < 0 || to >= items.length) return;
        items.splice(to, 0, items.splice(from, 1)[0]); await commit();
        list.querySelector(`[data-id="${item.id}"] .drag-handle`)?.focus();
      };
      let dragging = false;
      handle.onpointerdown = event => {
        if (event.button !== 0 || editingId || adding || root.dataset.busy) return;
        event.preventDefault(); dragging = true; row.classList.add("dragging"); root.dataset.dirty = "true";
        handle.setPointerCapture(event.pointerId);
      };
      handle.onpointermove = event => {
        if (!dragging) return;
        const siblings = [...list.children].filter(node => node !== row);
        const next = siblings.find(node => event.clientY < node.getBoundingClientRect().top + node.getBoundingClientRect().height / 2);
        if (row.nextElementSibling !== (next || null)) { list.insertBefore(row, next || null); handle.setPointerCapture(event.pointerId); }
      };
      handle.onpointerup = async () => {
        if (!dragging) return; dragging = false; row.classList.remove("dragging");
        const order = new Map(items.map(item => [item.id, item]));
        items = [...list.children].map(node => order.get(node.dataset.id));
        if (JSON.stringify(items) !== JSON.stringify(saved)) await commit(); else markDirty();
      };
      handle.onpointercancel = () => { dragging = false; draw(); markDirty(); };
      const check = element("input"); check.type = "checkbox"; check.checked = item.done; check.setAttribute("aria-label", `完成：${item.text}`);
      check.onchange = () => { item.done = check.checked; commit(); };
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
        text.onclick = () => { editingId = item.id; draw(); markDirty(); list.querySelector(".todo-edit").focus(); };
        const remove = element("button", "×", "todo-action"); remove.type = "button"; remove.setAttribute("aria-label", `删除待办：${item.text}`);
        remove.onclick = () => { items = items.filter(value => value.id !== item.id); commit(); };
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
    "会议":"M15 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M5 21v-2a7 7 0 0 1 14 0v2 M19 7a3 3 0 0 1 0 6 M22 20v-2a5 5 0 0 0-3-4"
  };
  const svg=document.createElementNS("http://www.w3.org/2000/svg","svg"),path=document.createElementNS(svg.namespaceURI,"path");
  svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("aria-hidden","true");svg.setAttribute("class",`nav-icon cat-${CATEGORIES.indexOf(category)}`);
  path.setAttribute("d",paths[category]);svg.append(path);return svg;
}
function renderNavigation() {
  $("categories").replaceChildren(...["全部", ...CATEGORIES].map(category => {
    const button = element("button", null, "nav-button" + (categoryFilter === category ? " active" : ""));
    button.setAttribute("aria-pressed", String(categoryFilter === category));
    button.append(navigationIcon(category), element("span", category === "全部" ? "总览" : category),
      element("span", String(tasks.filter(t => t.status !== "done" && (category === "全部" || t.category === category)).length), "count"));
    button.onclick = () => { if (hasDraft()) { notice("请先保存或取消正在编辑的待办事项"); return; } categoryFilter = category; closeAddMenu(); render(); };
    return button;
  }));
}
function card(task) {
  const article = element("article", null, "task");
  article.dataset.taskId = task.id;
  const meta = element("div", null, "task-meta");
  meta.append(element("span", task.category, `badge cat-${CATEGORIES.indexOf(task.category)}`),
    element("span", task.source ? sources.find(s => s.id === task.source)?.name || task.source : "手动添加", "source-label"));
  const title = element("h3", task.title, "task-title");
  article.append(meta, title);
  for(const [key,label] of [["teacher","教师"],["seat","座位"],["organizer","组织者"]]) if(task.details?.[key]) article.append(element("p",`${label} · ${task.details[key]}`,"event-detail"));
  if(task.details?.period) article.append(element("p",`第 ${task.details.week} 周 · ${task.details.period}`,"event-detail"));
  if (task.location) article.append(element("p", `⌖ ${task.location}`, "task-location"));
  if (task.course) article.append(element("p", task.course, "course"));
  const isOverdue = task.category === "作业" && task.status !== "done" && deadline(task) && new Date(deadline(task)) < new Date();
  const time = element("div", null, "task-time" + (isOverdue ? " overdue" : ""));
  const completedHomework=task.category==="作业" && task.status==="done";
  time.append(element("p", (isOverdue ? "已逾期 · " : "") + (completedHomework ? "完成时间" : task.category === "作业" ? "截止时间" : "起止时间"), "time-label"));
  if (task.category === "作业") time.append(element("p", formatTime(completedHomework ? task.completed_at : task.due_at, true)));
  else time.append(element("p", formatTime(task.starts_at)), element("p", `至 ${formatTime(task.ends_at, true)}`));
  const footer = element("div", null, "task-footer");
  const status=element("select",null,"task-status");
  status.setAttribute("aria-label",`任务状态：${task.title}`);
  for(const [value,label] of Object.entries(STATES)) { const option=element("option",label);option.value=value;status.append(option); }
  status.value=task.status;
  status.onchange=async()=>{
    if(hasDraft()) {status.value=task.status;notice("请先保存或取消正在编辑的待办事项");return;}
    article.dataset.busy="true";
    article.querySelectorAll("button,input,select").forEach(node=>node.disabled=true);
    try {
      const updated=await api(`/api/tasks/${task.id}`,"PATCH",{status:status.value,revision:task.revision});
      tasks=tasks.map(value=>value.id===updated.id?updated:value);lastPayload="";
      task=current=updated;
      notice(`已设为${STATES[updated.status]}`);
    } catch(error) {notice(error.message);}
    finally {
      delete article.dataset.busy;status.value=task.status;
      article.querySelectorAll("button,input,select").forEach(node=>node.disabled=false);
      if(!hasDraft()) render();await refresh();
    }
  };
  footer.append(status);
  if (task.source_url) {
    const link = element("a", task.source?.startsWith("ruc_")?"教务原页面 ↗":"查看原作业 ↗");
    link.href = task.source_url; link.target = "_blank"; link.rel = "noopener noreferrer"; footer.append(link);
  }
  const actions = element("div", null, "task-actions");
  const edit = element("button", "编辑", "edit-task");
  edit.type = "button";
  edit.setAttribute("aria-label", `编辑：${task.title}`);
  edit.onclick = () => openTask(task);
  const remove = element("button", "删除", "delete-task");
  remove.type = "button";
  remove.setAttribute("aria-label", `删除：${task.title}`);
  remove.onclick = () => { if (hasDraft()) { notice("请先保存或取消正在编辑的待办事项"); return; } deleting = task; $("delete-dialog").showModal(); };
  actions.append(edit, remove); footer.append(actions); article.append(time);
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
    for (const link of task.links || []) { const row=element("div",null,"resource-row"); row.append(element("span","LINK","resource-kind"),externalLink(`${link.label || new URL(link.url).hostname} ↗`,link.url)); resources.append(row); }
    article.append(resources);
  }
  article.append(footer);
  return article;
}
function render() {
  renderNavigation();
  if($("course-dialog").open && !hasDraft()) renderCourseDetail();
  document.querySelector(".summary").hidden=categoryFilter==="课程";
  document.querySelector(".summary").removeAttribute("data-schedule");
  const visible = tasks.filter(t => categoryFilter === "全部" || categoryFilter === t.category);
  $("view-title").textContent = categoryFilter === "全部" ? "总览" : categoryFilter;
  $("add-task").textContent = categoryFilter === "全部" ? "＋ 添加任务" : `＋ 添加${categoryFilter}`;
  const open = visible.filter(t => t.status !== "done");
  $("count-open").textContent = open.length;
  $("count-done").textContent = visible.length - open.length;
  const current = Date.now();
  $("count-soon").textContent = open.filter(t => deadline(t) && new Date(deadline(t)).getTime() >= current && new Date(deadline(t)).getTime() <= current + 7 * 86400000).length;
  $("count-overdue").textContent = open.filter(t => deadline(t) && new Date(deadline(t)).getTime() < current).length;
  $("board").className="board"+(categoryFilter==="全部"?" calendar-board":categoryFilter!=="作业"?" schedule-board":"");
  document.querySelectorAll(".summary>div").forEach((node,index)=>{
    node.querySelector("span").textContent=["待完成","未来 7 天到期","已逾期","已完成"][index];
    node.querySelector("small").textContent=["按截止 / 结束时间从近到远","按截止 / 结束时间从近到远","已过截止 / 结束时间，且尚未完成","按完成时间倒序，超过 7 天自动归档"][index];
  });
  $("board-caption").hidden=categoryFilter!=="作业";
  if(categoryFilter==="全部") {renderCalendar();renderSources();return;}
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
        const view=element("button","查看","course-view");view.setAttribute("aria-label",`查看课程：${task.title}`);view.onclick=()=>openCourse(group.items);block.append(view);cell.append(block);
      }
      tr.append(cell);
    }
    body.append(tr);
  });
  grid.append(body);scroll.append(grid);panel.append(scroll,element("p","左右滑动查看完整课表 · 点击“查看”管理具体课次","timetable-hint"));
}
function openCourse(items) {
  courseIds=items.map(task=>task.id);courseOccurrence=(items.find(task=>Date.parse(task.ends_at)>=Date.now()) || items[0]).id;
  renderCourseDetail();$("course-dialog").showModal();
}
function renderCourseDetail() {
  const items=courseIds.map(id=>tasks.find(task=>task.id===id)).filter(Boolean).sort((a,b)=>a.starts_at.localeCompare(b.starts_at));
  if(!items.length){$("course-dialog").close();return;}
  if(!items.some(task=>task.id===courseOccurrence))courseOccurrence=items[0].id;
  const select=$("course-occurrence");select.replaceChildren(...items.map(task=>{const option=element("option",`${task.details?.week?`第 ${task.details.week} 周 · `:""}${formatTime(task.starts_at,true)}`);option.value=task.id;return option;}));select.value=courseOccurrence;
  select.onchange=()=>{if(hasDraft()){select.value=courseOccurrence;notice("请先保存或取消待办输入");return;}courseOccurrence=select.value;renderCourseDetail();};
  const task=items.find(t=>t.id===courseOccurrence),detail=card(task);
  detail.querySelector(".edit-task").onclick=()=>{if(hasDraft()){notice("请先保存或取消待办输入");return;}$("course-dialog").close();openTask(task);};
  $("course-detail").replaceChildren(detail);
}
function renderSchedule(visible) {
  const root=$("board"),today=localInput(new Date()).slice(0,10),now=Date.now();
  const sorted=[...visible].sort((a,b)=>(a.starts_at || "9999").localeCompare(b.starts_at || "9999") || a.id.localeCompare(b.id));
  root.replaceChildren();
  if(categoryFilter==="课程") {renderTimetable(sorted);return;}
  const upcoming=sorted.filter(t=>Date.parse(t.ends_at)>=now),past=sorted.filter(t=>Date.parse(t.ends_at)<now);
  scheduleStats([categoryFilter==="考试"?"待赴考试":"接下来的安排","未来 7 天","今天","已结束"],
    [upcoming.length,upcoming.filter(t=>Date.parse(t.starts_at)<=now+7*86400000).length,sorted.filter(t=>onCalendarDay(t,today)).length,past.length],
    ["按开始时间从近到远","未来一周开始的安排","全部时间均为北京时间","按开始时间从近到远"]);
  function group(items,container) {
    const groups=new Map();for(const task of items) {const key=localInput(task.starts_at).slice(0,10);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(task);}
    for(const [day,items] of groups) {
      const section=element("section",null,`event-group ${categoryFilter==="考试"?"exam-group":categoryFilter==="会议"?"meeting-group":"activity-group"}`);
      const heading=element("div",null,"event-heading"),delta=Math.round((Date.parse(`${day}T00:00:00Z`)-Date.parse(`${today}T00:00:00Z`))/86400000);
      heading.append(element("h2",`${shortDay(day)}${day.slice(0,4)!==today.slice(0,4)?` · ${day.slice(0,4)}`:""}`));
      heading.append(element("span",delta===0?"今天":delta===1?"明天":delta>1?`${delta} 天后`:"已结束","date-pill"));section.append(heading);
      const list=element("div",null,"event-grid");list.append(...items.map(card));section.append(list);container.append(section);
    }
  }
  group(upcoming,root);
  if(!upcoming.length)root.append(element("p",categoryFilter==="考试"?"暂无接下来的考试安排。教务发布日程后，同步即可查看。":`暂无接下来的${categoryFilter}。`,"day-empty"));
  if(past.length) {const details=element("details",null,"past-events");details.append(element("summary",`已结束的${categoryFilter} · ${past.length}`));group(past,details);root.append(details);}
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
    day.dataset.date=key;day.setAttribute("aria-label",`${key}，${matching.length} 项任务`);
    day.setAttribute("aria-pressed",String(key===selectedDay));day.setAttribute("aria-controls","day-list");
    if(key===todayKey) day.setAttribute("aria-current","date");
    day.append(element("span",String(date.getUTCDate()),"day-number"));
    for(const task of matching.slice(0,2)) {
      const title=element("span",task.title,`day-task cat-${CATEGORIES.indexOf(task.category)}`+(task.status==="done"?" is-done":""));title.title=task.title;day.append(title);
    }
    if(matching.length>2)day.append(element("span",`+${matching.length-2} 项`,"day-more"));
    day.onclick=()=>{
      calendarSelect(key);$("board").querySelector(`[data-date="${key}"]`)?.focus({preventScroll:true});
      if(selectedDay===key) $("board").querySelector(".day-agenda").scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth",block:"start"});
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
  agenda.append(element("h2",`${selectedDay ? `${Number(selectedDay.slice(5,7))} 月 ${Number(selectedDay.slice(8))} 日` : "未定日期"} · ${matching.length} 项任务`));
  if(matching.length)list.append(...matching.map(card));else list.append(element("p","这一天没有任务。","day-empty"));
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
    actions.append(view,remove);row.append(info,actions);return row;
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
  if(task.location) root.append(element("p",`地点 · ${task.location}`,"task-location"));
  if(task.course) root.append(element("p",task.course,"course"));
  for(const [key,label] of [["teacher","教师"],["week","教学周"],["period","节次"],["seat","座位"],["organizer","组织者"]]) if(task.details?.[key]) root.append(element("p",`${label} · ${task.details[key]}`,"event-detail"));
  root.append(element("p",`完成时间 · ${formatTime(task.completed_at,true)}`,"task-time"));
  root.append(element("p",task.category==="作业"?`原截止时间 · ${formatTime(task.due_at,true)}`:`起止时间 · ${formatTime(task.starts_at,true)} 至 ${formatTime(task.ends_at,true)}`,"task-time"));
  if(task.todos.length) {const list=element("ul",null,"archive-todos");for(const todo of task.todos) list.append(element("li",`${todo.done?"☑":"☐"} ${todo.text}`));root.append(list);}
  const resources=element("div",null,"resources");resources.append(...task.attachments.map(file=>fileRow(file)));
  for(const link of task.links) {const row=element("div",null,"resource-row");row.append(externalLink(`${link.label || new URL(link.url).hostname} ↗`,link.url));resources.append(row);}
  root.append(resources);if(task.source_url) root.append(externalLink(task.source?.startsWith("ruc_")?"教务原页面 ↗":"查看原作业 ↗",task.source_url));
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
    const id=crypto.randomUUID(),timer=setTimeout(()=>{collectorRequests.delete(id);reject(new Error("此浏览器未连接新版扩展。请在 Edge 重新加载扩展，再刷新看板；手机端可查看电脑同步的结果。"));},timeout);
    collectorRequests.set(id,{resolve,reject,timer});window.postMessage({kind:"campus-board-command",id,command,...extra},location.origin);
  });
}
function updateSyncControls() {
  const connected=!!collectorState?.connected;
  $("collector-controls").hidden=!collectorState || connected;
  $("collector-install").hidden=!!collectorState;
  $("browser-settings").hidden=!connected;
  $("collector-scan").disabled=syncing || !(cloudState?.enabled || (connected && collectorState.enabled));
  $("collector-scan").textContent=syncing?"正在同步…":"立即同步";
  $("cloud-authorize").disabled=!connected;
  $("academic-scan").disabled=!connected || !collectorState.enabled;
  $("cloud-revoke").disabled=syncing || !cloudState?.enabled;
}
async function checkCollector() {
  try {
    collectorState=await collectorCommand("status",{},1800);
    $("collector-state").textContent=collectorState.connected?`Edge 扩展已连接 · v${collectorState.version}${collectorState.enabled?"":" · 浏览器导入已暂停"}`:"已检测到扩展，点击下方按钮连接。";
    $("collector-enabled").checked=collectorState.enabled;
  }catch {
    collectorState=null;
    $("collector-state").textContent="此浏览器未连接扩展。手机可直接查看云端同步结果。";
  }
  updateSyncControls();renderSources();
}
$("collector-connect").onclick=async()=>{
  $("collector-connect").disabled=true;$("source-error").textContent="";
  try {
    await collectorCommand("status",{},1800);
    const {token}=await api("/api/collector-token","POST",{});
    await collectorCommand("pair",{token});await checkCollector();
    await collectorCommand("scan");notice("已连接，正在读取作业。请确认三个网站已登录。");
  }catch(error){$("source-error").textContent=error.message;}finally{$("collector-connect").disabled=false;}
};
$("collector-scan").onclick=async()=>{
  syncing=true;updateSyncControls();$("source-error").textContent="";
  try {
    if(cloudState?.enabled) {await api("/api/cloud/run","POST",{},60000);await refresh();await checkCloud();}
    else {await collectorCommand("scan");notice("已开始读取作业，结果会显示在下方。");}
  }catch(error){$("source-error").textContent=error.message;}
  finally{syncing=false;updateSyncControls();}
};
$("collector-enabled").onchange=async()=>{
  const enabled=$("collector-enabled").checked;$("collector-enabled").disabled=true;
  try{await collectorCommand("configure",{enabled});await checkCollector();}
  catch(error){$("source-error").textContent=error.message;$("collector-enabled").checked=!enabled;}
  finally{$("collector-enabled").disabled=false;}
};
$("academic-scan").onclick=async()=>{
  $("academic-scan").disabled=true;
  try {if((collectorState?.version || "0").localeCompare("1.4.1",undefined,{numeric:true})<0)throw new Error("请重新加载扩展至 v1.4.1，再刷新此页面");await collectorCommand("academic-scan");notice("已打开教务查询页，正在导入课表和考试。");}
  catch(error){$("source-error").textContent=error.message;}finally{updateSyncControls();}
};
$("collector-options").onclick=$("cloud-authorize").onclick=()=>collectorCommand("options").catch(error=>{$("source-error").textContent=error.message;});
async function checkCloud() {
  try {
    cloudState=await api("/api/cloud");
    $("cloud-status").textContent=cloudState.enabled?"云端自动同步已开启 · 每 15 分钟":"云端未启用 · 使用电脑扩展导入";
    updateSyncControls();renderSources();
  }catch(error){$("cloud-status").textContent=error.message;}
}
$("cloud-revoke").onclick=async()=>{
  if(!confirm("关闭云端采集并删除服务器保存的教学网站登录授权？已导入的任务会保留。"))return;
  try{await api("/api/cloud","DELETE");await checkCloud();}catch(error){$("source-error").textContent=error.message;}
};
function renderSources() {
  $("sources-list").replaceChildren(...sources.map(source=>{
    const row=element("div",null,"source-row"),header=element("div");
    const academic=source.kind==="academic";
    const cloud=!academic && cloudState?.enabled?cloudState.sources?.[source.id]:null;
    const local=collectorState?.sourceResults?.[source.id];
    const seen=cloud?.last_success || source.last_seen;
    const fresh=seen && Date.now()-Date.parse(seen)<30*60000;
    const error=!academic && cloudState?.enabled ? cloud?.error : (local?.error && (!seen || Date.parse(local.time)>Date.parse(seen)) ? local.error:source.error);
    const incomplete=!academic && (cloud?.last_success ? cloud.status_count<cloud.count : source.imported_count>source.status_count);
    const label=error?"需处理":incomplete?"状态不完整":fresh?"已同步":seen?"等待更新":"待连接";
    header.append(externalLink(`${source.name} ↗`,source.url),element("span",label,"state"+(fresh && !error && !incomplete?" connected":"")));
    row.append(header);
    const total=cloud?.last_success?cloud.count:source.task_count;
    row.append(element("p",error || (seen?`${formatTime(seen)} · ${total} 项${academic?"日程":"作业"}${incomplete?" · 部分完成状态未识别":""}`:cloud?.authorized?"授权已保存，等待同步":"请连接扩展并登录此网站")));
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
    tasks = data.tasks; sources = data.sources; timetables=data.timetables || [];
    if($("sources-dialog").open) {if(collectorState)checkCollector();checkCloud();}
    const signature = JSON.stringify([tasks, sources, timetables, categoryFilter, Math.floor(Date.now()/60000)]);
    if (signature !== lastPayload) { render(); lastPayload = signature; }
    $("load-error").textContent = "";
  } catch (error) {
    $("load-error").textContent = `无法同步：${error.message}。页面上的内容可能不是最新的。`;
  }
}
function toggleDates() {
  const homework = taskCategory === "作业";
  $("deadline-field").hidden = !homework; $("range-fields").hidden = homework;
  $("due-at").required = homework && !editing?.source;
  $("starts-at").required = !homework; $("ends-at").required = !homework;
}
function openTask(task = null) {
  if (hasDraft()) { notice("请先保存或取消正在编辑的待办事项"); return; }
  editing = task; $("task-form").reset(); $("task-error").textContent = "";
  taskCategory = task?.category || categoryFilter;
  $("dialog-title").textContent = task ? `编辑${taskCategory}` : `添加${taskCategory}`;
  $("task-title").value = task?.title || "";
  $("task-location").value = task?.location || "";
  $("schedule-fields").hidden=taskCategory==="作业";
  $("schedule-person-label").textContent=taskCategory==="课程"?"教师（选填）":"组织者 / 主持人（选填）";
  $("schedule-person").value=task?.details?.[taskCategory==="课程"?"teacher":"organizer"] || "";
  $("schedule-seat").value=task?.details?.seat || "";
  $("schedule-seat").hidden=taskCategory!=="考试";
  document.querySelector('label[for="schedule-seat"]').hidden=taskCategory!=="考试";
  draftTodos = structuredClone(task?.todos || []);
  draftAttachments = structuredClone(task?.attachments || []); renderAttachments(); $("upload-state").textContent="";
  $("task-links").replaceChildren(); for (const link of task?.links || []) addLinkRow(link);
  if (!(task?.links || []).length) $("task-links").append(element("p", "可添加课程资料、会议或文档链接", "resource-empty"));
  $("task-source").hidden=!task?.source_url; $("task-source").replaceChildren();
  if (task?.source_url) $("task-source").append(externalLink(task.source?.startsWith("ruc_")?"打开教务原页面 ↗":"打开对应作业网页 ↗",task.source_url));
  $("task-todos").replaceChildren(checklist(draftTodos, async todos => { draftTodos = todos; }, true));
  $("status").value = task?.status || "todo";
  $("task-completed").hidden=!task?.completed_at; $("task-completed").textContent=task?.completed_at ? `完成时间 · ${formatTime(task.completed_at,true)}（重新打开任务后再次完成会重新计时）` : "";
  $("due-at").value = localInput(task?.due_at); $("starts-at").value = localInput(task?.starts_at); $("ends-at").value = localInput(task?.ends_at);
  toggleDates(); $("task-dialog").showModal();
}
function closeAddMenu() { $("add-menu").hidden = true; $("add-task").setAttribute("aria-expanded", "false"); }
function startAdd() {
  if (categoryFilter !== "全部") return openTask();
  $("add-menu").hidden = !$("add-menu").hidden;
  $("add-task").setAttribute("aria-expanded", String(!$("add-menu").hidden));
  if (!$("add-menu").hidden) $("add-menu").querySelector("button").focus();
}
$("add-menu").replaceChildren(...CATEGORIES.map(category => {
  const button = element("button", `＋ ${category}`);
  button.onclick = () => { if (hasDraft()) { notice("请先保存或取消待办输入"); return; } categoryFilter = category; closeAddMenu(); render(); openTask(); };
  return button;
}));
document.addEventListener("click", event => { if (!event.target.closest(".add-control") && !event.target.closest(".empty")) closeAddMenu(); });
document.addEventListener("keydown", event => { if (event.key === "Escape" && !$("add-menu").hidden) { closeAddMenu(); $("add-task").focus(); } });
$("add-task").onclick = startAdd;
$("sources-button").onclick = () => { renderSources(); $("sources-dialog").showModal(); $("source-error").textContent=""; checkCollector(); checkCloud(); };
document.querySelectorAll(".close-dialog").forEach(button => button.onclick = () => {const dialog=button.closest("dialog");if(dialog.id==="course-dialog" && hasDraft()){notice("请先保存或取消待办输入");return;}dialog.close();});
$("course-dialog").addEventListener("cancel",event=>{if(hasDraft()){event.preventDefault();notice("请先保存或取消待办输入");}});
$("task-form").onsubmit = async event => {
  event.preventDefault(); $("save-task").disabled = true; $("task-error").textContent = "";
  try {
    if (uploading) throw new Error("请等待附件上传完成");
    const homework = taskCategory === "作业";
    if ($("task-todos").querySelector("[data-dirty], [data-busy]")) throw new Error("请先确认或取消正在输入的待办事项");
    const links=[...$("task-links").querySelectorAll(".link-edit-row")].map(row=>({label:row.querySelector(".link-label").value.trim(),url:row.querySelector(".link-url").value.trim()})).filter(link=>link.label || link.url);
    const payload = {category: taskCategory, title: $("task-title").value.trim(), location: $("task-location").value.trim(), todos: draftTodos, links, attachments:draftAttachments.map(file=>file.id), status: $("status").value,
      due_at: homework ? inputTime($("due-at").value) : null, starts_at: homework ? null : inputTime($("starts-at").value),
      ends_at: homework ? null : inputTime($("ends-at").value)};
    payload.details={...(editing?.details || {})};
    if(taskCategory==="课程" && (!editing || payload.starts_at!==editing.starts_at || payload.ends_at!==editing.ends_at)) {
      const table=timetables.find(t=>t.semester===(editing?.details?.semester || courseSemester));
      if(table && !editing)Object.assign(payload.details,{semester:table.semester,semester_label:table.label});
      const date=$("starts-at").value.slice(0,10),start=$("starts-at").value.slice(11),end=$("ends-at").value.slice(11);
      payload.details.week=String(table?.days.find(day=>day.date===date)?.week || "");
      payload.details.weekday=String(new Date(`${date}T00:00:00Z`).getUTCDay() || 7);
      payload.details.period=(table?.slots || []).filter(slot=>start<slot.end && end>slot.start).map(slot=>slot.period).filter(Boolean).join("、");
    }
    for(const [key,input] of [[taskCategory==="课程"?"teacher":"organizer","schedule-person"],...(taskCategory==="考试"?[["seat","schedule-seat"]]:[])]) {
      if(taskCategory!=="作业" && $(input).value.trim()!==(payload.details[key] || "")) payload.details[key]=$(input).value.trim();
    }
    if (editing) payload.revision = editing.revision;
    await api(editing ? `/api/tasks/${editing.id}` : "/api/tasks", editing ? "PATCH" : "POST", payload);
    $("task-dialog").close(); notice("任务已保存"); await refresh();
  } catch (error) { $("task-error").textContent = error.message; }
  finally { $("save-task").disabled = false; }
};
$("confirm-delete").onclick = async () => {
  $("confirm-delete").disabled = true;
  try { await api(`/api/tasks/${deleting.id}`, "DELETE", {revision: deleting.revision}); $("delete-dialog").close(); notice("任务已删除"); await refresh(); if($("archive-dialog").open) await loadArchive(); }
  catch (error) { notice(error.message); }
  finally { $("confirm-delete").disabled = false; }
};
$("login-form").onsubmit = async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true; $("login-error").textContent = "";
  try { await api("/api/login", "POST", {password: $("password").value}); $("password").value = ""; await refresh(); }
  catch (error) { $("login-error").textContent = error.message; }
  finally { button.disabled = false; }
};
$("logout").onclick = async () => { try { await api("/api/logout", "POST", {}); showLogin(); } catch(error) { notice(error.message); } };
document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("workspace").hidden) refresh(); });
setInterval(() => { if (!document.hidden && !$("workspace").hidden && !document.activeElement.matches("#board input, #board select")) refresh(); }, 6000);
api("/api/session").then(data => data.authenticated ? refresh() : showLogin()).catch(() => { showLogin(); $("login-error").textContent = "服务器暂时无法连接，请刷新重试"; });
