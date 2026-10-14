const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {CodexStateFollower}=require('../codex-state-follower');
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'whalepet-reload-provenance-'));
  const file=path.join(dir,'task.jsonl'),seen=[];let now=Date.now();
  const record=(type,payload)=>JSON.stringify({timestamp:new Date(++now).toISOString(),type,payload})+'\n';
  const append=(type,payload)=>fs.appendFileSync(file,record(type,payload));
  const filler=()=>record('event_msg',{type:'fixture_non_state',padding:'x'.repeat(300*1024)});
  const follower=new CodexStateFollower({directory:dir,now:()=>now,onState:s=>seen.push(s)});
  const drain=async()=>{for(let i=0;i<8;i++){await follower.tick();if(follower.files.get(file)?.offset===fs.statSync(file).size)return;}throw new Error('fixture did not drain');};
  const reply=index=>append('response_item',{type:'message',role:'user',content:[{type:'input_text',text:`<send_user_message_question_reply>\n${JSON.stringify([{questionItemId:JSON.stringify(['request_user_input_async','question',index]),answer:'fixture'}])}\n</send_user_message_question_reply>`}]});
  try{
    append('event_msg',{type:'task_started'});
    append('response_item',{type:'function_call',name:'request_user_input_async',call_id:'question',arguments:JSON.stringify({questions:[{},{}]})});
    follower.running=true;await drain();assert.equal(seen.at(-1).state,'needs_input');
    fs.appendFileSync(file,filler());await drain();
    await follower.reload();
    assert.equal(seen.at(-1).state,'needs_input','bounded reload must retain a known unanswered request before the tail');
    assert.equal(follower.reducer.tasks.get(file).questions.get('question').size,2);
    reply(0);await drain();await follower.reload();
    assert.equal(seen.at(-1).state,'needs_input','reload retains the unanswered part of a multi-question request');
    assert.deepEqual([...follower.reducer.tasks.get(file).questions.get('question')],[1]);
    fs.appendFileSync(file,filler());await drain();await follower.reload();
    assert.equal(seen.at(-1).state,'needs_input','a tail containing only a large ignored record must not manufacture idle');
    reply(1);await drain();await follower.reload();
    assert.equal(seen.at(-1).state,'thinking','a matched answer after the preserved request resumes work');
    assert.equal(follower.reducer.tasks.get(file).pending.size,0);

    // A replaced source is authoritative even if its events predate the old
    // cursor. Carrying old state without verifying the source would hide it.
    const replacementTime=now-1000;
    fs.writeFileSync(file,filler()+JSON.stringify({timestamp:new Date(replacementTime).toISOString(),type:'event_msg',payload:{type:'turn_aborted'}})+'\n');
    await follower.reload();
    assert.equal(seen.at(-1).state,'idle','confirmed terminal in a replaced source overrides cached newer work');
    append('event_msg',{type:'request_user_input'});await drain();
    const before=follower.reducer.tasks.get(file);
    follower.directory=path.join(dir,'missing');await assert.rejects(follower.reload(),/保留原状态/);
    assert.equal(follower.reducer.tasks.get(file),before,'failed reload leaves the original request object unchanged');
    assert.equal(before.state,'needs_input');
    console.log('PASS: bounded reload preserves old and partially answered questions, resumes on matched answers, detects replacement and retains failed-reload state.');
  }finally{follower.stop();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
