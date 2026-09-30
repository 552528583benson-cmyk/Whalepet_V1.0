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
function presentationPriority(task) {return task?.completion ? 70 : task?.uncertain&&!ATTENTION.has(task.state)?40:priority(task?.state);}
function priority(state) { return state==='needs_input'?100:state==='blocked'?90:state==='ready'?10:state==='idle'?0:50; }
function publicId(id) { return createHash('sha256').update(id).digest('hex').slice(0,8); }

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
    this.bubbleIds=[];
  }

  consume(id, record) {
    const p = record?.payload;
    if (!p) return;
    const time = Date.parse(record.timestamp);
    if (!Number.isFinite(time) || time > this.now() + 60_000 || this.now() - time > this.attentionMs) return;
    const previous = this.tasks.get(id);
    if (previous && time < previous.time) return;
    const pending = new Map(previous?.pending || []);
    let state;
    if (record.type === "event_msg") {
      if (['task_started','turn_started','user_message','turn_aborted','task_aborted','session_end'].includes(p.type)) pending.clear();
      if (["task_started", "turn_started", "user_message"].includes(p.type)) state = "thinking";
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
      if(p.type==='message' && p.role==='user'){pending.clear();state='thinking';}
      if (p.type === "reasoning") state = "thinking";
      if (p.type === "message" && p.role === "assistant") state = p.phase === "final" ? "ready" : "thinking";
      if (["function_call", "custom_tool_call"].includes(p.type)) {
        state = toolState(p.name || "", p.arguments || p.input || "");
        if(state==='needs_input')pending.set(p.call_id||'legacy',/async/i.test(p.name||'')?'async':'sync');
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
    this.tasks.set(id, { state, time, pending, completedAt });
  }

  snapshot() {
    // Silence is not a terminal event. Retain unresolved work (and questions)
    // until a new event resolves it; only confirmed terminal records expire.
    for(const [id,t] of this.tasks)if(TERMINAL.has(t.state)&&this.now()-t.time>Math.max(this.staleMs,COMPLETION_MS))this.tasks.delete(id);
    const list=[...this.tasks.entries()].map(([session,t])=>{
      const completion=t.state==='ready'&&t.completedAt!=null&&this.now()-t.completedAt<COMPLETION_MS;
      const state=t.state==='ready'&&!completion?'idle':t.state;
      const uncertain=!TERMINAL.has(state)&&this.now()-t.time>(ATTENTION.has(state)?this.attentionMs:this.staleMs);
      return {state,message:uncertain?'状态待确认':MESSAGES[state],session,eventTime:t.time,id:publicId(session),completion,uncertain};
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
    const threadId=path.basename(session).match(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/i)?.[0];
    return {id,state,message,uncertain,primary:session===this.selected,title:this.titles.get(threadId)||`会话 ${id.slice(0,6).toUpperCase()}`};
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
        if(typeof item.id==='string'&&typeof item.thread_name==='string')this.reducer.titles.set(item.id,item.thread_name.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,120));
      }catch{}
    }finally{await handle.close();}
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
    } finally { await handle.close(); }
  }

  tick() {
    if(!this.running||this.reloadPromise)return Promise.resolve();
    if(this.tickPromise)return this.tickPromise;
    this.tickPromise=this.scan().finally(()=>{this.tickPromise=null;});
    return this.tickPromise;
  }

  async scan() {
    try {
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
    this.reducer.bubbleIds=[];
    this.lastValue='';this.hadState=false;this.lastScan=0;this.reducer.selected=null;
  }
}

module.exports = { CodexStateFollower, TaskStates, toolState, priority, COMPLETION_MS };
