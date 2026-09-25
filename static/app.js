"use strict";
const $ = id => document.getElementById(id);
const CATEGORIES = ["作业", "科研", "竞赛", "活动", "组织"];
const STATES = {todo: "待开始", doing: "进行中", done: "已完成"};
let tasks = [], sources = [], categoryFilter = "全部", editing = null, deleting = null;
let refreshSequence = 0, lastPayload = "", toastTimer, taskCategory = "作业", draftTodos = [];

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
  tasks = []; sources = []; lastPayload = "";
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
  const title = element("button", task.title, "task-title");
  title.setAttribute("aria-label", `编辑：${task.title}`);
  title.onclick = () => openTask(task);
  article.append(meta, title);
  if (task.location) article.append(element("p", `⌖ ${task.location}`, "task-location"));
  if (task.course) article.append(element("p", task.course, "course"));
  const isOverdue = task.status !== "done" && deadline(task) && new Date(deadline(task)) < new Date();
  const time = element("div", null, "task-time" + (isOverdue ? " overdue" : ""));
  time.append(element("p", (isOverdue ? "已逾期 · " : "") + (task.category === "作业" ? "截止时间" : "起止时间"), "time-label"));
  if (task.category === "作业") time.append(element("p", formatTime(task.due_at, true)));
  else time.append(element("p", formatTime(task.starts_at)), element("p", `至 ${formatTime(task.ends_at, true)}`));
  const footer = element("div", null, "task-footer");
  const select = element("select");
  select.setAttribute("aria-label", `修改进度：${task.title}`);
  for (const [value, label] of Object.entries(STATES)) {
    const option = element("option", label); option.value = value; select.append(option);
  }
  select.value = task.status;
  select.onchange = async () => {
    if (hasDraft()) { select.value = task.status; notice("请先保存或取消正在编辑的待办事项"); return; }
    select.disabled = true;
    try { await api(`/api/tasks/${task.id}`, "PATCH", {status: select.value, revision: task.revision}); await refresh(); }
    catch (error) { select.value = task.status; notice(error.message); await refresh(); }
    finally { select.disabled = false; }
  };
  footer.append(select);
  if (task.source_url) {
    const link = element("a", "查看原作业 ↗");
    link.href = task.source_url; link.target = "_blank"; link.rel = "noopener noreferrer"; footer.append(link);
  }
  const remove = element("button", "删除", "delete-task");
  remove.setAttribute("aria-label", `删除：${task.title}`);
  remove.onclick = () => { if (hasDraft()) { notice("请先保存或取消正在编辑的待办事项"); return; } deleting = task; $("delete-dialog").showModal(); };
  footer.append(remove); article.append(time);
  let current = task;
  const list = checklist(task.todos, async todos => {
    current = await api(`/api/tasks/${task.id}`, "PATCH", {todos, revision: current.revision});
    tasks = tasks.map(value => value.id === current.id ? current : value);
    task = current; lastPayload = "";
  });
  article.append(list, footer);
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
    const matching = visible.filter(t => t.status === state).sort((a,b) => (deadline(a) || "9999").localeCompare(deadline(b) || "9999") || a.created_at.localeCompare(b.created_at));
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
function renderSources() {
  $("sources-list").replaceChildren(...sources.map(source => {
    const row = element("div", null, "source-row"), header = element("div");
    const link = element("a", `${source.name} ↗`); link.href = source.url; link.target = "_blank"; link.rel = "noopener noreferrer";
    const fresh = source.last_seen && Date.now() - new Date(source.last_seen).getTime() < 30 * 60000;
    header.append(link, element("span", source.error ? "需处理" : fresh ? "已接收" : source.last_seen ? "等待新数据" : "待连接", "state" + (fresh && !source.error ? " connected" : "")));
    row.append(header, element("p", source.error || (source.last_seen ? `上次接收 ${formatTime(source.last_seen)} · ${source.task_count} 项作业` : "尚未收到此网站的作业数据")));
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
  $("task-todos").replaceChildren(checklist(draftTodos, async todos => { draftTodos = todos; }, true));
  $("status").value = task?.status || "todo";
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
$("sources-button").onclick = () => { renderSources(); $("sources-dialog").showModal(); };
document.querySelectorAll(".close-dialog").forEach(button => button.onclick = () => button.closest("dialog").close());
$("task-form").onsubmit = async event => {
  event.preventDefault(); $("save-task").disabled = true; $("task-error").textContent = "";
  try {
    const homework = taskCategory === "作业";
    if ($("task-todos").querySelector("[data-dirty], [data-busy]")) throw new Error("请先确认或取消正在输入的待办事项");
    const payload = {category: taskCategory, title: $("task-title").value.trim(), location: $("task-location").value.trim(), todos: draftTodos, status: $("status").value,
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
  try { await api(`/api/tasks/${deleting.id}`, "DELETE", {revision: deleting.revision}); $("delete-dialog").close(); notice("任务已删除"); await refresh(); }
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
