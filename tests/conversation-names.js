const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {CodexStateFollower}=require('../codex-state-follower');
(async()=>{
 const run=fs.mkdtempSync(path.join(os.tmpdir(),'whalepet-names-')),sessions=path.join(run,'sessions');fs.mkdirSync(sessions);
 const root='10000000-1111-1111-1111-111111111111',child='20000000-2222-2222-2222-222222222222',nested='30000000-3333-3333-3333-333333333333',other='40000000-4444-4444-4444-444444444444';
 const file=id=>path.join(sessions,`rollout-${id}.jsonl`),seen=[];
 let eventTime=Date.now();
 const emit=(id,type,payload)=>fs.appendFileSync(file(id),JSON.stringify({timestamp:new Date(eventTime++).toISOString(),type,payload})+'\n');
 const database=path.join(run,'state_5.sqlite'),db=new DatabaseSync(database);
 db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, name TEXT, source TEXT, title TEXT, first_user_message TEXT)');
 const insert=(id,name,parent)=>db.prepare('INSERT INTO threads VALUES (?,?,?,?,?)').run(id,name,parent?JSON.stringify({subagent:{thread_spawn:{parent_thread_id:parent}}}):'cli','PRIVATE PROMPT MUST NOT BE DISPLAYED','PRIVATE MESSAGE');
 insert(root,'我们的会话',null);insert(child,null,root);insert(nested,null,child);insert(other,null,null);db.close();
 const follower=new CodexStateFollower({directory:sessions,onState:s=>seen.push(s)});
 try{
  emit(root,'event_msg',{type:'task_started'});emit(child,'event_msg',{type:'task_started'});emit(nested,'event_msg',{type:'request_user_input'});
  follower.running=true;await follower.tick();
  assert.equal(seen.at(-1).conversations.length,1,'nested workers form one real conversation');
  assert.equal(seen.at(-1).conversations[0].title,'我们的会话');assert.equal(seen.at(-1).state,'needs_input');
  emit(nested,'event_msg',{type:'user_message'});emit(child,'event_msg',{type:'task_complete'});await follower.tick();
  assert.notEqual(seen.at(-1).state,'ready','one completed worker does not celebrate an active conversation');
  const rename=new DatabaseSync(database);rename.prepare('UPDATE threads SET name=? WHERE id=?').run('新的会话名字',root);rename.close();follower.lastScan=0;await follower.tick();
  assert.equal(seen.at(-1).conversations[0].title,'新的会话名字','explicit rename updates without a new status');
  emit(other,'event_msg',{type:'task_started'});follower.lastScan=0;await follower.tick();
  assert.equal(seen.at(-1).conversations.length,2);
  assert.ok(seen.at(-1).conversations.some(c=>c.title==='未命名会话'),'missing name never exposes hash or raw prompt title');
  await follower.reload();assert.ok(seen.at(-1).conversations.some(c=>c.title==='新的会话名字'));
  emit(root,'event_msg',{type:'task_complete'});await follower.tick();
  assert.equal(seen.at(-1).conversations.find(c=>c.title==='新的会话名字').state,'ready','confirmed parent completion retires workers missing a terminal');
  emit(other,'event_msg',{type:'task_complete'});await follower.tick();
  assert.equal(follower.reducer.hasUnresolved(),false,'old worker cannot block idle after both conversations finish');
  emit(nested,'event_msg',{type:'task_started'});await follower.tick();
  assert.equal(seen.at(-1).conversations.find(c=>c.title==='新的会话名字').state,'thinking','new worker activity after parent completion reopens the group');
  assert.ok(!JSON.stringify(seen).includes('PRIVATE'),'metadata lookup never reads prompt title or message');
  console.log('PASS: nested parent grouping, actual display names, rename, parent/worker completion, resumed worker, unnamed fallback and reload.');
 }finally{follower.stop();fs.rmSync(run,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
