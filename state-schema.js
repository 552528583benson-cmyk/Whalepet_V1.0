const STATES = Object.freeze([
  "idle",
  "connecting",
  "thinking",
  "reading",
  "searching",
  "tool_use",
  "working",
  "testing",
  "generating",
  "needs_input",
  "ready",
  "blocked"
]);

const PROVIDERS = Object.freeze(["chatgpt", "deepseek", "custom"]);
const VALID_STATES = new Set(STATES);
const VALID_PROVIDERS = new Set(PROVIDERS);
const BRIDGE_HOST = "127.0.0.1";
const BRIDGE_PORT = 43815;

module.exports = {
  STATES,
  PROVIDERS,
  VALID_STATES,
  VALID_PROVIDERS,
  BRIDGE_HOST,
  BRIDGE_PORT
};
