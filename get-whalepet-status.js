// Read-only localhost diagnostic: receiving a state and rendering it are separate.
const dgram = require("node:dgram");
const crypto = require("node:crypto");
const socket = dgram.createSocket("udp4");
const nonce = crypto.randomUUID();
const timer = setTimeout(() => {
  console.error("No response from the running WhalePet. Start the updated desktop app first.");
  socket.close(); process.exitCode = 1;
}, 2500);
socket.on("error", error => { clearTimeout(timer); console.error(error.message); socket.close(); process.exitCode = 1; });
socket.on("message", data => {
  let value;
  try { value = JSON.parse(data); } catch { return; }
  if (value.type !== "whalepet-status-reply" || value.nonce !== nonce) return;
  clearTimeout(timer);
  delete value.nonce;
  console.log(JSON.stringify(value, null, 2));
  socket.close();
});
socket.send(Buffer.from(JSON.stringify({ type: "whalepet-status", nonce })),
  Number(process.env.WHALEPET_BRIDGE_PORT || 43815), "127.0.0.1");
