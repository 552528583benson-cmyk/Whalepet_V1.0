const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {TaskStates,CodexStateFollower}=require('../codex-state-follower');
(async()=>{
  let now=Date.now();const guardian='10000001-1111-1111-1111-111111111111',user='10000002-2222-2222-2222-222222222222';
  const r=new TaskStates({now:()=>now});
  const emit=(id,type,payload,time=now)=>r.consume(id,{timestamp:new Date(time).toISOString(),type,payload});
  // Metadata identity applies even when its timestamp predates the active
  // tail. The exact enum, not a title or arbitrary message text, is decisive.
  emit(guardian,'session_meta',{source:{subagent:{other:'guardian'}}},now-48*60*60*1000);
  emit(guardian,'event_msg',{type:'request_user_input'});
  assert.equal(r.current(),null);assert.equal(r.hasUnresolved(),false);assert.deepEqual(r.conversations(),[]);
  emit(user,'session_meta',{source:'cli'});r.titles.set(user,'Guardian review');
  emit(user,'event_msg',{type:'task_started'});
  assert.equal(r.current().state,'thinking');assert.equal(r.conversations()[0].title,'Guardian review','a legitimate user chat with the same title remains visible');
  emit(guardian,'event_msg',{type:'task_started'});emit(guardian,'event_msg',{type:'task_complete'});
  assert.equal(r.current().state,'thinking','internal review completion cannot celebrate over user work');
  assert.equal(r.overflow().count,0);

  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'whalepet-internal-review-')),sessions=path.join(dir,'sessions');fs.mkdirSync(sessions);
  const file=id=>path.join(sessions,`rollout-${id}.jsonl`),seen=[];
  const write=(id,type,payload)=>fs.appendFileSync(file(id),JSON.stringify({timestamp:new Date(now).toISOString(),type,payload})+'\n');
  const database=path.join(dir,'state_5.sqlite'),db=new DatabaseSync(database);
  db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY,name TEXT,source TEXT)');
  db.prepare('INSERT INTO threads VALUES (?,?,?)').run(guardian,'Guardian review',JSON.stringify({subagent:{other:'guardian'}}));
  db.prepare('INSERT INTO threads VALUES (?,?,?)').run(user,'Guardian review','cli');db.close();
  const follower=new CodexStateFollower({directory:sessions,now:()=>now,onState:s=>seen.push(s)});
  try{
    // No session_meta survives the bounded tail; SQLite source metadata still
    // distinguishes the internal reviewer from a genuinely same-named chat.
    write(guardian,'event_msg',{type:'task_started'});write(guardian,'event_msg',{type:'task_complete'});
    write(user,'event_msg',{type:'task_started'});write(user,'response_item',{type:'function_call',name:'apply_patch'});
    follower.running=true;await follower.tick();
    assert.equal(seen.at(-1).state,'working');assert.equal(seen.at(-1).conversations.length,1);
    assert.equal(seen.at(-1).conversations[0].title,'Guardian review');
    await follower.reload();assert.equal(seen.at(-1).state,'working');assert.equal(seen.at(-1).conversations.length,1);
    now++;write(user,'event_msg',{type:'turn_aborted'});await follower.tick();
    assert.equal(seen.at(-1).state,'idle');assert.deepEqual(seen.at(-1).conversations,[]);assert.equal(follower.reducer.hasUnresolved(),false);
    console.log('PASS: exact guardian source excluded via old session metadata and SQLite, never by name; real same-named conversation, reload, priority, bubble count and idle remain correct.');
  }finally{follower.stop();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
