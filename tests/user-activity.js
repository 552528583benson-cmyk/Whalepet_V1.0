'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { createUserActivity, normalizeGames, parseActivity } = require('../user-activity');

function fixture(platform = 'win32') {
  const calls = [];
  const children = [];
  const events = [];
  const statuses = [];
  const timers = new Map();
  let nextTimer = 0;
  const adapter = createUserActivity({
    platform,
    onActivity: event => events.push(event),
    onStatus: status => statuses.push(status),
    spawn: (executable, args, options) => {
      calls.push({ executable, args, options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stdout.setEncoding = encoding => { child.encoding = encoding; };
      child.stderr = new EventEmitter();
      child.killed = false;
      child.kill = () => { child.killed = true; return true; };
      children.push(child);
      return child;
    },
    setTimeout: callback => { const timer = ++nextTimer; timers.set(timer, callback); return timer; },
    clearTimeout: timer => timers.delete(timer)
  });
  return { adapter, calls, children, events, statuses, timers };
}

assert.deepEqual(normalizeGames(['GAME.exe', 'game', 'My Game.EXE', '../secret.exe',
  'C:\\Games\\game.exe', 'game;Write-Host x', null, '.', '..', '', '游戏.exe']), ['game', 'my game', '游戏']);
assert.equal(normalizeGames(new Array(100).fill('game.exe')).length, 1);
assert.deepEqual(normalizeGames('game.exe'), []);
assert.deepEqual(parseActivity('{"presses":2,"held":true,"gaming":false}'), { presses: 2, held: true, gaming: false });
for (const line of ['null', '[]', '{', '{"presses":-1,"held":false,"gaming":false}',
  '{"presses":0.5,"held":false,"gaming":false}', '{"presses":999999,"held":false,"gaming":false}',
  '{"presses":0,"held":"false","gaming":false}', '{"presses":0,"held":false,"gaming":false,"process":"secret"}',
  '{"presses":0,"held":false,"gaming":false,"text":"typed secret"}', ' '.repeat(2000)]) {
  assert.equal(parseActivity(line), null);
}

const f = fixture();
assert.equal(f.calls.length, 0, 'Creating the controller must not capture any activity.');
assert.deepEqual(f.adapter.getStatus(), { state: 'stopped', reason: null, available: false });
assert.equal(f.adapter.start({ games: ['Demo.EXE', 'demo'], typing: true }), true);
assert.equal(f.calls.length, 1);
assert.equal(f.calls[0].executable, 'powershell.exe');
assert.equal(f.calls[0].options.windowsHide, true);
assert.equal(f.calls[0].options.shell, false);
assert.deepEqual(f.calls[0].options.stdio, ['ignore', 'pipe', 'pipe']);
const gamesArg = f.calls[0].args[f.calls[0].args.indexOf('-GamesJsonBase64') + 1];
assert.deepEqual(JSON.parse(Buffer.from(gamesArg, 'base64').toString('utf8')), ['demo']);
assert.equal(f.children[0].encoding, 'utf8');
assert.equal(f.adapter.start({ games: ['demo.exe'], typing: true }), true);
assert.equal(f.calls.length, 1, 'Same normalized configuration must not start another helper.');

f.children[0].stdout.emit('data', '{"presses":3,"held":tr');
assert.equal(f.events.length, 0);
f.children[0].stdout.emit('data', 'ue,"gaming":false}\r\n{"presses":0,"held":false,"gaming":true}\n');
assert.deepEqual(f.events, [{ presses: 3, held: true, gaming: false }, { presses: 0, held: false, gaming: true }]);
assert.deepEqual(f.adapter.getStatus(), { state: 'running', reason: null, available: true });
assert.equal(f.timers.size, 1, 'First valid aggregate replaces startup timeout with a heartbeat watchdog.');
f.children[0].stderr.emit('data', 'PRIVATE OS DIAGNOSTIC');
assert(!JSON.stringify(f.statuses).includes('PRIVATE'));

f.adapter.start({ games: ['Another.exe'], typing: false });
assert.equal(f.children[0].killed, true);
assert.equal(f.calls.length, 2);
assert.equal(f.calls[1].args[f.calls[1].args.indexOf('-ReadKeyboard') + 1], '0');
f.children[0].emit('exit', 0);
assert.equal(f.adapter.getStatus().state, 'starting', 'Old helper exit must not affect the new helper.');
f.children[1].stdout.emit('data', '{"presses":0,"held":false,"gaming":true}\n');
f.adapter.stop();
assert.equal(f.children[1].killed, true);
assert.equal(f.adapter.getStatus().state, 'stopped');
const beforeStopEvents = f.events.length;
f.children[1].stdout.emit('data', '{"presses":4,"held":true,"gaming":true}\n');
assert.equal(f.events.length, beforeStopEvents, 'Stopped helper output must not reach the app.');
f.adapter.start();
f.children[2].emit('error', new Error('PRIVATE SPAWN DETAILS'));
assert.deepEqual(f.adapter.getStatus(), { state: 'unavailable', reason: 'spawn_failed', available: false });
assert.equal(f.children[2].killed, true);
assert(!JSON.stringify(f.statuses).includes('PRIVATE'));
f.adapter.start();
f.children[3].stdout.emit('data', '{"presses":0,"held":false,"gaming":false,"key":"A"}\n');
assert.equal(f.adapter.getStatus().reason, 'invalid_output');
assert.equal(f.children[3].killed, true);
assert(!JSON.stringify(f.events).includes('"key"'));
f.adapter.start();
f.children[4].stdout.emit('data', 'x'.repeat(20000));
assert.equal(f.adapter.getStatus().reason, 'invalid_output');
f.adapter.start();
const startup = [...f.timers.values()][0];
startup();
assert.equal(f.adapter.getStatus().reason, 'startup_timeout');
assert.equal(f.children[5].killed, true);
f.adapter.start();
f.children[6].emit('exit', 1);
assert.equal(f.adapter.getStatus().reason, 'helper_exited');
f.adapter.start();
f.children[7].stdout.emit('data', '{"presses":0,"held":false,"gaming":false}\n');
[...f.timers.values()][0]();
assert.equal(f.adapter.getStatus().reason, 'helper_timeout');
assert.equal(f.children[7].killed, true);
f.adapter.dispose();
assert.equal(f.timers.size, 0);
assert.equal(f.adapter.start(), false);
assert.equal(f.calls.length, 8);

const unsupported = fixture('linux');
assert.equal(unsupported.adapter.start(), false);
assert.equal(unsupported.calls.length, 0);
assert.equal(unsupported.adapter.getStatus().reason, 'unsupported');

const throwing = createUserActivity({ platform: 'win32', spawn: () => { throw new Error('PRIVATE'); } });
assert.equal(throwing.start(), false);
assert.equal(throwing.getStatus().reason, 'spawn_failed');

const script = fs.readFileSync(path.join(__dirname, '..', 'native', 'user-activity.ps1'), 'utf8');
assert(script.includes('GetAsyncKeyState(key) < 0'), 'Poll only the reliable high bit.');
assert(script.includes('GetForegroundWindow()'));
assert(script.includes('StringComparison.OrdinalIgnoreCase'));
assert(script.includes('[Threading.Thread]::Sleep(50)'));
assert(script.includes('($now - $lastSent) -ge 100'), 'Output capped at 10 Hz.');
assert(!/GetWindowText|SetWindowsHookEx|ToUnicode|SendInput|WriteAllText|Out-File|Start-Transcript|Invoke-WebRequest/.test(script));

console.log('PASS opt-in activity adapter: hidden lifecycle, aggregates only, explicit game list, bounded parsing, safe failures.');
