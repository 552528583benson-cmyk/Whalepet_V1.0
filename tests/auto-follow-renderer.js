const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");
const directory = fs.mkdtempSync(path.join(__dirname, "../work/follow-renderer-"));
const sessions = path.join(directory, "sessions");
fs.mkdirSync(sessions);
process.env.WHALEPET_RUNTIME_DIR = path.join(directory, "runtime");
process.env.WHALEPET_CODEX_SESSIONS = sessions;
process.env.WHALEPET_QA_ALLOW_SECOND_INSTANCE = "1";
process.env.WHALEPET_QA_HIDDEN = "1";
process.env.WHALEPET_BRIDGE_PORT = String(48000 + process.pid % 1000);
app.setPath("userData", path.join(directory, "electron"));
app.setAppPath(path.resolve(__dirname, ".."));
require("../main");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const transcript = path.join(sessions, "test.jsonl");
fs.writeFileSync(transcript, "");

async function expectPose(type, payload, expected) {
  fs.appendFileSync(transcript, JSON.stringify({ timestamp: new Date().toISOString(), type, payload }) + "\n");
  const deadline = Date.now() + 15_000;
  let actual;
  while (Date.now() < deadline) {
    await pause(250);
    const window = BrowserWindow.getAllWindows()[0];
    actual = await window.webContents.executeJavaScript("window.whalePetController?.getState()?.state").catch(() => null);
    if (actual === expected) { console.log(`Event -> rendered posture: ${expected}`); return; }
  }
  assert.equal(actual, expected);
}

app.whenReady().then(async () => {
  await pause(1600);
  await expectPose("event_msg", { type: "task_started" }, "thinking");
  await expectPose("response_item", { type: "function_call", name: "apply_patch" }, "working");
  await expectPose("response_item", { type: "function_call", name: "request_user_input" }, "needs_input");
  await expectPose("response_item", { type: "function_call", name: "imagegen" }, "generating");
  await expectPose("event_msg", { type: "task_complete" }, "ready");
  console.log("Automatic event-to-renderer integration passed (no manual state commands)");
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
setTimeout(() => app.exit(1), 90_000).unref();
