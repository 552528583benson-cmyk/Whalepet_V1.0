'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, globalShortcut, screen } = require('electron');

const root = path.resolve(__dirname, '..');
const run = fs.mkdtempSync(path.join(root, 'work', 'cursor-recovery-qa-'));
const runtime = path.join(run, 'runtime');
const sessions = path.join(run, 'sessions');
fs.mkdirSync(runtime);
fs.mkdirSync(sessions);
Object.assign(process.env, {
  WHALEPET_RUNTIME_DIR: runtime,
  WHALEPET_CODEX_SESSIONS: sessions,
  WHALEPET_DISABLE_AUTO_FOLLOW: '1',
  WHALEPET_QA_ALLOW_SECOND_INSTANCE: '1',
  WHALEPET_QA_HIDDEN: '1',
  WHALEPET_QA_SETTINGS: '1',
  WHALEPET_BRIDGE_PORT: String(58000 + process.pid % 1000)
});
delete process.env.WHALEPET_QA_FORCE_INTERACTIVE;
app.setPath('userData', path.join(run, 'electron'));
app.setAppPath(root);
globalShortcut.register = () => false;
let qaCursor = { x: -1000000, y: -1000000 };
app.once('ready', () => { screen.getCursorScreenPoint = () => ({ ...qaCursor }); });

// This process never observes real keys, game processes, or the real cursor.
require('../user-activity').createUserActivity = () => ({
  start: () => true,
  stop() {},
  dispose() {},
  getStatus: () => ({ state: 'stopped', reason: null, available: false })
});
fs.writeFileSync(path.join(runtime, 'preferences.json'), JSON.stringify(
  require('../preferences').normalizePreferences({ idleLife: false, idleSongEnabled: false })
));

const observed = new Map();
app.on('browser-window-created', (_event, window) => {
  window.setOpacity(0);
  window.setSkipTaskbar(true);
  window.webContents.setAudioMuted(true);
  const events = { ignored: null, modes: [], probes: [], dragStarts: 0 };
  observed.set(window, events);
  const setIgnore = window.setIgnoreMouseEvents.bind(window);
  window.setIgnoreMouseEvents = (ignored, options) => {
    events.ignored = ignored;
    events.modes.push(ignored);
    return setIgnore(ignored, options);
  };
  const send = window.webContents.send.bind(window.webContents);
  window.webContents.send = (channel, ...args) => {
    if (channel === 'pet:cursor-probe') events.probes.push(args[0]);
    if (channel === 'pet:drag-motion' && args[0]?.start) events.dragStarts++;
    return send(channel, ...args);
  };
});

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(check, message, timeout = 2500) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { return await check(); } catch (error) { last = error; }
    await pause(25);
  }
  throw new Error(message + ': ' + (last?.message || 'timed out'));
}

require('../main');
app.whenReady().then(async () => {
  const pet = await eventually(() => {
    const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().endsWith('index.html'));
    assert.ok(window); return window;
  }, 'pet window loads');
  const settings = await eventually(() => {
    const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('settings.html'));
    assert.ok(window); return window;
  }, 'settings window loads');
  const events = observed.get(pet);
  const js = code => pet.webContents.executeJavaScript(code);
  const ui = code => settings.webContents.executeJavaScript(code);
  const good = async code => {
    const response = await ui(code);
    assert.equal(response.ok, true, response.error);
    return response.value;
  };
  const expectIgnored = (ignored, message) => eventually(
    () => assert.equal(events.ignored, ignored), message
  );
  const moveTo = point => {
    const bounds = pet.getContentBounds();
    const zoom = pet.webContents.getZoomFactor();
    qaCursor = {
      x: bounds.x + Math.round(point.x * zoom),
      y: bounds.y + Math.round(point.y * zoom)
    };
  };
  const moveOutside = () => { qaCursor = { x: -1000000, y: -1000000 }; };
  const opaquePoint = async () => eventually(async () => {
    const point = await js(`(() => {
      for (let y = 230; y < 510; y += 5)
        for (let x = 140; x < 430; x += 5)
          if (whalePetController.hitTest(x, y)) return { x, y };
      return null;
    })()`);
    assert.ok(point, 'the actual visible layer has an opaque hit point');
    return point;
  }, 'visible alpha map loads');
  const setState = async state => {
    await js(`whalePetController.setState({state:${JSON.stringify(state)},providerChanged:true})`);
    await eventually(async () => {
      const info = await js('({state:whalePetController.getState().state,transition:whalePetController.transitionInfo().inProgress,layers:whalePetController.layerInfo().visibleLayers})');
      assert.equal(info.state, state);
      assert.equal(info.transition, false);
      assert.equal(info.layers, 1);
    }, state + ' settles');
    await pause(80);
  };

  await eventually(async () => assert.equal(await js('typeof whalePetController'), 'object'), 'renderer initializes');
  await eventually(async () => assert.equal(await ui('typeof petSettings.companion'), 'function'), 'settings initialize');
  // Forwarded/native mousemoves cannot repair the test: only cursor probes can.
  await js("document.addEventListener('mousemove',event=>event.stopImmediatePropagation(),true)");
  pet.webContents.debugger.attach('1.3');
  await pet.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  });
  await good("petSettings.companion('show')");
  assert.equal(pet.isVisible(), true, 'the invisible QA surface participates in cursor probing');
  assert.equal(pet.getOpacity(), 0);
  await setState('idle');

  for (const scale of [.75, 1, 1.5]) {
    moveOutside();
    await expectIgnored(true, 'previous hover is released');
    await good(`petSettings.save({scale:${scale}})`);
    await eventually(() => assert.equal(pet.webContents.getZoomFactor(), scale), 'zoom changes');
    const point = await opaquePoint();
    moveTo(point);
    await expectIgnored(false, scale + ': opaque character recovers without mousemove');
    const probe = events.probes.findLast(value => value && Math.abs(value.x - point.x) <= 1 && Math.abs(value.y - point.y) <= 1);
    assert.ok(probe, 'content-relative probe is converted back to CSS coordinates');
    moveTo({ x: 2, y: 2 });
    await expectIgnored(true, scale + ': transparent padding releases the native window');
    moveTo(point);
    await expectIgnored(false, scale + ': re-entering character restores interaction');
    moveOutside();
    await expectIgnored(true, scale + ': outside window releases the native window');
    assert.equal(events.probes.at(-1), null, 'leaving the window clears the renderer pointer sample');
  }

  await good('petSettings.save({scale:1})');
  await setState('idle');
  await js(`window.qaIdleHits=[];
    for(let y=240;y<500;y+=6)for(let x=145;x<420;x+=6)
      window.qaIdleHits.push({x,y,hit:whalePetController.hitTest(x,y)});`);
  await setState('reading');
  const stationaryPoint = await js(`window.qaIdleHits.find(point=>!point.hit&&whalePetController.hitTest(point.x,point.y))`);
  assert.ok(stationaryPoint, 'reading introduces an opaque pixel over idle-transparent space');
  await setState('idle');
  moveTo(stationaryPoint);
  await expectIgnored(true, 'idle is transparent at the stationary test point');
  const stationaryCursor = { ...qaCursor };
  await setState('reading');
  assert.deepEqual(qaCursor, stationaryCursor, 'pose swap does not move the fake cursor');
  await expectIgnored(false, 'unchanged cursor is resampled after the visible pose changes');
  await setState('idle');
  await expectIgnored(true, 'unchanged cursor is released after the pose moves away');

  assert.equal(await js('whaleBuddy.ready'), true);
  await good('petSettings.gameMode(true)');
  await eventually(async () => assert.equal(await js('whaleBuddy.info().mode'), 'gaming'), 'gaming overlay becomes visible');
  const buddyPoint = await opaquePoint();
  assert.match(await js('whaleBuddy.hitLayer().dataset.filename'), /buddy-gaming/);
  moveTo(buddyPoint);
  await expectIgnored(false, 'visible buddy reference alpha restores interaction');
  moveTo({ x: 2, y: 2 });
  await expectIgnored(true, 'buddy keeps transparent padding available');
  await good('petSettings.gameMode(false)');
  await setState('idle');
  const dragPoint = await opaquePoint();
  moveTo(dragPoint);
  await expectIgnored(false, 'character is interactive before native drag');

  const dragStarts = events.dragStarts;
  await js('whalePet.beginDrag({})');
  await eventually(() => assert.equal(events.dragStarts, dragStarts + 1), 'native drag starts');
  moveOutside();
  const dragProbeCount = events.probes.length;
  await pause(360);
  assert.equal(events.probes.length, dragProbeCount, 'native dragging suppresses cursor probes');
  assert.equal(events.ignored, false, 'native dragging retains mouse interaction');
  await js('whalePet.endDrag({cancelled:true})');
  await expectIgnored(true, 'normal probing resumes after native drag ends');

  moveTo(dragPoint);
  await expectIgnored(false, 'character is interactive before pending pointer press');
  await js(`(() => {
    const pet=document.querySelector('#pet');
    pet.setPointerCapture=()=>{};pet.hasPointerCapture=()=>false;
    pet.dispatchEvent(new PointerEvent('pointerdown',{button:0,buttons:1,pointerId:923,
      clientX:${dragPoint.x},clientY:${dragPoint.y},screenX:300,screenY:300,bubbles:true}));
  })()`);
  moveTo({ x: 2, y: 2 });
  const pressProbeCount = events.probes.length;
  await pause(360);
  assert.ok(events.probes.length > pressProbeCount, 'pre-threshold press still receives probes');
  assert.equal(events.ignored, false, 'renderer pending-pointer guard retains interaction');
  await js("document.querySelector('#pet').dispatchEvent(new PointerEvent('pointercancel',{pointerId:923,bubbles:true}))");
  await expectIgnored(true, 'pointer cancellation allows transparent release');

  moveTo(dragPoint);
  await expectIgnored(false, 'character recovers before hiding');
  await good("petSettings.companion('hide')");
  await eventually(async () => assert.equal((await good('petSettings.get()')).companion.hideStage, 'hidden'), 'hide animation settles', 8000);
  const tucked = await js('whalePetController.edgeInfo()');
  assert.equal(tucked.phase, 'tucked');assert.equal(tucked.animated, false, 'reduced motion skips escape animation');
  assert.equal(pet.isVisible(), false);
  await expectIgnored(true, 'hide cancels mouse interaction');
  const hiddenProbeCount = events.probes.length;
  await pause(360);
  assert.equal(events.probes.length, hiddenProbeCount, 'hidden pet stops probing');
  await good("petSettings.companion('show')");
  await eventually(async () => assert.equal((await good('petSettings.get()')).companion.hideStage, 'normal'), 'emergence animation settles', 8000);
  assert.equal(await js('whalePetController.edgeInfo().animated'), false, 'reduced motion skips jump animation');
  moveTo(await opaquePoint());
  await expectIgnored(false, 'show resumes recovery without mousemove');
  for (const window of BrowserWindow.getAllWindows()) {
    assert.equal(window.getOpacity(), 0, 'all QA windows stay invisible');
  }
  console.log('PASS cursor recovery: fake input only, no forwarded mousemove, 75/100/150% alpha/blank/outside, stationary pose swaps, buddy reference alpha, native drag/pending press guards, and hide/show. Artifacts: ' + run);
  app.quit();
}).catch(error => {
  console.error(error);
  console.error('Artifacts: ' + run);
  app.exit(1);
});
setTimeout(() => { console.error('Cursor recovery QA timed out. Artifacts: ' + run); app.exit(1); }, 30000).unref();
