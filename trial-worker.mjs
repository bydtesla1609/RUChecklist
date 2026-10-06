import board,{digest,applyImport,SOURCES,autoArchive} from "./worker.mjs";
import {partition,accountDatabase,TRIAL_SLOTS} from "./trial-schema.mjs";
import {runCloud} from "./cloud.mjs";
import {community} from "./community.mjs";
const userEnvironment=(env,user)=>({...env,DB:partition(accountDatabase(env,user.slot),user.slot),BOARD_PASSWORD_HASH:"trial-authenticated",SOURCE_URLS:"{}",TRIAL_MODE:true,TRIAL_USER:user.id});
export async function runTrialCloud(env,scheduledTime=Date.now(),options={}) {
  if(env.CLOUD_DISPATCH){
    const minute=Math.floor(scheduledTime/60000),slots=Array.from({length:10},(_,i)=>minute%30+1+i*30);
    const {results:accounts}=await env.DB.prepare(`SELECT slot FROM trial_users WHERE status='active' AND slot IN (${slots.map(()=>"?").join(",")})`).bind(...slots).all();
    const results=[];
    for(let offset=0;offset<accounts.length;offset+=3){
      const batch=await Promise.allSettled(accounts.slice(offset,offset+3).map(async({slot})=>{
        const sentMinute=Math.floor(Date.now()/60000),signature=await digest(`${env.CLOUD_ENCRYPTION_KEY}:${sentMinute}:${slot}`);
        const result=await env.CLOUD_DISPATCH.fetch(new Request(`https://internal/internal/sync/${slot}`,{method:"POST",headers:{"X-Sync-Minute":String(sentMinute),"X-Sync-Signature":signature}}));
        await result.arrayBuffer();return {slot,ok:result.ok};
      }));
      results.push(...batch.map((result,i)=>result.status==="fulfilled"?result.value:{slot:accounts[offset+i].slot,ok:false}));
    }
    if(results.some(result=>!result.ok))console.error("Cloud dispatch incomplete",results.filter(result=>!result.ok).map(result=>result.slot));
    return results;
  }
  // Local fixture and legacy single-slot scheduler.
  const slot=Math.floor(scheduledTime/60000)%30+1;
  const user=await env.DB.prepare("SELECT id,slot FROM trial_users WHERE slot=? AND status='active'").bind(slot).first();
  if(!user)return {skipped:true};
  const scoped=userEnvironment(env,user);
  await autoArchive(scoped.DB,scheduledTime);
  return runCloud(scoped,payload=>applyImport(payload,scoped.DB,SOURCES),options);
}
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const json=(data,status=200,headers={})=>Response.json(data,{status,headers});
const random=()=>[...crypto.getRandomValues(new Uint8Array(24))].map(b=>b.toString(16).padStart(2,"0")).join("");
const sessionCookie=(token,age=null)=>`trial_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict${age===null?"":`; Max-Age=${age}`}`;
async function body(request) {
  if(!request.headers.get("Content-Type")?.includes("application/json"))fail(400,"请发送 JSON");
  const reader=request.body?.getReader();if(!reader)fail(400,"缺少内容");
  let size=0;const chunks=[];
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();fail(413,"内容过长");}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try {const result=JSON.parse(new TextDecoder().decode(bytes));if(result && typeof result==="object" && !Array.isArray(result))return result;}catch{}
  fail(400,"内容格式错误");
}
function credentials(data,requireNew=false) {
  const username=typeof data.username==="string"?data.username.trim().toLowerCase():"";
  if(!/^[a-z][a-z0-9_]{2,23}$/.test(username))fail(400,"用户名为 3–24 位小写字母、数字或下划线，以字母开头");
  if(typeof data.password!=="string" || data.password.length<6 || new TextEncoder().encode(data.password).length>72)fail(400,"密码至少 6 个字符，最多 72 字节");
  if(requireNew && (!/[A-Za-z]/.test(data.password) || !/[0-9]/.test(data.password)))fail(400,"密码需同时包含英文字母和数字");
  return {username,password:data.password};
}
async function limit(db,key,max) {
  const now=Date.now(),cutoff=now-300000;
  const row=await db.prepare("INSERT INTO trial_attempts(key,count,since) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN since<? THEN 1 ELSE count+1 END,since=CASE WHEN since<? THEN excluded.since ELSE since END RETURNING count").bind(key,now,cutoff,cutoff).first();
  if(row.count>max)fail(429,"操作太频繁，请 5 分钟后重试");
}
async function authService(env,path,method,value) {
  if(!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)fail(503,"认证服务尚未配置，暂未开放注册");
  const origin=new URL(env.SUPABASE_URL);
  if(origin.protocol!=="https:" || !/^[a-z0-9]+\.supabase\.co$/.test(origin.hostname))fail(503,"认证服务配置错误");
  let response;
  try {response=await (env.AUTH_FETCH || fetch)(`${origin.origin}/auth/v1${path}`,{method,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,"Content-Type":"application/json"},body:JSON.stringify(value),redirect:"manual",signal:AbortSignal.timeout(15000)});}
  catch{fail(503,"认证服务暂时未响应，请稍后重试");}
  if(response.status>=300 && response.status<400)fail(503,"认证服务返回了意外跳转，请联系维护者");
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(response.status===429?"认证操作过于频繁，请稍后再试":"用户名或密码不正确，或认证暂时不可用"),{status:response.status===429?429:401,authStatus:response.status});
  return data;
}
const authEmail=user=>`u-${user.id}@accounts.ruchecklist.invalid`;
async function createSession(db,user,extra={},remember=false) {
  const token=random();
  await db.batch([db.prepare("DELETE FROM trial_sessions WHERE expires<?").bind(Date.now()),db.prepare("DELETE FROM trial_attempts WHERE since<?").bind(Date.now()-86400000),db.prepare("INSERT INTO trial_sessions(hash,user_id,expires) VALUES (?,?,?)").bind(await digest(token),user.id,Date.now()+(remember?30:1)*86400000)]);
  return json({ok:true,account:user.id,username:user.username,admin:user.slot===1,...extra},200,{"Set-Cookie":sessionCookie(token,remember?30*86400:null)});
}
async function route(request,env) {
  const url=new URL(request.url),path=url.pathname,method=request.method,db=env.DB;
  if(path.startsWith("/internal/")){
    const slot=Number(path.match(/^\/internal\/sync\/(\d+)$/)?.[1]),minute=Number(request.headers.get("X-Sync-Minute"));
    if(env.CLOUD_INTERNAL!=="true" || !env.CLOUD_ENCRYPTION_KEY || method!=="POST" || !Number.isInteger(slot) || slot<1 || slot>TRIAL_SLOTS || !Number.isInteger(minute) || Math.abs(minute-Math.floor(Date.now()/60000))>5 || request.headers.get("X-Sync-Signature")!==await digest(`${env.CLOUD_ENCRYPTION_KEY}:${minute}:${slot}`))fail(404,"页面不存在");
    const user=await db.prepare("SELECT id,slot FROM trial_users WHERE slot=? AND status='active'").bind(slot).first();if(!user)return json({skipped:true});
    const scoped=userEnvironment(env,user);await autoArchive(scoped.DB);return json(await runCloud(scoped,payload=>applyImport(payload,scoped.DB,SOURCES)));
  }
  if(!path.startsWith("/api/"))return board.fetch(request,env);
  if(!db)fail(503,"服务尚未配置");
  const collectorPath=["/api/import","/api/collector-config","/api/academic/timetable","/api/cloud-authorize","/api/cloud-credentials"].includes(path);
  if(!["GET","HEAD"].includes(method) && !collectorPath && ((request.headers.get("Origin") && request.headers.get("Origin")!==url.origin) || request.headers.get("Sec-Fetch-Site")==="cross-site"))fail(403,"不允许跨站请求");
  const token=(request.headers.get("Cookie") || "").split(";").map(s=>s.trim()).find(s=>s.startsWith("trial_session="))?.slice(14) || "";
  const hash=await digest(token);
  const session=token?await db.prepare("SELECT u.* FROM trial_users u JOIN trial_sessions s ON s.user_id=u.id WHERE s.hash=? AND s.expires>? AND u.status='active'").bind(hash,Date.now()).first():null;
  if(path==="/api/session" && method==="GET"){
    const counts=await db.prepare("SELECT count(*) total,coalesce(sum(status='active'),0) registered FROM trial_users").first();
    return json({trial:true,public_registration:env.PUBLIC_REGISTRATION==="true",authenticated:!!session,account:session?.id || null,username:session?.username || null,admin:session?.slot===1,registered:counts.registered,capacity:TRIAL_SLOTS,registration_open:env.REGISTRATION_OPEN==="true" && counts.registered<TRIAL_SLOTS && !!env.SUPABASE_URL && !!env.SUPABASE_SERVICE_ROLE_KEY});
  }
  if(["/api/register","/api/login","/api/recover"].includes(path) && method==="POST") {
    const data=await body(request),{username,password}=credentials(data,path!=="/api/login");
    await limit(db,`ip:${await digest(request.headers.get("CF-Connecting-IP") || "local")}`,60);
    await limit(db,`name:${await digest(username)}`,10);
    if(path==="/api/register") {
      if(env.REGISTRATION_OPEN!=="true")fail(403,"暂未开放新注册");
      let user,inviteHash=null;
      if(env.PUBLIC_REGISTRATION==="true"){
        await limit(db,`register:${await digest(request.headers.get("CF-Connecting-IP") || "local")}`,10);
        user=await db.prepare("SELECT * FROM trial_users WHERE username=?").bind(username).first();
        if(user && user.status!=="pending")fail(409,"用户名已被使用");
        if(!user){
          try{user=await db.prepare("INSERT INTO trial_users(id,slot,username,created_at) SELECT ?,slot,?,? FROM (WITH RECURSIVE slots(slot) AS (SELECT 2 UNION ALL SELECT slot+1 FROM slots WHERE slot<300) SELECT slot FROM slots WHERE slot NOT IN (SELECT slot FROM trial_users) ORDER BY slot LIMIT 1) RETURNING *").bind(crypto.randomUUID(),username,Date.now()).first();}
          catch{fail(409,"注册正在处理，请稍后重试");}
          if(!user)fail(403,"本阶段 300 个名额已满，已有账号可继续登录");
        }
      }else{
        if(typeof data.invite!=="string" || !/^[a-f0-9]{48}$/.test(data.invite.trim()))fail(400,"请输入有效邀请码");
        inviteHash=await digest(data.invite.trim());
        const invite=await db.prepare("SELECT * FROM trial_invites WHERE hash=?").bind(inviteHash).first();
        if(!invite)fail(400,"邀请码无效");
        user=await db.prepare("SELECT * FROM trial_users WHERE slot=?").bind(invite.slot).first();
        if(user && (user.status!=="pending" || user.username!==username))fail(409,"邀请码已使用");
        if(!user){
          if(await db.prepare("SELECT 1 FROM trial_users WHERE username=?").bind(username).first())fail(409,"用户名已被使用");
          const id=crypto.randomUUID();try{await db.prepare("INSERT INTO trial_users(id,slot,username,created_at) VALUES (?,?,?,?)").bind(id,invite.slot,username,Date.now()).run();}catch{fail(409,"注册正在处理，请稍后重试");}
          user={id,slot:invite.slot,username,status:"pending"};
        }
      }
      accountDatabase(env,user.slot);
      let identity;
      try {identity=await authService(env,"/admin/users","POST",{email:authEmail(user),password,email_confirm:true});}
      catch(error){
        if(![400,422].includes(error.authStatus))throw error;
        identity=(await authService(env,"/token?grant_type=password","POST",{email:authEmail(user),password})).user;
      }
      const authId=identity?.id || identity?.user?.id;if(!authId)fail(503,"认证结果不完整，请稍后重试");
      const recovery=random();
      const result=await db.batch([db.prepare("UPDATE trial_users SET auth_id=?,recovery_hash=?,status='active' WHERE id=? AND status='pending'").bind(authId,await digest(recovery),user.id),...(inviteHash?[db.prepare("UPDATE trial_invites SET used_by=? WHERE hash=? AND used_by IS NULL").bind(user.id,inviteHash)]:[])]);
      if(result[0].meta.changes!==1)fail(409,"注册已完成，请直接登录");
      return createSession(db,user,{recovery},data.remember===true);
    }
    const user=await db.prepare("SELECT * FROM trial_users WHERE username=? AND status='active'").bind(username).first();
    if(path==="/api/recover") {
      if(typeof data.recovery!=="string" || !user || await digest(data.recovery.trim())!==user.recovery_hash)fail(401,"用户名或恢复码不正确");
      // Consume before calling the provider. Restore on a definite failure so a timeout is retryable.
      const claim=random();const locked=await db.prepare("UPDATE trial_users SET recovery_hash=? WHERE id=? AND recovery_hash=?").bind(claim,user.id,user.recovery_hash).run();
      if(locked.meta.changes!==1)fail(409,"恢复操作正在进行");
      try {await authService(env,`/admin/users/${user.auth_id}`,"PUT",{password});}
      catch(error){await db.prepare("UPDATE trial_users SET recovery_hash=? WHERE id=? AND recovery_hash=?").bind(user.recovery_hash,user.id,claim).run();throw error;}
      const recovery=random();await db.batch([db.prepare("UPDATE trial_users SET recovery_hash=? WHERE id=? AND recovery_hash=?").bind(await digest(recovery),user.id,claim),db.prepare("DELETE FROM trial_sessions WHERE user_id=?").bind(user.id),db.prepare("DELETE FROM trial_collectors WHERE user_id=?").bind(user.id)]);
      return createSession(db,user,{recovery},data.remember===true);
    }
    if(!user)fail(401,"用户名或密码不正确");
    const result=await authService(env,"/token?grant_type=password","POST",{email:authEmail(user),password});
    if(result.user?.id!==user.auth_id)fail(401,"用户名或密码不正确");
    return createSession(db,user,{},data.remember===true);
  }
  if(path==="/api/logout" && method==="POST") {await db.prepare("DELETE FROM trial_sessions WHERE hash=?").bind(hash).run();return json({ok:true},200,{"Set-Cookie":sessionCookie("",0)});}
  let user=session;
  if(collectorPath) {
    const bearer=request.headers.get("Authorization")?.match(/^Bearer ([a-f0-9]{48})$/)?.[1];
    user=bearer?await db.prepare("SELECT u.* FROM trial_users u JOIN trial_collectors c ON c.user_id=u.id WHERE c.hash=? AND u.status='active'").bind(await digest(bearer)).first():null;
  }
  if(!user)fail(401,"请先登录自己的账号，或重新连接扩展");
  if(path.startsWith("/api/feedback/") || path.startsWith("/api/announcements"))return community(request,env,user,{body,limit});
  if(path==="/api/recovery-code" && method==="POST") {
    await limit(db,`recovery:${user.id}`,5);const data=await body(request);
    const {password}=credentials({...data,username:user.username});
    const result=await authService(env,"/token?grant_type=password","POST",{email:authEmail(user),password});
    if(result.user?.id!==user.auth_id)fail(401,"密码不正确");
    const recovery=random();await db.prepare("UPDATE trial_users SET recovery_hash=? WHERE id=?").bind(await digest(recovery),user.id).run();return json({recovery});
  }
  if(path.startsWith("/api/academic/retry"))fail(403,"请通过浏览器重新同步课表");
  const scoped={...userEnvironment(env,user),TRIAL_AUTHENTICATED:!collectorPath};
  if(path==="/api/collector-token" && method==="POST") {
    const collector=random(),hash=await digest(collector);
    await db.batch([db.prepare("INSERT INTO trial_collectors(hash,user_id) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET hash=excluded.hash").bind(hash,user.id),scoped.DB.prepare("INSERT INTO settings(key,value) VALUES ('collector_hash',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(hash)]);
    return json({token:collector});
  }
  return board.fetch(request,scoped);
}
export default {async scheduled(event,env,ctx){ctx.waitUntil(runTrialCloud(env,event.scheduledTime));},async fetch(request,env){
  let response;try {response=await route(request,env);}catch(error){response=json({error:error.status?error.message:"请求未完成，请稍后重试"},error.status || 500);}
  const headers=new Headers(response.headers);headers.set("Cache-Control","no-store");headers.set("X-Content-Type-Options","nosniff");headers.set("Referrer-Policy","no-referrer");
  if(!headers.has("Content-Security-Policy"))headers.set("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self' chrome-extension:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  return new Response(response.body,{status:response.status,headers});
}};
