'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, dialog, globalShortcut, nativeImage, powerMonitor, screen } = require('electron');
const root = path.resolve(__dirname, '..');
const run = fs.mkdtempSync(path.join(root, 'work', 'buddy-qa-'));
const runtime = path.join(run, 'runtime');
const sessions = path.join(run, 'sessions');
const gameDirectory = path.join(run, 'game-fixtures');
for (const directory of [runtime, sessions, gameDirectory]) fs.mkdirSync(directory);
const a = '10000001-1111-1111-1111-111111111111';
const b = '10000002-2222-2222-2222-222222222222';
for (const id of [a, b]) fs.writeFileSync(path.join(sessions, `rollout-${id}.jsonl`), '');
fs.writeFileSync(path.join(run, 'session_index.jsonl'), [
  { id: a, thread_name: '小鲸陪伴 · 测试一' }, { id: b, thread_name: '小鲸陪伴 · 测试二' }
].map(value => JSON.stringify(value)).join('\n') + '\n');
const gameFile = path.join(gameDirectory, 'Lovely-Game.EXE');
const invalidGame = path.join(gameDirectory, 'not-a-game.txt');
fs.writeFileSync(gameFile, 'This QA placeholder is never executed.');
fs.writeFileSync(invalidGame, 'Not an executable.');
Object.assign(process.env, {
  WHALEPET_RUNTIME_DIR: runtime,
  WHALEPET_CODEX_SESSIONS: sessions,
  WHALEPET_QA_ALLOW_SECOND_INSTANCE: '1',
  WHALEPET_QA_HIDDEN: '1',
  WHALEPET_QA_SETTINGS: '1',
  WHALEPET_BRIDGE_PORT: String(52000 + process.pid % 1000)
});
app.setPath('userData', path.join(run, 'electron'));
app.setAppPath(root);
// Never register user-global shortcuts, open a native picker, or read real keys.
globalShortcut.register = () => false;
app.whenReady().then(() => { screen.getCursorScreenPoint = () => ({ x: -1000000, y: -1000000 }); });
app.on('browser-window-created', (_event, window) => {
  window.setOpacity(0); window.setSkipTaskbar(true); window.setFocusable(false); window.webContents.setAudioMuted(true);
  const nativeIgnore = window.setIgnoreMouseEvents.bind(window);
  window.setIgnoreMouseEvents = () => nativeIgnore(true, { forward: true });
  window.setIgnoreMouseEvents(true, { forward: true });
});
const activityModule = require('../user-activity');
const starts = [];
let stopCount = 0;
let activityOptions;
let monitorStatus = { state: 'stopped', reason: null, available: false };
let helperActive = false;
let helperConfiguration = '';
let helperDisposed = false;
activityModule.createUserActivity = options => {
  activityOptions = options;
  return {
    start(config = {}) {
      const normalized = { typing: config.typing !== false, games: activityModule.normalizeGames(config.games) };
      const key = JSON.stringify(normalized);
      if (helperActive && key === helperConfiguration) return true;
      helperActive = true;
      helperConfiguration = key;
      starts.push(normalized);
      monitorStatus = { state: 'running', reason: null, available: true };
      options.onStatus(monitorStatus);
      return true;
    },
    stop() {
      if (helperActive) stopCount++;
      helperActive = false;
      helperConfiguration = '';
      monitorStatus = { state: 'stopped', reason: null, available: false };
      options.onStatus(monitorStatus);
    },
    dispose() { helperDisposed = true; this.stop(); },
    getStatus() { return { ...monitorStatus }; }
  };
};
const { normalizePreferences } = require('../preferences');
fs.writeFileSync(path.join(runtime, 'preferences.json'), JSON.stringify(normalizePreferences({ idleSongEnabled: false })));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(fn, count = 100) {
  let last;
  for (let index = 0; index < count; index++) {
    try { return await fn(); } catch (error) { last = error; await pause(80); }
  }
  throw last;
}
const emit = (id, type, payload) => fs.appendFileSync(path.join(sessions, `rollout-${id}.jsonl`), JSON.stringify({ timestamp: new Date().toISOString(), type, payload }) + '\n');
const packet = (presses = 0, held = false, gaming = false) => {
  assert(helperActive, 'The mocked helper must be explicitly enabled before activity.');
  activityOptions.onActivity({ presses, held, gaming });
};
const report = { realActivityCaptured: false, helperStarts: [], assets: [], frames: [], screenshots: [], limitations: [
  'Windows key/foreground acquisition is mocked; this test does not observe the user or validate a particular real game.',
  'Visual checks verify transparent pixels, preserved anatomy and bounded hand displacement, not anatomical quality for every generated pixel.',
  'Screenshots at 75% and 100% are compositor snapshots, not a subjective real-time frame-pacing benchmark.'
] };
require('../main');

app.whenReady().then(async () => {
  const pet = await eventually(() => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('index.html'));
    assert(window); return window;
  });
  const settings = await eventually(() => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('settings.html'));
    assert(window); return window;
  });
  pet.setOpacity(0); pet.showInactive(); pet.webContents.setAudioMuted(true);
  settings.setOpacity(0); settings.webContents.setAudioMuted(true);
  const js = code => pet.webContents.executeJavaScript(code);
  const ui = code => settings.webContents.executeJavaScript(code);
  const good = async code => { const response = await ui(code); assert.equal(response.ok, true, response.error); return response.value; };
  const snapshot = () => good('petSettings.get()');
  const renderer = () => js('whaleBuddy.info()');
  const state = () => js('whalePetController.getState().state');
  const bubbles = () => js('[...document.querySelectorAll(".conversation-bubble")].map(e=>({state:e.dataset.state,title:e.querySelector("span").textContent}))');
  const expectMode = mode => eventually(async () => assert.equal((await renderer()).mode, mode));
  await eventually(async () => assert.equal(await js('typeof whalePetController'), 'object'));
  await eventually(async () => assert.equal(await js('typeof whaleBuddy'), 'object'));
  assert.equal(await js('whaleBuddy.ready'), true, 'Companion artwork and WebGL pipeline load.');
  await eventually(async () => assert.equal((await snapshot()).preferences.typingCompanion, false));
  assert.equal((await snapshot()).preferences.gameCompanion, false);
  assert.deepEqual((await snapshot()).preferences.games, []);
  assert.equal(starts.length, 0, 'Default-off feature does not start a helper.');
  assert.equal(helperActive, false);
  await expectMode('none');

  await good('petSettings.gameMode(true)');
  await expectMode('gaming');
  assert.equal(starts.length, 0, 'Manual gaming never requires activity capture.');
  assert.equal((await snapshot()).companion.buddy.manualGame, true);
  assert.equal(await state(), 'idle', 'A companion gesture does not modify AI state.');
  await js('document.querySelector("#pet").classList.add("is-dragging")');
  await expectMode('none');
  await js('document.querySelector("#pet").classList.remove("is-dragging")');
  await expectMode('gaming');
  await js('document.body.classList.add("music-playing")');
  await expectMode('none');
  await js('document.body.classList.remove("music-playing")');
  await expectMode('gaming');
  await good('petSettings.gameMode(false)');
  await expectMode('none');
  await good('petSettings.previewBuddy("typing")');
  await expectMode('typing');
  assert.equal(starts.length, 0, 'Manual typing preview never starts a helper.');
  await eventually(async () => assert.equal((await renderer()).mode, 'none'), 55);
  assert.equal((await ui('petSettings.gameMode("true")')).ok, false);
  assert.equal((await ui('petSettings.previewBuddy("gaming")')).ok, false);

  await good('petSettings.save({typingCompanion:true})');
  await eventually(() => assert.equal(helperActive, true));
  assert.deepEqual(starts.at(-1), { typing: true, games: [] });
  const beforeTyping = { state: await state(), bubbles: await bubbles() };
  packet(3, true, false);
  await expectMode('typing');
  assert.equal(await state(), beforeTyping.state);
  assert.deepEqual(await bubbles(), beforeTyping.bubbles);
  packet(0, false, false);
  await expectMode('typing');
  await eventually(async () => assert.equal((await renderer()).mode, 'none'), 30);
  packet(3, true, false);
  await expectMode('typing');
  await good('petSettings.save({typingCompanion:false})');
  await expectMode('none');
  assert.equal(helperActive, false, 'Disabling the only observer stops its helper.');

  dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  assert.equal((await good('petSettings.addGame()')).cancelled, true);
  assert.deepEqual((await snapshot()).preferences.games, []);
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [invalidGame] });
  assert.equal((await ui('petSettings.addGame()')).ok, false);
  dialog.showOpenDialog = async (_window, options) => {
    assert.deepEqual(options.filters[0].extensions, ['exe']);
    return { canceled: false, filePaths: [gameFile] };
  };
  await good('petSettings.addGame()');
  const games = (await snapshot()).preferences.games;
  assert.deepEqual(activityModule.normalizeGames(games), ['lovely-game']);
  assert(games.every(value => !/[\\/]/.test(value)), 'Only the executable basename is stored.');
  await good('petSettings.addGame()');
  assert.equal((await snapshot()).preferences.games.length, 1, 'Repeated selection is deduplicated.');
  assert.equal(helperActive, false, 'Selecting a game alone does not grant monitoring consent.');
  await good('petSettings.save({gameCompanion:true})');
  await eventually(() => assert.equal(helperActive, true));
  assert.deepEqual(starts.at(-1), { typing: false, games: ['lovely-game'] });
  packet(0, false, true); await expectMode('gaming');
  packet(0, false, false); await expectMode('none');
  await good(`petSettings.removeGame(${JSON.stringify(games[0])})`);
  assert.deepEqual((await snapshot()).preferences.games, []);
  assert.equal(helperActive, false, 'Removing the last selected game stops game-only capture.');
  assert.equal((await ui('petSettings.removeGame({name:"game"})')).ok, false);

  await good('petSettings.save({typingCompanion:true,gameCompanion:false})');
  packet(4, true, false); await expectMode('typing');
  monitorStatus = { state: 'unavailable', reason: 'helper_timeout', available: false };
  helperActive = false;
  activityOptions.onStatus(monitorStatus);
  await expectMode('none');
  assert.equal((await snapshot()).companion.buddy.monitor.state, 'unavailable');
  await ui('petSettings.get().then(result=>{snapshot=result.value;render();})');
  assert.equal(await ui('document.querySelector("#buddyMonitorWarning").hidden'), false);
  await good('petSettings.save({typingCompanion:false})');
  await good('petSettings.gameMode(true)'); await expectMode('gaming');

  // Keep a real two-task follower running; companion activity must not change
  // its state, titles, counts or question/complete semantics.
  emit(a, 'event_msg', { type: 'task_started' });
  emit(b, 'event_msg', { type: 'task_started' });
  emit(a, 'response_item', { type: 'function_call', name: 'apply_patch' });
  emit(b, 'response_item', { type: 'function_call', name: 'apply_patch' });
  await good('petSettings.reloadCodex()');
  await eventually(async () => assert.equal((await bubbles()).length, 2));
  await eventually(async () => assert.equal(await state(), 'working'));
  await expectMode('gaming');
  const ordinary = { state: await state(), bubbles: await bubbles() };
  await good('petSettings.previewBuddy("typing")');
  assert.deepEqual(await bubbles(), ordinary.bubbles);
  assert.equal(await state(), ordinary.state);
  emit(a, 'response_item', { type: 'function_call', name: 'request_user_input_async', call_id: 'buddy-question' });
  await good('petSettings.reloadCodex()');
  await eventually(async () => assert.equal(await state(), 'needs_input'));
  await expectMode('none');
  const urgent = await bubbles();
  await good('petSettings.gameMode(false)');
  await good('petSettings.gameMode(true)');
  assert.equal(await state(), 'needs_input');
  assert.deepEqual(await bubbles(), urgent, 'Manual companion controls cannot acknowledge or modify an AI question.');
  emit(a, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'QA fixture answer' }] });
  await good('petSettings.reloadCodex()');
  await eventually(async () => assert.notEqual(await state(), 'needs_input'));
  await expectMode('gaming');
  emit(b, 'event_msg', { type: 'turn_failed' });
  await good('petSettings.reloadCodex()');
  await eventually(async () => assert.equal(await state(), 'blocked'));
  await expectMode('none');
  emit(b, 'event_msg', { type: 'task_started' });
  emit(b, 'response_item', { type: 'function_call', name: 'apply_patch' });
  await good('petSettings.reloadCodex()');
  await eventually(async () => assert.equal(await state(), 'working'));
  await expectMode('gaming');
  emit(a, 'event_msg', { type: 'task_complete' });
  await good('petSettings.reloadCodex()');
  await eventually(async () => assert.equal(await state(), 'ready'));
  await expectMode('none');
  assert.equal((await bubbles()).find(value => value.title.endsWith('测试一')).state, 'ready');
  await eventually(async () => assert.equal(await state(), 'working'));
  await expectMode('gaming');

  await good('petSettings.save({typingCompanion:true})');
  assert.equal(helperActive, true);
  const beforeHideStops = stopCount;
  await good('petSettings.companion("hide")');
  assert.equal(helperActive, false);
  assert(stopCount > beforeHideStops);
  assert.equal((await snapshot()).companion.buddy.mode, 'none');
  assert.equal((await snapshot()).companion.buddy.manualGame, true);
  const beforeShowStarts = starts.length;
  await good('petSettings.companion("show")');
  assert.equal(helperActive, true);
  assert(starts.length > beforeShowStarts);
  await expectMode('gaming');
  for (const [pauseEvent, resumeEvent] of [['lock-screen', 'unlock-screen'], ['suspend', 'resume']]) {
    powerMonitor.emit(pauseEvent);
    assert.equal(helperActive, false, pauseEvent + ' pauses the helper.');
    await expectMode('none');
    assert.equal((await snapshot()).companion.buddy.manualGame, true);
    powerMonitor.emit(resumeEvent);
    assert.equal(helperActive, true, resumeEvent + ' restores opted-in detection.');
    await expectMode('gaming');
  }
  await good('petSettings.save({typingCompanion:false})');
  assert.equal(helperActive, false);
  await good('petSettings.gameMode(false)');
  emit(b, 'event_msg', { type: 'turn_aborted' });
  await good('petSettings.reloadCodex()');
  await eventually(async () => assert.equal(await state(), 'idle'));
  await eventually(async () => assert.equal((await bubbles()).length, 0));

  // Check source alpha and compare animated master frames. Pixel changes must
  // be confined to the shader's bounded hand fields, never the face/band/legs.
  for (const mode of ['typing', 'gaming']) {
    const file = path.join(root, 'assets', 'whalepet-buddy', `${mode}-v1.png`);
    const image = nativeImage.createFromPath(file);
    const { width, height } = image.getSize();
    assert(width >= 1024 && width <= 4096); assert.equal(height, width);
    const rgba = image.toBitmap();
    const alpha = (x, y) => rgba[(Math.round(y * height / 1280) * width + Math.round(x * width / 1280)) * 4 + 3];
    let transparent = 0;
    for (let index = 3; index < rgba.length; index += 4) if (rgba[index] === 0) transparent++;
    assert(transparent / (width * height) > .3, 'Background is true alpha, not a white or checker drawing.');
    const points = mode === 'typing' ? { hole: [585, 145], band: [580, 200], legs: [[505, 1020], [710, 1020]], shoes: [[500, 1150], [720, 1150]] } :
      { hole: [615, 155], band: [595, 225], legs: [[465, 1060], [705, 1080]], shoes: [[420, 1140], [710, 1150]] };
    assert.equal(alpha(...points.hole), 0, mode + ' ahoge interior gap is transparent.');
    assert(alpha(...points.band) >= 250, mode + ' white headband remains opaque.');
    for (const point of points.legs) assert(alpha(...point) >= 250, mode + ' short legs remain visible.');
    for (const point of points.shoes) assert(alpha(...point) >= 250, mode + ' both shoes remain visible.');
    report.assets.push({ mode, width, height, transparentFraction: transparent / (width * height), points });
    const baselineUrl = await js(`whaleBuddy.inspectFrame(${JSON.stringify(mode)},0,0)`);
    const animatedUrl = await js(`whaleBuddy.inspectFrame(${JSON.stringify(mode)},1,1)`);
    assert(baselineUrl && animatedUrl);
    const baseline = nativeImage.createFromBuffer(Buffer.from(baselineUrl.split(',')[1], 'base64')).toBitmap();
    const animated = nativeImage.createFromBuffer(Buffer.from(animatedUrl.split(',')[1], 'base64')).toBitmap();
    assert.equal(baseline.length, animated.length);
    const boxes = mode === 'typing' ? [[440, 815, 565, 921], [650, 815, 760, 925]] : [[445, 805, 565, 932], [650, 805, 762, 932]];
    let changed = 0, outside = 0;
    for (let index = 0; index < baseline.length; index += 4) {
      if (baseline[index] === animated[index] && baseline[index + 1] === animated[index + 1] && baseline[index + 2] === animated[index + 2] && baseline[index + 3] === animated[index + 3]) continue;
      changed++;
      const x = index / 4 % 1280, y = Math.floor(index / 4 / 1280);
      if (!boxes.some(([left, top, right, bottom]) => x >= left && x < right && y >= top && y < bottom)) outside++;
    }
    assert(changed > 100, mode + ' hands animate.');
    assert.equal(outside, 0, mode + ' no animated pixels outside the bounded hand fields.');
    report.frames.push({ mode, changed, outside, boxes });
    fs.writeFileSync(path.join(run, `${mode}-master.png`), Buffer.from(baselineUrl.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(run, `${mode}-hands.png`), Buffer.from(animatedUrl.split(',')[1], 'base64'));
  }

  const backgrounds = {
    black: '#050505', navy: '#101d3d', gray: '#858c97',
    checker: 'repeating-conic-gradient(#eeeeee 0% 25%, #c6c6c6 0% 50%) 0 0 / 20px 20px'
  };
  for (const scale of [.75, 1]) {
    await good(`petSettings.save({scale:${scale}})`);
    await eventually(() => assert.equal(pet.webContents.getZoomFactor(), scale));
    for (const mode of ['typing', 'gaming']) {
      await good(mode === 'gaming' ? 'petSettings.gameMode(true)' : 'petSettings.gameMode(false)');
      if (mode === 'typing') await good('petSettings.previewBuddy("typing")');
      await expectMode(mode);
      const info = await renderer();
      assert.equal(info.failed, false);
      assert.equal(info.loaded, true);
      for (const [name, background] of Object.entries(backgrounds)) {
        if (mode === 'typing') await good('petSettings.previewBuddy("typing")');
        await js(`document.documentElement.style.background=${JSON.stringify(background)}`);
        await pause(100);
        await pet.webContents.capturePage(); await pause(65);
        const filename = `${mode}-${Math.round(scale * 100)}-${name}.png`;
        const screenshot = await pet.webContents.capturePage();
        assert.equal(screenshot.isEmpty(), false);
        fs.writeFileSync(path.join(run, filename), screenshot.toPNG());
        report.screenshots.push(filename);
      }
    }
  }
  await good('petSettings.gameMode(false)');
  await good('petSettings.save({typingCompanion:false,gameCompanion:false})');
  assert.equal(helperActive, false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(runtime, 'preferences.json'), 'utf8')).typingCompanion, false);
  await ui('petSettings.get().then(result=>{snapshot=result.value;render();tab("companion");})');
  settings.showInactive();
  for (const [width, height] of [[940, 740], [560, 480]]) {
    settings.setContentSize(width, height);
    await ui('document.querySelector(".buddy-card").scrollIntoView({block:"start"})');
    await pause(120);
    assert.equal(await ui('document.querySelector("main").scrollWidth<=document.querySelector("main").clientWidth'), true, 'Companion controls fit narrow settings width.');
    const filename = `buddy-controls-${width}x${height}.png`;
    fs.writeFileSync(path.join(run, filename), (await settings.webContents.capturePage()).toPNG());
    report.screenshots.push(filename);
  }
  report.helperStarts = starts;
  report.helperStops = stopCount;
  report.passed = true;
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2));
  console.log('PASS companionship runtime: default privacy, picker consent, typing/game/manual modes, urgent/ready precedence, unchanged AI/bubbles, hide/recover/failure, alpha/anatomy, bounded hands, 75/100% four-background QA. Artifacts: ' + run);
  app.quit();
}).catch(error => {
  report.error = error.message;
  report.helperStarts = starts;
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2));
  console.error(error);
  console.error('Artifacts: ' + run);
  app.exit(1);
});
app.on('will-quit', () => {
  // Main must dispose the mock, proving real helpers would be terminated too.
  if (activityOptions && report.passed) {
    assert.equal(helperDisposed, true, 'Quitting disposes the companion activity controller.');
    assert.equal(helperActive, false, 'No helper remains active after quit cleanup.');
    report.helperDisposed = helperDisposed;
    fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2));
  }
});
setTimeout(() => { console.error('Buddy QA timed out. Artifacts: ' + run); app.exit(1); }, 120000).unref();
