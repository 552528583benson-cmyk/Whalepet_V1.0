const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CodexStateFollower, TaskStates, toolState } = require("../codex-state-follower");

async function main() {
  let now = Date.now();
  const event = (type, payload) => ({ timestamp: new Date(now).toISOString(), type, payload });
  const tasks = new TaskStates({ now: () => now, staleMs: 60_000 });
  tasks.consume("a", event("event_msg", { type: "task_started" }));
  assert.equal(tasks.current().state, "thinking");
  now++;
  tasks.consume("a", event("response_item", { type: "function_call", name: "apply_patch" }));
  assert.equal(tasks.current().state, "working");
  now++;
  tasks.consume("b", event("event_msg", { type: "task_complete" }));
  assert.equal(tasks.current().state, "working", "other task completion must not hide active work");
  now++;
  tasks.consume("a", event("response_item", { type: "function_call", name: "request_user_input_async" }));
  tasks.consume("a", event("response_item", { type: "function_call_output" }));
  assert.equal(tasks.current().state, "needs_input");
  now++;
  tasks.consume("a", event("response_item", { type: "reasoning" }));
  assert.equal(tasks.current().state, "thinking");
  now++;
  tasks.consume("a", event("response_item", { type: "message", role: "assistant", phase: "final" }));
  assert.equal(tasks.current().state, "ready");
  now += 9000;
  assert.equal(tasks.current().state, "idle");
  now += 60_000;
  assert.equal(tasks.current(), null);
  assert.equal(toolState("exec", 'await tools.apply_patch("...")'), "working");
  assert.equal(toolState("exec", 'await tools.exec_command({cmd:"npm run test"})'), "testing");
  assert.equal(toolState("mcp__image_gen__imagegen"), "generating");
  assert.equal(toolState("mcp__web__run"), "searching");
  assert.equal(toolState("unknown_tool"), "tool_use");

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "whalepet-follow-test-"));
  const filename = path.join(directory, "old-session.jsonl");
  const seen = [];
  const follower = new CodexStateFollower({ directory, onState: value => seen.push(value.state) });
  try {
    // A large old transcript must not be replayed or read in full.
    fs.writeFileSync(filename, "x".repeat(1024 * 1024) + "\n");
    fs.utimesSync(filename, new Date(0), new Date(0));
    follower.running = true;
    await follower.tick();
    assert.equal(seen.length, 0);
    assert.equal(follower.files.get(filename).offset, fs.statSync(filename).size);
    const record = JSON.stringify({timestamp:new Date().toISOString(),type:"event_msg",payload:{type:"task_started"}}) + "\n";
    fs.appendFileSync(filename, record.slice(0, 30));
    await follower.tick();
    assert.equal(seen.length, 0, "partial line must wait for completion");
    fs.appendFileSync(filename, record.slice(30));
    await follower.tick();
    assert.equal(seen.at(-1), "thinking");
    fs.appendFileSync(filename, JSON.stringify({ timestamp:new Date().toISOString(),type:"response_item",payload:{type:"function_call",name:"imagegen"}}) + "\n");
    await follower.tick();
    assert.equal(seen.at(-1), "generating");
    // Truncation/replacement must reset the cursor.
    fs.writeFileSync(filename, JSON.stringify({ timestamp:new Date().toISOString(),type:"event_msg",payload:{type:"turn_aborted"}}) + "\n");
    await follower.tick();
    assert.equal(seen.at(-1), "idle");
    fs.writeFileSync(path.join(directory,"new-task.jsonl"), JSON.stringify({timestamp:new Date().toISOString(),type:"response_item",payload:{type:"function_call",name:"request_user_input"}}) + "\n");
    follower.lastScan = 0;
    await follower.tick();
    assert.equal(seen.at(-1), "needs_input", "new task must be discovered");
    follower.stop();
    assert.equal(follower.files.size, 0);
  } finally {
    follower.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
  console.log("Auto-follow passed: lifecycle, tool mapping, overlapping tasks, expiry, partial writes, large old logs, truncation, and new sessions");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
