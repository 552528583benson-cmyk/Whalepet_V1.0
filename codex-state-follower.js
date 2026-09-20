// Read-only adapter for local Codex task events. No prompts, replies or tool
// output are persisted or sent over the network. Transcript schema is best-effort.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { StringDecoder } = require("node:string_decoder");

const MESSAGES = Object.freeze({
  idle: "等待下一项任务", thinking: "正在认真思考", reading: "正在阅读文件",
  searching: "正在搜索", tool_use: "正在调用工具", working: "正在处理文件",
  testing: "正在检查结果", generating: "正在生成内容", needs_input: "需要你的回答",
  ready: "完成啦！", blocked: "任务遇到问题"
});
const TERMINAL = new Set(["ready", "idle", "blocked"]);

function toolState(name, input = "") {
  if (/request_user_input|ask_user|PermissionRequest/i.test(name)) return "needs_input";
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
  constructor({ now = Date.now, staleMs = 15 * 60_000 } = {}) {
    this.now = now;
    this.staleMs = staleMs;
    this.tasks = new Map();
  }

  consume(id, record) {
    const p = record?.payload;
    if (!p) return;
    const time = Date.parse(record.timestamp);
    if (!Number.isFinite(time) || time > this.now() + 60_000 || this.now() - time > this.staleMs) return;
    let state;
    if (record.type === "event_msg") {
      if (["task_started", "turn_started", "user_message"].includes(p.type)) state = "thinking";
      if (["task_complete", "task_completed", "turn_complete", "turn_completed"].includes(p.type)) state = "ready";
      if (["turn_aborted", "task_aborted", "session_end"].includes(p.type)) state = "idle";
      if (["error", "turn_failed"].includes(p.type)) state = "blocked";
      if (["permission_request", "request_user_input"].includes(p.type)) state = "needs_input";
      if (["agent_reasoning", "agent_reasoning_raw_content"].includes(p.type)) state = "thinking";
    } else if (record.type === "turn_context") {
      state = "thinking";
    } else if (record.type === "response_item") {
      if (p.type === "reasoning") state = "thinking";
      if (p.type === "message" && p.role === "assistant") state = p.phase === "final" ? "ready" : "thinking";
      if (["function_call", "custom_tool_call"].includes(p.type)) state = toolState(p.name || "", p.arguments || p.input || "");
      if (["function_call_output", "custom_tool_call_output"].includes(p.type)) {
        // An asynchronous question returns immediately, before the user answers.
        const task = this.tasks.get(id);
        state = task?.state === "needs_input" ? "needs_input" : "thinking";
      }
    }
    if (!state) return;
    const previous = this.tasks.get(id);
    if (previous && time < previous.time) return;
    this.tasks.set(id, { state, time });
  }

  current() {
    const fresh = [...this.tasks.entries()].filter(([, t]) => this.now() - t.time <= this.staleMs);
    for (const [id, t] of this.tasks) if (this.now() - t.time > this.staleMs) this.tasks.delete(id);
    const busy = fresh.filter(([, t]) => !TERMINAL.has(t.state));
    const selected = (busy.length ? busy : fresh).sort((a, b) => b[1].time - a[1].time)[0];
    if (!selected) return null;
    const [session, t] = selected;
    const state = TERMINAL.has(t.state) && this.now() - t.time > 8000 ? "idle" : t.state;
    return { state, message: MESSAGES[state], session, eventTime: t.time };
  }
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
      if (entry.isDirectory()) await this.discover(filename).catch(() => {});
      else if (entry.isFile() && entry.name.endsWith(".jsonl") && !this.files.has(filename)) {
        this.files.set(filename, { offset: null, pending: "", decoder: new StringDecoder("utf8") });
      }
    }
  }

  async readFile(filename, cursor) {
    const stat = await fs.promises.stat(filename);
    if (cursor.offset === null) {
      // Never read an entire long-running transcript (some exceed 500 MB).
      cursor.offset = stat.mtimeMs < this.now() - 120_000 ? stat.size : Math.max(0, stat.size - 256 * 1024);
      cursor.skipFirst = cursor.offset > 0 && cursor.offset < stat.size;
    }
    if (stat.size < cursor.offset) {
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

  async tick() {
    if (!this.running || this.ticking) return;
    this.ticking = true;
    try {
      if (!this.lastScan || this.now() - this.lastScan > 10_000) {
        this.lastScan = this.now();
        await this.discover();
      }
      for (const [filename, cursor] of this.files) {
        if (!this.running) break;
        await this.readFile(filename, cursor).catch(error => {
          if (error.code === "ENOENT") this.files.delete(filename);
        });
      }
      const selected = this.reducer.current();
      if (selected || this.hadState) {
        const value = selected || { state: "idle", message: MESSAGES.idle };
        const key = JSON.stringify([value.state, value.session]);
        if (key !== this.lastValue && this.running) {
          this.lastValue = key;
          this.hadState = Boolean(selected);
          this.onState({ state: value.state, message: value.message });
          this.onStatus({ status: "following", state: value.state, lastEventAt: value.eventTime || null });
        }
      }
    } catch (error) {
      this.onStatus({ status: error.code === "ENOENT" ? "not-found" : "unavailable", error: error.code || "read-failed" });
    } finally { this.ticking = false; }
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
  }
}

module.exports = { CodexStateFollower, TaskStates, toolState };
