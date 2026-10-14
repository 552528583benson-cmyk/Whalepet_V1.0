// Read-only adapter for local Codex task events. No prompts, replies or tool
// output are persisted or sent over the network. Transcript schema is best-effort.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { StringDecoder } = require("node:string_decoder");
const { createHash } = require('node:crypto');

const MESSAGES = Object.freeze({
  idle: "等待下一项任务", thinking: "正在认真思考", reading: "正在阅读文件",
  searching: "正在搜索", tool_use: "正在调用工具", working: "正在处理文件",
  testing: "正在检查结果", generating: "正在生成内容", needs_input: "需要你的回答",
  ready: "完成啦！", blocked: "任务遇到问题"
});
const TERMINAL = new Set(["ready", "idle"]);
const ATTENTION = new Set(['needs_input','blocked']);
const COMPLETION_MS = 3000;
const CURSOR_SAMPLE_BYTES = 4096;
function presentationPriority(task) {return task?.completion ? 70 : task?.uncertain&&!ATTENTION.has(task.state)?40:priority(task?.state);}
function priority(state) { return state==='needs_input'?100:state==='blocked'?90:state==='ready'?10:state==='idle'?0:50; }
function publicId(id) { return createHash('sha256').update(id).digest('hex').slice(0,8); }
function threadId(session) {return path.basename(session).match(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/i)?.[0]?.toLowerCase();}
function displayName(value) {return typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,120):'';}
function internalReviewSource(value) {
  try{if(typeof value==='string'&&value.length<16384)value=JSON.parse(value);}catch{return false;}
  // This exact source enum denotes Codex's internal approval reviewer. A
  // user conversation can have the same name and must remain visible.
  return value?.subagent?.other==='guardian';
}
async function fingerprint(handle,start,length) {
  const bytes=Buffer.alloc(length),{bytesRead}=await handle.read(bytes,0,length,start);
  return bytesRead===length?createHash('sha256').update(bytes).digest('hex'):null;
}

// Inspect only the app's bounded reply envelope, never retain answer text.
// null = ordinary user message; [] = malformed/unknown structured reply.
function replyQuestionIds(content) {
  const text=typeof content==='string'?content:Array.isArray(content)?content.filter(c=>['input_text','text'].includes(c?.type)).map(c=>c.text||'').join('\n'):'';
  if(!text.trimStart().startsWith('<send_user_message_question_reply>'))return null;
  if(text.length>256*1024)return [];
  const match=text.trim().match(/^<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>$/);
  if(!match)return [];
  try {
    const replies=JSON.parse(match[1]);if(!Array.isArray(replies))return [];
    return replies.flatMap(reply=>{
      if(!Object.hasOwn(reply,'answer'))return [];
      let id=reply.questionItemId;if(typeof id==='string')id=JSON.parse(id);
      return Array.isArray(id)&&typeof id[1]==='string'&&Number.isInteger(id[2])&&id[2]>=0?[{callId:id[1],index:id[2]}]:[];
    });
  }catch{return [];}
}

function toolState(name, input = "") {
  if (/request_user_input|ask_user|PermissionRequest|request_permissions/i.test(name)) return "needs_input";
  if (/imagegen|image_gen|generate_image/i.test(name)) return "generating";
  if (/apply_patch|write_file|edit_file/i.test(name)) return "working";
  if (/search|web.*run/i.test(name)) return "searching";
  if (/read_file|view_image|read_thread/i.test(name)) return "reading";
  if (/exec|bash|shell/i.test(name)) {
    // Code-mode calls wrap their actual tool names. Only inspect bounded tool
    // arguments; never evaluate the input or display its contents in the pet.
    const value = typeof input === "string" ? input.slice(0, 32768) : JSON.stringify(input).slice(0, 32768);
    if (/tools\.(?:\w*imagegen\w*|\w*image_gen\w*)\s*\(/i.test(value)) return "generating";
    if (/tools\.apply_patch\s*\(/.test(value)) return "working";
    if (/tools\.\w*web__run\s*\(/.test(value)) return "searching";
    if (/\b(?:npm\s+(?:run\s+)?(?:test|check)|pytest|vitest|jest|cargo\s+test|dotnet\s+test)\b/.test(value)) return "testing";
    if (/\b(?:Get-Content|read_file|view_image)\b/.test(value)) return "reading";
    if (/\b(?:rg|Select-String)\s/.test(value)) return "searching";
  }
  return "tool_use";
}

class TaskStates {
  constructor({ now = Date.now, staleMs = 15 * 60_000, attentionMs = 24 * 60 * 60_000 } = {}) {
    this.now = now;
    this.staleMs = staleMs;
    this.attentionMs = attentionMs;
    this.tasks = new Map();
    this.titles = new Map();
    this.parents = new Map();
    this.internalReviews = new Set();
    this.bubbleIds=[];
  }

  consume(id, record) {
    const p = record?.payload;
    if (!p) return;
    const key=threadId(id)||id;
    if(record.type==='session_meta'&&internalReviewSource(p.source))this.internalReviews.add(key);
    if(this.internalReviews.has(key))return;
    const time = Date.parse(record.timestamp);
    if (!Number.isFinite(time) || time > this.now() + 60_000 || this.now() - time > this.attentionMs) return;
    const previous = this.tasks.get(id);
    if (previous && time < previous.time) return;
    const pending = new Map(previous?.pending || []);
    const questions=new Map([...(previous?.questions||[])].map(([key,indices])=>[key,new Set(indices)]));
    const userContent=record.type==='response_item'&&p.type==='message'&&p.role==='user'?p.content
      :record.type==='event_msg'&&p.type==='item_completed'&&p.item?.type==='UserMessage'?p.item.content
      :record.type==='event_msg'&&p.type==='user_message'?p.message:undefined;
    const isUser=(record.type==='response_item'&&p.type==='message'&&p.role==='user')||
      (record.type==='event_msg'&&(p.type==='user_message'||p.type==='item_completed'&&p.item?.type==='UserMessage'));
    if(isUser){
      const ids=replyQuestionIds(userContent);
      if(ids===null){pending.clear();questions.clear();}
      else for(const {callId,index} of ids){
        if(!pending.has(callId))continue;
        const indices=questions.get(callId);
        if(indices){indices.delete(index);if(indices.size)continue;}
        pending.delete(callId);questions.delete(callId);
      }
    }
    let state;
    if (record.type === "event_msg") {
      if (['task_started','turn_started','turn_aborted','task_aborted','session_end'].includes(p.type)) pending.clear();
      if (["task_started", "turn_started", "user_message"].includes(p.type)) state = "thinking";
      if(isUser)state='thinking';
      if (["task_complete", "task_completed", "turn_complete", "turn_completed"].includes(p.type)) state = "ready";
      if (["turn_aborted", "task_aborted", "session_end"].includes(p.type)) state = "idle";
      if (["error", "turn_failed"].includes(p.type)) state = "blocked";
      if (["permission_request", "request_user_input"].includes(p.type)) {state = "needs_input";pending.set(p.call_id||p.request_id||'event','sync');}
      if (['request_user_input_response','permission_response','server_request_resolved'].includes(p.type)) {
        const key=p.call_id||p.request_id;
        if(key)pending.delete(key);else pending.clear();
        state='thinking';
      }
      if (["agent_reasoning", "agent_reasoning_raw_content"].includes(p.type)) state = "thinking";
    } else if (record.type === "turn_context") {
      state = "thinking";
    } else if (record.type === "response_item") {
      if(isUser)state='thinking';
      if (p.type === "reasoning") state = "thinking";
      if (p.type === "message" && p.role === "assistant") state = p.phase === "final" ? "ready" : "thinking";
      if (["function_call", "custom_tool_call"].includes(p.type)) {
        state = toolState(p.name || "", p.arguments || p.input || "");
        if(state==='needs_input'){
          const key=p.call_id||'legacy';pending.set(key,/async/i.test(p.name||'')?'async':'sync');
          try{const args=typeof p.arguments==='string'?JSON.parse(p.arguments):p.arguments;
            if(Array.isArray(args?.questions)&&args.questions.length)questions.set(key,new Set(args.questions.map((_,index)=>index)));
          }catch{/* Older logs may omit structured arguments. */}
        }
      }
      if (["function_call_output", "custom_tool_call_output"].includes(p.type)) {
        // Synchronous calls return after the answer. Async acknowledgement is
        // NOT an answer; unrelated tool results/reasoning cannot dismiss it.
        if(pending.get(p.call_id)==='sync')pending.delete(p.call_id);
        state = 'thinking';
      }
    }
    if (!state) return;
    if(TERMINAL.has(state))for(const [key,kind] of pending)if(kind==='sync')pending.delete(key);
    // Legacy logs without IDs cannot pair results; subsequent actual work
    // proves that a synchronous request is no longer blocking.
    if(state!=='needs_input' && !['function_call_output','custom_tool_call_output'].includes(p.type) && pending.get('legacy')==='sync')pending.delete('legacy');
    state=pending.size?'needs_input':state;
    // A final response and task_complete often describe the SAME completion.
    // Keep its original deadline; do not replay/extend the celebration.
    const completedAt=state==='ready'
      ? (previous?.state==='ready'?previous.completedAt:previous&&!TERMINAL.has(previous.state)?time:null)
      : null;
    for(const key of questions.keys())if(!pending.has(key))questions.delete(key);
    this.tasks.set(id, { state, time, pending, questions, completedAt });
  }

  snapshot() {
    // Silence is not a terminal event. Retain unresolved work (and questions)
    // until a new event resolves it; only confirmed terminal records expire.
    for(const [id,t] of this.tasks)if(TERMINAL.has(t.state)&&this.now()-t.time>Math.max(this.staleMs,COMPLETION_MS))this.tasks.delete(id);
    const members=[...this.tasks.entries()].filter(([session])=>!this.internalReviews.has(threadId(session)||session)).map(([session,t])=>{
      const completion=t.state==='ready'&&t.completedAt!=null&&this.now()-t.completedAt<COMPLETION_MS;
      const state=t.state==='ready'&&!completion?'idle':t.state;
      const uncertain=!TERMINAL.has(state)&&this.now()-t.time>(ATTENTION.has(state)?this.attentionMs:this.staleMs);
      return {state,message:uncertain?'状态待确认':MESSAGES[state],session,eventTime:t.time,id:publicId(session),completion,uncertain};
    });
    const groups=new Map();
    for(const member of members){
      const initial=threadId(member.session);let root=initial;
      const seen=new Set();
      while(root&&this.parents.has(root)&&!seen.has(root)&&seen.size<16){seen.add(root);root=this.parents.get(root);}
      if(seen.has(root))root=initial; // malformed ancestry cannot merge unrelated sessions
      if(this.internalReviews.has(root))continue;
      const key=root||member.session;
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push(member);
    }
    const list=[...groups].map(([session,members])=>{
      // A confirmed parent completion/cancellation retires older worker logs.
      // Missing worker terminal records must not keep a finished chat alive.
      // A later worker event can still reopen the group as genuine new activity.
      const boundary=members.find(t=>threadId(t.session)===session&&TERMINAL.has(t.state));
      const items=members.filter(t=>{
        if(boundary&&t!==boundary&&t.eventTime<=boundary.eventTime){this.tasks.delete(t.session);return false;}
        return true;
      });
      // Internal worker completion must not celebrate while its conversation
      // still works. Any unresolved urgent request continues to take priority.
      const active=items.filter(t=>!TERMINAL.has(t.state));
      const pool=active.length?active:items;
      pool.sort((a,b)=>presentationPriority(b)-presentationPriority(a)||b.eventTime-a.eventTime);
      return {...pool[0],session,id:publicId(session)};
    });
    list.sort((a,b)=>presentationPriority(b)-presentationPriority(a)||
      (a.session===this.selected?-1:b.session===this.selected?1:0)||b.eventTime-a.eventTime||a.id.localeCompare(b.id));
    this.selected=list[0]?.session;
    return list;
  }
  current() {return this.snapshot()[0]||null;}
  hasUnresolved() {return this.snapshot().some(t=>!TERMINAL.has(t.state));}
  overflow() {
    const hidden=this.snapshot().filter(t=>t.state!=='idle').slice(2);
    return {count:hidden.filter(t=>!t.completion).length,uncertain:hidden.filter(t=>t.uncertain).length};
  }
  conversations() {
    const visible=this.snapshot().filter(t=>t.state!=='idle').slice(0,2);
    const ids=new Set(visible.map(t=>t.id));
    // Keep each bubble bound to its task and in the same slot through green.
    this.bubbleIds=this.bubbleIds.filter(id=>ids.has(id));
    for(const t of visible)if(!this.bubbleIds.includes(t.id))this.bubbleIds.push(t.id);
    return this.bubbleIds.map(id=>visible.find(t=>t.id===id)).map(({id,state,message,session,uncertain})=>{
    return {id,state,message,uncertain,primary:session===this.selected,title:this.titles.get(threadId(session))||'未命名会话'};
  });}
}

class CodexStateFollower {
  constructor({ directory, onState, onStatus = () => {}, now = Date.now, pollMs = 500, staleMs } = {}) {
    this.directory = directory || path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "sessions");
    this.onState = onState;
    this.onStatus = onStatus;
    this.now = now;
    this.pollMs = pollMs;
    this.reducer = new TaskStates({ now, staleMs });
    this.files = new Map();
    this.running = false;
    this.lastValue = "";
    this.hadState = false;
  }

  async discover(directory = this.directory) {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!this.running) return;
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await this.discover(filename).catch(error => {if(this.strictRead)throw error;});
      else if (entry.isFile() && entry.name.endsWith(".jsonl") && !this.files.has(filename)) {
        this.files.set(filename, { offset: null, pending: "", decoder: new StringDecoder("utf8") });
      }
    }
  }

  async readTitles() {
    // Only local index metadata, never user prompts or assistant replies.
    const file=path.join(path.dirname(this.directory),'session_index.jsonl');
    const handle=await fs.promises.open(file,'r');
    try {
      const stat=await handle.stat(),start=Math.max(0,stat.size-256*1024);
      const buffer=Buffer.alloc(stat.size-start);await handle.read(buffer,0,buffer.length,start);
      const lines=buffer.toString('utf8').split('\n');if(start)lines.shift();
      for(const line of lines)try {
        const item=JSON.parse(line);
        const name=displayName(item.thread_name);
        if(typeof item.id==='string'&&name)this.reducer.titles.set(item.id.toLowerCase(),name);
      }catch{}
    }finally{await handle.close();}
  }

  async readThreadMetadata() {
    // Subagents lack session_index names. Resolve their parent and explicit
    // UI name from the local DB. NEVER select title/first_user_message: raw
    // title may be an entire prompt rather than the displayed conversation name.
    let DatabaseSync;try{({DatabaseSync}=require('node:sqlite'));}catch{return;}
    const directory=path.dirname(this.directory);
    const names=(await fs.promises.readdir(directory)).filter(n=>/^state_\d+\.sqlite$/.test(n)).sort((a,b)=>Number(b.match(/\d+/)[0])-Number(a.match(/\d+/)[0]));
    if(!names.length)return;
    const db=new DatabaseSync(path.join(directory,names[0]),{readOnly:true});
    try {
      db.exec('PRAGMA busy_timeout=50; PRAGMA query_only=ON;');
      const columns=new Set(db.prepare('PRAGMA table_info(threads)').all().map(c=>c.name));
      if(!columns.has('id')||!columns.has('source'))return;
      const visited=new Set();let ids=[...new Set([...this.reducer.tasks.keys()].map(threadId).filter(Boolean))];
      for(let depth=0;ids.length&&depth<16;depth++){
        const next=[];
        for(let start=0;start<ids.length;start+=256){
          const batch=ids.slice(start,start+256);
          const rows=db.prepare(`SELECT id, ${columns.has('name')?'name':'NULL AS name'}, source FROM threads WHERE id IN (${batch.map(()=>'?').join(',')})`).all(...batch);
          for(const row of rows){
            const id=row.id.toLowerCase();visited.add(id);
            const name=displayName(row.name);if(name)this.reducer.titles.set(id,name);
            let source;try{if(typeof row.source==='string'&&row.source.length<16384)source=JSON.parse(row.source);}catch{}
            if(internalReviewSource(source)){this.reducer.internalReviews.add(id);continue;}
            const parent=source?.subagent?.thread_spawn?.parent_thread_id;
            if(typeof parent==='string'&&threadId(parent)===parent.toLowerCase()&&parent.toLowerCase()!==id){
              this.reducer.parents.set(id,parent.toLowerCase());
              if(!visited.has(parent.toLowerCase()))next.push(parent.toLowerCase());
            }
          }
          batch.forEach(id=>visited.add(id));
        }
        ids=[...new Set(next)].filter(id=>!visited.has(id));
      }
    }finally{db.close();}
  }

  async readFile(filename, cursor) {
    const stat = await fs.promises.stat(filename);
    if (cursor.offset === null) {
      // Never read an entire long-running transcript (some exceed 500 MB).
      cursor.offset = stat.mtimeMs < this.now() - this.reducer.attentionMs ? stat.size : Math.max(0, stat.size - 256 * 1024);
      cursor.skipFirst = cursor.offset > 0 && cursor.offset < stat.size;
    }
    if (stat.size < cursor.offset) {
      this.reducer.tasks.delete(filename);
      cursor.offset = 0; cursor.pending = ""; cursor.skipFirst = false;
      cursor.decoder = new StringDecoder("utf8");
    }
    if (stat.size <= cursor.offset) return;
    const handle = await fs.promises.open(filename, "r");
    try {
      const buffer = Buffer.alloc(Math.min(stat.size - cursor.offset, 256 * 1024));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, cursor.offset);
      cursor.offset += bytesRead;
      cursor.pending += cursor.decoder.write(buffer.subarray(0, bytesRead));
      let end;
      while ((end = cursor.pending.indexOf("\n")) !== -1) {
        const line = cursor.pending.slice(0, end);
        cursor.pending = cursor.pending.slice(end + 1);
        if (cursor.skipFirst) { cursor.skipFirst = false; continue; }
        try { this.reducer.consume(filename, JSON.parse(line)); } catch { /* incomplete/unknown events are harmless */ }
      }
      if (cursor.pending.length > 1024 * 1024) { cursor.pending = ""; cursor.skipFirst = true; }
      // Keep tiny source samples rather than transcript content. Explicit
      // reload can then preserve known question provenance only when the
      // previous source is still present, including on very long logs.
      const length=Math.min(cursor.offset,CURSOR_SAMPLE_BYTES),start=cursor.offset-length;
      const head=await fingerprint(handle,0,length),tail=start?await fingerprint(handle,start,length):head;
      cursor.anchor=head&&tail?{end:cursor.offset,length,start,head,tail}:null;
    } finally { await handle.close(); }
  }

  async carryKnownTasks(fresh) {
    for(const [filename,task] of this.reducer.tasks){
      const anchor=this.files.get(filename)?.anchor;if(!anchor)continue;
      let handle;
      try {
        handle=await fs.promises.open(filename,'r');
        if((await handle.stat()).size<anchor.end)continue;
        if(await fingerprint(handle,0,anchor.length)!==anchor.head)continue;
        if(anchor.start&&await fingerprint(handle,anchor.start,anchor.length)!==anchor.tail)continue;
        fresh.reducer.tasks.set(filename,{...task,pending:new Map(task.pending),
          questions:new Map([...task.questions].map(([key,indices])=>[key,new Set(indices)]))});
      }catch(error){if(error.code!=='ENOENT')throw error;}
      finally{await handle?.close();}
    }
    fresh.reducer.titles=new Map(this.reducer.titles);
    fresh.reducer.parents=new Map(this.reducer.parents);
    fresh.reducer.internalReviews=new Set(this.reducer.internalReviews);
    fresh.reducer.bubbleIds=[...this.reducer.bubbleIds];fresh.reducer.selected=this.reducer.selected;
  }

  tick() {
    if(!this.running||this.reloadPromise)return Promise.resolve();
    if(this.tickPromise)return this.tickPromise;
    this.tickPromise=this.scan().finally(()=>{this.tickPromise=null;});
    return this.tickPromise;
  }

  async scan() {
    try {
      const refreshMetadata=!this.lastScan||this.now()-this.lastScan>10_000;
      if (!this.lastScan || this.now() - this.lastScan > 10_000) {
        this.lastScan = this.now();
        await this.discover();
        await this.readTitles().catch(()=>{});
      }
      for (const [filename, cursor] of this.files) {
        if (!this.running) break;
        await this.readFile(filename, cursor).catch(error => {
          if(this.strictRead)throw error;
          if (error.code === "ENOENT") {this.files.delete(filename);this.reducer.tasks.delete(filename);}
        });
      }
      if(refreshMetadata)await this.readThreadMetadata().catch(()=>{});
      const selected = this.reducer.current();
      if (selected || this.hadState) {
        const value = selected || { state: "idle", message: MESSAGES.idle };
        const conversations=this.reducer.conversations();
        const conversationOverflow=this.reducer.overflow();
        const key = JSON.stringify([value.state, value.session,conversations,conversationOverflow]);
        if (key !== this.lastValue && this.running) {
          this.lastValue = key;
          this.hadState = Boolean(selected);
          this.onState({ state: value.state, message: value.message, conversations,conversationOverflow });
          this.onStatus({ status: "following", state: value.state, lastEventAt: value.eventTime || null, conversations,conversationOverflow });
        }
      }
    } catch (error) {
      this.onStatus({ status: error.code === "ENOENT" ? "not-found" : "unavailable", error: error.code || "read-failed" });
    }
  }

  reload() {
    if(this.reloadPromise)return this.reloadPromise;
    if(!this.running)return Promise.reject(new Error('自动跟随尚未开启'));
    this.reloadPromise=(async()=>{
      await this.tickPromise;
      let value,status;
      const fresh=new CodexStateFollower({directory:this.directory,now:this.now,staleMs:this.reducer.staleMs,
        onState:next=>{value=next;},onStatus:next=>{status=next;}});
      fresh.running=true;fresh.hadState=true;fresh.strictRead=true;
      try {
        try{await this.carryKnownTasks(fresh);}catch(error){
          throw new Error('未能重新读取 Codex 任务，已保留原状态。请检查本地任务目录后重试。',{cause:error});
        }
        await fresh.tick();
        if(!this.running)throw new Error('监听已关闭，请重新开启后再试');
        if(status?.status!=='following'||!value)throw new Error('未能重新读取 Codex 任务，已保留原状态。请检查本地任务目录后重试。');
        // Commit only after a complete successful bounded scan. A failed
        // reload must not erase a genuine pending question or ongoing work.
        this.reducer=fresh.reducer;this.files=fresh.files;
        this.lastScan=fresh.lastScan;this.lastValue=fresh.lastValue;this.hadState=fresh.hadState;
        this.onState(value);
        this.onStatus({...status,reloadedAt:this.now()});
        return value;
      } finally {fresh.running=false;}
    })().finally(()=>{this.reloadPromise=null;});
    return this.reloadPromise;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.onStatus({ status: "listening" });
    this.tick();
    this.timer = setInterval(() => this.tick(), this.pollMs);
    this.timer.unref?.();
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    this.files.clear();
    this.reducer.tasks.clear();
    this.reducer.titles.clear();
    this.reducer.parents.clear();
    this.reducer.internalReviews.clear();
    this.reducer.bubbleIds=[];
    this.lastValue='';this.hadState=false;this.lastScan=0;this.reducer.selected=null;
  }
}

module.exports = { CodexStateFollower, TaskStates, toolState, priority, COMPLETION_MS };
