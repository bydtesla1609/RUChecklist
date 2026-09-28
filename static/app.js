"use strict";
const $ = id => document.getElementById(id);
const CATEGORIES = ["作业", "科研", "竞赛", "活动", "组织"];
const STATES = {todo: "待开始", doing: "进行中", done: "已完成"};
let tasks = [], sources = [], categoryFilter = "全部", editing = null, deleting = null;
let refreshSequence = 0, lastPayload = "", toastTimer, taskCategory = "作业", draftTodos = [];
let draftAttachments = [], uploading = false;
let collectorState=null;
let archiveCategory="全部", archiveItems=[], archiveTotal=0, archiveSequence=0;

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
async function api(path, method = "GET", payload) {
  const response = await fetch(path, {method, cache: "no-store", headers: {"Content-Type": "application/json"},
    ...(payload !== undefined ? {body: JSON.stringify(payload)} : {}), signal: AbortSignal.timeout(15000)});
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
  tasks = []; sources = []; archiveItems=[]; lastPayload = "";
  $("archive-list").replaceChildren(); $("archive-detail").replaceChildren();
  $("board").replaceChildren(); $("sources-list").replaceChildren(); $("pair-code").value = "";
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
function hasDraft() { return !!$("board").querySelector("[data-dirty], [data-busy], .dragging"); }
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
function renderNavigation() {
  $("categories").replaceChildren(...["全部", ...CATEGORIES].map(category => {
    const button = element("button", null, "nav-button" + (categoryFilter === category ? " active" : ""));
    button.setAttribute("aria-pressed", String(categoryFilter === category));
    button.append(element("span", "", `category-mark cat-${CATEGORIES.indexOf(category)}`), element("span", category === "全部" ? "全部任务" : category),
      element("span", String(tasks.filter(t => t.status !== "done" && (category === "全部" || t.category === category)).length), "count"));
    button.onclick = () => { if (hasDraft()) { notice("请先保存或取消正在编辑的待办事项"); return; } categoryFilter = category; closeAddMenu(); render(); };
    return button;
  }));
}
function card(task) {
  const article = element("article", null, "task");
  const meta = element("div", null, "task-meta");
  meta.append(element("span", task.category, `badge cat-${CATEGORIES.indexOf(task.category)}`),
    element("span", task.source ? sources.find(s => s.id === task.source)?.name || task.source : "手动添加", "source-label"));
  const title = element("h3", task.title, "task-title");
  article.append(meta, title);
  if (task.location) article.append(element("p", `⌖ ${task.location}`, "task-location"));
  if (task.course) article.append(element("p", task.course, "course"));
  const isOverdue = task.status !== "done" && deadline(task) && new Date(deadline(task)) < new Date();
  const time = element("div", null, "task-time" + (isOverdue ? " overdue" : ""));
  const completedHomework=task.category==="作业" && task.status==="done";
  time.append(element("p", (isOverdue ? "已逾期 · " : "") + (completedHomework ? "完成时间" : task.category === "作业" ? "截止时间" : "起止时间"), "time-label"));
  if (task.category === "作业") time.append(element("p", formatTime(completedHomework ? task.completed_at : task.due_at, true)));
  else time.append(element("p", formatTime(task.starts_at)), element("p", `至 ${formatTime(task.ends_at, true)}`));
  const footer = element("div", null, "task-footer");
  footer.append(element("span", STATES[task.status], "task-status"));
  if (task.source_url) {
    const link = element("a", "查看原作业 ↗");
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
  article.append(list);
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
  const visible = tasks.filter(t => categoryFilter === "全部" || categoryFilter === t.category);
  $("view-title").textContent = categoryFilter === "全部" ? "全部任务" : categoryFilter;
  $("add-task").textContent = categoryFilter === "全部" ? "＋ 添加任务" : `＋ 添加${categoryFilter}`;
  const open = visible.filter(t => t.status !== "done");
  $("count-open").textContent = open.length;
  $("count-done").textContent = visible.length - open.length;
  const current = Date.now();
  $("count-soon").textContent = open.filter(t => deadline(t) && new Date(deadline(t)).getTime() >= current && new Date(deadline(t)).getTime() <= current + 7 * 86400000).length;
  $("count-overdue").textContent = open.filter(t => deadline(t) && new Date(deadline(t)).getTime() < current).length;
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
  root.append(element("p",`完成时间 · ${formatTime(task.completed_at,true)}`,"task-time"));
  root.append(element("p",task.category==="作业"?`原截止时间 · ${formatTime(task.due_at,true)}`:`起止时间 · ${formatTime(task.starts_at,true)} 至 ${formatTime(task.ends_at,true)}`,"task-time"));
  if(task.todos.length) {const list=element("ul",null,"archive-todos");for(const todo of task.todos) list.append(element("li",`${todo.done?"☑":"☐"} ${todo.text}`));root.append(list);}
  const resources=element("div",null,"resources");resources.append(...task.attachments.map(file=>fileRow(file)));
  for(const link of task.links) {const row=element("div",null,"resource-row");row.append(externalLink(`${link.label || new URL(link.url).hostname} ↗`,link.url));resources.append(row);}
  root.append(resources);if(task.source_url) root.append(externalLink("查看原作业 ↗",task.source_url));
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
async function checkCollector() {
  try {
    collectorState=await collectorCommand("status",{},1800);
    $("collector-controls").hidden=false;
    $("collector-state").textContent=collectorState.connected?`扩展 ${collectorState.version} 已连接 · ${collectorState.enabled?"自动检查已开启":"已暂停"}`:`已检测到扩展 ${collectorState.version}，点击连接即可完成配对。`;
    $("collector-connect").textContent=collectorState.connected?"重新连接":"连接此看板";
    $("collector-scan").disabled=!collectorState.connected || !collectorState.enabled;
    $("collector-enabled").disabled=!collectorState.connected;$("collector-enabled").checked=collectorState.enabled;
    renderSources();
  }catch(error){collectorState=null;$("collector-controls").hidden=true;$("collector-state").textContent=error.message;}
}
$("collector-connect").onclick=async()=>{
  $("collector-connect").disabled=true;$("source-error").textContent="";
  try {
    await collectorCommand("status",{},1800);
    const {token}=await api("/api/collector-token","POST",{});
    await collectorCommand("pair",{token});await checkCollector();
    $("collector-state").textContent="已连接。正在打开作业页，读取结果会显示在各平台下方…";
    await collectorCommand("scan");
  }catch(error){$("source-error").textContent=error.message;}finally{$("collector-connect").disabled=false;}
};
$("collector-scan").onclick=async()=>{
  $("collector-scan").disabled=true;$("source-error").textContent="";
  try{await collectorCommand("scan");$("collector-state").textContent="已开始检查，请稍候。登录失效或无法识别时会在对应平台下方提示。";}
  catch(error){$("source-error").textContent=error.message;}finally{$("collector-scan").disabled=false;}
};
$("collector-enabled").onchange=async()=>{
  const enabled=$("collector-enabled").checked;$("collector-enabled").disabled=true;
  try{await collectorCommand("configure",{enabled});await checkCollector();}
  catch(error){$("source-error").textContent=error.message;$("collector-enabled").checked=!enabled;}
  finally{$("collector-enabled").disabled=false;}
};
$("collector-options").onclick=()=>collectorCommand("options").catch(error=>{$("source-error").textContent=error.message;});
async function checkCloud() {
  try {
    const cloud=await api("/api/cloud");
    $("cloud-run").disabled=!cloud.enabled;$("cloud-revoke").disabled=!cloud.enabled;
    const lines=[element("p",!cloud.available?"云端服务尚未配置":cloud.enabled?"云端定时器已启用，每 15 分钟检查一次。各平台的授权与采集结果见下方。":"尚未启用，教学网站登录授权仍只保留在你的电脑中。")];
    if(cloud.enabled) for(const source of sources) {
      const status=cloud.sources[source.id] || {};
      lines.push(element("p",`${source.name}：${status.error || (status.last_success?`最近成功 ${formatTime(status.last_success)} · ${status.count} 项作业，识别状态 ${status.status_count} 项，更新 ${status.changed} 项`:status.authorized?"已收到授权，等待云端采集":"等待首次授权")}`));
    }
    $("cloud-status").replaceChildren(...lines);
  }catch(error){$("cloud-status").textContent=error.message;}
}
$("cloud-authorize").onclick=()=>collectorCommand("options").catch(error=>{$("source-error").textContent=error.message;});
$("cloud-run").onclick=async()=>{
  $("cloud-run").disabled=true;$("cloud-status").textContent="云端正在检查作业，请稍候…";
  try{await api("/api/cloud/run","POST",{});await refresh();}catch(error){$("source-error").textContent=error.message;}finally{await checkCloud();}
};
$("cloud-revoke").onclick=async()=>{
  if(!confirm("关闭云端采集并删除服务器保存的教学网站登录授权？已导入的任务会保留。"))return;
  try{await api("/api/cloud","DELETE");await checkCloud();}catch(error){$("source-error").textContent=error.message;}
};
function renderSources() {
  $("sources-list").replaceChildren(...sources.map(source => {
    const row = element("div", null, "source-row"), header = element("div");
    const link = element("a", `${source.name} ↗`); link.href = source.url; link.target = "_blank"; link.rel = "noopener noreferrer";
    const fresh = source.last_seen && Date.now() - new Date(source.last_seen).getTime() < 30 * 60000;
    const missingStates=source.imported_count>0 && source.status_count<source.imported_count;
    header.append(link, element("span", source.error ? "需处理" : missingStates ? "状态未同步完整" : fresh ? "已接收" : source.last_seen ? "等待新数据" : "待连接", "state" + (fresh && !source.error && !missingStates ? " connected" : "")));
    row.append(header, element("p", source.error || (source.last_seen ? `上次接收 ${formatTime(source.last_seen)} · ${source.task_count} 项作业` : "尚未收到此网站的作业数据")));
    if(source.imported_count) row.append(element("p",`已识别完成状态 ${source.status_count} / ${source.imported_count} 项${missingStates?"。请确认扩展已更新，并刷新教学网站的作业列表后同步。":""}`,"source-diagnostic"));
    const local=collectorState?.sourceResults?.[source.id];
    if(local?.time && (!source.last_seen || Date.parse(local.time)>=Date.parse(source.last_seen)-1000)) {
      row.append(element("p",local.error || `本机上次检查 · 读取 ${local.count} 项，更新 ${local.changed} 项${local.missingDates?` · ${local.missingDates} 项未提供完整截止时间`:""}`,"source-diagnostic"));
    }
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
    tasks = data.tasks; sources = data.sources;
    if($("sources-dialog").open) {if(collectorState)checkCollector();checkCloud();}
    $("storage-state").textContent = data.storage ? `附件空间：${fileSize(data.storage.used)} / ${fileSize(data.storage.limit)}` : "";
    const signature = JSON.stringify([tasks, sources, categoryFilter, Math.floor(Date.now()/60000)]);
    if (signature !== lastPayload) { render(); lastPayload = signature; }
    $("sync-state").textContent = "已同步 ↻"; $("sync-state").classList.remove("failed"); $("load-error").textContent = "";
  } catch (error) {
    $("sync-state").textContent = "连接中断 · 重试"; $("sync-state").classList.add("failed");
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
  draftTodos = structuredClone(task?.todos || []);
  draftAttachments = structuredClone(task?.attachments || []); renderAttachments(); $("upload-state").textContent="";
  $("task-links").replaceChildren(); for (const link of task?.links || []) addLinkRow(link);
  if (!(task?.links || []).length) $("task-links").append(element("p", "可添加课程资料、会议或文档链接", "resource-empty"));
  $("task-source").hidden=!task?.source_url; $("task-source").replaceChildren();
  if (task?.source_url) $("task-source").append(externalLink("打开对应作业网页 ↗",task.source_url));
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
$("sync-state").onclick = refresh;
$("sources-button").onclick = () => { renderSources(); $("sources-dialog").showModal(); checkCollector(); checkCloud(); };
document.querySelectorAll(".close-dialog").forEach(button => button.onclick = () => button.closest("dialog").close());
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
$("pair").onclick = async () => {
  $("pair").disabled = true;
  try { const data = await api("/api/collector-token", "POST", {}); $("pair-url").value = location.origin; $("pair-code").value = data.token; $("pair-result").hidden = false; }
  catch (error) { $("source-error").textContent = error.message; }
  finally { $("pair").disabled = false; }
};
$("sources-dialog").addEventListener("close", () => { $("pair-code").value = ""; $("pair-result").hidden = true; });
$("today").textContent = new Intl.DateTimeFormat("zh-CN", {timeZone:"Asia/Shanghai", year:"numeric", month:"long", day:"numeric", weekday:"long"}).format(new Date());
document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("workspace").hidden) refresh(); });
setInterval(() => { if (!document.hidden && !$("workspace").hidden && !$("board").contains(document.activeElement)) refresh(); }, 6000);
api("/api/session").then(data => data.authenticated ? refresh() : showLogin()).catch(() => { showLogin(); $("login-error").textContent = "服务器暂时无法连接，请刷新重试"; });
