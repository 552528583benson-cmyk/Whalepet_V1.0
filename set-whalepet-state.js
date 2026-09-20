const fs = require("fs");
const path = require("path");
const dgram = require("dgram");
const {
  STATES,
  VALID_STATES,
  VALID_PROVIDERS,
  BRIDGE_HOST,
  BRIDGE_PORT
} = require("./state-schema");
const args = process.argv.slice(2);
let provider = process.env.WHALEPET_PROVIDER || "chatgpt";
if (args[0] === "--provider") {
  provider = args[1];
  args.splice(0, 2);
}
const state = args[0];
const message = args.slice(1).join(" ").trim().slice(0, 160);

if (!VALID_PROVIDERS.has(provider) || !VALID_STATES.has(state)) {
  console.error(`Usage: node set-whalepet-state.js [--provider chatgpt|deepseek|custom] <${STATES.join("|")}> [message]`);
  process.exitCode = 1;
} else {
  const stateFile = process.env.WHALEPET_STATE_FILE
    ? path.resolve(process.env.WHALEPET_STATE_FILE)
    : path.join(__dirname, "runtime", `state-${provider}.json`);
  const temporaryFile = `${stateFile}.${process.pid}.tmp`;
  const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const value = { type: "whalepet-state", provider, state, message, nonce };

  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(temporaryFile, `${JSON.stringify({ state, message }, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryFile, stateFile);

  // The installed desktop pet lives in another folder, so a project-local
  // state file alone cannot reach it.  Send the same update over a localhost-
  // only UDP bridge; keep the file write as a development/offline fallback.
  const socket = dgram.createSocket("udp4");
  const bridgePort = Number(process.env.WHALEPET_BRIDGE_PORT) || BRIDGE_PORT;
  let finished = false;
  const finish = (live) => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    socket.close();
    const suffix = live ? "（桌面小鲸已收到）" : "（已写入状态文件；打开小鲸后可继续实时同步）";
    console.log(`WhalePet [${provider}] -> ${state}${message ? `: ${message}` : ""} ${suffix}`);
  };
  socket.on("message", (packet) => {
    try {
      const reply = JSON.parse(packet.toString("utf8"));
      if (reply?.type === "whalepet-state-ack" && reply?.nonce === nonce) finish(true);
    } catch {
      // Ignore unrelated local UDP traffic.
    }
  });
  socket.on("error", () => finish(false));
  const timeout = setTimeout(() => finish(false), 320);
  socket.send(Buffer.from(JSON.stringify(value)), bridgePort, BRIDGE_HOST, (error) => {
    if (error) finish(false);
  });
}
