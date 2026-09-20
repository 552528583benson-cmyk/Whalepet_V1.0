const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const { STATES: states } = require("../state-schema");

const source = fs.readFileSync(path.join(__dirname, "..", "pet.js"), "utf8");
assert.match(source, /const STATE_TRANSITIONS = Object\.freeze\(Object\.fromEntries\(/, "dynamic STATE_TRANSITIONS graph was not found");
assert.match(source, /Object\.keys\(STATES\)\.flatMap/, "motion graph must include every source state");
assert.match(source, /\.filter\(\(to\) => to !== from\)/, "motion graph must exclude only self routes");
assert.match(source, /const POSE_TRANSITION_MS = 920;/, "natural pose bridge duration changed unexpectedly");
assert.match(source, /const POSE_SWAP_PROGRESS = 0\.38;/, "pose swap must occur during the fast centre crossing");
assert.match(source, /const POSE_MOTION_SAMPLES = 61;/, "continuous spring sampling changed unexpectedly");
const runtimeAssets = {
  idle: "idle.webp",
  connecting: "connecting.webp",
  thinking: "thinking.webp",
  reading: "reading.webp",
  searching: "searching.webp",
  tool_use: "tool-use.webp",
  working: "working.webp",
  testing: "testing.webp",
  generating: "generating.webp",
  needs_input: "needs-input.webp",
  ready: "ready.webp",
  blocked: "blocked.webp"
};
for (const [state, filename] of Object.entries(runtimeAssets)) {
  assert.match(
    source,
    new RegExp(`${state}:[\\s\\S]*?frames: \\[frame\\("${filename.replace(".", "\\.")}", \\d+\\)\\]`),
    `${state} must use its approved v0.15 sprite`
  );
  assert.ok(
    fs.existsSync(path.join(__dirname, "..", "assets", "whalepet-hd", filename.replace(/\.webp$/, '.png'))),
    `${filename} is missing`
  );
}
assert.match(source, /const FRAME_Y_OFFSETS = Object\.freeze\(\{\}\);/, "v0.15 assets must use their shared authored baseline");
assert.match(source, /function playPoseTransition\(/, "drag-style compositor transition is missing");
assert.match(source, /showFrame\(targetFrame, version, false, true\)/, "target pose must swap exactly at the centre crossing");
assert.match(source, /requestAnimationFrame\(swapTick\)/, "pose swap must be synchronized to display repaint");
assert.doesNotMatch(source, /generatedSequence\(/, "full-body optical-flow playback must stay disabled");
assert.doesNotMatch(source, /-smooth\/frame-/, "runtime must not load anatomy-changing optical-flow frames");
const poseTransition = source.match(/function poseMotionKeyframes\([\s\S]*?\n\}\n\nfunction flushQueuedState/)?.[0] || "";
assert.doesNotMatch(poseTransition, /const tuck = motionLayer\.animate/, "pose motion must not be split into a tuck animation");
assert.doesNotMatch(poseTransition, /const settle = motionLayer\.animate/, "pose motion must not be split into a settle animation");
assert.doesNotMatch(
  poseTransition,
  /rotate\(|translateX\(/,
  "pose bridge must not introduce left-right oscillation"
);
const poseScales = [...poseTransition.matchAll(/scale\(([\d.]+),\s*([\d.]+)\)/g)]
  .map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
assert.ok(poseScales.length >= 1, "pose bridge scale keyframes were not found");
for (const scale of poseScales) {
  assert.equal(scale.x, 1, `pose bridge width must remain exactly 100%: ${scale.x}`);
  assert.equal(scale.y, 1, `pose bridge height must remain exactly 100%: ${scale.y}`);
}
assert.match(source, /queuedIncomingState = next;/, "latest-state queue is missing");

console.log(`Motion graph passed: ${states.length * (states.length - 1)} directed routes use the normalized operation posture set`);
