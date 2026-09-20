function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(value, maximum));
}

const PET_WINDOW_SIZE = Object.freeze({ width: 300, height: 342 });

function clampWindowToWorkArea(position, workArea, windowSize = PET_WINDOW_SIZE) {
  const maximumX = Math.max(workArea.x, workArea.x + workArea.width - windowSize.width);
  const maximumY = Math.max(workArea.y, workArea.y + workArea.height - windowSize.height);
  return {
    x: Math.round(clamp(position.x, workArea.x, maximumX)),
    y: Math.round(clamp(position.y, workArea.y, maximumY))
  };
}

function hasExpectedWindowSize(bounds, windowSize = PET_WINDOW_SIZE, tolerance = 8) {
  return Math.abs(bounds.width - windowSize.width) <= tolerance &&
    Math.abs(bounds.height - windowSize.height) <= tolerance;
}

function applyCursorDelta({ position, lastCursor, cursor, windowSize, workArea }) {
  const unclampedPosition = {
    x: position.x + cursor.x - lastCursor.x,
    y: position.y + cursor.y - lastCursor.y
  };
  return {
    position: clampWindowToWorkArea(unclampedPosition, workArea, windowSize),
    cursor: { x: cursor.x, y: cursor.y }
  };
}

module.exports = {
  PET_WINDOW_SIZE,
  applyCursorDelta,
  clampWindowToWorkArea,
  hasExpectedWindowSize
};
