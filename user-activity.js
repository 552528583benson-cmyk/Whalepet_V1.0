'use strict';

const path = require('node:path');
const { spawn: defaultSpawn } = require('node:child_process');

const MAX_BUFFER = 16 * 1024;
const MAX_LINE = 1024;

function normalizeGames(games) {
  if (!Array.isArray(games)) return [];
  return [...new Set(games.slice(0, 32).filter(item => typeof item === 'string').map(item => {
    const value = item.trim().replace(/\.exe$/i, '').toLowerCase();
    // Only explicit executable basenames, never executable paths or shell fragments.
    return value !== '.' && value !== '..' && /^[\p{L}\p{N}_. -]{1,80}$/u.test(value) ? value : '';
  }).filter(Boolean))];
}

function parseActivity(line) {
  if (typeof line !== 'string' || line.length > MAX_LINE) return null;
  let value;
  try { value = JSON.parse(line); } catch { return null; }
  if (!value || Array.isArray(value) || typeof value !== 'object') return null;
  if (Object.keys(value).sort().join(',') !== 'gaming,held,presses') return null;
  if (!Number.isInteger(value.presses) || value.presses < 0 || value.presses > 4096 ||
      typeof value.held !== 'boolean' || typeof value.gaming !== 'boolean') return null;
  return { presses: value.presses, held: value.held, gaming: value.gaming };
}

// Explicit opt-in only. This controller is deliberately not a keyboard hook:
// its helper reports only coarse activity and matches a user-selected game list.
function createUserActivity(options = {}) {
  const platform = options.platform || process.platform;
  const spawn = options.spawn || defaultSpawn;
  const onActivity = typeof options.onActivity === 'function' ? options.onActivity : () => {};
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
  const schedule = options.setTimeout || setTimeout;
  const cancel = options.clearTimeout || clearTimeout;
  const helper = options.helperPath || path.join(__dirname, 'native', 'user-activity.ps1');
  const startupMs = Math.max(1000, Math.min(30000, options.startupMs || 15000));
  const heartbeatMs = Math.max(2000, Math.min(15000, options.heartbeatMs || 5000));
  let child = null;
  let generation = 0;
  let buffer = '';
  let startupTimer = null;
  let heartbeatTimer = null;
  let configKey = '';
  let disposed = false;
  let status = { state: 'stopped', reason: null, available: false };

  function report(state, reason = null) {
    status = { state, reason, available: state === 'running' };
    onStatus({ ...status });
  }

  function clearStartup() {
    if (startupTimer !== null) cancel(startupTimer);
    startupTimer = null;
  }

  function terminate() {
    generation++;
    clearStartup();
    if (heartbeatTimer !== null) cancel(heartbeatTimer);
    heartbeatTimer = null;
    const previous = child;
    child = null;
    buffer = '';
    configKey = '';
    if (previous) {
      // Never surface stderr; it may contain system-dependent paths or details.
      previous.stdout?.removeAllListeners('data');
      try { previous.kill(); } catch { /* Already exited. */ }
    }
  }

  function fail(reason) {
    terminate();
    report('unavailable', reason);
  }

  function start(config = {}) {
    if (disposed) return false;
    if (platform !== 'win32') {
      terminate();
      report('unavailable', 'unsupported');
      return false;
    }
    const games = normalizeGames(config.games);
    const typing = config.typing !== false;
    const nextConfigKey = JSON.stringify({ games, typing });
    if (child && nextConfigKey === configKey) return true;
    terminate();
    const token = generation;
    report('starting');
    try {
      // Base64 transports the small startup JSON safely through PowerShell's
      // Windows argument parser. There is no shell, input text, or file log.
      const gamesJsonBase64 = Buffer.from(JSON.stringify(games), 'utf8').toString('base64');
      child = spawn('powershell.exe', [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', helper, '-GamesJsonBase64', gamesJsonBase64,
        '-ReadKeyboard', typing ? '1' : '0', '-OwnerProcessId', String(process.pid)
      ], { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      configKey = nextConfigKey;
    } catch {
      fail('spawn_failed');
      return false;
    }
    const runningChild = child;
    if (!runningChild?.stdout || !runningChild?.on) {
      fail('spawn_failed');
      return false;
    }
    runningChild.stdout.setEncoding?.('utf8');
    runningChild.stderr?.on('data', () => {});
    runningChild.on('error', () => {
      if (generation === token && child === runningChild) fail('spawn_failed');
    });
    runningChild.on('exit', () => {
      if (generation === token && child === runningChild) fail('helper_exited');
    });
    runningChild.stdout.on('data', chunk => {
      if (generation !== token || child !== runningChild) return;
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (buffer.length > MAX_BUFFER) return fail('invalid_output');
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const activity = parseActivity(line);
        if (!activity) return fail('invalid_output');
        clearStartup();
        if (heartbeatTimer !== null) cancel(heartbeatTimer);
        heartbeatTimer = schedule(() => {
          if (generation === token && child === runningChild) fail('helper_timeout');
        }, heartbeatMs);
        heartbeatTimer?.unref?.();
        if (status.state !== 'running') report('running');
        if (generation !== token || child !== runningChild) return;
        onActivity(typing ? activity : { ...activity, presses: 0, held: false });
        if (generation !== token || child !== runningChild) return;
      }
      if (buffer.length > MAX_LINE) fail('invalid_output');
    });
    startupTimer = schedule(() => {
      if (generation === token && child === runningChild) fail('startup_timeout');
    }, startupMs);
    startupTimer?.unref?.();
    return true;
  }

  function stop() {
    terminate();
    report('stopped');
  }

  function dispose() {
    stop();
    disposed = true;
  }

  return { start, stop, dispose, getStatus: () => ({ ...status }) };
}

module.exports = { createUserActivity, normalizeGames, parseActivity };
