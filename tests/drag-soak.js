const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const {
  PET_WINDOW_SIZE,
  applyCursorDelta,
  clampWindowToWorkArea,
  hasExpectedWindowSize
} = require("../drag-math");

const WINDOW_SIZE = PET_WINDOW_SIZE;
const mainSource = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const petSource = fs.readFileSync(path.join(__dirname, "..", "pet.js"), "utf8");
assert.match(
  mainSource,
  /hasExpectedWindowSize\(contentBounds, expectedContentSize\)/,
  "runtime guard must use the shared DPI rounding tolerance"
);
assert.doesNotMatch(
  mainSource,
  /hasExpectedWindowSize\(contentBounds, expectedContentSize,\s*2\)/,
  "2px content tolerance causes a transparent-window repair storm"
);
const dragUpdateSource = mainSource.match(/function updateDraggedWindow\([^)]*\) \{[\s\S]*?\n\}/)?.[0] || "";
assert.doesNotMatch(
  dragUpdateSource,
  /repairPetWindowBounds/,
  "the drag loop must not run the separate tolerance-based repair guard"
);
assert.match(
  dragUpdateSource,
  /windowSize: expectedOuterSize/,
  "drag boundaries must ignore Windows' inflated invisible transparent border"
);
assert.match(
  dragUpdateSource,
  /petWindow\.setBounds\(\{ \.\.\.result\.position, \.\.\.expectedOuterSize \}, false\)/,
  "every native drag move must reassert the canonical window size"
);
assert.doesNotMatch(
  mainSource,
  /petWindow\.on\("resize"[\s\S]{0,160}repairPetWindowBounds/,
  "resize events must not recursively trigger transparent-window repair"
);

function runVirtualDesktop(workArea, cycles) {
  const maximumX = workArea.x + workArea.width - WINDOW_SIZE.width;
  const maximumY = workArea.y + workArea.height - WINDOW_SIZE.height;
  const corners = [
    { x: workArea.x, y: workArea.y },
    { x: maximumX, y: workArea.y },
    { x: maximumX, y: maximumY },
    { x: workArea.x, y: maximumY }
  ];
  let position = { ...corners[2] };

  for (let cycle = 0; cycle < cycles; cycle += 1) {
    for (const target of corners) {
      const startPosition = { ...position };
      const startCursor = { x: position.x + 150, y: position.y + 170 };
      const targetCursor = {
        x: startCursor.x + target.x - startPosition.x,
        y: startCursor.y + target.y - startPosition.y
      };
      let lastCursor = startCursor;
      for (let step = 1; step <= 24; step += 1) {
        const cursor = {
          x: Math.round(startCursor.x + (targetCursor.x - startCursor.x) * step / 24),
          y: Math.round(startCursor.y + (targetCursor.y - startCursor.y) * step / 24)
        };
        const result = applyCursorDelta({ position, lastCursor, cursor, windowSize: WINDOW_SIZE, workArea });
        position = result.position;
        lastCursor = result.cursor;
      }
      assert.deepEqual(position, target, `cycle ${cycle} could not reach ${JSON.stringify(target)}`);
    }
  }

  const startCursor = { x: position.x + 150, y: position.y + 170 };
  let result = applyCursorDelta({
    position,
    lastCursor: startCursor,
    cursor: { x: startCursor.x - 200, y: startCursor.y + 200 },
    windowSize: WINDOW_SIZE,
    workArea
  });
  const edgePosition = result.position;
  result = applyCursorDelta({
    position: edgePosition,
    lastCursor: result.cursor,
    cursor: { x: result.cursor.x + 1, y: result.cursor.y - 1 },
    windowSize: WINDOW_SIZE,
    workArea
  });
  assert.equal(result.position.x, edgePosition.x + 1, "window stuck after reversing from a clamped edge");
  assert.equal(result.position.y, edgePosition.y - 1, "window stuck after reversing from a clamped edge");

  return { cycles, reachable: { minimumX: workArea.x, maximumX, minimumY: workArea.y, maximumY } };
}

const results = [
  runVirtualDesktop({ x: 0, y: 0, width: 1920, height: 1080 }, 100),
  runVirtualDesktop({ x: 0, y: 0, width: 1536, height: 864 }, 100)
];

assert.equal(hasExpectedWindowSize({ width: 300, height: 342 }), true);
assert.equal(hasExpectedWindowSize({ width: 301, height: 343 }), true);
assert.equal(hasExpectedWindowSize({ width: 304, height: 345 }), true);
assert.equal(hasExpectedWindowSize({ width: 308, height: 350 }), true);
assert.equal(hasExpectedWindowSize({ width: 315, height: 356 }), false);
assert.equal(hasExpectedWindowSize({ width: 324, height: 364 }), false);
assert.equal(hasExpectedWindowSize({ width: 332, height: 372 }), false);
assert.equal(hasExpectedWindowSize({ width: 310, height: 352 }, PET_WINDOW_SIZE, 16), true);
assert.equal(hasExpectedWindowSize({ width: 320, height: 362 }, PET_WINDOW_SIZE, 16), false);
assert.equal(hasExpectedWindowSize({ width: 1100, height: 958 }), false);
assert.deepEqual(
  clampWindowToWorkArea(
    { x: 1800, y: 1000 },
    { x: 0, y: 0, width: 1920, height: 1080 },
    PET_WINDOW_SIZE
  ),
  { x: 1620, y: 738 },
  "a repaired window must remain fully reachable after pathological size drift"
);

// The tail-hang drawing replaces the three upright drawings. Its measured
// 1153px opaque height at 1254px source resolution is ~217px on the desktop,
// matching idle (~220px); tests/tail-hang.js also checks the decoded pixels.
assert.match(petSource, /\[DRAG_START_FILE\]: 0\.86/, "tail-hang scale must match idle height");
assert.match(petSource, /const DRAG_FRAME_COUNT = 1;/, "drag must not swap to old upright art");

console.log(`Virtual drag soak passed: ${JSON.stringify(results)}`);
