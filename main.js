const { app, BrowserWindow, globalShortcut, ipcMain, Menu, Tray, screen, shell, dialog, powerMonitor } = require("electron");
const fs = require("fs");
const path = require("path");
const dgram = require("dgram");
const { CodexStateFollower, priority } = require("./codex-state-follower");
const { POSES, readPreferences, writePreferences, normalizePreferences } = require('./preferences');
const { createSettingsController } = require('./settings-window');
const { createIdleSongController } = require('./idle-song');
const { createUserActivity, normalizeGames } = require('./user-activity');
const { createBuddyPolicy } = require('./buddy-policy');
const { createRecoveryController } = require('./recovery-window');
const { createEdgeTravelController } = require('./edge-travel-window');
const AHOGE_PULL = require('./ahoge-pull-assets');
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
let hideStage='normal',hiddenHome=null,edgeGeneration=0,edgeTransitionPromise=null;
let peekPull=null,peekPullTimer=null;
let dragCursor = null;
let dragTimer = null;
let dragRoom = null;
let dragSession = null;
let boundsGuardTimer = null;
let cursorProbeTimer = null, cursorProbeInside = false;
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
let recoveryController = null;
let edgeTravelController = null;
let reloadStatusPromise=null,reloadSequence=0,reloadReceipt=null;
let reloadDisplay=null;
let idleSongController = null;
let musicMuteShortcut = false;
let providerShortcut = false;
let petTray = null;
let trayRefreshTimer = null;
let lastTrayValue = '';
const companionShortcuts = {visibility:false,corner:false};
const buddyPolicy = createBuddyPolicy();
let userActivity = null, buddyTimer = null, lastBuddyValue = '', renderedBuddyMode = 'none';
let buddyLocked = false, buddySuspended = false;
const buddyPowerHandlers = {};
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
  const logical=hiddenHome||{x:before.x+(dragRoom?.left||0),y:before.y+(dragRoom?.top||0)};
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
  if(previousScale!==preferences.scale&&peekPull)cancelEdgeMotion();
  if(previousScale!==preferences.scale) applyPetSize();
  if(previousScale!==preferences.scale&&['hiding','emerging'].includes(hideStage)){
    const emerging=hideStage==='emerging';cancelEdgeMotion();
    if(emerging)finishShowingPet();else settleHiddenPet();
  }
  recoveryController?.refresh();
  petWindow?.webContents.send('pet:preferences',rendererPreferences());
  if(Object.keys(patch).some(key=>key.startsWith('idleSong')))idleSongController?.changed();
  if(Object.keys(patch).some(key=>['typingCompanion','gameCompanion','games'].includes(key)))configureBuddyMonitoring();
  updatePetTray();
}

function buddyRequest() {
  const value=buddyPolicy.snapshot({hidden:petHidden||buddyLocked||buddySuspended});
  // Neither key codes nor activity counts cross into the renderer/diagnostics.
  return {mode:value.mode,tempo:Math.round(value.tempo*100)/100};
}

function publishBuddy(force=false) {
  const value=buddyRequest(), signature=JSON.stringify(value);
  if(!force&&signature===lastBuddyValue)return;
  const previousMode=lastBuddyValue?JSON.parse(lastBuddyValue).mode:'none';
  lastBuddyValue=signature;
  if(value.mode!=='none'&&previousMode==='none')idleSongController?.activity();
  if(petWindow&&!petWindow.isDestroyed())petWindow.webContents.send('pet:buddy',value);
}

function configureBuddyMonitoring() {
  buddyPolicy.configure(preferences);
  if(userActivity) {
    const enabled=preferences.typingCompanion||preferences.gameCompanion&&preferences.games.length>0;
    if(petHidden||buddyLocked||buddySuspended||!enabled) {
      userActivity.stop();buddyPolicy.clearActivity();
    } else userActivity.start({typing:preferences.typingCompanion,games:preferences.gameCompanion?preferences.games:[]});
  }
  publishBuddy(true);
}

function setupBuddy() {
  userActivity=createUserActivity({
    onActivity:value=>{buddyPolicy.activity(value);publishBuddy();},
    onStatus:value=>{
      if(!['starting','running'].includes(value.state))buddyPolicy.clearActivity();
      publishBuddy();updatePetTray();
    }
  });
  for(const [event,change] of Object.entries({
    'lock-screen':()=>{buddyLocked=true;},'unlock-screen':()=>{buddyLocked=false;},
    suspend:()=>{buddySuspended=true;},resume:()=>{buddySuspended=false;}
  })) {
    buddyPowerHandlers[event]=()=>{change();if((buddyLocked||buddySuspended)&&peekPull)cancelEdgeMotion();configureBuddyMonitoring();};
    powerMonitor.on(event,buddyPowerHandlers[event]);
  }
  configureBuddyMonitoring();
  buddyTimer=setInterval(publishBuddy,100);
}

function companionSnapshot() {
  return {hidden:petHidden,hideStage,pullActive:Boolean(peekPull),trayAvailable:Boolean(petTray),
    ...(recoveryController?.snapshot()||{recoveryAvailable:false,recoveryVisible:false}),
    shortcuts:{...companionShortcuts},
    buddy:{mode:renderedBuddyMode,requestedMode:buddyRequest().mode,manualGame:buddyPolicy.snapshot().manualGame,
      monitor:userActivity?.getStatus()||{state:'stopped',reason:null,available:false}}};
}

function settingsSnapshot() {
  const rendered=rendererPreferences();
  const provider=activeProvider;
  const packet={type:'whalepet-state',provider,state:'thinking',message:'正在认真思考',nonce:'your-unique-id'};
  return {
    preferences:{...preferences,images:{...preferences.images}},
    idleSong:idleSongController?.snapshot()||{available:false,playing:false,error:''},
    musicMuteShortcut,
    companion:companionSnapshot(),
    poses:POSES.map(([state,label,filename])=>({state,label,custom:Boolean(rendered.images[filename]),url:rendered.images[filename]||`assets/whalepet-hd/${filename.replace(/\.webp$/,'.png')}`})),
    provider,providerLocked,autoFollowCodex:autoFollow,follower:followStatus,
    state:currentState.state,renderedState,reloadDisplay,
    activeConversation:codexConversations().find(item=>item.primary)||null,
    lastReceivedAt:lastBridgeEvents[provider]||null,
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
    reloadCodex:reloadCodexStatus,
    gameMode:enabled=>{buddyPolicy.setManualGame(enabled);publishBuddy(true);return settingsSnapshot();},
    previewBuddy:()=>{buddyPolicy.previewTyping();publishBuddy(true);return settingsSnapshot();},
    addGame:name=>{
      const names=normalizeGames([name]);
      if(!names.length)throw new Error('这个游戏文件名暂不支持，请选择游戏本体的 .exe。');
      if(preferences.games.length>=32&&!preferences.games.includes(names[0]))throw new Error('最多可添加 32 个游戏。');
      saveAppearance({games:[...preferences.games,...names]});return settingsSnapshot();
    },
    removeGame:name=>{
      const names=normalizeGames([name]);
      saveAppearance({games:preferences.games.filter(game=>!names.includes(game))});return settingsSnapshot();
    },
    companion:async action=>{
      if(action==='show')await showPet();
      else if(action==='hide')await hidePet();
      else if(action==='corner')await cyclePetSafeCorner();
      else throw new Error('未知的陪伴操作');
      return settingsSnapshot();
    },
    audioDirectory:getRuntimeFile('custom-audio'),
    setSong:(file,name)=>saveAppearance({idleSongFile:file,idleSongName:name}),
    previewSong:()=>idleSongController.preview(),
    stopSong:()=>idleSongController.stop(),
    disableSong:disableIdleSong,
    openSongSource:()=>shell.openExternal('https://www.bilibili.com/video/BV1pue56AEyL/'),
    save(patch) {
      const appearance={};
      for(const key of ['scale','bubbleScale','bubbleOffset','showBadge','showSpeech','idleLife','typingCompanion','gameCompanion','customLabel','idleSongEnabled','idleSongMode','idleSongVolume']) if(Object.hasOwn(patch,key)) appearance[key]=patch[key];
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
    reset:()=>saveAppearance({scale:1,bubbleScale:1,bubbleOffset:0,showBadge:true,showSpeech:true,idleLife:true,images:{}})
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

function codexConversations() {
  return activeProvider==='chatgpt' && autoFollow && codexFollower ? codexFollower.reducer.conversations() : [];
}

function peekConversations() {
  const conversations=codexConversations();
  if(conversations.length)return conversations;
  const state=effectiveState(currentState).state;
  if(['idle','ready'].includes(state))return [];
  // Other AI bridges have no task list. Show only a provider/status summary,
  // never the bridge's arbitrary message or an inactive historical bubble.
  return [{title:activeProvider==='custom'?preferences.customLabel:PROVIDERS[activeProvider].label,state,primary:true,uncertain:false}];
}

function codexConversationOverflow() {
  return activeProvider==='chatgpt' && autoFollow && codexFollower ? codexFollower.reducer.overflow() : {count:0,uncertain:0};
}

function effectiveState(fallback) {
  const selected=activeProvider==='chatgpt'&&autoFollow&&codexFollower?.reducer.current();
  // A generic bridge/file update must not erase another thread's question,
  // failure, or active work. Idle follow state still allows external bridges.
  return selected && (selected.completion || priority(selected.state)>=50 || priority(selected.state)>priority(fallback.state))
    ? normalizeState(selected) : fallback;
}

function sendCurrentState(extra = {}) {
  currentState=effectiveState(currentState);
  idleSongController?.stateChanged();
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send("pet:state", {
      ...currentState,
      provider: activeProvider,
      conversations: codexConversations(),
      conversationOverflow: codexConversationOverflow(),
      conversationTracking: activeProvider==='chatgpt' && autoFollow && Boolean(codexFollower),
      ...extra
    });
  }
  recoveryController?.refresh();
  updatePetTray();
}

function readStateFile(force = false, providerChanged = false) {
  try {
    const next = normalizeState(JSON.parse(fs.readFileSync(stateFile, "utf8")));
    const unchanged = next.state === currentState.state && next.message === currentState.message;
    currentState = effectiveState(next);
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
          renderedState, autoFollowCodex: autoFollow, follower: followStatus,
          music:{enabled:preferences.idleSongEnabled,mode:preferences.idleSongMode,muteShortcut:musicMuteShortcut,...idleSongController?.snapshot()},
          companion:companionSnapshot()
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
    sendCurrentState();
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

function reloadCodexStatus() {
  if(reloadStatusPromise)return reloadStatusPromise;
  const follower=codexFollower;
  if(providerLocked||activeProvider!=='chatgpt'||!autoFollow||!follower)return Promise.reject(new Error('请先选择 ChatGPT / Codex 并开启自动跟随。'));
  const id=++reloadSequence;
  const feedback=(phase,extra={})=>{
    if(petWindow&&!petWindow.isDestroyed())petWindow.webContents.send('pet:reload-action',{id,phase,state:currentState.state,...extra});
  };
  reloadStatusPromise=(async()=>{
    if(!petWindow||petWindow.isDestroyed())throw new Error('小鲸窗口不可用，请重新打开小鲸。');
    // An explicit reload from the control room brings her back first; hidden
    // curls never receive an on-screen progress/result badge.
    if(petHidden)await showPet();
    idleSongController?.activity();
    feedback('reading');
    await follower.reload();
    if(follower!==codexFollower||activeProvider!=='chatgpt')throw new Error('状态来源已改变，请在当前来源下重试。');
    if(!petWindow||petWindow.isDestroyed())throw new Error('小鲸窗口不可用，请重新打开小鲸。');
    if(petHidden)await showPet();
    idleSongController?.activity();
    const receipt=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        if(reloadReceipt?.id===id)reloadReceipt=null;
        reject(new Error('日志已重新读取，但姿势尚未确认同步；请再试一次或重新打开小鲸。'));
      },2500);
      reloadReceipt={id,resolve,reject,timer};
    });
    sendCurrentState({statusReloaded:true,reloadId:id});
    const result=await receipt;
    feedback(result.deferred?'deferred':'synced',{state:result.state});
    return settingsSnapshot();
  })().catch(error=>{feedback('failed');throw error;}).finally(()=>{reloadStatusPromise=null;});
  return reloadStatusPromise;
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

function disableIdleSong() {
  idleSongController?.stop();
  saveAppearance({idleSongEnabled:false});
}

function toggleIdleSong() {
  if(preferences.idleSongEnabled){disableIdleSong();return;}
  // The normal settings path persists the choice and restarts the idle timer;
  // enabling this option must never start a song immediately.
  saveAppearance({idleSongEnabled:true});
}

function buildPetMenu() {
  // A small, flat quick menu. Detailed controls live in the control room;
  // never make the user chase hover targets or expose developer/debug lists.
  const canReload=!petHidden&&!providerLocked&&activeProvider==='chatgpt'&&autoFollow&&Boolean(codexFollower);
  return Menu.buildFromTemplate([
    {id:'settings',label:'小鲸的控制室…',click:()=>settingsController.open('appearance')},
    {id:'size',label:`调整大小 · ${Math.round(preferences.scale*100)}%…`,click:()=>settingsController.open('appearance')},
    {id:'visibility',label:petHidden?'显示小鲸':'暂时隐藏小鲸',click:togglePetVisibility},
    {id:'recover',label:'找回小鲸',click:cyclePetSafeCorner},
    {id:'quiet',label:preferences.idleSongEnabled?'关闭自动唱歌':'开启自动唱歌',click:toggleIdleSong},
    ...(canReload?[{id:'reload-codex',label:'重新读取 Codex 状态',click:async()=>{
      try{await reloadCodexStatus();}catch(error){dialog.showMessageBox(petWindow,{type:'warning',title:'状态重载未完成',message:error.message});}
    }}]:[]),
    { type: "separator" },
    {id:'quit',label:'退出小鲸',click:()=>app.quit()}
  ]);
}

function showPetMenu(owner=petWindow) {
  buildPetMenu().popup({ window: owner });
}

function updatePetTray() {
  if(!petTray)return;
  const value=JSON.stringify([currentState.state,activeProvider,preferences,companionSnapshot(),codexConversations(),codexConversationOverflow(),idleSongController?.snapshot().playing]);
  if(value===lastTrayValue)return;
  lastTrayValue=value;
  const state=renderedBuddyMode==='typing'?'陪你敲键盘':renderedBuddyMode==='gaming'?'陪你玩游戏':POSES.find(p=>p[0]===currentState.state)?.[1]||'陪着你';
  petTray.setToolTip(`小鲸鱼桌宠 · ${petHidden?(hideStage==='peeking'?'探头看你':'躲猫猫'):state}`);
  petTray.setContextMenu(buildPetMenu());
}

function createPetTray() {
  // Isolated hidden QA must never add a real icon beside the user's pet.
  if(process.env.WHALEPET_QA_HIDDEN==='1')return;
  try {
    petTray=new Tray(path.join(__dirname,'assets','whalepet-v015','WhalePet.ico'));
    petTray.on('double-click',showPet);
    updatePetTray();
    trayRefreshTimer=setInterval(updatePetTray,1000);
  }catch(error){petTray?.destroy();petTray=null;console.warn('WhalePet tray unavailable: '+error.message);}
}

function cancelPetInteraction() {
  stopDragTracking();
  petWindow?.webContents.send('pet:interaction-reset');
}

function probePetCursor() {
  if(!petWindow||petWindow.isDestroyed()||petHidden||!petWindow.isVisible()||dragCursor)return;
  // A recovery path for Windows losing forwarded mousemove while the alpha
  // window ignores empty margins. Never record positions or inspect other apps.
  // Poll unchanged points too: the pose can change beneath a stationary cursor.
  const cursor=screen.getCursorScreenPoint(),bounds=petWindow.getContentBounds();
  const inside=cursor.x>=bounds.x&&cursor.y>=bounds.y&&cursor.x<bounds.x+bounds.width&&cursor.y<bounds.y+bounds.height;
  if(inside){
    const zoom=petWindow.webContents.getZoomFactor();
    petWindow.webContents.send('pet:cursor-probe',{x:(cursor.x-bounds.x)/zoom,y:(cursor.y-bounds.y)/zoom});
  }else if(cursorProbeInside){petWindow.webContents.send('pet:cursor-probe',null);}
  cursorProbeInside=inside;
}

function cancelEdgeMotion(){
  abandonPeekPull();
  edgeGeneration++;
  edgeTravelController?.cancel();
  if(mouseModeStabilizeTimer)clearTimeout(mouseModeStabilizeTimer);
  mouseModeStabilizeTimer=null;
  return edgeGeneration;
}

function abandonPeekPull(){
  const session=peekPull;if(!session)return;
  peekPull=null;clearInterval(peekPullTimer);peekPullTimer=null;clearTimeout(session.startTimer);
  session.cancelled=true;
  recoveryController?.setPulling(false,session.requestId);recoveryController?.notifyPull('cancelled',session.requestId);
  if(hideStage==='pulling'){hideStage='peeking';recoveryController?.peek();}
}

function updatePeekPull(){
  const session=peekPull;if(!session||session.ending)return;
  const cursor=session.releaseCursor||screen.getCursorScreenPoint();
  // Only release is clamped. The moving support remains at the real cursor,
  // including during a rapid flick; clamping it would flatten the inertia.
  session.point={
    x:cursor.x-session.grab.x*session.scale,
    y:cursor.y-session.grab.y*session.scale
  };
  if(session.started)edgeTravelController?.updatePull(session.point);
}

async function beginPeekPull(details){
  if(peekPull)return details?.requestId===peekPull.requestId;
  if(!petWindow||petWindow.isDestroyed()||!petHidden||hideStage!=='peeking')return false;
  const origin=recoveryController?.pullOrigin();
  if(!origin||!Number.isInteger(details?.requestId)||details.requestId<1||!Number.isFinite(details?.grabX)||!Number.isFinite(details?.grabY)||
     !Number.isFinite(details?.pressScreenX)||!Number.isFinite(details?.pressScreenY)||
     details.grabX<0||details.grabX>=275||details.grabY<0||details.grabY>161.34765625)return false;
  const z=origin.scale,pressedFrom={x:details.pressScreenX-details.grabX*z,y:details.pressScreenY-details.grabY*z};
  // The grab must originate on this peeking artwork, not another application.
  // Allow the existing 380ms head-rise transition, plus native DPI rounding.
  if(Math.abs(pressedFrom.x-origin.x)>4||pressedFrom.y<origin.y-4||pressedFrom.y>origin.bottom-66.6015625*z+4)return false;
  // The renderer authenticates the visible head or original loop/hole; this
  // guard bounds the same clipped artwork and verifies its native origin.
  // Once lifted, the straight hair tip remains the support for the upright pet,
  // including when a face drag was used as the more forgiving gesture.
  const grab={...AHOGE_PULL.pivot},from={x:details.pressScreenX-grab.x*z,y:details.pressScreenY-grab.y*z};
  const area=recoveryController.geometry().area;
  const token=cancelEdgeMotion();cancelPetInteraction();idleSongController?.activity();
  const session={token,requestId:details.requestId,scale:z,area:{...area},from,point:{...from},grab,started:false,ending:false,released:false,cancelled:false,reducedMotion:false};
  peekPull=session;
  session.startTimer=setTimeout(()=>{if(peekPull===session)cancelEdgeMotion();},8000);
  updatePeekPull();
  try{
    const visual=await petWindow.webContents.executeJavaScript('whalePetController.prepareEdge()');
    if(peekPull!==session||token!==edgeGeneration)return false;
    session.reducedMotion=visual.reducedMotion===true;
    updatePeekPull();
    const ok=await edgeTravelController.beginPull({scale:z,area:session.area,from:session.point,pivot:session.grab,bottom:area.y+area.height,reducedMotion:session.reducedMotion},()=>{
      if(peekPull!==session||token!==edgeGeneration)throw new Error('Pull cancelled');
      session.started=true;hideStage='pulling';
      recoveryController.setPulling(true,session.requestId);recoveryController.notifyPull('started',session.requestId);
      petWindow.webContents.send('pet:edge-action',{phase:'tucked'});
      updatePeekPull();updatePetTray();
    });
    if(peekPull!==session||token!==edgeGeneration)return false;
    if(!ok)throw new Error('Pull artwork unavailable');
    clearTimeout(session.startTimer);
    if(session.released)endPeekPull({cancelled:session.cancelled,requestId:session.requestId});
    else peekPullTimer=setInterval(updatePeekPull,DRAG_TRACK_INTERVAL_MS);
    return true;
  }catch(error){
    if(peekPull===session)cancelEdgeMotion();
    console.warn('WhalePet ahoge pull recovered: '+error.message);return false;
  }
}

async function endPeekPull(details={}){
  const session=peekPull;if(!session||session.ending)return;
  if(details.requestId!==session.requestId)return;
  if(details?.cancelled===true){cancelEdgeMotion();if(details.recoveryGone)showPet();return;}
  if(!session.released)session.releaseCursor=screen.getCursorScreenPoint();
  session.released=true;
  if(!session.started)return; // Release during readiness is handled once ready.
  updatePeekPull();session.ending=true;clearInterval(peekPullTimer);peekPullTimer=null;
  const z=session.scale,outer=petWindow.getBounds(),content=petWindow.getContentBounds();
  const releaseArea=screen.getDisplayNearestPoint(session.releaseCursor).workArea;
  const target=clampWindowToWorkArea({x:session.point.x-142.5*z-(content.x-outer.x),y:session.point.y-225*z-(content.y-outer.y)},dragWorkArea(releaseArea),expectedOuterSize);
  const to=edgeActorPoint(target);
  try{
    const ok=await edgeTravelController.finishPull({to,duration:160,reducedMotion:session.reducedMotion});
    if(peekPull!==session||session.token!==edgeGeneration)return;
    if(!ok)throw new Error('Pull settlement unavailable');
    peekPull=null;clearTimeout(session.startTimer);
    recoveryController.notifyPull('ended',session.requestId);
    petWindow.setBounds({...target,...expectedOuterSize},false);
    finishShowingPet();
  }catch(error){if(peekPull===session)cancelEdgeMotion();console.warn('WhalePet ahoge release recovered: '+error.message);}
}

function edgeActorPoint(bounds=petWindow.getBounds()){
  const outer=petWindow.getBounds(),content=petWindow.getContentBounds(),z=preferences.scale;
  return {x:bounds.x+(content.x-outer.x)+142.5*z,y:bounds.y+(content.y-outer.y)+225*z,opacity:1};
}

function edgeBorderPoint(layout){
  const z=preferences.scale;
  return {x:layout.centerX-137.5*z,y:layout.area.y+layout.area.height-268*z};
}

function settleEdgeAfterScreenChange(){
  if(peekPull){cancelEdgeMotion();recoveryController?.refresh();return;}
  if(!petWindow||petWindow.isDestroyed()||!['hiding','emerging'].includes(hideStage))return;
  const emerging=hideStage==='emerging';cancelEdgeMotion();
  if(emerging){const home=normalHomeBounds();petWindow.setBounds({...home,...expectedOuterSize},false);finishShowingPet();}
  else settleHiddenPet();
}

function normalHomeBounds(){
  const bounds=petWindow.getBounds(),point=hiddenHome||{x:bounds.x+(dragRoom?.left||0),y:bounds.y+(dragRoom?.top||0)};
  const area=dragWorkArea(screen.getDisplayNearestPoint(point).workArea);
  return clampWindowToWorkArea({x:point.x-(dragRoom?.left||0),y:point.y-(dragRoom?.top||0)},area,expectedOuterSize||PET_WINDOW_SIZE);
}

function settleHiddenPet(){
  if(!petWindow||petWindow.isDestroyed())return;
  hideStage='hidden';petHidden=true;
  petWindow.webContents.send('pet:edge-action',{phase:'tucked'});
  petWindow.hide();recoveryController?.show();updatePetTray();
}

function finishShowingPet(){
  if(!petWindow||petWindow.isDestroyed())return;
  hideStage='normal';petHidden=false;hiddenHome=null;
  recoveryController?.hide();
  petWindow.webContents.send('pet:edge-action',{phase:'normal'});
  configureBuddyMonitoring();idleSongController?.activity();
  petWindow.showInactive();
  petWindow.moveTop();saveWindowPosition();updatePetTray();
  // Keep the final journey bitmap underneath until the normal renderer has
  // painted. A cancelled/next journey must never be hidden by this old handoff.
  const handoff=edgeGeneration;
  let handoffTimer;
  const painted=petWindow.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))').catch(()=>{});
  Promise.race([painted,new Promise(resolve=>{handoffTimer=setTimeout(resolve,250);})])
    .then(()=>{clearTimeout(handoffTimer);if(handoff===edgeGeneration&&hideStage==='normal')edgeTravelController?.cancel();});
}

function hidePet() {
  if(!petWindow||petWindow.isDestroyed())return Promise.resolve();
  if(peekPull)cancelEdgeMotion();
  if(hideStage==='hiding')return edgeTransitionPromise;
  if(['hidden','peeking'].includes(hideStage)){recoveryController?.retract();return Promise.resolve();}
  const interrupted=hideStage==='emerging'?edgeTravelController?.freeze().catch(()=>null):null;
  const token=cancelEdgeMotion();cancelPetInteraction();
  if(!hiddenHome){saveWindowPosition();const b=petWindow.getBounds();hiddenHome={x:b.x+(dragRoom?.left||0),y:b.y+(dragRoom?.top||0)};}
  hideStage='hiding';petHidden=true;
  petWindow.webContents.send('pet:edge-action',{phase:'prepare'});
  configureBuddyMonitoring();idleSongController?.activity();
  recoveryController?.hide();recoveryController?.setAnchor({x:hiddenHome.x+150*preferences.scale,y:hiddenHome.y+170*preferences.scale});
  updatePetTray();
  edgeTransitionPromise=(async()=>{
    try{
      await recoveryController.ready();
      const visual=await petWindow.webContents.executeJavaScript('whalePetController.prepareEdge()');
      if(token!==edgeGeneration)return;
      if(!visual.ready)throw new Error('角色图片未能加载');
      const captured=await interrupted;
      if(token!==edgeGeneration||!petWindow||petWindow.isDestroyed())return;
      const layout=recoveryController.geometry(),from=captured||edgeActorPoint(),to=edgeBorderPoint(layout);
      const distance=Math.hypot(to.x-from.x,to.y-from.y);
      const runMs=visual.reducedMotion?0:Math.round(Math.max(360,Math.min(850,distance/1.2))),dipMs=visual.reducedMotion?0:260;
      petWindow.webContents.send('pet:edge-action',{phase:'hiding',composited:true});
      mouseInteractive=false;petWindow.setIgnoreMouseEvents(true,{forward:true});
      // One stationary surface and one compositor clock: no per-frame native
      // window movement, integer rounding, independent hop clock or resizing.
      const completed=await edgeTravelController.play({mode:'hiding',scale:preferences.scale,bottom:layout.area.y+layout.area.height,
        from,to,runMs,dipMs,reducedMotion:visual.reducedMotion},()=>petWindow.hide());
      if(!completed){if(token===edgeGeneration)throw new Error('小跑画面未能完成，已保留小鲸');return;}
      if(token===edgeGeneration)settleHiddenPet();
    }catch(error){
      if(token!==edgeGeneration||!petWindow||petWindow.isDestroyed())return;
      const home=normalHomeBounds();petWindow.setBounds({...home,...expectedOuterSize},false);finishShowingPet();
      dialog.showMessageBox(petWindow,{type:'warning',title:'暂时不能躲起来',message:'躲猫猫画面未能准备好，已保留小鲸：'+error.message});
    }
  })();
  return edgeTransitionPromise;
}

function showPet() {
  if(!petWindow||petWindow.isDestroyed())return Promise.resolve();
  if(peekPull)cancelEdgeMotion();
  if(hideStage==='emerging')return edgeTransitionPromise;
  const fromBorder=['hidden','peeking'].includes(hideStage),wasHidden=petHidden;
  const interrupted=hideStage==='hiding'?edgeTravelController?.freeze().catch(()=>null):null;
  const token=cancelEdgeMotion();cancelPetInteraction();repairPetWindowBounds('show');
  const target=normalHomeBounds();
  if(!wasHidden){petWindow.setBounds({...target,...expectedOuterSize},false);finishShowingPet();return Promise.resolve();}
  if(fromBorder){
    // Resizing or removing a monitor while tucked can relocate the invisible
    // main window. Start the jump at the current visible curl, not at home.
    const layout=recoveryController.geometry(),outer=petWindow.getBounds(),content=petWindow.getContentBounds(),z=preferences.scale;
    petWindow.setBounds({x:Math.round(layout.centerX-280*z-(content.x-outer.x)),y:Math.round(layout.area.y+layout.area.height-493*z-(content.y-outer.y)),...expectedOuterSize},false);
  }
  hideStage='emerging';petHidden=true;recoveryController?.hide();updatePetTray();
  edgeTransitionPromise=(async()=>{
    try{
      const visual=await petWindow.webContents.executeJavaScript('whalePetController.prepareEdge()').catch(()=>({reducedMotion:true,ready:false}));
      const captured=await interrupted;
      if(token!==edgeGeneration||!petWindow||petWindow.isDestroyed())return;
      const layout=recoveryController.geometry(),from=captured||edgeActorPoint();
      if(fromBorder&&!captured){from.y+=205*preferences.scale;from.opacity=0;}
      const duration=visual.reducedMotion?0:520;
      petWindow.webContents.send('pet:edge-action',{phase:'emerging',composited:true});
      const completed=await edgeTravelController.play({mode:'emerging',scale:preferences.scale,bottom:layout.area.y+layout.area.height,
        from,to:edgeActorPoint(target),duration,reducedMotion:visual.reducedMotion},()=>petWindow.hide());
      if(!completed){if(token===edgeGeneration)throw new Error('跳回画面未能完成');return;}
      if(token===edgeGeneration){petWindow.setBounds({...target,...expectedOuterSize},false);finishShowingPet();}
    }catch(error){
      if(token!==edgeGeneration||!petWindow||petWindow.isDestroyed())return;
      petWindow.setBounds({...target,...expectedOuterSize},false);finishShowingPet();
      console.warn('WhalePet jump animation recovered: '+error.message);
    }
  })();
  return edgeTransitionPromise;
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
  showPet();
}

function cyclePetSafeCorner() {
  if(petHidden)return showPet();
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
  showPet();
}

function togglePetVisibility() {
  if (!petWindow || petWindow.isDestroyed()) return;
  if(petHidden||!petWindow.isVisible())showPet();else hidePet();
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
  const x=Math.round(hiddenHome?.x??left+(dragRoom?.left||0)),y=Math.round(hiddenHome?.y??top+(dragRoom?.top||0));
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
      backgroundThrottling: false,
      autoplayPolicy:'no-user-gesture-required'
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
    if(!petHidden&&process.env.WHALEPET_QA_HIDDEN!=="1") petWindow.showInactive();
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
  petWindow.on("closed", () => { petWindow = null;recoveryController?.dispose();recoveryController=null;edgeTravelController?.dispose();edgeTravelController=null; });
}

// Normal releases remain single-instance. Automated visual QA may open an
// isolated second renderer so the user's currently running pet is not killed.
const qaAllowsSecondInstance = process.env.WHALEPET_QA_ALLOW_SECOND_INSTANCE === "1";
const hasLock = qaAllowsSecondInstance || app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", (_event,argv) => {
    showPet();
    if(argv?.includes('--settings'))settingsController?.open('companion');
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
    idleSongController=createIdleSongController({getWindow:()=>petWindow,getPreferences:()=>preferences,getDirectory:()=>getRuntimeFile('custom-audio'),isBlocked:()=>petHidden||Boolean(dragCursor)||buddyRequest().mode!=='none'||!petWindow||petWindow.isDestroyed(),isAiIdle:()=>activeProvider==='chatgpt'&&['idle','ready'].includes(currentState.state)&&renderedState==='idle'&&!(autoFollow&&codexFollower?.reducer.hasUnresolved())});
    petWindow.webContents.on('did-start-loading',()=>idleSongController.activity());
    petWindow.webContents.on('render-process-gone',()=>idleSongController.activity());
    watchStateFile();
    startStateBridge();
    configureCodexFollower();
    setupSettings();
    recoveryController=createRecoveryController({getPet:()=>petWindow,isHidden:()=>petHidden,restore:showPet,menu:showPetMenu,
      beginPull:beginPeekPull,movePull:value=>{if(value?.requestId===peekPull?.requestId)updatePeekPull();},endPull:endPeekPull,
      onUnavailable:()=>{if(peekPull){cancelEdgeMotion();showPet();}},
      getView:()=>({scale:preferences.scale,showSpeech:preferences.showSpeech,conversations:peekConversations(),conversationOverflow:codexConversationOverflow()}),
      onChange:()=>{if(['hidden','peeking'].includes(hideStage))hideStage=recoveryController?.snapshot().recoveryStage||'hidden';updatePetTray();}});
    edgeTravelController=createEdgeTravelController({onGeometryChanged:settleEdgeAfterScreenChange,onPullInterrupted:()=>{if(peekPull)cancelEdgeMotion();}});
    // Warm the intact picture invisibly so the first escape need not decode it.
    edgeTravelController.ready().catch(error=>console.warn('WhalePet travel preparation: '+error.message));
    setupBuddy();
    if(process.env.WHALEPET_QA_SETTINGS==='1'||process.argv.includes('--settings'))settingsController.open();
    companionShortcuts.corner=globalShortcut.register("CommandOrControl+Alt+W", cyclePetSafeCorner);
    companionShortcuts.visibility=globalShortcut.register("CommandOrControl+Alt+H", togglePetVisibility);
    musicMuteShortcut=globalShortcut.register('CommandOrControl+Alt+M',disableIdleSong);
    if (!providerLocked) {
      providerShortcut=globalShortcut.register("CommandOrControl+Alt+P", cycleStateProvider);
    }
    createPetTray();

    ipcMain.on("pet:drag-start", (_event, details) => {
      if (!petWindow || petWindow.isDestroyed() || petHidden) return;
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
      if(petHidden){mouseInteractive=false;petWindow.setIgnoreMouseEvents(true,{forward:true});return;}
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
      conversations: codexConversations(),
      conversationOverflow: codexConversationOverflow(),
      conversationTracking: activeProvider==='chatgpt' && autoFollow && Boolean(codexFollower),
      providerLocked
    }));
    ipcMain.handle('pet:request-preferences', event=>{
      if(event.sender!==petWindow.webContents)throw new Error('Invalid sender');
      return rendererPreferences();
    });
    const isPetSender=event=>event.sender===petWindow?.webContents&&event.senderFrame===petWindow?.webContents.mainFrame;
    ipcMain.on('pet:status-reloaded',(event,value)=>{
      if(!isPetSender(event)||!reloadReceipt||value?.id!==reloadReceipt.id||!VALID_STATES.has(value?.state)||typeof value?.ok!=='boolean')return;
      const receipt=reloadReceipt;reloadReceipt=null;clearTimeout(receipt.timer);
      if(!value.ok){receipt.reject(new Error('日志已重读，但角色图片未能同步加载，请再试一次。'));return;}
      renderedState=value.state;
      reloadDisplay={state:value.state,deferred:value.deferred===true,appliedAt:Date.now()};
      receipt.resolve({...reloadDisplay});
    });
    ipcMain.handle('pet:request-buddy',event=>{
      if(!isPetSender(event))throw new Error('Invalid sender');
      return buddyRequest();
    });
    ipcMain.on('pet:buddy-rendered',(event,mode)=>{
      if(!isPetSender(event)||!['none','typing','gaming'].includes(mode))return;
      if(renderedBuddyMode===mode)return;
      renderedBuddyMode=mode;updatePetTray();
    });
    ipcMain.on("pet:context-menu", event=>{
      if(!petHidden&&event.sender===petWindow?.webContents)showPetMenu();
    });
    boundsGuardTimer = setInterval(
      () => repairPetWindowBounds("periodic-guard"),
      BOUNDS_GUARD_INTERVAL_MS
    );
    // Longer than the renderer's 90ms release delay, so blank margins can
    // actually release between probes instead of continuously resetting it.
    cursorProbeTimer=setInterval(probePetCursor,120);
  });
}

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  cancelEdgeMotion();
  if(reloadReceipt){clearTimeout(reloadReceipt.timer);reloadReceipt.reject(new Error('小鲸正在退出'));reloadReceipt=null;}
  recoveryController?.dispose();recoveryController=null;
  edgeTravelController?.dispose();edgeTravelController=null;
  if(buddyTimer)clearInterval(buddyTimer);
  buddyTimer=null;
  userActivity?.dispose();userActivity=null;
  for(const [event,handler] of Object.entries(buddyPowerHandlers))powerMonitor.removeListener(event,handler);
  if(trayRefreshTimer)clearInterval(trayRefreshTimer);
  trayRefreshTimer=null;
  petTray?.destroy();petTray=null;
  idleSongController?.dispose();
  codexFollower?.stop();
  stopDragTracking();
  if (boundsGuardTimer) clearInterval(boundsGuardTimer);
  boundsGuardTimer = null;
  if(cursorProbeTimer)clearInterval(cursorProbeTimer);
  cursorProbeTimer=null;cursorProbeInside=false;
  if (mouseModeStabilizeTimer) clearTimeout(mouseModeStabilizeTimer);
  mouseModeStabilizeTimer = null;
  if (stateFile) fs.unwatchFile(stateFile, stateWatchListener);
  if (stateBridgeSocket) stateBridgeSocket.close();
  stateBridgeSocket = null;
  globalShortcut.unregisterAll();
});
