'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {app,BrowserWindow,globalShortcut,ipcMain,screen,dialog}=require('electron');
const root=path.resolve(__dirname,'..'),run=fs.mkdtempSync(path.join(root,'work','reload-display-qa-'));
const runtime=path.join(run,'runtime'),sessions=path.join(run,'sessions');fs.mkdirSync(runtime);fs.mkdirSync(sessions);
const id='10000001-1111-1111-1111-111111111111',file=path.join(sessions,`rollout-${id}.jsonl`);
fs.writeFileSync(file,'');fs.writeFileSync(path.join(run,'session_index.jsonl'),JSON.stringify({id,thread_name:'状态重载 · 验证会话'})+'\n');
Object.assign(process.env,{WHALEPET_RUNTIME_DIR:runtime,WHALEPET_CODEX_SESSIONS:sessions,WHALEPET_QA_ALLOW_SECOND_INSTANCE:'1',WHALEPET_QA_HIDDEN:'1',WHALEPET_QA_SETTINGS:'1',WHALEPET_BRIDGE_PORT:String(54000+process.pid%1000)});
app.setPath('userData',path.join(run,'electron'));app.setAppPath(root);
globalShortcut.register=()=>false;
dialog.showMessageBox=async()=>({response:0});
app.once('ready',()=>{screen.getCursorScreenPoint=()=>({x:-1000000,y:-1000000});});
app.on('browser-window-created',(_event,window)=>{
  const setOpacity=window.setOpacity.bind(window),setIgnore=window.setIgnoreMouseEvents.bind(window);
  window.setOpacity=()=>setOpacity(0);window.setOpacity(0);window.setSkipTaskbar(true);window.setFocusable(false);
  window.webContents.setAudioMuted(true);window.focus=()=>{};
  window.show=window.showInactive.bind(window);
  window.setIgnoreMouseEvents=(_ignored,options)=>setIgnore(true,options);
  window.setIgnoreMouseEvents(true,{forward:true});
});
// Isolated fixture: never capture real keys/cursor, intercept real clicks,
// focus an invisible window, select a game or play audio.
require('../user-activity').createUserActivity=()=>({start:()=>false,stop(){},dispose(){},getStatus:()=>({state:'stopped',available:false})});
let songPlaying=false,songStops=0;
require('../idle-song').createIdleSongController=options=>({
  snapshot:()=>({playing:songPlaying,available:true,error:''}),
  activity(){songStops++;songPlaying=false;const w=options.getWindow();if(w&&!w.isDestroyed())w.webContents.send('pet:idle-song',{action:'stop'});},
  stateChanged(){},stop(){songPlaying=false;},changed(){},preview(){},dispose(){}
});
const {normalizePreferences}=require('../preferences');
fs.writeFileSync(path.join(runtime,'preferences.json'),JSON.stringify(normalizePreferences({scale:.75,idleSongEnabled:false})));
const emit=(type,payload)=>fs.appendFileSync(file,JSON.stringify({timestamp:new Date().toISOString(),type,payload})+'\n');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function eventually(fn,count=100){let last;for(let i=0;i<count;i++)try{return await fn();}catch(error){last=error;await pause(80);}throw last;}
let holdFollower=false,releaseFollower=null,followerReloads=0;
const Follower=require('../codex-state-follower').CodexStateFollower;
const originalReload=Follower.prototype.reload;
Follower.prototype.reload=async function(...args){
  followerReloads++;
  if(holdFollower)await new Promise(resolve=>{releaseFollower=resolve;});
  return originalReload.apply(this,args);
};
require('../main');
app.whenReady().then(async()=>{
  const pet=await eventually(()=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('index.html'));assert(w);return w;});
  const settings=await eventually(()=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('settings.html'));assert(w);return w;});
  pet.setOpacity(0);pet.showInactive();pet.webContents.setAudioMuted(true);settings.setOpacity(0);settings.webContents.setAudioMuted(true);
  const js=code=>pet.webContents.executeJavaScript(code),ui=code=>settings.webContents.executeJavaScript(code);
  const good=async code=>{const result=await ui(code);assert.equal(result.ok,true,result.error);return result.value;};
  const snapshot=()=>good('petSettings.get()');
  const state=()=>js('whalePetController.getState().state');
  const pose=()=>js(`(()=>{const c=whalePetController;return {state:c.getState().state,frame:c.layerInfo().renderedLayer,transition:c.transitionInfo().inProgress,buddy:document.querySelector('#pet').classList.contains('has-buddy'),loaded:[...document.querySelectorAll('.character-layer.is-visible')].some(e=>e.complete&&e.naturalWidth>0&&getComputedStyle(e).opacity==='1')};})()`);
  await eventually(async()=>assert.equal(await js('typeof whalePetController'),'object'));
  assert.equal(await js('whaleBuddy.ready'),true);
  let suppressReload=false;const reloadPackets=[],acks=[],actionPackets=[];
  const send=pet.webContents.send.bind(pet.webContents);
  pet.webContents.send=(channel,...args)=>{
    if(channel==='pet:reload-action')actionPackets.push({...args[0],sentAt:Date.now(),visible:pet.isVisible(),followerReloads});
    if(channel==='pet:state'&&args[0]?.statusReloaded){reloadPackets.push(args[0]);if(suppressReload)return;}
    return send(channel,...args);
  };
  const feedback=()=>js('whalePetController.reloadInfo()');
  const captureOwn=async name=>{
    const layout=await js('({width:innerWidth,height:innerHeight,box:document.querySelector("#pet").getBoundingClientRect().toJSON()})');
    await pause(50);const image=await pet.webContents.capturePage(undefined,{stayHidden:true}),size=image.getSize();
    const sx=size.width/layout.width,sy=size.height/layout.height;
    const x=Math.max(0,Math.floor((layout.box.x-8)*sx)),y=Math.max(0,Math.floor((layout.box.y-8)*sy));
    const right=Math.min(size.width,Math.ceil((layout.box.right+8)*sx)),bottom=Math.min(size.height,Math.ceil((layout.box.bottom+8)*sy));
    assert.ok(right>x&&bottom>y,'own pet crop remains non-empty');
    fs.writeFileSync(path.join(run,name),image.crop({x,y,width:right-x,height:bottom-y}).toPNG());
  };
  const observe=(event,value)=>{if(event.sender===pet.webContents&&event.senderFrame===pet.webContents.mainFrame)acks.push({...value,receivedAt:Date.now()});};
  ipcMain.on('pet:status-reloaded',observe);
  try{
    await good('petSettings.gameMode(true)');
    await eventually(async()=>assert.equal(await js('whaleBuddy.info().mode'),'gaming'));
    emit('response_item',{type:'function_call',name:'request_user_input_async',call_id:'first-question',arguments:'{"questions":[{}]}'});
    await eventually(async()=>assert.equal(await state(),'needs_input'));
    emit('response_item',{type:'message',role:'user',content:[{type:'input_text',text:'fixture answer'}]});
    holdFollower=true;let readingSettled=false;
    const reading=good('petSettings.reloadCodex()').then(value=>{readingSettled=true;return value;});
    await eventually(()=>assert.equal(typeof releaseFollower,'function'));
    const readingPacket=actionPackets.at(-1);
    assert.equal(readingPacket.phase,'reading');
    assert.equal(readingPacket.followerReloads,followerReloads-1,'reading feedback begins before calling the real log reload');
    await eventually(async()=>{const info=await feedback();assert.equal(info.phase,'reading');assert.equal(info.visible,true);assert.equal(info.animated,true);});
    assert.equal(readingSettled,false,'pending real reload has progress, never premature success');
    assert.match((await feedback()).label,/重新确认/);
    await captureOwn('reload-action-reading-75.png');
    holdFollower=false;releaseFollower();releaseFollower=null;
    const answered=await reading;
    assert.equal(answered.state,'thinking');assert.equal(answered.renderedState,'thinking');
    assert.equal(answered.reloadDisplay.state,'thinking');assert.equal(answered.reloadDisplay.deferred,false);
    assert.equal(answered.companion.buddy.manualGame,true,'reload preserves the manual companionship choice');
    const visible=await pose();assert.deepEqual(visible,{state:'thinking',frame:'thinking.webp',transition:false,buddy:false,loaded:true},'acknowledged reload shows the loaded AI picture rather than the companionship overlay');
    assert.equal(acks.at(-1).ok,true);assert.equal(acks.at(-1).id,reloadPackets.at(-1).reloadId);
    assert.ok(answered.reloadDisplay.appliedAt>=acks.at(-1).receivedAt,'settings success follows the visible-pose receipt');
    const firstSynced=actionPackets.find(packet=>packet.id===readingPacket.id&&packet.phase==='synced');
    assert.ok(firstSynced&&firstSynced.sentAt>=acks.at(-1).receivedAt,'synced feedback follows the loaded-pose receipt');
    await eventually(async()=>assert.equal((await feedback()).phase,'synced'));
    assert.match((await feedback()).label,/状态已同步/);
    await captureOwn('reload-action-synced-75.png');
    await pet.webContents.capturePage();await pause(70);fs.writeFileSync(path.join(run,'reload-confirmed-thinking.png'),(await pet.webContents.capturePage()).toPNG());
    await pause(650);assert.equal((await pose()).buddy,false,'the requested AI picture stays visible long enough to inspect');
    await eventually(async()=>assert.equal(await js('whaleBuddy.info().mode'),'gaming'),50);

    // A local preview and music overlay are both cancelled by an actual reload.
    await good('petSettings.preview("generating")');await eventually(async()=>assert.equal(await state(),'generating'));
    songPlaying=true;await js('document.body.classList.add("music-playing")');const stopsBefore=songStops;
    const previewReload=await good('petSettings.reloadCodex()');
    assert.equal(previewReload.state,'thinking');assert.equal(previewReload.renderedState,'thinking');assert.ok(songStops>stopsBefore);
    assert.equal(songPlaying,false);assert.equal(await js('document.body.classList.contains("music-playing")'),false);
    assert.equal((await pose()).frame,'thinking.webp');assert.equal((await pose()).buddy,false);

    emit('response_item',{type:'function_call',name:'request_user_input_async',call_id:'second-question',arguments:'{"questions":[{}]}'});
    const waiting=await good('petSettings.reloadCodex()');assert.equal(waiting.state,'needs_input');assert.equal(waiting.renderedState,'needs_input');
    assert.equal((await pose()).frame,'needs-input.webp');assert.equal((await pose()).buddy,false);
    assert.equal(await js('document.querySelector(".conversation-bubble").dataset.state'),'needs_input','reload cannot acknowledge a genuine unanswered question');
    await eventually(async()=>assert.equal((await feedback()).phase,'synced'));
    assert.match((await feedback()).label,/仍等你确认/,'synced is not the same as a completed AI task');
    emit('response_item',{type:'message',role:'user',content:[{type:'input_text',text:'fixture answer'}]});
    emit('response_item',{type:'function_call',name:'apply_patch'});
    const countBefore=reloadPackets.length,actionCountBefore=actionPackets.filter(packet=>packet.phase==='reading').length;
    const pair=await ui('Promise.all([petSettings.reloadCodex(),petSettings.reloadCodex()])');
    assert.ok(pair.every(result=>result.ok),JSON.stringify(pair));
    assert.equal(reloadPackets.length-countBefore,1,'simultaneous reload calls share one renderer confirmation');
    assert.equal(actionPackets.filter(packet=>packet.phase==='reading').length-actionCountBefore,1,'coalesced reloads play one local action');
    assert.equal(pair[0].value.reloadDisplay.appliedAt,pair[1].value.reloadDisplay.appliedAt);
    assert.equal(pair[0].value.renderedState,'working');assert.equal((await pose()).frame,'working.webp');

    await js('whalePetController.previewDrag(1100)');
    await eventually(async()=>assert.equal(await js('whalePetController.dragPhysicsInfo().active'),true));
    const dragging=await good('petSettings.reloadCodex()');assert.equal(dragging.reloadDisplay.deferred,true,'active dragging is explicitly deferred rather than interrupted');
    const deferredPacket=actionPackets.at(-1);assert.equal(deferredPacket.phase,'deferred');
    assert.equal(actionPackets.some(packet=>packet.id===deferredPacket.id&&packet.phase==='synced'),false,'a drag-deferred receipt is never presented as synced');
    assert.equal((await feedback()).animated,false);assert.equal((await feedback()).visible,false,'drag remains unmodified by reload feedback');
    assert.equal(await js('whalePetController.dragPhysicsInfo().active'),true);
    await eventually(async()=>assert.equal(await js('whalePetController.dragPhysicsInfo().active'),false));
    await eventually(async()=>assert.equal((await pose()).frame,'working.webp'));

    // Drop only the renderer reload request; normal following continues. A
    // settings-window sender (or wrong renderer frame) cannot forge success.
    const previousReceipt=(await snapshot()).reloadDisplay.appliedAt;
    suppressReload=true;const beforeMissing=reloadPackets.length;let settled=false;
    const missing=ui('petSettings.reloadCodex()').then(result=>{settled=true;return result;});
    await eventually(()=>assert.equal(reloadPackets.length,beforeMissing+1));
    const missingId=reloadPackets.at(-1).reloadId;
    ipcMain.emit('pet:status-reloaded',{sender:settings.webContents,senderFrame:settings.webContents.mainFrame},{id:missingId,state:'idle',ok:true});
    ipcMain.emit('pet:status-reloaded',{sender:pet.webContents,senderFrame:settings.webContents.mainFrame},{id:missingId,state:'idle',ok:true});
    ipcMain.emit('pet:status-reloaded',{sender:pet.webContents,senderFrame:pet.webContents.mainFrame},{id:missingId-1,state:'idle',ok:true});
    await pause(180);assert.equal(settled,false,'untrusted or stale receipt cannot resolve the pending reload');
    assert.equal((await snapshot()).reloadDisplay.appliedAt,previousReceipt);
    const timedOut=await missing;assert.equal(timedOut.ok,false);assert.match(timedOut.error,/姿势尚未确认同步/);
    assert.equal(actionPackets.at(-1).phase,'failed');
    assert.equal(actionPackets.some(packet=>packet.id===missingId&&packet.phase==='synced'),false,'missing receipt never produces synced feedback');
    await eventually(async()=>assert.equal((await feedback()).phase,'failed'));
    assert.match((await feedback()).label,/未能确认同步/);assert.equal((await feedback()).animated,false);
    await captureOwn('reload-action-failed-75.png');
    suppressReload=false;const recovered=await good('petSettings.reloadCodex()');assert.equal(recovered.renderedState,'working');assert.equal(recovered.reloadDisplay.deferred,false);
    assert.equal(recovered.companion.buddy.manualGame,true);
    await good('petSettings.companion("hide")');
    await eventually(async()=>assert.equal((await snapshot()).companion.hideStage,'hidden'));
    assert.equal((await snapshot()).companion.hidden,true);
    const shown=await good('petSettings.reloadCodex()');assert.equal(shown.companion.hidden,false,'explicit reload restores a hidden pet before confirming the picture');
    assert.equal(actionPackets.filter(packet=>packet.phase==='reading').at(-1).visible,true,'hidden curl is restored before reload feedback starts');
    await eventually(async()=>assert.equal((await snapshot()).companion.hideStage,'normal'));
    assert.equal(pet.isVisible(),true);assert.equal(shown.renderedState,'working');assert.equal((await pose()).loaded,true);
    await good('petSettings.companion("hide")');
    const recovery=await eventually(()=>{const window=BrowserWindow.getAllWindows().find(item=>item.webContents.getURL().endsWith('recovery.html'));assert.ok(window);return window;});
    await recovery.webContents.executeJavaScript('whaleRecovery.toggle()');
    await eventually(async()=>assert.equal((await snapshot()).companion.hideStage,'peeking'));
    const fromPeek=await good('petSettings.reloadCodex()');
    assert.equal(fromPeek.companion.hidden,false,'explicit reload also restores the head-only peek');
    assert.equal(fromPeek.companion.hideStage,'normal');assert.equal(recovery.isVisible(),false);
    assert.equal(fromPeek.renderedState,'working');assert.equal((await pose()).loaded,true);
    const interrupted=await ui('(async()=>{const hiding=petSettings.companion("hide"),reloading=petSettings.reloadCodex();return {hide:await hiding,reload:await reloading};})()');
    assert.equal(interrupted.hide.ok,true,interrupted.hide.error);assert.equal(interrupted.reload.ok,true,interrupted.reload.error);
    await eventually(async()=>assert.equal((await snapshot()).companion.hideStage,'normal'));
    assert.equal(pet.isVisible(),true);assert.equal(recovery.isVisible(),false);
    assert.equal((await pose()).frame,'working.webp','reload during a hide returns to a confirmed work pose');
    for(const window of BrowserWindow.getAllWindows()){assert.equal(window.getOpacity(),0);assert.equal(window.isFocusable(),false);}
    fs.writeFileSync(path.join(run,'reload-action-packets.json'),JSON.stringify(actionPackets,null,2));
    console.log('PASS: real reload progress before reread; synced only after loaded-pose receipt; genuine questions; deferred/timeout feedback without fake success; one action for coalesced calls; previews/music cancelled; preserved companionship; hidden/peek restore; spoofed receipts rejected. Invisible mock-input artifacts: '+run);
    app.quit();
  }finally{ipcMain.removeListener('pet:status-reloaded',observe);pet.webContents.send=send;Follower.prototype.reload=originalReload;releaseFollower?.();}
}).catch(error=>{console.error(error);app.exit(1);});setTimeout(()=>app.exit(1),45000).unref();
