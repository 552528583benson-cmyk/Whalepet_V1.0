const { app, BrowserWindow, globalShortcut, ipcMain, Menu, screen, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const dgram = require("dgram");
const { CodexStateFollower } = require("./codex-state-follower");
const { POSES, readPreferences, writePreferences, normalizePreferences } = require('./preferences');
const { createSettingsController } = require('./settings-window');
const {
  STATES: STATE_NAMES,
  VALID_STATES,
  VALID_PROVIDERS,
  BRIDGE_HOST,
  BRIDGE_PORT
} = require("./state-schema");
const {
  PET_WINDOW_SIZE,
  applyCursorDelta,
  clampWindowToWorkArea,
  hasExpectedWindowSize
} = require("./drag-math");

const DEFAULT_STATE = Object.freeze({ state: "idle", message: "待机中" });
const DEFAULT_PROVIDER = "chatgpt";
const PROVIDERS = Object.freeze({
  chatgpt: Object.freeze({ label: "ChatGPT", menuLabel: "ChatGPT · 星星搭档" }),
  deepseek: Object.freeze({ label: "DeepSeek", menuLabel: "DeepSeek · 小鲸工作台" }),
  custom: Object.freeze({label: '自定义 AI', menuLabel: '自定义 AI · 本地状态桥'})
});
const WATCH_INTERVAL_MS = 600;
const DRAG_TRACK_INTERVAL_MS = 16;
const BOUNDS_GUARD_INTERVAL_MS = 750;

let petWindow = null;
let currentState = { ...DEFAULT_STATE };
let stateFile = "";
let settingsFile = "";
let activeProvider = DEFAULT_PROVIDER;
let providerLocked = false;
let windowStateFile = "";
let mouseInteractive = true;
let petHidden = false;
let dragCursor = null;
let dragTimer = null;
let dragRoom = null;
let dragSession = null;
let boundsGuardTimer = null;
let mouseModeStabilizeTimer = null;
let repairingBounds = false;
let expectedOuterSize = null;
let expectedContentSize = null;
let stateBridgeSocket = null;
let codexFollower = null;
let autoFollow = true;
let followStatus = { status: "starting" };
let renderedState = null;
let preferences = normalizePreferences();
let settingsController = null;
let preferencesRevision = 0;
const lastBridgeEvents = {};
const stateWatchListener = () => readStateFile();

function rendererPreferences() {
  const images = {};
  for (const [state, , filename] of POSES) {
    const imported=preferences.images[state];
    if(!imported) continue;
    try { images[filename]='data:image/png;base64,'+fs.readFileSync(path.join(getRuntimeFile('custom-images'),imported)).toString('base64'); }
    catch { /* Missing imports fall back to the bundled drawing. */ }
  }
  return {...preferences,images,revision:preferencesRevision};
}

function applyPetSize() {
  if(!petWindow || petWindow.isDestroyed()) return;
  stopDragTracking();
  const before=petWindow.getBounds();
  const logical={x:before.x+(dragRoom?.left||0),y:before.y+(dragRoom?.top||0)};
  repairingBounds=true;
  try {
    petWindow.webContents.setZoomFactor(preferences.scale);
    const z=preferences.scale;
    dragRoom={left:130*z,top:170*z,right:130*z,bottom:48*z};
    petWindow.setContentSize(Math.round(560*z),Math.round(560*z));
    const b=petWindow.getBounds(), c=petWindow.getContentBounds();
    expectedOuterSize={width:b.width,height:b.height};
    expectedContentSize={width:c.width,height:c.height};
    const area=screen.getDisplayNearestPoint({x:b.x,y:b.y}).workArea;
    const position=clampWindowToWorkArea({x:logical.x-dragRoom.left,y:logical.y-dragRoom.top},dragWorkArea(area),expectedOuterSize);
    petWindow.setPosition(position.x,position.y);
  } finally {repairingBounds=false;}
}

function saveAppearance(patch) {
  const previousScale=preferences.scale;
  preferences=writePreferences(getRuntimeFile('preferences.json'),{...preferences,...patch});
  preferencesRevision++;
  if(previousScale!==preferences.scale) applyPetSize();
  petWindow?.webContents.send('pet:preferences',rendererPreferences());
}

function settingsSnapshot() {
  const rendered=rendererPreferences();
  const provider=activeProvider;
  const packet={type:'whalepet-state',provider,state:'thinking',message:'正在认真思考',nonce:'your-unique-id'};
  return {
    preferences:{...preferences,images:{...preferences.images}},
    poses:POSES.map(([state,label,filename])=>({state,label,custom:Boolean(rendered.images[filename]),url:rendered.images[filename]||`assets/whalepet-hd/${filename.replace(/\.webp$/,'.png')}`})),
    provider,providerLocked,autoFollowCodex:autoFollow,follower:followStatus,
    state:currentState.state,renderedState,lastReceivedAt:lastBridgeEvents[provider]||null,
    endpoint:`127.0.0.1:${Number(process.env.WHALEPET_BRIDGE_PORT)||BRIDGE_PORT}`,
    stateFile:getStateFile(provider),
    snippets:{
      packet:JSON.stringify(packet,null,2),
      python:'import socket, json\npacket = '+JSON.stringify(packet)+'\nsocket.socket(socket.AF_INET, socket.SOCK_DGRAM).sendto(\n    json.dumps(packet).encode("utf-8"),\n    ("127.0.0.1", '+(Number(process.env.WHALEPET_BRIDGE_PORT)||BRIDGE_PORT)+')\n)',
      states:STATE_NAMES.join(', ')
    }
  };
}

function setupSettings() {
  settingsController=createSettingsController({
    snapshot:settingsSnapshot,imageDirectory:getRuntimeFile('custom-images'),preview:setPreviewState,
    save(patch) {
      const appearance={};
      for(const key of ['scale','showBadge','showSpeech','idleLife','customLabel']) if(Object.hasOwn(patch,key)) appearance[key]=patch[key];
      if(Object.keys(appearance).length) saveAppearance(appearance);
      if(!providerLocked && VALID_PROVIDERS.has(patch.provider)) setStateProvider(patch.provider);
      if(!providerLocked && typeof patch.autoFollowCodex==='boolean') {
        autoFollow=patch.autoFollowCodex;saveProviderSetting();configureCodexFollower();
      }
    },
    setImage(state,name) {
      const images={...preferences.images};
      if(name)images[state]=name;else delete images[state];
      saveAppearance({images});setPreviewState(state);
    },
    reset:()=>saveAppearance({scale:1,showBadge:true,showSpeech:true,idleLife:true,images:{}})
  });
}

function dragWorkArea(area) {
  if(!dragRoom)return area;
  // Empty margins may lie outside the display; the normal pet footprint keeps
  // its original reachable range. Do not clamp the enlarged empty rectangle.
  return {x:area.x-dragRoom.left,y:area.y-dragRoom.top,
    width:area.width+dragRoom.left+dragRoom.right,
    height:area.height+dragRoom.top+dragRoom.bottom};
}

function repairPetWindowBounds(reason = "guard") {
  if (!petWindow || petWindow.isDestroyed() || repairingBounds) return false;
  if (!expectedOuterSize || !expectedContentSize) return false;
  const bounds = petWindow.getBounds();
  const contentBounds = petWindow.getContentBounds();
  if (process.env.WHALEPET_DEBUG_BOUNDS === "1") {
    console.log(`WhalePet bounds ${JSON.stringify({ reason, bounds, contentBounds, expectedOuterSize, expectedContentSize })}`);
  }
  // A few pixels of fractional-DPI rounding are harmless. Larger growth is not:
  // it expands the invisible hit box and eventually makes repeated dragging
  // difficult. Resize events do not call this guard, so an 8px tolerance no
  // longer creates the old recursive repair loop.
  if (hasExpectedWindowSize(contentBounds, expectedContentSize)) return false;
  const workArea = dragWorkArea(screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }).workArea);
  const position = clampWindowToWorkArea(bounds, workArea, expectedOuterSize);
  repairingBounds = true;
  try {
    petWindow.setBounds({ ...position, ...expectedOuterSize }, false);
    console.warn(
      `WhalePet repaired unexpected window bounds (${reason}): ` +
      `${bounds.width}x${bounds.height} -> ` +
      `${expectedOuterSize.width}x${expectedOuterSize.height}`
    );
  } finally {
    repairingBounds = false;
  }
  return true;
}

function stopDragTracking() {
  if (dragTimer) clearInterval(dragTimer);
  dragTimer = null;
  if(dragSession&&petWindow&&!petWindow.isDestroyed()){
    const end=dragCursor||screen.getCursorScreenPoint();
    const point={x:dragSession.origin.x+end.x-dragSession.press.x,
      y:dragSession.origin.y+end.y-dragSession.press.y};
    const position=clampWindowToWorkArea(point,dragWorkArea(screen.getDisplayNearestPoint(end).workArea),expectedOuterSize);
    petWindow.setBounds({...position,...expectedOuterSize},false);
  }
  dragCursor = null;
  dragSession = null;
}

function stabilizeAfterMouseModeChange() {
  if (!petWindow || petWindow.isDestroyed() || !expectedOuterSize) return;
  if (mouseModeStabilizeTimer) clearTimeout(mouseModeStabilizeTimer);
  const applyCanonicalBounds = () => {
    if (!petWindow || petWindow.isDestroyed() || !expectedOuterSize) return;
    const bounds = petWindow.getBounds();
    const workArea = dragWorkArea(screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }).workArea);
    const position = clampWindowToWorkArea(bounds, workArea, expectedOuterSize);
    petWindow.setBounds({ ...position, ...expectedOuterSize }, false);
  };
  // Apply once for the current style and once after DWM has committed the
  // WS_EX_TRANSPARENT change. The delayed pass is debounced across rapid
  // forwarded mousemove events.
  applyCanonicalBounds();
  mouseModeStabilizeTimer = setTimeout(() => {
    mouseModeStabilizeTimer = null;
    applyCanonicalBounds();
  }, 60);
}

function updateDraggedWindow(finalCursor) {
  if (!petWindow || petWindow.isDestroyed() || !dragCursor) return;
  const cursor = Number.isFinite(finalCursor?.x)&&Number.isFinite(finalCursor?.y)
    ? {x:Math.round(finalCursor.x),y:Math.round(finalCursor.y)} : screen.getCursorScreenPoint();
  const bounds = petWindow.getBounds();
  const { x, y } = bounds;
  const workArea = dragWorkArea(screen.getDisplayNearestPoint(cursor).workArea);
  const result = applyCursorDelta({
    position: { x, y },
    lastCursor: dragCursor,
    cursor,
    // Do not let Windows' invisible transparent-border rounding shrink the
    // reachable desktop area. Dragging always uses the canonical outer size.
    windowSize: expectedOuterSize || { width: bounds.width, height: bounds.height },
    workArea
  });
  dragCursor = result.cursor;
  // Use the actual clamped support movement, not cursor travel beyond an edge.
  petWindow.webContents.send('pet:drag-motion',{
    x:result.position.x/petWindow.webContents.getZoomFactor()
  });
  if (result.position.x !== x || result.position.y !== y) {
    // setPosition preserves a Windows transparent frame after DWM has silently
    // inflated it. Reassert the canonical outer size in the same compositor
    // transaction as the move, preventing each drag from accumulating padding.
    if (expectedOuterSize) {
      petWindow.setBounds({ ...result.position, ...expectedOuterSize }, false);
    } else {
      petWindow.setPosition(result.position.x, result.position.y);
    }
  }
}

function normalizeState(value) {
  const state = VALID_STATES.has(value?.state) ? value.state : DEFAULT_STATE.state;
  const message = typeof value?.message === "string"
    ? value.message.trim().slice(0, 160)
    : "";
  return { state, message };
}

function normalizeProvider(value) {
  return Object.hasOwn(PROVIDERS, value) ? value : DEFAULT_PROVIDER;
}

function getProviderLock() {
  const value = process.env.WHALEPET_PROVIDER_LOCK;
  return Object.hasOwn(PROVIDERS, value) ? value : "";
}

function getRuntimeFile(filename) {
  if (process.env.WHALEPET_RUNTIME_DIR) return path.join(path.resolve(process.env.WHALEPET_RUNTIME_DIR), filename);
  return app.isPackaged
    ? path.join(app.getPath("userData"), filename)
    : path.join(__dirname, "runtime", filename);
}

function getStateFile(provider = activeProvider) {
  if (process.env.WHALEPET_STATE_FILE) {
    return path.resolve(process.env.WHALEPET_STATE_FILE);
  }
  return getRuntimeFile(`state-${normalizeProvider(provider)}.json`);
}

function getLegacyStateFile() {
  return getRuntimeFile("state.json");
}

function getSettingsFile() {
  return getRuntimeFile("settings.json");
}

function getWindowStateFile() {
  if (process.env.WHALEPET_RUNTIME_DIR) return getRuntimeFile("window-state.json");
  return app.isPackaged
    ? path.join(app.getPath("userData"), "window-state.json")
    : path.join(__dirname, "runtime", "window-state.json");
}

function readProviderSetting() {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    autoFollow = settings.autoFollowCodex !== false;
    return normalizeProvider(settings?.provider);
  } catch {
    return DEFAULT_PROVIDER;
  }
}

function saveProviderSetting() {
  if (!settingsFile || providerLocked) return;
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  const temporaryFile = `${settingsFile}.${process.pid}.tmp`;
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(settingsFile, "utf8")); } catch {}
  fs.writeFileSync(
    temporaryFile,
    `${JSON.stringify({ ...existing, provider: activeProvider, autoFollowCodex: autoFollow }, null, 2)}\n`,
    "utf8"
  );
  fs.renameSync(temporaryFile, settingsFile);
}

function ensureStateFile() {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  if (!fs.existsSync(stateFile)) {
    const legacy = getLegacyStateFile();
    if (activeProvider === "deepseek" && fs.existsSync(legacy)) {
      fs.copyFileSync(legacy, stateFile);
    } else {
      fs.writeFileSync(stateFile, `${JSON.stringify(DEFAULT_STATE, null, 2)}\n`, "utf8");
    }
  }
}

function sendCurrentState(extra = {}) {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send("pet:state", {
      ...currentState,
      provider: activeProvider,
      ...extra
    });
  }
}

function readStateFile(force = false, providerChanged = false) {
  try {
    const next = normalizeState(JSON.parse(fs.readFileSync(stateFile, "utf8")));
    const unchanged = next.state === currentState.state && next.message === currentState.message;
    currentState = next;
    if (!unchanged || force) sendCurrentState({ providerChanged });
  } catch (error) {
    console.warn(`WhalePet ignored an invalid state file: ${error.message}`);
  }
}

function watchStateFile(providerChanged = false) {
  if (stateFile) fs.unwatchFile(stateFile, stateWatchListener);
  stateFile = getStateFile(activeProvider);
  ensureStateFile();
  readStateFile(true, providerChanged);
  fs.watchFile(stateFile, { interval: WATCH_INTERVAL_MS }, stateWatchListener);
}

function writeProviderState(provider, value) {
  const target = getStateFile(provider);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporaryFile = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryFile, target);
}

function startStateBridge() {
  if (stateBridgeSocket) return;
  const port = Number(process.env.WHALEPET_BRIDGE_PORT) || BRIDGE_PORT;
  const socket = dgram.createSocket("udp4");
  stateBridgeSocket = socket;
  socket.on("message", (packet, remote) => {
    if (remote.address !== BRIDGE_HOST) return;
    try {
      const value = JSON.parse(packet.toString("utf8"));
      if (value?.type === "whalepet-status") {
        socket.send(Buffer.from(JSON.stringify({
          type: "whalepet-status-reply", nonce: value.nonce || "",
          provider: activeProvider, state: currentState.state,
          renderedState, autoFollowCodex: autoFollow, follower: followStatus
        })), remote.port, remote.address);
        return;
      }
      if (value?.type !== "whalepet-state") return;
      if (!VALID_PROVIDERS.has(value?.provider) || !VALID_STATES.has(value?.state)) return;
      const next = normalizeState(value);
      lastBridgeEvents[value.provider]=Date.now();
      writeProviderState(value.provider, next);
      if (value.provider === activeProvider) {
        currentState = next;
        sendCurrentState();
      }
      const acknowledgement = Buffer.from(JSON.stringify({
        type: "whalepet-state-ack",
        nonce: value.nonce || ""
      }));
      socket.send(acknowledgement, remote.port, remote.address);
    } catch (error) {
      console.warn(`WhalePet ignored an invalid bridge message: ${error.message}`);
    }
  });
  socket.on("error", (error) => {
    console.warn(`WhalePet live state bridge is unavailable: ${error.message}`);
    socket.close();
    if (stateBridgeSocket === socket) stateBridgeSocket = null;
  });
  socket.bind(port, BRIDGE_HOST);
}

function configureCodexFollower() {
  codexFollower?.stop();
  codexFollower = null;
  if (!autoFollow || providerLocked || process.env.WHALEPET_DISABLE_AUTO_FOLLOW === "1") {
    followStatus = { status: "disabled" };
    return;
  }
  codexFollower = new CodexStateFollower({
    directory: process.env.WHALEPET_CODEX_SESSIONS,
    onState: (value) => {
      writeProviderState("chatgpt", value);
      if (activeProvider === "chatgpt") {
        currentState = normalizeState(value);
        sendCurrentState();
      }
    },
    onStatus: (status) => { followStatus = status; }
  });
  codexFollower.start();
}

function setStateProvider(provider) {
  if (providerLocked) return;
  const next = normalizeProvider(provider);
  if (next === activeProvider) {
    sendCurrentState({ providerChanged: true });
    return;
  }
  activeProvider = next;
  saveProviderSetting();
  watchStateFile(true);
}

function cycleStateProvider() {
  if (providerLocked) return;
  const providers=Object.keys(PROVIDERS);
  setStateProvider(providers[(providers.indexOf(activeProvider)+1)%providers.length]);
}

function setPreviewState(state) {
  const preview = normalizeState({ state, message: "本地预览" });
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send("pet:state", {
      ...preview,
      provider: activeProvider,
      preview: true
    });
  }
}

function showPetMenu() {
  const providerMenu = providerLocked
    ? [{ label: `状态来源：${PROVIDERS[activeProvider].label}（固定）`, enabled: false }]
    : [{
        label: `状态来源：${PROVIDERS[activeProvider].label}（Ctrl+Alt+P 切换）`,
        submenu: [
          {
            label: PROVIDERS.chatgpt.menuLabel,
            type: "radio",
            checked: activeProvider === "chatgpt",
            click: () => setStateProvider("chatgpt")
          },
          {
            label: PROVIDERS.deepseek.menuLabel,
            type: "radio",
            checked: activeProvider === "deepseek",
            click: () => setStateProvider("deepseek")
          },
          {
            label: `${preferences.customLabel} · 自定义 AI`, type:'radio',
            checked:activeProvider==='custom',click:()=>setStateProvider('custom')
          }
        ]
      }];
  const menu = Menu.buildFromTemplate([
    {label:'小鲸的控制室…',click:()=>settingsController.open()},
    {label:'更换姿势图片…',click:()=>settingsController.open('poses')},
    {label:`大小 · ${Math.round(preferences.scale*100)}%`,submenu:[.75,1,1.25,1.5].map(scale=>({label:`${Math.round(scale*100)}%${scale===1?'（默认）':''}`,type:'radio',checked:preferences.scale===scale,click:()=>saveAppearance({scale})}))},
    {label:'动作预览',submenu:POSES.map(([state,label])=>({label,click:()=>setPreviewState(state)}))},
    { type: "separator" },
    ...providerMenu,
    ...(!providerLocked?[{label:'AI 接入设置…',click:()=>settingsController.open('connections')}]:[]),
    ...(!providerLocked ? [{
      label: "自动跟随本机 Codex 任务", type: "checkbox", checked: autoFollow,
      click: () => { autoFollow = !autoFollow; saveProviderSetting(); configureCodexFollower(); }
    }] : []),
    { type: "separator" },
    { label: "切换安全角落（Ctrl+Alt+W）", click: cyclePetSafeCorner },
    { label: "隐藏 / 显示（Ctrl+Alt+H）", click: togglePetVisibility },
    { label: "打开状态文件", click: () => shell.showItemInFolder(stateFile) },
    { label: "退出 WhalePet", click: () => app.quit() }
  ]);
  menu.popup({ window: petWindow });
}

function movePetToSafeCorner() {
  if (!petWindow || petWindow.isDestroyed()) return;
  const area = dragWorkArea(screen.getPrimaryDisplay().workArea);
  repairPetWindowBounds("safe-corner");
  const size=expectedOuterSize||PET_WINDOW_SIZE;
  const x = area.x + area.width - size.width - 20;
  const y = area.y + area.height - size.height - 20;
  stopDragTracking();
  petWindow.setPosition(Math.round(x), Math.round(y));
  petWindow.showInactive();
  petWindow.moveTop();
  petHidden = false;
  saveWindowPosition();
}

function cyclePetSafeCorner() {
  if (!petWindow || petWindow.isDestroyed()) return;
  const area = dragWorkArea(screen.getPrimaryDisplay().workArea);
  repairPetWindowBounds("corner-cycle");
  const padding = 20;
  const size=expectedOuterSize||PET_WINDOW_SIZE;
  const positions = [
    { x: area.x + area.width - size.width - padding, y: area.y + area.height - size.height - padding },
    { x: area.x + padding, y: area.y + area.height - size.height - padding },
    { x: area.x + area.width - size.width - padding, y: area.y + padding }
  ];
  const [currentX, currentY] = petWindow.getPosition();
  const currentIndex = positions.findIndex((position) =>
    Math.abs(position.x - currentX) <= 24 && Math.abs(position.y - currentY) <= 24
  );
  const next = positions[(currentIndex + 1) % positions.length];
  stopDragTracking();
  petWindow.setPosition(Math.round(next.x), Math.round(next.y));
  petWindow.showInactive();
  petWindow.moveTop();
  petHidden = false;
  saveWindowPosition();
}

function togglePetVisibility() {
  if (!petWindow || petWindow.isDestroyed()) return;
  if (petWindow.isVisible()) {
    petWindow.hide();
    stopDragTracking();
    petHidden = true;
  } else {
    movePetToSafeCorner();
  }
}

function clampWindowPosition(x, y, width, height) {
  const display = screen.getDisplayNearestPoint({ x, y });
  const area = display.workArea;
  return {
    x: Math.max(area.x, Math.min(x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(y, area.y + area.height - height))
  };
}

function readWindowPosition(width, height) {
  const display = screen.getPrimaryDisplay().workArea;
  const fallback = {
    x: display.x + display.width - width - 24,
    y: display.y + display.height - height - 24
  };
  try {
    const saved = JSON.parse(fs.readFileSync(windowStateFile, "utf8"));
    if (!Number.isFinite(saved?.x) || !Number.isFinite(saved?.y)) return fallback;
    const clamped = clampWindowPosition(Math.round(saved.x), Math.round(saved.y), width, height);
    const unsafeTopLeft = clamped.x <= display.x + 12 && clamped.y <= display.y + 12;
    return unsafeTopLeft ? fallback : clamped;
  } catch {
    return fallback;
  }
}

function saveWindowPosition() {
  if (!petWindow || petWindow.isDestroyed() || !windowStateFile) return;
  const [left, top] = petWindow.getPosition();
  const x=Math.round(left+(dragRoom?.left||0)),y=Math.round(top+(dragRoom?.top||0));
  fs.mkdirSync(path.dirname(windowStateFile), { recursive: true });
  const temporaryFile = `${windowStateFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify({ x, y }, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryFile, windowStateFile);
}

function createPetWindow() {
  const { width, height } = PET_WINDOW_SIZE;
  const position = readWindowPosition(width, height);

  petWindow = new BrowserWindow({
    width,
    height,
    x: position.x,
    y: position.y,
    frame: false,
    useContentSize: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: false,
      backgroundThrottling: false
    }
  });

  petWindow.setAlwaysOnTop(true, "screen-saver");
  // Keep width/height in the same outer-window coordinate system used by the
  // drag guard. Mixing content size and outer bounds causes Windows to add its
  // invisible transparent border again after every mouse-pass-through toggle.
  const forceQaInteractive = process.env.WHALEPET_QA_FORCE_INTERACTIVE === "1";
  petWindow.setIgnoreMouseEvents(!forceQaInteractive, { forward: true });
  mouseInteractive = forceQaInteractive;
  petWindow.loadFile(path.join(__dirname,"index.html"));
  petWindow.on("will-resize", (event) => event.preventDefault());
  petWindow.webContents.on("did-finish-load", () => {
    if (!petWindow || petWindow.isDestroyed()) return;
    const qaBackground = process.env.WHALEPET_QA_BACKGROUND;
    if (/^#[0-9a-f]{6}$/i.test(qaBackground || "")) {
      petWindow.webContents.executeJavaScript(
        `document.documentElement.style.background = ${JSON.stringify(qaBackground)}`
      ).catch((error) => console.error(`WhalePet QA background failed: ${error.message}`));
    }
    petWindow.moveTop();
    const stableBounds = petWindow.getBounds();
    const stableContentBounds = petWindow.getContentBounds();
    expectedOuterSize = { width: stableBounds.width, height: stableBounds.height };
    expectedContentSize = { width: stableContentBounds.width, height: stableContentBounds.height };
    applyPetSize();
    repairPetWindowBounds("renderer-ready");
    if(process.env.WHALEPET_QA_HIDDEN!=="1") petWindow.showInactive();
    console.log(`WhalePet window visible at ${JSON.stringify(petWindow.getBounds())}`);
    if (process.env.WHALEPET_QA_DRAG_VISUAL === "1") {
      setTimeout(async () => {
        try {
          await petWindow.webContents.executeJavaScript(
            "window.whalePetController.previewDrag(2400)"
          );
        } catch (error) {
          console.error(`WhalePet drag visual QA failed: ${error.message}`);
        }
      }, 250);
    }
    if (process.env.WHALEPET_CAPTURE_FILE) {
      const requestedDelay = Number(process.env.WHALEPET_CAPTURE_DELAY_MS);
      const captureDelay = Number.isFinite(requestedDelay)
        ? Math.max(100, Math.min(requestedDelay, 30_000))
        : 1200;
      setTimeout(async () => {
        try {
          const capture = await petWindow.webContents.capturePage();
          const captureFile = path.resolve(process.env.WHALEPET_CAPTURE_FILE);
          fs.mkdirSync(path.dirname(captureFile), { recursive: true });
          fs.writeFileSync(captureFile, capture.toPNG());
          console.log(`WhalePet renderer captured at ${captureFile}`);
        } catch (error) {
          console.error(`WhalePet renderer capture failed: ${error.message}`);
        } finally {
          if (process.env.WHALEPET_QA_AUTO_QUIT === "1" && process.env.WHALEPET_QA_MOTION !== "1") {
            setTimeout(() => app.quit(), 250);
          }
        }
      }, captureDelay);
    }
    if (process.env.WHALEPET_QA_INTERACTION === "1") {
      setTimeout(async () => {
        try {
          const result = await petWindow.webContents.executeJavaScript(`(async () => {
            const controller = window.whalePetController;
            const box = (selector) => {
              const rect = document.querySelector(selector).getBoundingClientRect();
              return {
                left: Math.round(rect.left), top: Math.round(rect.top),
                right: Math.round(rect.right), bottom: Math.round(rect.bottom),
                width: Math.round(rect.width), height: Math.round(rect.height)
              };
            };
            const started = performance.now();
            for (let index = 0; index < 1000; index += 1) controller.react();
            const spamMs = performance.now() - started;
            for (let index = 0; index < 40; index += 1) {
              window.whalePet.setInteractive(index % 2 === 0);
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
            return {
              transparentCorner: controller.hitTest(6, 205),
              characterCenter: controller.hitTest(innerWidth / 2, innerHeight * 0.76),
              bubbleCenter: controller.hitTest(innerWidth / 2, 24),
              spamMs,
              state: controller.getState(),
              layers: controller.layerInfo(),
              layout: {
                viewport: { width: innerWidth, height: innerHeight },
                pet: box("#pet"), stage: box(".stage"),
                speech: box("#speech"), badge: box("#stateBadge")
              }
            };
          })()`);
          console.log(`WhalePet interaction QA ${JSON.stringify(result)}`);
        } catch (error) {
          console.error(`WhalePet interaction QA failed: ${error.message}`);
        }
      }, 1400);
    }
    if (process.env.WHALEPET_QA_MOUSE_TOGGLE_SOAK === "1") {
      setTimeout(async () => {
        const samples = [];
        for (let index = 0; index < 24; index += 1) {
          const interactive = index % 2 === 0;
          mouseInteractive = interactive;
          petWindow.setIgnoreMouseEvents(!interactive, { forward: true });
          stabilizeAfterMouseModeChange();
          await new Promise((resolve) => setTimeout(resolve, 260));
          samples.push({ bounds: petWindow.getBounds(), content: petWindow.getContentBounds() });
        }
        const widths = [...new Set(samples.map((sample) => sample.content.width))];
        const heights = [...new Set(samples.map((sample) => sample.content.height))];
        console.log(`WhalePet mouse-toggle QA ${JSON.stringify({ toggles: samples.length, widths, heights, final: samples.at(-1) })}`);
      }, 600);
    }
    if (process.env.WHALEPET_QA_CLICK === "1") {
      setTimeout(() => {
        const input = { x: 150, y: 260, button: "left", clickCount: 1 };
        petWindow.webContents.sendInputEvent({ type: "mouseMove", x: input.x, y: input.y });
        petWindow.webContents.sendInputEvent({ type: "mouseDown", ...input });
        petWindow.webContents.sendInputEvent({ type: "mouseUp", ...input });
        setTimeout(async () => {
          try {
            const result = await petWindow.webContents.executeJavaScript(`(() => ({
              dragging: document.querySelector("#pet").classList.contains("is-dragging"),
              badge: document.querySelector("#stateBadge").textContent,
              state: window.whalePetController.getState(),
              layers: window.whalePetController.layerInfo()
            }))()`);
            console.log(`WhalePet click QA ${JSON.stringify(result)}`);
          } catch (error) {
            console.error(`WhalePet click QA failed: ${error.message}`);
          }
        }, 140);
      }, 500);
    }
    if (process.env.WHALEPET_QA_MOTION === "1") {
      setTimeout(async () => {
        const captureDirectory = process.env.WHALEPET_QA_MOTION_CAPTURE_DIR
          ? path.resolve(process.env.WHALEPET_QA_MOTION_CAPTURE_DIR)
          : "";
        const qaMotionSequence = process.env.WHALEPET_QA_MOTION_SEQUENCE || "queue";
        const requestedCaptureInterval = Number(process.env.WHALEPET_QA_MOTION_CAPTURE_MS);
        const captureInterval = Number.isFinite(requestedCaptureInterval)
          ? Math.max(16, Math.min(250, requestedCaptureInterval))
          : 100;
        let captureIndex = 0;
        let captureBusy = false;
        let captureTimer = null;
        try {
          if (captureDirectory) {
            fs.mkdirSync(captureDirectory, { recursive: true });
            captureTimer = setInterval(async () => {
              if (captureBusy || !petWindow || petWindow.isDestroyed()) return;
              captureBusy = true;
              try {
                const capture = await petWindow.webContents.capturePage();
                captureIndex += 1;
                const filename = `frame-${String(captureIndex).padStart(3, "0")}.png`;
                fs.writeFileSync(path.join(captureDirectory, filename), capture.toPNG());
              } finally {
                captureBusy = false;
              }
            }, captureInterval);
          }
          const result = await petWindow.webContents.executeJavaScript(`(async () => {
            const controller = window.whalePetController;
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const qaSequence = ${JSON.stringify(qaMotionSequence)};
            const allStates = ${JSON.stringify(STATE_NAMES)};
            const visitedStates = [];
            if (qaSequence === "all-states") {
              for (const state of allStates) {
                controller.setState({ state, message: "全姿势测试：" + state, preview: true });
                visitedStates.push(state);
                await sleep(1100);
              }
            } else if (qaSequence === "search-ready") {
              controller.setState({ state: "searching", message: "搜索到完成测试", preview: true });
              visitedStates.push("searching");
              await sleep(1400);
              controller.setState({ state: "ready", message: "搜索到完成测试", preview: true });
              visitedStates.push("ready");
              await sleep(1500);
            } else {
              controller.setState({ state: "ready", message: "动作测试", preview: true });
              visitedStates.push("ready");
              await sleep(120);
              controller.setState({ state: "searching", message: "动作测试", preview: true });
              visitedStates.push("searching");
              await sleep(120);
              controller.setState({ state: "needs_input", message: "动作测试", preview: true });
              visitedStates.push("needs_input");
            }
            const samples = [];
            for (let index = 0; index < 200; index += 1) {
              samples.push({
                state: controller.getState().state,
                frame: controller.getState().frame,
                transition: controller.transitionInfo(),
                layers: controller.layerInfo().visibleLayers
              });
              await sleep(50);
            }
            return {
              final: controller.getState(),
              transition: controller.transitionInfo(),
              maximumVisibleLayers: Math.max(...samples.map((sample) => sample.layers)),
              statesSeen: [...new Set(samples.map((sample) => sample.state))],
              visitedStates,
              queuedStatesSeen: [...new Set(samples.map((sample) => sample.transition.queuedState).filter(Boolean))],
              renderedFrames: new Set(samples.map((sample) => sample.frame)).size
            };
          })()`);
          console.log(`WhalePet motion QA ${JSON.stringify({ ...result, captureDirectory, captureIndex, captureInterval })}`);
        } catch (error) {
          console.error(`WhalePet motion QA failed: ${error.message}`);
        } finally {
          if (captureTimer) clearInterval(captureTimer);
          if (process.env.WHALEPET_QA_AUTO_QUIT === "1") {
            setTimeout(() => app.quit(), 250);
          }
        }
      }, 700);
    }
  });
  petWindow.webContents.on("did-fail-load", (_event, code, description) => {
    console.error(`WhalePet renderer failed to load (${code}): ${description}`);
  });
  petWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(`WhalePet renderer stopped: ${details.reason}`);
  });
  petWindow.on("closed", () => { petWindow = null; });
}

// Normal releases remain single-instance. Automated visual QA may open an
// isolated second renderer so the user's currently running pet is not killed.
const qaAllowsSecondInstance = process.env.WHALEPET_QA_ALLOW_SECOND_INSTANCE === "1";
const hasLock = qaAllowsSecondInstance || app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (petWindow) petWindow.showInactive();
  });

  app.whenReady().then(() => {
    app.setName("WhalePet Desktop");
    settingsFile = getSettingsFile();
    const lockedProvider = getProviderLock();
    providerLocked = Boolean(lockedProvider);
    activeProvider = lockedProvider || readProviderSetting();
    preferences=readPreferences(getRuntimeFile('preferences.json'));
    windowStateFile = getWindowStateFile();
    createPetWindow();
    watchStateFile();
    startStateBridge();
    configureCodexFollower();
    setupSettings();
    if(process.env.WHALEPET_QA_SETTINGS==='1'||process.argv.includes('--settings'))settingsController.open();
    globalShortcut.register("CommandOrControl+Alt+W", cyclePetSafeCorner);
    globalShortcut.register("CommandOrControl+Alt+H", togglePetVisibility);
    if (!providerLocked) {
      globalShortcut.register("CommandOrControl+Alt+P", cycleStateProvider);
    }

    ipcMain.on("pet:drag-start", (_event, details) => {
      if (!petWindow || petWindow.isDestroyed()) return;
      stopDragTracking();
      repairPetWindowBounds("drag-start");
      petWindow.setAlwaysOnTop(true, "screen-saver");
      petWindow.moveTop();
      dragCursor = screen.getCursorScreenPoint();
      // The tail can jump to the pointer during the inverted pose, but release
      // must use the original click-to-release displacement, not the tail offset.
      if(Number.isFinite(details?.pressScreenX)&&Number.isFinite(details?.pressScreenY)){
        dragSession={origin:petWindow.getBounds(),press:{x:Math.round(details.pressScreenX),y:Math.round(details.pressScreenY)}};
      }
      // Pin the short tail to the real cursor (renderer CSS px -> window DIP).
      // Do this once; retain the proven delta tracker and edge clamping after it.
      const anchor = details?.tailAnchor;
      if (Number.isFinite(anchor?.x) && Number.isFinite(anchor?.y) &&
          anchor.x >= 0 && anchor.x <= 300 && anchor.y >= 0 && anchor.y <= 342) {
        const content = petWindow.getContentBounds();
        const outer = petWindow.getBounds();
        const zoom = petWindow.webContents.getZoomFactor();
        const position = clampWindowToWorkArea({
          x: dragCursor.x - (anchor.x+130) * zoom - (content.x - outer.x),
          y: dragCursor.y - (anchor.y+170) * zoom - (content.y - outer.y)
        }, dragWorkArea(screen.getDisplayNearestPoint(dragCursor).workArea), expectedOuterSize);
        petWindow.setBounds({ ...position, ...expectedOuterSize }, false);
      }
      dragTimer = setInterval(updateDraggedWindow, DRAG_TRACK_INTERVAL_MS);
      petWindow.webContents.send('pet:drag-motion',{
        x:petWindow.getBounds().x/petWindow.webContents.getZoomFactor(),start:true
      });
      if (process.env.WHALEPET_DEBUG_STATE === "1") {
        console.log(`WhalePet drag started ${JSON.stringify({ details, cursor: dragCursor, bounds: petWindow.getBounds() })}`);
      }
    });
    ipcMain.on("pet:drag-move", () => {
      updateDraggedWindow();
    });
    ipcMain.on("pet:drag-end", (_event, details) => {
      updateDraggedWindow(details?.cursor);
      stopDragTracking();
      repairPetWindowBounds("drag-end");
      saveWindowPosition();
      if (process.env.WHALEPET_DEBUG_STATE === "1") {
        console.log(`WhalePet drag ended ${JSON.stringify({ details, bounds: petWindow.getBounds() })}`);
      }
    });
    ipcMain.on("pet:set-interactive", (_event, interactive) => {
      if (!petWindow || petWindow.isDestroyed()) return;
      if (process.env.WHALEPET_QA_FORCE_INTERACTIVE === "1") {
        mouseInteractive = true;
        petWindow.setIgnoreMouseEvents(false);
        return;
      }
      const next = interactive === true;
      if (next === mouseInteractive) return;
      if (!next && dragCursor) return;
      mouseInteractive = next;
      petWindow.setIgnoreMouseEvents(!next, { forward: true });
      stabilizeAfterMouseModeChange();
    });
    ipcMain.on("pet:debug-state", (_event, value) => {
      if (VALID_STATES.has(value?.state)) renderedState = value.state;
      if (process.env.WHALEPET_DEBUG_STATE === "1") {
        console.log(`WhalePet renderer state ${JSON.stringify(value)}`);
      }
    });
    ipcMain.handle("pet:request-state", () => ({
      ...currentState,
      provider: activeProvider,
      providerLocked
    }));
    ipcMain.handle('pet:request-preferences', event=>{
      if(event.sender!==petWindow.webContents)throw new Error('Invalid sender');
      return rendererPreferences();
    });
    ipcMain.on("pet:context-menu", showPetMenu);
    boundsGuardTimer = setInterval(
      () => repairPetWindowBounds("periodic-guard"),
      BOUNDS_GUARD_INTERVAL_MS
    );
  });
}

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  codexFollower?.stop();
  stopDragTracking();
  if (boundsGuardTimer) clearInterval(boundsGuardTimer);
  boundsGuardTimer = null;
  if (mouseModeStabilizeTimer) clearTimeout(mouseModeStabilizeTimer);
  mouseModeStabilizeTimer = null;
  if (stateFile) fs.unwatchFile(stateFile, stateWatchListener);
  if (stateBridgeSocket) stateBridgeSocket.close();
  stateBridgeSocket = null;
  globalShortcut.unregisterAll();
});
