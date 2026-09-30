const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {CodexStateFollower}=require('../codex-state-follower');
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'whalepet-reload-'));
  const file=path.join(dir,'task.jsonl'),seen=[];
  const line=type=>JSON.stringify({timestamp:new Date().toISOString(),type:'event_msg',payload:{type}})+'\n';
  const follower=new CodexStateFollower({directory:dir,onState:s=>seen.push(s)});
  try{
    fs.writeFileSync(file,line('request_user_input'));follower.running=true;await follower.tick();
    assert.equal(follower.reducer.current().state,'needs_input');
    await follower.reload();assert.equal(follower.reducer.current().state,'needs_input','reload preserves a genuine question');
    // Replace the source with a longer file: incremental offsets cannot detect
    // this rotation, whereas an explicit reload must rebuild from the source.
    fs.writeFileSync(file,line('task_started')+line('agent_reasoning'));
    const first=follower.reload();assert.equal(follower.reload(),first,'concurrent reloads are coalesced');await first;
    assert.equal(seen.at(-1).state,'thinking');
    const originalDir=follower.directory;follower.directory=path.join(dir,'missing');
    await assert.rejects(follower.reload(),/保留原状态/);
    assert.equal(follower.reducer.current().state,'thinking','read failure retains working state');
    follower.directory=originalDir;
    fs.writeFileSync(file,line('turn_aborted'));await follower.reload();
    assert.equal(seen.at(-1).state,'idle');assert.equal(seen.at(-1).conversations.length,0);
    fs.appendFileSync(file,line('task_started'));await follower.tick();
    assert.equal(seen.at(-1).state,'thinking','incremental following continues after reload');
    const pending=follower.reload();follower.stop();await assert.rejects(pending,/监听已关闭/);
    await assert.rejects(follower.reload(),/尚未开启/);
    console.log('PASS: reload rereads source, preserves real questions, coalesces clicks, handles failure/stop, then continues following.');
  }finally{follower.stop();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
