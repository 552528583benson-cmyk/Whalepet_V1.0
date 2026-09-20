const assert = require("assert/strict");
const dgram = require("dgram");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const root = path.join(__dirname, "..");
const stateFile = path.join(root, "runtime", `bridge-test-${process.pid}.json`);
const port = 45000 + (process.pid % 1000);
const server = dgram.createSocket("udp4");

function cleanup() {
  server.close();
  if (fs.existsSync(stateFile)) fs.rmSync(stateFile, { force: true });
}

server.on("message", (packet, remote) => {
  const value = JSON.parse(packet.toString("utf8"));
  assert.equal(value.type, "whalepet-state");
  assert.equal(value.provider, "chatgpt");
  assert.equal(value.state, "thinking");
  const acknowledgement = Buffer.from(JSON.stringify({
    type: "whalepet-state-ack",
    nonce: value.nonce
  }));
  server.send(acknowledgement, remote.port, remote.address);
});

server.bind(port, "127.0.0.1", () => {
  const child = spawn(
    process.execPath,
    ["set-whalepet-state.js", "--provider", "chatgpt", "thinking", "正在测试实时桥"],
    {
      cwd: root,
      env: {
        ...process.env,
        WHALEPET_BRIDGE_PORT: String(port),
        WHALEPET_STATE_FILE: stateFile
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("exit", (code) => {
    try {
      assert.equal(code, 0, stderr);
      assert.match(stdout, /桌面小鲸已收到/);
      assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, "utf8")), {
        state: "thinking",
        message: "正在测试实时桥"
      });
      console.log("State bridge passed: installed-pet acknowledgement and file fallback both work");
    } finally {
      cleanup();
    }
  });
});

setTimeout(() => {
  console.error("State bridge test timed out");
  cleanup();
  process.exitCode = 1;
}, 4000).unref();
