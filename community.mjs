export const COMMUNITY_SCHEMA=`
CREATE TABLE IF NOT EXISTS feedback_messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,thread_user_id TEXT NOT NULL REFERENCES trial_users(id),sender_id TEXT NOT NULL REFERENCES trial_users(id),
 body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),client_id TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(sender_id,client_id));
CREATE INDEX IF NOT EXISTS feedback_thread ON feedback_messages(thread_user_id,id);
CREATE TABLE IF NOT EXISTS feedback_reads (user_id TEXT NOT NULL REFERENCES trial_users(id),thread_user_id TEXT NOT NULL REFERENCES trial_users(id),last_id INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,thread_user_id));
CREATE TABLE IF NOT EXISTS announcements (id INTEGER PRIMARY KEY AUTOINCREMENT,author_id TEXT NOT NULL REFERENCES trial_users(id),body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),client_id TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS announcement_reads (user_id TEXT PRIMARY KEY REFERENCES trial_users(id),last_id INTEGER NOT NULL DEFAULT 0);
`;
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const integer=value=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<0)fail(400,"消息位置不正确");return n;};
function message(data){
  if(typeof data.body!=="string" || !data.body.trim() || data.body.length>2000)fail(400,"消息需为 1–2000 个字符");
  if(typeof data.client_id!=="string" || !/^[a-zA-Z0-9-]{16,64}$/.test(data.client_id))fail(400,"缺少消息标识，请刷新重试");
  return {text:data.body.trim(),key:data.client_id};
}
export async function community(request,env,user,{body,limit}) {
  const url=new URL(request.url),path=url.pathname,method=request.method,db=env.DB,admin=user.slot===1;
  if(path==="/api/feedback/threads" && method==="GET"){
    if(!admin)fail(403,"仅管理员可查看用户会话");
    const rows=await db.prepare(`SELECT u.id,u.username,m.body AS preview,m.created_at,
      (SELECT count(*) FROM feedback_messages f WHERE f.thread_user_id=u.id AND f.sender_id<>? AND f.id>coalesce(r.last_id,0)) AS unread
      FROM trial_users u JOIN feedback_messages m ON m.id=(SELECT max(id) FROM feedback_messages WHERE thread_user_id=u.id)
      LEFT JOIN feedback_reads r ON r.thread_user_id=u.id AND r.user_id=? WHERE u.status='active' AND u.slot<>1 ORDER BY m.id DESC`).bind(user.id,user.id).all();
    return Response.json({threads:rows.results});
  }
  if(path==="/api/feedback/unread" && method==="GET"){
    const row=await db.prepare(`SELECT count(*) AS total FROM feedback_messages m LEFT JOIN feedback_reads r ON r.thread_user_id=m.thread_user_id AND r.user_id=? WHERE m.sender_id<>? AND m.id>coalesce(r.last_id,0)${admin?"":" AND m.thread_user_id=?"}`).bind(user.id,user.id,...(admin?[]:[user.id])).first();
    return Response.json(row);
  }
  const match=path.match(/^\/api\/feedback\/([a-zA-Z0-9-]{1,64})(\/read)?$/);
  if(match && !["threads","unread"].includes(match[1])){
    const target=match[1]==="me"?user.id:match[1];
    if(!admin && target!==user.id)fail(403,"只能查看自己与管理员的对话");
    const other=await db.prepare("SELECT id,username,slot FROM trial_users WHERE id=? AND status='active'").bind(target).first();
    if(!other || other.slot===1)fail(404,"会话不存在");
    if(match[2] && method==="POST"){
      const id=integer((await body(request)).last_id);
      if(id && !await db.prepare("SELECT 1 FROM feedback_messages WHERE id=? AND thread_user_id=?").bind(id,target).first())fail(400,"消息不属于此会话");
      await db.prepare("INSERT INTO feedback_reads(user_id,thread_user_id,last_id) VALUES (?,?,?) ON CONFLICT(user_id,thread_user_id) DO UPDATE SET last_id=max(last_id,excluded.last_id)").bind(user.id,target,id).run();return Response.json({ok:true});
    }
    if(!match[2] && method==="GET"){
      const before=integer(url.searchParams.get("before") || 0);
      const rows=await db.prepare(`SELECT id,sender_id,body,created_at,client_id FROM feedback_messages WHERE thread_user_id=?${before?" AND id<?":""} ORDER BY id DESC LIMIT 51`).bind(target,...(before?[before]:[])).all();
      return Response.json({name:admin?other.username:"管理员",messages:rows.results.slice(0,50).reverse().map(m=>({...m,mine:m.sender_id===user.id,sender_id:undefined})),more:rows.results.length>50});
    }
    if(!match[2] && method==="POST"){
      const value=message(await body(request));await limit(db,`feedback:${user.id}`,60);
      await db.prepare("INSERT INTO feedback_messages(thread_user_id,sender_id,body,client_id,created_at) VALUES (?,?,?,?,?) ON CONFLICT(sender_id,client_id) DO NOTHING").bind(target,user.id,value.text,value.key,new Date().toISOString()).run();
      const sent=await db.prepare("SELECT id,thread_user_id FROM feedback_messages WHERE sender_id=? AND client_id=?").bind(user.id,value.key).first();
      if(sent.thread_user_id!==target)fail(409,"消息标识已使用，请重新发送");return Response.json({ok:true,id:sent.id});
    }
  }
  if(path==="/api/announcements" && method==="GET"){
    const before=integer(url.searchParams.get("before") || 0);
    const rows=await db.prepare(`SELECT id,body,created_at FROM announcements${before?" WHERE id<?":""} ORDER BY id DESC LIMIT 51`).bind(...(before?[before]:[])).all();
    const read=await db.prepare("SELECT last_id FROM announcement_reads WHERE user_id=?").bind(user.id).first();
    return Response.json({announcements:rows.results.slice(0,50),more:rows.results.length>50,last_read:read?.last_id || 0});
  }
  if(path==="/api/announcements" && method==="POST"){
    if(!admin)fail(403,"只有管理员可以发布公告");
    const value=message(await body(request));await limit(db,`announcements:${user.id}`,20);
    await db.prepare("INSERT INTO announcements(author_id,body,client_id,created_at) VALUES (?,?,?,?) ON CONFLICT(client_id) DO NOTHING").bind(user.id,value.text,value.key,new Date().toISOString()).run();return Response.json({ok:true});
  }
  if(path==="/api/announcements/read" && method==="POST"){
    const id=integer((await body(request)).last_id);
    if(id && !await db.prepare("SELECT 1 FROM announcements WHERE id=?").bind(id).first())fail(400,"公告不存在");
    await db.prepare("INSERT INTO announcement_reads(user_id,last_id) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET last_id=max(last_id,excluded.last_id)").bind(user.id,id).run();return Response.json({ok:true});
  }
  fail(404,"消息接口不存在");
}
