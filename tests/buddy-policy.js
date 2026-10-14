'use strict';

const assert = require('node:assert/strict');
const { createBuddyPolicy } = require('../buddy-policy');

function fixture() {
  let clock = 0;
  const policy = createBuddyPolicy({ now: () => clock });
  return { policy, at: stamp => { clock = stamp; }, advance: ms => { clock += ms; } };
}
const packet = (presses = 0, held = false, gaming = false) => ({ presses, held, gaming });

const f = fixture();
assert.deepEqual(f.policy.snapshot(), { mode: 'none', tempo: 2, manualGame: false });
f.policy.activity(packet(4, true, true));
assert.equal(f.policy.snapshot().mode, 'none', 'Default companion detection is off.');
f.policy.configure({ typingCompanion: true });
assert.equal(f.policy.snapshot().mode, 'none', 'Enabling detection must not reuse disabled activity.');
f.policy.activity(packet(1));
assert.equal(f.policy.snapshot().mode, 'typing', 'First input changes mode without artificial latency.');
assert(f.policy.snapshot().tempo > 2 && f.policy.snapshot().tempo <= 7);
f.at(1199);
assert.equal(f.policy.snapshot().mode, 'typing');
f.at(1200);
assert.equal(f.policy.snapshot().mode, 'none');

f.at(2000);
f.policy.activity(packet(1, true));
f.at(3000);
assert.equal(f.policy.snapshot().mode, 'typing', 'Held keys remain active between heartbeat packets.');
f.policy.activity(packet(0, false));
f.at(4199);
assert.equal(f.policy.snapshot().mode, 'typing', 'Release has a full 1200ms tail.');
f.at(4200);
assert.equal(f.policy.snapshot().mode, 'none');

f.at(5000);
f.policy.activity(packet(1, true));
f.at(7500);
assert.equal(f.policy.snapshot().mode, 'typing');
f.at(7501);
assert.equal(f.policy.snapshot().mode, 'none', 'Helper silence retires held typing after 2500ms.');
f.policy.activity(packet(0, false));
assert.equal(f.policy.snapshot().mode, 'none', 'A late idle heartbeat does not revive a retired held key.');
f.policy.activity(packet(2, true));
assert.equal(f.policy.snapshot().mode, 'typing');
f.policy.clearActivity();
assert.equal(f.policy.snapshot().mode, 'none', 'Helper failure clears activity immediately.');

const g = fixture();
g.policy.configure({ gameCompanion: true });
g.policy.activity(packet(0, false, true));
assert.equal(g.policy.snapshot().mode, 'none', 'Auto-game requires an explicit game list.');
g.policy.configure({ typingCompanion: true, gameCompanion: true, games: ['Demo.EXE', '../unsafe.exe'] });
g.policy.activity(packet(3, true, true));
assert.equal(g.policy.snapshot().mode, 'gaming', 'Gaming has precedence over observed typing.');
g.at(100);
g.policy.activity(packet(0, true, false));
assert.equal(g.policy.snapshot().mode, 'typing', 'Leaving a game ends auto-game on the next packet.');
g.policy.configure({ gameCompanion: true, games: ['demo'] });
assert.equal(g.policy.snapshot().mode, 'none', 'Disabling typing clears observed typing immediately.');
g.policy.activity(packet(0, false, true));
assert.equal(g.policy.snapshot().mode, 'gaming');
g.policy.configure({ gameCompanion: true, games: ['other.exe'] });
assert.equal(g.policy.snapshot().mode, 'none', 'Changing the explicit list invalidates old game matches.');
g.policy.activity(packet(0, false, true));
g.at(2601);
assert.equal(g.policy.snapshot().mode, 'none', 'Helper silence retires auto-game.');
g.policy.activity(packet(0, false, true));
g.policy.configure({ gameCompanion: false, games: ['other'] });
assert.equal(g.policy.snapshot().mode, 'none');

const manual = fixture();
manual.policy.setManualGame(true);
assert.deepEqual(manual.policy.snapshot(), { mode: 'gaming', tempo: 2, manualGame: true });
manual.advance(100000);
manual.policy.clearActivity();
assert.equal(manual.policy.snapshot().mode, 'gaming', 'Manual mode needs no helper or heartbeat.');
assert.deepEqual(manual.policy.snapshot({ hidden: true }), { mode: 'none', tempo: 2, manualGame: true });
assert.equal(manual.policy.snapshot().mode, 'gaming', 'Showing the pet restores transient manual mode.');
manual.policy.configure({});
assert.equal(manual.policy.snapshot().mode, 'gaming', 'Changing auto preferences does not cancel manual play.');
manual.policy.setManualGame(false);
assert.equal(manual.policy.snapshot().mode, 'none');
manual.policy.previewTyping();
assert.equal(manual.policy.snapshot().mode, 'typing', 'Preview requires neither opt-in nor a helper.');
manual.policy.clearActivity();
assert.equal(manual.policy.snapshot().mode, 'typing', 'Helper stop does not cancel an independent preview.');
manual.advance(2999);
assert.equal(manual.policy.snapshot().mode, 'typing');
manual.advance(1);
assert.equal(manual.policy.snapshot().mode, 'none');
manual.policy.previewTyping();
manual.policy.setManualGame(true);
assert.equal(manual.policy.snapshot().mode, 'gaming');
manual.policy.setManualGame(false);
assert.equal(manual.policy.snapshot().mode, 'typing');
manual.advance(3000);
assert.equal(manual.policy.snapshot().mode, 'none');

const tempo = fixture();
tempo.policy.configure({ typingCompanion: true, gameCompanion: true, games: ['demo'] });
for (let index = 0; index < 40; index++) {
  tempo.policy.activity(packet(10, true, true));
  assert(tempo.policy.snapshot().tempo >= 2 && tempo.policy.snapshot().tempo <= 7);
  tempo.advance(100);
}
const rapidTempo = tempo.policy.snapshot().tempo;
assert(rapidTempo > 6);
tempo.advance(1500);
assert(tempo.policy.snapshot().tempo < rapidTempo, 'Tempo decays smoothly after rapid activity.');
const afterDecay = tempo.policy.snapshot().tempo;
tempo.policy.activity(packet(0, true, true));
assert.equal(tempo.policy.snapshot().tempo, afterDecay, 'Heartbeat alone does not raise tempo.');
const beforeInvalid = tempo.policy.snapshot();
for (const invalid of [null, {}, packet(-1), packet(.5), packet(9000), { presses: 1, held: 'true', gaming: false }]) {
  tempo.policy.activity(invalid);
  assert.deepEqual(tempo.policy.snapshot(), beforeInvalid);
}
tempo.policy.clearActivity();
assert.deepEqual(tempo.policy.snapshot(), { mode: 'none', tempo: 2, manualGame: false });

console.log('PASS buddy policy: opt-in, immediate typing, release tail, stale-helper recovery, selected games, manual/hide/preview, smooth bounded tempo.');
