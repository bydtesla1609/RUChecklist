import test from 'node:test';
import assert from 'node:assert/strict';
process.env.TRIAL_UI_FIXTURE='1';
const {trialFixture}=await import('./trial-test.mjs');
const message=body=>({body,client_id:crypto.randomUUID()});

test('admin invitation, private feedback, unread receipts, announcements and archive isolation',async()=>{
  const {database:db,invites,client}=await trialFixture();
  const admin=client(),alice=client(),bob=client(),anon=client(),users=[admin,alice,bob];
  try{
    for(const [i,c] of users.entries()){
      const r=await c.api('/api/register','POST',{username:['admin','alice','bob'][i],password:'Ab1234',invite:invites[i]});
      assert.equal(r.status,200);assert.equal(r.data.admin,i===0);assert.equal((await c.api('/api/session')).data.admin,i===0);
    }
    const aliceId=db.prepare("SELECT id FROM trial_users WHERE slot=2").get().id,bobId=db.prepare("SELECT id FROM trial_users WHERE slot=3").get().id;
    assert.equal((await anon.api('/api/feedback/threads')).status,401);
    assert.equal((await alice.api('/api/feedback/threads')).status,403);
    const hello=message('<img src=x onerror=alert(1)> 问题反馈');
    const sent=await alice.api('/api/feedback/me','POST',hello);assert.equal(sent.status,200);
    assert.equal((await alice.api('/api/feedback/me','POST',hello)).data.id,sent.data.id);
    assert.equal(db.prepare('SELECT count(*) n FROM feedback_messages').get().n,1);
    for(const method of ['GET','POST'])assert.equal((await bob.api(`/api/feedback/${aliceId}`,method,method==='POST'?message('越权'):undefined)).status,403);
    assert.equal((await bob.api(`/api/feedback/${aliceId}/read`,'POST',{last_id:sent.data.id})).status,403);
    assert.equal((await bob.api('/api/feedback/me/read','POST',{last_id:sent.data.id})).status,400);
    assert.equal((await bob.api('/api/feedback/me')).data.messages.length,0);
    const threads=(await admin.api('/api/feedback/threads')).data.threads;assert.equal(threads.length,1);assert.equal(threads[0].username,'alice');assert.equal(threads[0].unread,1);
    assert.equal((await admin.api('/api/feedback/unread')).data.total,1);
    const incoming=(await admin.api(`/api/feedback/${aliceId}`)).data.messages[0];assert.equal(incoming.body,hello.body);assert.equal(incoming.mine,false);assert.ok(!('sender_id' in incoming));
    await admin.api(`/api/feedback/${aliceId}/read`,'POST',{last_id:sent.data.id});assert.equal((await admin.api('/api/feedback/unread')).data.total,0);
    const reply=message('收到，我会排查'),response=await admin.api(`/api/feedback/${aliceId}`,'POST',reply);assert.equal(response.status,200);
    assert.equal((await admin.api(`/api/feedback/${bobId}`,'POST',reply)).status,409);
    assert.equal((await alice.api('/api/feedback/unread')).data.total,1);assert.equal((await bob.api('/api/feedback/unread')).data.total,0);
    await alice.api('/api/feedback/me/read','POST',{last_id:response.data.id});await alice.api('/api/feedback/me/read','POST',{last_id:0});assert.equal((await alice.api('/api/feedback/unread')).data.total,0);
    for(const body of ['', 'x'.repeat(2001)])assert.equal((await alice.api('/api/feedback/me','POST',message(body))).status,400);
    assert.equal((await alice.api('/api/feedback/me?before=abc')).status,400);
    assert.equal((await alice.api('/api/announcements','POST',message('伪公告'))).status,403);
    const bulletin=message('试用通知');assert.equal((await admin.api('/api/announcements','POST',bulletin)).status,200);await admin.api('/api/announcements','POST',bulletin);
    const feed=(await alice.api('/api/announcements')).data;assert.equal(feed.announcements.length,1);assert.equal(feed.last_read,0);
    await alice.api('/api/announcements/read','POST',{last_id:feed.announcements[0].id});assert.equal((await bob.api('/api/announcements')).data.last_read,0);
    const release=(await alice.api('/api/notices')).data;assert.equal(release.unread,true);
    assert.deepEqual(release.releases.map(item=>item.version),['3.1.5','3.1.4','3.1.3','3.1.2','3.1.1','3.1.0','3.0.0']);
    assert.deepEqual(release.release,release.releases[0]);assert.ok(release.releases.every(item=>item.title && item.items.length));
    assert.equal((await alice.api('/api/notices/read','POST',{version:'3.0.0'})).status,400,'reading history must not mark the latest update read');
    await alice.api('/api/notices/read','POST',{version:release.release.version});assert.equal((await alice.api('/api/notices')).data.unread,false);assert.equal((await bob.api('/api/notices')).data.unread,true);
    const task=(await alice.api('/api/tasks','POST',{title:'归档隔离',category:'活动',starts_at:'2026-10-04T00:00:00Z',ends_at:'2026-10-04T01:00:00Z'})).data;
    assert.equal((await bob.api(`/api/tasks/${task.id}/archive`,'PATCH',{archived:true,revision:task.revision})).status,409);
    const archived=await alice.api(`/api/tasks/${task.id}/archive`,'PATCH',{archived:true,revision:task.revision});assert.equal(archived.status,200);
    assert.equal((await alice.api(`/api/tasks/${task.id}/archive`,'PATCH',{archived:false,revision:task.revision})).status,409);
    assert.equal((await alice.api('/api/board')).data.tasks.length,0);assert.equal((await alice.api('/api/archive')).data.total,1);assert.equal((await bob.api('/api/archive')).data.total,0);
    assert.equal((await alice.api(`/api/tasks/${task.id}/archive`,'PATCH',{archived:false,revision:archived.data.revision})).status,200);
    const token=(await alice.api('/api/collector-token','POST',{})).data.token;assert.equal((await anon.api('/api/feedback/me','POST',message('token unauthorized'),{Authorization:`Bearer ${token}`})).status,401);
    // Pagination must preserve every message, including identical text with distinct client IDs.
    for(let n=0;n<51;n++)assert.equal((await admin.api(`/api/feedback/${aliceId}`,'POST',message('补充说明'))).status,200);
    const recent=(await alice.api('/api/feedback/me')).data;assert.equal(recent.messages.length,50);assert.equal(recent.more,true);
    const older=(await alice.api(`/api/feedback/me?before=${recent.messages[0].id}`)).data;assert.equal(older.messages.length,3);assert.equal(older.more,false);
    assert.equal(new Set([...recent.messages,...older.messages].map(m=>m.id)).size,53);
  }finally{db.close();}
});
