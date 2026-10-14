'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {app,BrowserWindow,globalShortcut,ipcMain,Menu,screen}=require('electron');
const root=path.resolve(__dirname,'..'),run=fs.mkdtempSync(path.join(root,'work/hide-recovery-qa-'));
const runtime=path.join(run,'runtime'),sessions=path.join(run,'sessions');
fs.mkdirSync(runtime);fs.mkdirSync(sessions);
Object.assign(process.env,{WHALEPET_RUNTIME_DIR:runtime,WHALEPET_CODEX_SESSIONS:sessions,WHALEPET_QA_ALLOW_SECOND_INSTANCE:'1',WHALEPET_QA_HIDDEN:'1',WHALEPET_QA_SETTINGS:'1',WHALEPET_BRIDGE_PORT:String(51000+process.pid%1000)});
delete process.env.WHALEPET_DISABLE_AUTO_FOLLOW;
app.setPath('userData',path.join(run,'electron'));app.setAppPath(root);
const shortcuts=new Map();
globalShortcut.register=(key,callback)=>{shortcuts.set(key,callback);return false;};
const nativeIgnore=new Map(),recoveryPackets=[],emergenceOrigins=[];
// Real visibility is exercised, but QA windows never show artwork, steal focus,
// create taskbar entries, emit sound, or replace the user's running companion.
app.on('browser-window-created',(_event,window)=>{
  window.setOpacity(0);window.setSkipTaskbar(true);window.setFocusable(false);window.webContents.setAudioMuted(true);
  const calls=[];nativeIgnore.set(window.id,calls);
  const setIgnore=window.setIgnoreMouseEvents.bind(window);
  // Record requested modes for assertions, but never let an invisible QA
  // surface intercept the user's actual pointer.
  window.setIgnoreMouseEvents=(ignore,options)=>{calls.push(ignore);return setIgnore(true,options);};
  window.setIgnoreMouseEvents(true,{forward:true});
  const send=window.webContents.send.bind(window.webContents);
  window.webContents.send=(channel,...args)=>{
    if(channel==='recovery:update')recoveryPackets.push(args[0]);
    if(channel==='pet:edge-action'&&args[0]?.phase==='emerging')emergenceOrigins.push({packet:args[0],content:window.getContentBounds(),zoom:window.webContents.getZoomFactor()});
    return send(channel,...args);
  };
});
const userActivity=require('../user-activity'),monitor={starts:0,stops:0,disposed:0};
// No keyboard polling, process enumeration, helper process or activity capture.
userActivity.createUserActivity=options=>{
  let state='stopped';
  const status=()=>({state,reason:null,available:state==='running'});
  return {
    start(){monitor.starts++;state='running';options.onStatus?.(status());return true;},
    stop(){monitor.stops++;state='stopped';options.onStatus?.(status());},
    dispose(){monitor.disposed++;state='stopped';},getStatus:status
  };
};
// Only these fake summaries enter the work-state follower. No real session,
// prompt, source path, keyboard, game process or user cursor is inspected.
const privateDetails='PRIVATE_QA_PROMPT_OR_FILE_PATH';
const fixtureConversations=[
  {id:'qa-reading',title:'阅读项目',state:'reading',message:privateDetails,primary:true,uncertain:false},
  {id:'qa-working',title:'绘制场景',state:'working',message:privateDetails,primary:false,uncertain:false}
];
require('../codex-state-follower').CodexStateFollower=class {
  constructor(options){this.options=options;this.reducer={
    current:()=>({state:'reading',message:privateDetails}),
    conversations:()=>fixtureConversations,overflow:()=>({count:0,uncertain:0}),hasUnresolved:()=>true
  };}
  start(){this.options.onStatus?.({status:'following'});this.options.onState?.({state:'reading',message:privateDetails});}
  stop(){}
  async reload(){this.options.onState?.({state:'reading',message:privateDetails});}
};
const {normalizePreferences}=require('../preferences');
const initial=normalizePreferences({scale:.75,typingCompanion:true,gameCompanion:true,games:['qa-game'],idleLife:false,idleSongEnabled:true,idleSongVolume:.12,bubbleScale:.93,bubbleOffset:4});
fs.writeFileSync(path.join(runtime,'preferences.json'),JSON.stringify({...initial,clickThrough:true}));
let musicActivity=0;
const songModule=require('../idle-song'),createSong=songModule.createIdleSongController;
songModule.createIdleSongController=options=>{const controller=createSong(options),activity=controller.activity;controller.activity=()=>{musicActivity++;activity();};return controller;};
const templates=[],popups=[],buildMenu=Menu.buildFromTemplate.bind(Menu);
Menu.buildFromTemplate=template=>{templates.push(template);return buildMenu(template);};
Menu.prototype.popup=function(options){popups.push(options);};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function eventually(fn){let last;for(let i=0;i<120;i++)try{return await fn();}catch(error){last=error;await pause(75);}throw last;}
function samePosition(actual,expected,message){assert.equal(actual.x,expected.x,message);assert.equal(actual.y,expected.y,message);assert.ok(Math.abs(actual.width-expected.width)<=3&&Math.abs(actual.height-expected.height)<=3,'only fractional-DPI frame rounding is allowed');}
function inside(bounds,area){return bounds.x>=area.x-1&&bounds.y>=area.y-1&&bounds.x+bounds.width<=area.x+area.width+1&&bounds.y+bounds.height<=area.y+area.height+1;}
let displays,primary,initialDisplayListeners,qaCursor={x:-1000000,y:-1000000};
app.whenReady().then(()=>{
  screen.getCursorScreenPoint=()=>({...qaCursor});
  initialDisplayListeners=Object.fromEntries(['display-added','display-removed','display-metrics-changed'].map(event=>[event,screen.listenerCount(event)]));
  const actual=screen.getPrimaryDisplay(),area=actual.workArea,split=Math.floor(area.width/2);
  const make=(id,workArea)=>({...actual,id,bounds:{...workArea},workArea:{...workArea},size:{width:workArea.width,height:workArea.height},workAreaSize:{width:workArea.width,height:workArea.height}});
  primary=make(111,{x:area.x,y:area.y,width:split,height:area.height});
  const secondary=make(222,{x:area.x+split,y:area.y,width:area.width-split,height:area.height});
  displays=[primary,secondary];
  screen.getPrimaryDisplay=()=>primary;screen.getAllDisplays=()=>displays.map(display=>({...display}));
  screen.getDisplayNearestPoint=point=>displays.reduce((best,display)=>{
    const rect=display.workArea,dx=point.x-Math.max(rect.x,Math.min(point.x,rect.x+rect.width)),dy=point.y-Math.max(rect.y,Math.min(point.y,rect.y+rect.height));
    const distance=dx*dx+dy*dy;return !best||distance<best.distance?{display,distance}:best;
  },null).display;
});
require('../main');
app.whenReady().then(async()=>{
  const pet=await eventually(()=>{const window=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().endsWith('index.html'));assert.ok(window);return window;});
  const settings=await eventually(()=>{const window=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().includes('settings.html'));assert.ok(window);return window;});
  const ui=source=>settings.webContents.executeJavaScript(source);
  const snapshot=async()=>{const result=await ui('petSettings.get()');assert.equal(result.ok,true);return result.value;};
  const action=async name=>{const result=await ui(`petSettings.companion(${JSON.stringify(name)})`);assert.equal(result.ok,true,result.error);return result.value;};
  const settledStage=stage=>eventually(async()=>assert.equal((await snapshot()).companion.hideStage,stage));
  const recoveryWindows=()=>BrowserWindow.getAllWindows().filter(window=>window.webContents.getURL().endsWith('recovery.html'));
  await eventually(async()=>assert.equal(await ui('typeof petSettings.companion'),'function'));
  await eventually(()=>assert.equal(pet.webContents.isLoadingMainFrame(),false));
  await eventually(async()=>assert.equal(await pet.webContents.executeJavaScript('typeof whalePetController'),'object'));
  assert.equal(recoveryWindows().length,0,'recovery dock is created lazily, never when the pet is merely idle');
  assert.equal(Object.hasOwn((await snapshot()).preferences,'clickThrough'),false,'legacy mouse passthrough is removed before recovery testing');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(runtime,'preferences.json'),'utf8')),initial,'legacy mouse-lock migration preserves all remaining settings');
  assert.equal(shortcuts.has('CommandOrControl+Alt+L'),false,'removed mouse-lock shortcut is never registered');
  assert.equal((await snapshot()).companion.trayAvailable,false,'isolated QA does not create a real tray icon');
  assert.ok(monitor.starts>0,'opt-in monitoring uses the fake controller only');
  // Startup has skipped tray creation. Allow native visibility assertions below;
  // all existing and newly-created QA windows are still transparent to the eye.
  process.env.WHALEPET_QA_HIDDEN='0';
  pet.webContents.debugger.attach('1.3');
  await pet.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await action('show');await settledStage('normal');
  const secondary=displays[1];
  pet.setPosition(secondary.workArea.x+60,secondary.workArea.y+100);
  const original=pet.getBounds(),preferences=(await snapshot()).preferences;
  let previousMusic=musicActivity,previousStops=monitor.stops;
  const runPositions=[],runSampler=setInterval(()=>runPositions.push(pet.getBounds()),25);
  const hiding=action('hide');
  await eventually(async()=>{const edge=await pet.webContents.executeJavaScript('whalePetController.edgeInfo()');assert.equal(edge.phase,'hiding');assert.equal(edge.traveling,true,'escape is delegated to the fixed compositor travel surface');});
  assert.equal(await pet.webContents.executeJavaScript('getComputedStyle(document.querySelector("#pet")).visibility'),'hidden','the run actor carries no normal provider or work UI');
  const journey=await eventually(()=>{const window=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().endsWith('edge-travel.html'));assert.ok(window);return window;});
  await eventually(async()=>{const info=await journey.webContents.executeJavaScript('edgeTravel.info()');assert.equal(info.ready,true);assert.equal(info.mode,'hiding');assert.equal(info.animated,true);});
  const journeyBounds=journey.getBounds();
  const actorPositions=await journey.webContents.executeJavaScript(`new Promise(resolve=>{const samples=[],start=performance.now();function sample(){const info=edgeTravel.info();samples.push({time:performance.now()-start,mode:info.mode,actor:info.actorRect});if(performance.now()-start<280)requestAnimationFrame(sample);else resolve(samples);}requestAnimationFrame(sample);})`);
  assert.deepEqual(journey.getBounds(),journeyBounds,'the journey native surface remains stationary while Chromium animates the character');
  const traveled=actorPositions.filter(sample=>sample.mode==='hiding'&&sample.actor);
  assert.ok(new Set(traveled.map(sample=>sample.actor.x+','+sample.actor.y)).size>=3,'the character travels through intermediate compositor positions');
  assert.ok(traveled.some(sample=>Math.abs(sample.actor.y-traveled[0].actor.y)>20),'the compositor journey approaches the lower screen edge');
  await hiding;clearInterval(runSampler);
  assert.ok(new Set(runPositions.map(point=>point.x+','+point.y)).size<=2,'native pet window moves only once at handoff, never on every animation frame');
  assert.equal(journey.isVisible(),false,'completed escape clears the full travel surface');
  const dock=await eventually(()=>{const found=recoveryWindows();assert.equal(found.length,1);return found[0];});
  const recovery=source=>dock.webContents.executeJavaScript(source);
  await settledStage('hidden');
  await eventually(()=>assert.equal(dock.isVisible(),true,'hiding leaves the curl visible at the screen edge'));
  assert.equal(pet.isVisible(),false);assert.equal((await snapshot()).companion.hidden,true);
  assert.equal((await snapshot()).companion.recoveryAvailable,true);
  assert.equal((await snapshot()).companion.recoveryVisible,true);
  assert.ok(musicActivity>previousMusic,'hiding stops/reset music without disabling it');assert.ok(monitor.stops>previousStops,'hidden pet pauses its monitoring');
  assert.ok(inside(dock.getContentBounds(),secondary.workArea),'curl and head content viewport stays inside the hidden pet display work area');
  await eventually(async()=>assert.equal(await recovery('typeof whaleRecovery.toggle'),'function'));
  await eventually(async()=>assert.equal(await recovery('whalePeekController.info().ready'),true));
  const peekInfo=()=>recovery('whalePeekController.info()');
  const hiddenInfo=await peekInfo();
  assert.equal(hiddenInfo.stage,'hidden');assert.equal(hiddenInfo.curlVisible,true);assert.equal(hiddenInfo.headVisible,false);assert.equal(hiddenInfo.bubbleCount,0);
  assert.equal(await recovery('document.querySelector("#restorePet").textContent.trim()'),'','curl has no restore-panel text');
  assert.equal(await recovery('document.body.textContent.trim()'),'','hidden stage exposes no work-status or Codex information');
  assert.equal(await recovery('document.querySelector("#conversationBubbles").children.length'),0,'hidden status is removed from the DOM');
  assert.equal(await recovery('document.querySelector("#conversationBubbles").hidden'),true);
  assert.ok(recoveryPackets.some(packet=>packet.stage==='hidden'),'hidden state is explicitly published');
  assert.ok(recoveryPackets.filter(packet=>packet.stage==='hidden').every(packet=>!(packet.conversations?.length)),'hidden IPC packets contain no conversation summaries');
  assert.ok(recoveryPackets.filter(packet=>packet.stage==='hidden').every(packet=>!['provider','state','message'].some(key=>Object.hasOwn(packet,key))),'hidden IPC packets contain no AI status or provider fields');
  assert.ok(!JSON.stringify(recoveryPackets).includes(privateDetails),'recovery receives no prompt or source details');
  assert.equal(await recovery('getComputedStyle(document.querySelector("#restorePet")).pointerEvents'),'auto');
  const moveToRecovery=point=>{const bounds=dock.getContentBounds(),zoom=dock.webContents.getZoomFactor();qaCursor={x:bounds.x+Math.round(point.x*zoom),y:bounds.y+Math.round(point.y*zoom)};};
  const curlHole=await recovery('(()=>{const art=document.querySelector("#curlArt"),b=art.getBoundingClientRect();return {x:b.left+600*b.width/art.naturalWidth,y:b.top+280*b.height/art.naturalHeight};})()');
  const opaqueRecoveryPoint=()=>eventually(async()=>{const point=await recovery('(()=>{for(let y=2;y<innerHeight-2;y+=2)for(let x=2;x<innerWidth-2;x+=2)if([[0,0],[-1,0],[1,0],[0,-1],[0,1]].every(([dx,dy])=>whalePeekController.hitTest(x+dx,y+dy)))return {x,y};return null})()');assert.ok(point,'visible curl or head has an opaque clickable pixel safe from DPI rounding');return point;});
  assert.equal(await recovery('whalePeekController.hitTest(2,2)'),false,'empty recovery viewport passes clicks through');
  moveToRecovery({x:2,y:2});await eventually(()=>assert.equal(nativeIgnore.get(dock.id).at(-1),true,'transparent recovery space releases mouse input'));
  assert.equal(await recovery(`whalePeekController.hitTest(${curlHole.x},${curlHole.y})`),true,'the transparent curl hole is now clickable');
  moveToRecovery(curlHole);await eventually(()=>assert.equal(nativeIgnore.get(dock.id).at(-1),false,'stationary cursor inside the transparent curl hole restores native mouse interaction'));
  qaCursor={x:-1000000,y:-1000000};await eventually(()=>assert.equal(nativeIgnore.get(dock.id).at(-1),true,'leaving the curl releases input'));
  const layout=await recovery('({w:innerWidth,h:innerHeight,sw:document.documentElement.scrollWidth,sh:document.documentElement.scrollHeight})');
  assert.ok(Math.abs(dock.webContents.getZoomFactor()-preferences.scale)<1e-8,'recovery keeps the pet scale after navigation');
  assert.ok(Math.abs(layout.w-300)<=4&&Math.abs(layout.h-300)<=4,'recovery retains its 300 CSS-pixel viewport at 75% scale: '+JSON.stringify(layout));
  assert.ok(layout.sw<=layout.w&&layout.sh<=layout.h,'curl and head viewport has no overflow');
  await dock.webContents.capturePage({stayHidden:true});await pause(80);fs.writeFileSync(path.join(run,'hidden-curl.png'),(await dock.webContents.capturePage({stayHidden:true})).toPNG());
  assert.equal(pet.isVisible(),false,'capturing the dock does not restore the hidden pet');
  ipcMain.emit('recovery:restore',{sender:pet.webContents,senderFrame:pet.webContents.mainFrame});
  assert.equal(pet.isVisible(),false,'pet renderer cannot use dock restore IPC');
  ipcMain.emit('recovery:menu',{sender:settings.webContents,senderFrame:settings.webContents.mainFrame});
  assert.equal(pet.isVisible(),false,'settings renderer cannot use dock menu IPC');
  ipcMain.emit('recovery:restore',{sender:dock.webContents,senderFrame:{}});
  assert.equal(pet.isVisible(),false,'dock subframe cannot use restore IPC');
  await pause(75);assert.equal(pet.isVisible(),false,'other renderers and subframes cannot invoke the dock restore channel');assert.equal(popups.length,0,'only the recovery main frame can request its menu');
  ipcMain.emit('recovery:toggle',{sender:pet.webContents,senderFrame:pet.webContents.mainFrame});
  ipcMain.emit('recovery:toggle',{sender:dock.webContents,senderFrame:{}});
  await pause(75);assert.equal((await peekInfo()).stage,'hidden','other renderers and subframes cannot reveal hidden status');
  await recovery(`document.querySelector("#restorePet").dispatchEvent(new MouseEvent("click",{detail:1,button:0,bubbles:true,clientX:${curlHole.x},clientY:${curlHole.y}}))`);
  await settledStage('peeking');
  await eventually(async()=>assert.equal((await peekInfo()).stage,'peeking'));
  await pause(430);
  const revealed=await peekInfo();assert.equal(revealed.headVisible,true);assert.equal(revealed.curlVisible,false);assert.equal(revealed.bubbleCount,2);
  assert.equal(pet.isVisible(),false,'curl click reveals only the head rather than the full pet');assert.equal((await snapshot()).companion.hidden,true);
  assert.equal(await recovery('document.querySelectorAll(".conversation-bubble").length'),2,'peeking shows only compact status bubbles');
  const bubbleTitles=await recovery('[...document.querySelectorAll(".conversation-bubble span")].map(element=>element.textContent)');
  assert.deepEqual(bubbleTitles,['阅读项目','绘制场景']);
  const bubbleBounds=await recovery('[...document.querySelectorAll(".conversation-bubble")].map(element=>{const b=element.getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom,w:innerWidth,h:innerHeight}})');
  assert.ok(bubbleBounds.every(bounds=>bounds.x>=0&&bounds.y>=0&&bounds.right<=bounds.w&&bounds.bottom<=bounds.h),'both peek status bubbles are fully visible at 75% scale');
  assert.doesNotMatch(await recovery('document.body.textContent'),/ChatGPT|Codex|PRIVATE_QA_PROMPT_OR_FILE_PATH/,'peek exposes no provider panel or prompt details');
  assert.equal(await recovery('document.querySelector("#restorePet").textContent.trim()'),'','peek character stays artwork only');
  moveToRecovery(await opaqueRecoveryPoint());await eventually(()=>assert.equal(nativeIgnore.get(dock.id).at(-1),false,'head alpha accepts clicks'));
  moveToRecovery({x:2,y:2});await eventually(()=>assert.equal(nativeIgnore.get(dock.id).at(-1),true,'peeking also preserves transparent padding'));
  qaCursor={x:-1000000,y:-1000000};
  await dock.webContents.capturePage({stayHidden:true});await pause(80);fs.writeFileSync(path.join(run,'peeking-head-bubbles.png'),(await dock.webContents.capturePage({stayHidden:true})).toPNG());
  await recovery('document.querySelector("#restorePet").click()');await settledStage('hidden');
  await eventually(async()=>assert.equal((await peekInfo()).stage,'hidden'));
  assert.equal(await recovery('document.body.textContent.trim()'),'','clicking the head clears status and tucks her back to just the curl');
  assert.equal((await peekInfo()).bubbleCount,0);
  await recovery('document.querySelector("#restorePet").click()');await settledStage('peeking');
  await recovery('document.querySelector("#restorePet").dispatchEvent(new MouseEvent("contextmenu",{button:2,bubbles:true,cancelable:true}))');
  await eventually(()=>assert.equal(popups.length,1));assert.equal(popups[0].window,dock,'hidden recovery menu is owned by the dock rather than the invisible pet');
  const menu=templates.at(-1);assert.ok(menu.every(item=>!item.submenu),'recovery menu uses the same flat quick entries');
  const size=menu.find(item=>item.id==='size');assert.ok(size,'changing size has a direct entry');assert.match(size.label,/大小/);
  assert.ok(menu.filter(item=>item.type!=='separator').length<=7,'quick menu stays compact');
  assert.deepEqual(menu.filter(item=>item.type!=='separator').map(item=>item.id),['settings','size','visibility','recover','quiet','quit'],'recovery menu has no obsolete mouse-lock action');
  size.click();await eventually(async()=>assert.equal(await ui('document.querySelector("#appearance").hidden'),false));
  assert.ok(await ui('document.querySelector("#scaleNumber")&&!document.querySelector("#appearance").hidden'),'size entry opens its controls directly');
  const findBack=menu.find(item=>item.id==='recover');assert.ok(findBack,'find-back remains a direct menu action');findBack.click();
  await eventually(async()=>{const edge=await pet.webContents.executeJavaScript('whalePetController.edgeInfo()');assert.equal(edge.phase,'emerging');assert.equal(edge.traveling,true,'find-back uses the fixed-surface jump-out journey');});
  await settledStage('normal');assert.equal(pet.isVisible(),true);assert.equal((await snapshot()).companion.hidden,false);assert.equal(dock.isVisible(),false);
  samePosition(pet.getBounds(),original,'find-back jumps out and returns to the old clamped position');assert.deepEqual((await snapshot()).preferences,preferences);
  await action('hide');await settledStage('hidden');assert.equal(recoveryWindows()[0].id,dock.id,'the recovery entry is reused without accumulating windows');
  await action('show');await settledStage('normal');assert.equal(dock.isVisible(),false);samePosition(pet.getBounds(),original,'control room show does not relocate the body');
  await action('hide');await settledStage('hidden');
  app.emit('second-instance',{},[],root);
  await settledStage('normal');await eventually(()=>assert.equal(dock.isVisible(),false));samePosition(pet.getBounds(),original,'relaunch clears the recovery entry and retains position');
  await action('hide');await settledStage('hidden');
  const hiddenBefore=pet.getBounds();
  displays=[primary];screen.emit('display-removed',{},secondary);
  await eventually(()=>assert.ok(inside(dock.getContentBounds(),primary.workArea),'removed monitor brings recovery onto the remaining monitor: '+JSON.stringify(dock.getContentBounds())));
  samePosition(pet.getBounds(),hiddenBefore,'display removal moves only the recovery entry');
  displays=[primary,secondary];screen.emit('display-added',{},secondary);
  await eventually(()=>assert.ok(inside(dock.getContentBounds(),secondary.workArea),'added monitor restores recovery to the hidden pet nearest display'));
  samePosition(pet.getBounds(),hiddenBefore,'display addition moves only the recovery entry');
  const oldArea={...secondary.workArea};secondary.workArea={x:oldArea.x+30,y:oldArea.y+40,width:oldArea.width-60,height:oldArea.height-80};
  screen.emit('display-metrics-changed',{},secondary,['workArea']);
  await eventually(()=>assert.ok(inside(dock.getContentBounds(),secondary.workArea),'work area changes keep the complete entry reachable'));
  samePosition(pet.getBounds(),hiddenBefore,'work area change does not move the hidden pet');
  await action('corner');await settledStage('normal');await eventually(()=>assert.equal(dock.isVisible(),false));assert.equal(pet.isVisible(),true);assert.equal((await snapshot()).companion.hidden,false);
  assert.deepEqual((await snapshot()).preferences,preferences,'recovery, display changes and safe corner preserve size, music and opt-in preferences');
  assert.equal((await snapshot()).preferences.idleSongEnabled,true);
  await action('hide');await settledStage('hidden');
  const resized=await ui('petSettings.save({scale:1})');assert.equal(resized.ok,true,resized.error);
  await eventually(()=>assert.equal(dock.webContents.getZoomFactor(),1));
  const resizedDock=dock.getContentBounds();
  const preview=await ui('petSettings.preview("generating")');assert.equal(preview.ok,true,preview.error);
  await pause(100);
  assert.equal(await pet.webContents.executeJavaScript('whalePetController.getState().state'),'reading','hidden previews cannot replace the real work state');
  emergenceOrigins.length=0;await action('show');await settledStage('normal');
  const resizedOrigin=emergenceOrigins.at(-1);assert.ok(resizedOrigin);assert.equal(resizedOrigin.packet.composited,true);
  assert.ok(Math.abs(resizedOrigin.content.x+280*resizedOrigin.zoom-(resizedDock.x+resizedDock.width/2))<=3,'resizing while hidden keeps jump origin aligned to the visible border curl');
  assert.ok(Math.abs(resizedOrigin.content.y+493*resizedOrigin.zoom-(secondary.workArea.y+secondary.workArea.height))<=3,'resized jump begins at the display bottom');
  await eventually(async()=>assert.equal(await pet.webContents.executeJavaScript('whalePetController.layerInfo().renderedLayer'),'reading.webp','show restores the real work pose instead of the hidden preview'));
  const originalScale=await ui('petSettings.save({scale:.75})');assert.equal(originalScale.ok,true,originalScale.error);
  assert.deepEqual((await snapshot()).preferences,preferences,'hidden resizing preserves all remaining preferences and can return to the old scale');
  await action('hide');await settledStage('hidden');
  const switched=await ui('petSettings.save({provider:"deepseek"})');assert.equal(switched.ok,true,switched.error);
  const fixtureStateFile=(await snapshot()).stateFile;
  assert.ok(path.resolve(fixtureStateFile).startsWith(path.resolve(runtime)+path.sep),'other-provider fixture stays in the isolated runtime');
  fs.writeFileSync(fixtureStateFile,JSON.stringify({state:'working',message:privateDetails}));
  await eventually(async()=>assert.equal((await snapshot()).state,'working'));
  assert.equal(await recovery('document.body.textContent.trim()'),'','other-provider updates stay completely hidden behind the curl');
  await recovery('document.querySelector("#restorePet").click()');await settledStage('peeking');
  await eventually(async()=>assert.equal((await peekInfo()).bubbleCount,1));
  assert.equal(await recovery('document.querySelector(".conversation-bubble").dataset.state'),'working','active DeepSeek bridge status has a compact peek bubble');
  assert.doesNotMatch(await recovery('document.body.textContent'),/PRIVATE_QA_PROMPT_OR_FILE_PATH/,'fallback bubbles omit the arbitrary bridge message');
  const silent=await ui('petSettings.save({showSpeech:false})');assert.equal(silent.ok,true,silent.error);
  await eventually(async()=>assert.equal((await peekInfo()).bubbleCount,0));
  assert.equal((await peekInfo()).headVisible,true,'speech preference hides bubbles without dismissing the head');
  const unsilent=await ui('petSettings.save({showSpeech:true,provider:"chatgpt"})');assert.equal(unsilent.ok,true,unsilent.error);
  await eventually(async()=>assert.equal((await peekInfo()).bubbleCount,2));
  await recovery('document.querySelector("#restorePet").click()');await settledStage('hidden');
  assert.equal(await recovery('document.body.textContent.trim()'),'','returning from a fallback peek clears every status bubble');
  assert.ok(!JSON.stringify(recoveryPackets).includes(privateDetails),'neither conversation nor aggregate fallback sends raw prompt/message details');
  assert.ok(recoveryPackets.filter(packet=>packet.stage==='hidden').every(packet=>!(packet.conversations?.length)),'later hidden packets also omit provider and conversation fallback bubbles');
  assert.deepEqual((await snapshot()).preferences,preferences);
  // A queued hide never wins over the user's latest visibility choice.
  const repeated=await ui('Promise.all([petSettings.companion("hide"),petSettings.companion("show"),petSettings.companion("hide")])');
  assert.ok(repeated.every(result=>result.ok),JSON.stringify(repeated));await settledStage('hidden');
  assert.equal(pet.isVisible(),false);assert.equal(dock.isVisible(),true);
  await action('show');await settledStage('normal');assert.equal(dock.isVisible(),false);
  await action('hide');await settledStage('hidden');let recoveryClosed=false;dock.once('closed',()=>{recoveryClosed=true;});
  fs.writeFileSync(path.join(run,'menu-structure.json'),JSON.stringify(menu,null,2));
  app.on('will-quit',()=>{
    assert.equal(recoveryClosed,true,'quit destroys the reused recovery window');assert.equal(monitor.disposed,1,'quit disposes the fake monitoring controller');
    for(const channel of ['recovery:restore','recovery:menu','recovery:toggle','recovery:interactive'])assert.equal(ipcMain.listenerCount(channel),0);
    for(const [event,count]of Object.entries(initialDisplayListeners))assert.equal(screen.listenerCount(event),count,'quit removes recovery display listeners');
    console.log('PASS: fixed-surface compositor run/jump and single native handoff, edge curl -> head and status bubbles -> curl, private hidden state, alpha mouse recovery, trusted toggle/menu/find-back, preserved home/preferences, hidden resizing/preview safety, sanitized DeepSeek fallback, speech preference, fast hide/show, display recovery, and quit cleanup. Artifacts: '+run);
  });
  app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
setTimeout(()=>app.exit(1),60000).unref();
