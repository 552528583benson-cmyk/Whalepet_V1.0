const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");

const expected = Object.freeze({
  "idle-to-reading-smooth": 34,
  "closed-to-open-reading-smooth": 34,
  "reading-to-searching-smooth": 34,
  "completion-natural-smooth": 46,
  "needs-input-natural-smooth": 34,
  "blocked-natural-smooth": 34,
});

const transitionRoot = path.join(__dirname, "..", "assets", "generated-transitions");

for (const [directory, expectedCount] of Object.entries(expected)) {
  const absoluteDirectory = path.join(transitionRoot, directory);
  const manifestPath = path.join(absoluteDirectory, "manifest.json");
  assert.ok(fs.existsSync(manifestPath), `${directory} is missing manifest.json`);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const frames = fs.readdirSync(absoluteDirectory)
    .filter((filename) => /^frame-\d{3}\.webp$/.test(filename));

  assert.equal(frames.length, expectedCount, `${directory} has an incomplete frame set`);
  assert.equal(manifest.output_frames, expectedCount, `${directory} manifest count is stale`);
  assert.equal(manifest.duration_ms, 58, `${directory} cadence must remain near 17 FPS`);
  assert.equal(manifest.frames.length, expectedCount, `${directory} manifest frame list is incomplete`);
  for (const entry of manifest.frames) {
    assert.ok(fs.existsSync(path.join(absoluteDirectory, entry.file)), `${directory}/${entry.file} is missing`);
    assert.ok(Number.isFinite(entry.head_anchor_target_x), `${directory}/${entry.file} has no visual anchor`);
    assert.ok(Number.isInteger(entry.stabilization_x), `${directory}/${entry.file} has no anchor correction`);
    assert.ok(Math.abs(entry.stabilization_x) <= 40, `${directory}/${entry.file} has an unsafe anchor correction`);
    assert.ok(entry.sequence_scale >= 0.94 && entry.sequence_scale <= 1.02, `${directory} has unsafe scale normalization`);
  }
}

console.log("Smooth assets passed: 216 generated frames are present and indexed");
