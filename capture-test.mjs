import test from 'node:test';
import assert from 'node:assert/strict';
import './static/axis-layout.js';
process.env.TRIAL_UI_FIXTURE='1';
const {trialFixture}=await import('./trial-test.mjs');

test('records and axes are private, revision protected, detach without deletion, and retain archived history',async()=>{
  const {database,invites,client}=await trialFixture();const a=client(),b=client();
  try{
    for(const [i,c] of [a,b].entries())assert.equal((await c.api('/api/register','POST',{username:`capture${i}`,password:'Ab1234',invite:invites[i]})).status,200);
    assert.equal((await client().api('/api/axes','POST',{title:'Private'})).status,401);
    const axis=(await a.api('/api/axes','POST',{title:'学会摄影',content:'沿途记录'})).data;
    assert.equal((await a.api('/api/axes','POST',{title:'invalid',starts_at:'2026-11-01T00:00:00Z',ends_at:'2026-10-01T00:00:00Z'})).status,400);
    const record={category:'记录',title:'第一张照片',content:'观察到树叶的纹理',starts_at:'2026-10-01T08:00:00Z',axis_id:axis.id};
    assert.equal((await b.api('/api/tasks','POST',record)).status,400);
    let task=(await a.api('/api/tasks','POST',record)).data;assert.equal(task.category,'记录');assert.equal(task.ends_at,task.starts_at);assert.equal(task.status,'todo');
    assert.equal((await b.api(`/api/axes/${axis.id}`,'PATCH',{title:'other',revision:1})).status,409);
    assert.equal((await b.api('/api/board')).data.axes.length,0);
    assert.equal((await a.api('/api/board')).data.axis_items[0].id,task.id);
    task=(await a.api(`/api/tasks/${task.id}/archive`,'PATCH',{archived:true,revision:task.revision})).data;
    const board=(await a.api('/api/board')).data;assert.equal(board.tasks.length,0);assert.equal(board.axis_items[0].id,task.id);
    assert.equal((await a.api(`/api/axes/${axis.id}`,'DELETE',{revision:0})).status,409);
    assert.equal((await a.api(`/api/tasks/${task.id}`)).data.axis_id,axis.id);
    assert.equal((await a.api(`/api/axes/${axis.id}`,'DELETE',{revision:1})).status,200);
    const kept=(await a.api(`/api/tasks/${task.id}`)).data;assert.equal(kept.axis_id,null);assert.equal(kept.content,record.content);assert.ok(kept.archived_at);
    const second=(await a.api('/api/axes','POST',{title:'随记'})).data;
    let active=(await a.api('/api/tasks','POST',{...record,axis_id:second.id,status:'done'})).data;assert.equal(active.status,'done');
    active=(await a.api(`/api/tasks/${active.id}`,'PATCH',{axis_id:null,revision:active.revision})).data;assert.equal(active.axis_id,null);assert.equal((await a.api('/api/board')).data.tasks.length,1);
  }finally{database.close();}
});
test('axis projections cannot cross, including unequal node spacing and large drags',()=>{
  const lines=Array.from({length:6},(_,i)=>({nodes:Array.from({length:5+i},(_,j)=>({x:j*180+(j%2)*25,y:i*220+(j===2?(i%2?-800:1100):0)}))}));
  for(let pivot=0;pivot<lines.length;pivot++){
    const paths=CaptureLayout.project(lines,pivot);
    for(let i=1;i<paths.length;i++)for(let x=0;x<=paths[i-1].at(-1).x;x+=7){assert.ok(CaptureLayout.interpolate(paths[i],x)-CaptureLayout.interpolate(paths[i-1],x)>=104.999);}
  }
});


test('dragging either endpoint retains geometric clearance around neighbouring nodes',()=>{
  for(let sample=0;sample<40;sample++){
    const lines=Array.from({length:4},(_,i)=>({nodes:Array.from({length:4+i},(_,j)=>({x:sample*7+i*19+j*95,y:i*190+(j%2?-sample*40:sample*30)}))}));
    for(const anchor of [0,3]){
      const paths=CaptureLayout.project(lines,0,112,anchor);
      for(const path of paths)for(let j=1;j<path.length;j++)assert.ok(Math.abs((path[j].y-path[j-1].y)/(path[j].x-path[j-1].x))<=1.20001);
      for(let i=1;i<paths.length;i++){
        const start=Math.max(paths[i][0].x,paths[i-1][0].x),end=Math.min(paths[i].at(-1).x,paths[i-1].at(-1).x);
        for(let x=start;x<=end;x+=3)assert.ok(CaptureLayout.interpolate(paths[i],x)-CaptureLayout.interpolate(paths[i-1],x)>=111.999);
      }
    }
  }
});
