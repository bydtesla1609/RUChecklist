"use strict";
let messageReady=false,startupMessageShown=false,releaseState=null,announcementState=null,noticeSnapshot=null;
let chatTarget=null,chatMessages=[],chatMore=false,chatSequence=0,chatBusy=false,chatPending=null,communityUnread=0;
function resetMessages(){
  messageReady=false;startupMessageShown=false;releaseState=announcementState=noticeSnapshot=null;
  chatSequence++;chatTarget=null;chatMessages=[];chatMore=false;chatPending=null;chatBusy=false;communityUnread=0;
  $("chat-input").value="";$("chat-bubbles").replaceChildren();$("chat-threads").replaceChildren();$("messages-content").replaceChildren();
  $("feedback-unread").hidden=true;$("user-unread").hidden=true;$("chat-send").disabled=false;$("chat-error").textContent="";
}
async function archiveTask(task,archived){
  if(hasDraft()){notice("请先保存或取消待办草稿");return;}
  try{await api(`/api/tasks/${task.id}/archive`,"PATCH",{archived,revision:task.revision});lastPayload="";await refresh();if($("archive-dialog").open)await loadArchive();notice(archived?"已归档，可在归档处恢复":"已恢复到看板");}
  catch(error){notice(error.message);}
}
async function startMessages(){
  const session=syncSession;resetMessages();
  $("feedback-button").hidden=!trialMode;$("feedback-button").querySelector("span").textContent=isAdmin?"公告与答疑":"与管理员反馈";
  $("feedback-title").textContent=isAdmin?"公告与答疑":"与管理员反馈";
  $("feedback-dialog").classList.toggle("admin-chat",isAdmin);$("messages-error").textContent="";
  const results=await Promise.allSettled([api("/api/notices"),trialMode?api("/api/announcements"):Promise.resolve({announcements:[],last_read:0}),checkCloud()]);
  if(session!==syncSession || $("workspace").hidden)return;
  releaseState=results[0].status==="fulfilled"?results[0].value:null;
  announcementState=results[1].status==="fulfilled"?results[1].value:null;
  if(!releaseState || !announcementState)$("messages-error").textContent="部分消息暂时读取失败，可重新打开消息看板重试。";
  messageReady=true;refreshCommunityUnread();
}
function expiredSources(){return sources.filter(s=>needsLogin(s)&&(sourceLinksState===null||sourceLinksState.some(l=>l.source===s.id)));}
function soonTasks(){
  const now=Date.now(),end=now+7*86400000;
  return tasks.filter(t=>!["课程","记录"].includes(t.category) && t.status!=="done" && !t.archived_at && Date.parse(t.category==="作业"?t.due_at:t.starts_at)>=now && Date.parse(t.category==="作业"?t.due_at:t.starts_at)<=end)
    .sort((a,b)=>Date.parse(a.category==="作业"?a.due_at:a.starts_at)-Date.parse(b.category==="作业"?b.due_at:b.starts_at));
}
function unreadAnnouncements(){return (announcementState?.announcements || []).filter(a=>a.id>(announcementState?.last_read || 0));}
function maybeMessageBoard(){
  if(!messageReady || startupMessageShown || document.hidden || $("workspace").hidden || document.querySelector("dialog[open]") || hasDraft())return;
  startupMessageShown=true;
  if(releaseState?.unread || expiredSources().length || soonTasks().length || unreadAnnouncements().length || communityUnread){renderMessages(false);$("messages-dialog").showModal();}
}
function messageSection(title){const section=element("section",null,"message-section");section.append(element("h3",title));$("messages-content").append(section);return section;}
function renderMessages(manual){
  $("messages-content").replaceChildren();const release=releaseState?.release,announcements=manual?(announcementState?.announcements || []):unreadAnnouncements();
  noticeSnapshot={version:releaseState?.unread?release?.version:null,announcement:Math.max(0,...announcements.map(a=>a.id))};
  if(release && (manual || releaseState.unread)){
    const section=messageSection("更新优化"),history=element("div",null,"release-history");history.id="release-history";history.hidden=true;
    const entry=release=>{const article=element("article",null,"release-entry");article.append(element("h4",`v${release.version} · ${release.title}`));const list=element("ul");release.items.forEach(text=>list.append(element("li",text)));article.append(list);return article;};
    section.append(entry(release));
    const older=(releaseState.releases || []).filter(item=>item.version!==release.version);
    if(older.length){
      history.append(...older.map(entry));const more=element("button","查看更多","text-button release-more");more.type="button";more.setAttribute("aria-expanded","false");more.setAttribute("aria-controls",history.id);
      more.onclick=()=>{history.hidden=!history.hidden;more.setAttribute("aria-expanded",String(!history.hidden));more.textContent=history.hidden?"查看更多":"收起历史更新";if(history.hidden)more.scrollIntoView({block:"nearest"});};
      section.append(history,more);
    }
  }
  const expired=expiredSources();
  if(expired.length){const section=messageSection("以下网站登录过期");section.append(element("p","点击跳转并重新登录；请在已连接扩展的电脑浏览器完成。","hint"));expired.forEach(source=>{const row=element("div",null,"expired-site");row.append(element("strong",source.name),loginLink(source));section.append(row);});}
  const soon=soonTasks();
  for(const category of ["作业","考试","会议","活动"]){const group=soon.filter(task=>task.category===category);if(!group.length)continue;const section=messageSection(`未来 7 天${category==="作业"?"到期":"开始"} · ${category} ${group.length} 项`);for(const task of group){const row=element("div",null,"message-task");row.append(element("strong",task.title),element("time",formatTime(category==="作业"?task.due_at:task.starts_at,true)));section.append(row);}}
  if(announcements.length){const section=messageSection("公告通知");for(const a of announcements){const row=element("article",null,"announcement");row.append(element("small",`管理员 · ${formatTime(a.created_at,true)}`),element("p",a.body));section.append(row);}}
  if(communityUnread){const section=messageSection(`收到 ${communityUnread} 条新消息`),button=element("button",isAdmin?"查看用户反馈":"查看管理员回复","secondary");button.onclick=()=>{$("messages-dialog").close();openChat();};section.append(button);}
  if(!$("messages-content").children.length)$("messages-content").append(element("p","暂无新的消息或未来 7 天的安排。","muted"));
}
$("messages-button").onclick=async()=>{
  const session=syncSession;$("messages-error").textContent="";
  try{const [release,announcements]=await Promise.all([api("/api/notices"),trialMode?api("/api/announcements"):Promise.resolve({announcements:[],last_read:0}),checkCloud()]);if(session!==syncSession)return;releaseState=release;announcementState=announcements;startupMessageShown=true;renderMessages(true);$("messages-dialog").showModal();}
  catch(error){notice(error.message);}
};
$("messages-read").onclick=async()=>{
  const session=syncSession,snapshot=noticeSnapshot;$("messages-read").disabled=true;
  try{if(snapshot?.version)await api("/api/notices/read","POST",{version:snapshot.version});if(trialMode&&snapshot?.announcement)await api("/api/announcements/read","POST",{last_id:snapshot.announcement});if(session!==syncSession)return;if(releaseState)releaseState.unread=false;if(announcementState)announcementState.last_read=snapshot?.announcement || announcementState.last_read;$("messages-dialog").close();maybeDemo();}
  catch(error){$("messages-error").textContent=error.message;}finally{$("messages-read").disabled=false;}
};
async function refreshCommunityUnread(){
  if(!trialMode || $("workspace").hidden)return;const session=syncSession;
  try{const data=await api("/api/feedback/unread");if(session!==syncSession)return;communityUnread=data.total;$("feedback-unread").textContent=data.total>99?"99+":String(data.total);$("feedback-unread").hidden=!data.total;$("user-unread").hidden=!data.total;maybeMessageBoard();}catch{}
}
async function openChat(){
  if(!trialMode)return;$("chat-error").textContent="";$("feedback-dialog").dataset.active=isAdmin?"false":"true";$("feedback-dialog").showModal();
  if(isAdmin){await loadThreads();if(!chatTarget)await selectChat("announcements");else await loadChat();$("feedback-dialog").dataset.active="false";}else await selectChat("me");
}
$("feedback-button").onclick=openChat;
$("chat-back").onclick=()=>{$("feedback-dialog").dataset.active="false";loadThreads();};
async function loadThreads(){
  const session=syncSession;
  try{const data=await api("/api/feedback/threads");if(session!==syncSession)return;
    const pinned=element("button",null,"chat-thread pinned");pinned.append(element("strong","发布公告"),element("small","置顶 · 所有试用用户可见"));pinned.setAttribute("aria-pressed",String(chatTarget==="announcements"));pinned.onclick=()=>selectChat("announcements");
    $("chat-threads").replaceChildren(pinned,...data.threads.map(t=>{const button=element("button",null,"chat-thread");button.setAttribute("aria-pressed",String(chatTarget===t.id));button.append(element("strong",t.username+(t.unread?` · ${t.unread} 条未读`:"")),element("small",t.preview));button.onclick=()=>selectChat(t.id);return button;}));
    if(!data.threads.length)$("chat-threads").append(element("p","暂未收到用户反馈。","hint"));
  }catch(error){$("chat-error").textContent=error.message;}
}
async function selectChat(target){
  if(chatBusy)return;
  if(chatTarget!==target && $("chat-input").value.trim() && !await confirmAction("切换会话？","当前未发送的内容将被丢弃。","放弃并切换"))return;
  if(chatTarget!==target){$("chat-input").value="";chatPending=null;}
  chatTarget=target;chatMessages=[];chatMore=false;$("chat-bubbles").replaceChildren();$("chat-error").textContent="";$("feedback-dialog").dataset.active="true";
  $("chat-send").textContent=target==="announcements"?"发布公告":"发送";$("chat-input").placeholder=target==="announcements"?"输入公告，发布后其他用户打开网站时会收到提醒…":"反馈建议、遇到的问题，或补充说明…";
  await loadChat();if(isAdmin)await loadThreads();
}
function renderChat(){
  $("chat-bubbles").replaceChildren(...chatMessages.map(m=>{const row=element("article",null,"chat-message"+(m.mine?" mine":""));row.dataset.id=m.id;row.append(element("p",m.body,"chat-bubble"),element("time",formatTime(m.created_at,true)));return row;}));
  if(!chatMessages.length)$("chat-bubbles").append(element("p",chatTarget==="announcements"?"还没有公告，在下方发布第一条。":"说说你的建议或遇到的问题。管理员回复后会在这里显示。","chat-empty"));
  $("chat-older").hidden=!chatMore;
}
async function loadChat(older=false){
  if(!chatTarget || !$("feedback-dialog").open)return;const session=syncSession,target=chatTarget,sequence=++chatSequence;
  const history=$("chat-history"),height=history.scrollHeight,top=history.scrollTop,atEnd=height-top-history.clientHeight<70;
  const before=older?chatMessages[0]?.id:0;
  try{const data=await api(`${target==="announcements"?"/api/announcements":`/api/feedback/${target}`}${before?`?before=${before}`:""}`);
    if(session!==syncSession||sequence!==chatSequence||target!==chatTarget||!$("feedback-dialog").open)return;
    const items=target==="announcements"?data.announcements.slice().reverse().map(m=>({...m,mine:true})):data.messages;
    // After a long offline interval, restart at the latest page rather than skip a gap.
    if(!older && data.more && items[0]?.id>chatMessages.at(-1)?.id)chatMessages=[];
    const merged=new Map((older?[...items,...chatMessages]:[...chatMessages,...items]).map(m=>[m.id,m]));
    const next=[...merged.values()].sort((a,b)=>a.id-b.id);const changed=JSON.stringify(next)!==JSON.stringify(chatMessages);
    if(older || !chatMessages.length)chatMore=data.more;
    chatMessages=next;$("chat-name").textContent=target==="announcements"?"发布公告":data.name;$("chat-state").textContent="";
    if(changed || !items.length){renderChat();if(older)history.scrollTop=top+history.scrollHeight-height;else if(atEnd||!top)history.scrollTop=history.scrollHeight;}
    if(target!=="announcements" && items.length){await api(`/api/feedback/${target}/read`,"POST",{last_id:items.at(-1).id});if(session===syncSession)refreshCommunityUnread();}
  }catch(error){if(session===syncSession&&sequence===chatSequence)$("chat-error").textContent=error.message;}
}
$("chat-older").onclick=()=>loadChat(true);
$("chat-form").onsubmit=async event=>{
  event.preventDefault();if(chatBusy||!chatTarget)return;const text=$("chat-input").value.trim();if(!text)return;
  const session=syncSession,target=chatTarget;chatBusy=true;$("chat-send").disabled=true;$("chat-error").textContent="";
  if(!chatPending||chatPending.target!==target||chatPending.text!==text)chatPending={target,text,key:crypto.randomUUID()};
  try{await api(target==="announcements"?"/api/announcements":`/api/feedback/${target}`,"POST",{body:text,client_id:chatPending.key});if(session!==syncSession)return;$("chat-input").value="";chatPending=null;await loadChat();$("chat-history").scrollTop=$("chat-history").scrollHeight;if(isAdmin)loadThreads();}
  catch(error){if(session===syncSession)$("chat-error").textContent=`${error.message}。内容已保留，可重试发送。`;}
  finally{if(session===syncSession){chatBusy=false;$("chat-send").disabled=false;}}
};
let lastCommunityPoll=0,chatPolling=false;
setInterval(async()=>{
  if(!trialMode||document.hidden||$("workspace").hidden||chatPolling)return;
  if(!$("feedback-dialog").open && Date.now()-lastCommunityPoll<60000)return;
  lastCommunityPoll=Date.now();chatPolling=true;
  try{if($("feedback-dialog").open){await loadChat();if(isAdmin)await loadThreads();}await refreshCommunityUnread();}finally{chatPolling=false;}
},6000);
