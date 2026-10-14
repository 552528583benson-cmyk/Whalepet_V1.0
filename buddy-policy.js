'use strict';

const { normalizeGames } = require('./user-activity');

const TYPING_TAIL_MS = 1200;
const ACTIVITY_STALE_MS = 2500;
const PREVIEW_MS = 3000;
const TEMPO_DECAY_MS = 1600;

// Companion activity never changes AI state. Main/renderer can independently
// give questions, problems, dragging, previews and music their own priority.
function createBuddyPolicy(options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now;
  let prefs = { typingCompanion: false, gameCompanion: false, games: [] };
  let lastPacket = -Infinity;
  let held = false;
  let autoGame = false;
  let typingUntil = -Infinity;
  let previewUntil = -Infinity;
  let manualGame = false;
  let tempoBase = 2;
  let tempoAt = now();

  function currentTempo(stamp) {
    const elapsed = Math.max(0, stamp - tempoAt);
    return Math.max(2, Math.min(7, 2 + (tempoBase - 2) * Math.exp(-elapsed / TEMPO_DECAY_MS)));
  }

  function configure(value = {}) {
    const next = {
      typingCompanion: value?.typingCompanion === true,
      gameCompanion: value?.gameCompanion === true,
      games: normalizeGames(value?.games)
    };
    if (!next.typingCompanion) {
      held = false;
      typingUntil = -Infinity;
    }
    if (!next.gameCompanion || !next.games.length || JSON.stringify(next.games) !== JSON.stringify(prefs.games)) {
      autoGame = false;
    }
    prefs = next;
    return snapshot();
  }

  function activity(value) {
    if (!value || !Number.isInteger(value.presses) || value.presses < 0 || value.presses > 4096 ||
        typeof value.held !== 'boolean' || typeof value.gaming !== 'boolean') return;
    const stamp = now();
    const previouslyHeld = held && stamp >= lastPacket && stamp - lastPacket <= ACTIVITY_STALE_MS;
    lastPacket = stamp;
    held = prefs.typingCompanion && value.held;
    autoGame = prefs.gameCompanion && prefs.games.length > 0 && value.gaming;
    if (prefs.typingCompanion && (value.presses > 0 || held || previouslyHeld && !held)) {
      typingUntil = stamp + TYPING_TAIL_MS;
    }
    if ((prefs.typingCompanion || autoGame) && value.presses > 0) {
      // A single smoothed aggregate, not key codes, characters or a history.
      const target = Math.min(7, 2 + value.presses * 1.6);
      tempoBase = currentTempo(stamp) * .45 + target * .55;
      tempoAt = stamp;
    }
  }

  function clearActivity() {
    lastPacket = -Infinity;
    held = false;
    autoGame = false;
    typingUntil = -Infinity;
    tempoBase = 2;
    tempoAt = now();
  }

  function setManualGame(enabled) {
    manualGame = enabled === true;
    return snapshot();
  }

  function previewTyping() {
    const stamp = now();
    previewUntil = stamp + PREVIEW_MS;
    tempoBase = 4;
    tempoAt = stamp;
    return snapshot();
  }

  function snapshot({ hidden = false } = {}) {
    const stamp = now();
    const fresh = stamp - lastPacket <= ACTIVITY_STALE_MS && stamp >= lastPacket;
    const gaming = manualGame || fresh && autoGame;
    const typing = stamp < previewUntil || prefs.typingCompanion && fresh && (held || stamp < typingUntil);
    const mode = hidden ? 'none' : gaming ? 'gaming' : typing ? 'typing' : 'none';
    return { mode, tempo: mode === 'none' ? 2 : currentTempo(stamp), manualGame };
  }

  return { configure, activity, clearActivity, setManualGame, previewTyping, snapshot };
}

module.exports = { createBuddyPolicy };
