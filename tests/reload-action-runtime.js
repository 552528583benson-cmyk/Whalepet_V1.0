'use strict';

// Only our invisible local renderer is used here. No main process follower,
// keyboard watcher, global shortcut, live cursor, desktop capture or audio.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {app,BrowserWindow,ipcMain,globalShortcut}=require('electron');
const root=path.resolve(__dirname,'..'),run=fs.mkdtempSync(path.join(root,'work','reload-action-qa-'));
app.setPath('userData',path.join(run,'electron'));
globalShortcut.register=()=>false;
let preferences=require('../preferences').normalizePreferences({scale:.75,idleLife:false,idleSongEnabled:false});
const realState={state:'thinking',provider:'chatgpt',message:'真实 AI 仍在思考',conversationTracking:true,
  conversations:[{id:'fixture',title:'真实任务',state:'thinking',primary:true}],conversationOverflow:{count:0}};
ipcMain.handle('pet:request-state',()=>realState);
ipcMain.handle('pet:request-preferences',()=>preferences);
ipcMain.handle('pet:request-buddy',()=>({mode:'none',tempo:3}));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function eventually(check){let error;for(let i=0;i<75;i++)try{return await check();}catch(e){error=e;await pause(30);}throw error;}

app.whenReady().then(async()=>{
  const window=new BrowserWindow({width:420,height:420,useContentSize:true,show:false,focusable:false,
    skipTaskbar:true,transparent:true,frame:false,webPreferences:{preload:path.join(root,'preload.js'),
      contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  window.setOpacity(0);window.setIgnoreMouseEvents(true,{forward:true});window.webContents.setAudioMuted(true);
  await window.loadFile(path.join(root,'index.html'));window.showInactive();
  const js=source=>window.webContents.executeJavaScript(source),info=()=>js('whalePetController.reloadInfo()');
  const state=()=>js('whalePetController.getState()');
  const send=(id,phase,state='thinking')=>window.webContents.send('pet:reload-action',{id,phase,state});
  await eventually(async()=>assert.equal(await js('typeof whalePetController.reloadInfo'),'function'));
  await eventually(async()=>assert.equal((await state()).state,'thinking'));
  await eventually(async()=>assert.equal(await js('whalePetController.transitionInfo().inProgress'),false));
  let id=0;const measurements=[];
  for(const scale of [.65,.75,1,1.5]){
    window.setContentSize(Math.round(560*scale),Math.round(560*scale));window.webContents.setZoomFactor(scale);
    preferences={...preferences,scale};window.webContents.send('pet:preferences',preferences);
    const before=await state();send(++id,'reading');
    await eventually(async()=>{const value=await info();assert.equal(value.phase,'reading');assert.equal(value.visible,true);assert.equal(value.animated,true);});
    const animation=await js(`(()=>{const a=document.querySelector('#reloadMotion').getAnimations()[0];return {duration:a.effect.getTiming().duration,iterations:a.effect.getTiming().iterations,keys:a.effect.getKeyframes().map(k=>k.transform)};})()`);
    assert.equal(animation.duration,1200);assert.equal(animation.iterations,Infinity);
    for(const transform of animation.keys){
      assert.doesNotMatch(transform,/scale|rotate/,'character size/anatomy remain unchanged');
      const matrix=await js(`(()=>{const m=new DOMMatrix(${JSON.stringify(transform)});return {a:m.a,b:m.b,c:m.c,d:m.d,x:m.e,y:m.f};})()`);
      assert.equal(matrix.a,1);assert.equal(matrix.d,1);assert.equal(matrix.b,0);assert.equal(matrix.c,0);
      assert.ok(Math.abs(matrix.x)<=3&&Math.abs(matrix.y)<=3,'bounded tiny compositor movement');
    }
    const beforeDuplicate=await js("document.querySelector('#reloadMotion').getAnimations()[0].currentTime");
    await pause(120);send(id,'reading');
    await pause(40);
    assert.ok(await js("document.querySelector('#reloadMotion').getAnimations()[0].currentTime")>beforeDuplicate,'duplicate start cannot replay the action');
    send(id-1,'failed');assert.equal((await info()).phase,'reading','old result cannot replace a newer action');
    send(id,'synced');send(id,'failed');
    await eventually(async()=>assert.equal((await info()).phase,'synced'));
    assert.match((await info()).label,/状态已同步/,'first accepted terminal wins over duplicate failed packet');
    assert.deepEqual(await state(),before,'local feedback never changes actual AI state');
    const layout=await js(`(()=>{const b=document.querySelector('#reloadFeedback').getBoundingClientRect();return {w:innerWidth,h:innerHeight,left:b.left,right:b.right,top:b.top,bottom:b.bottom,pointer:getComputedStyle(document.querySelector('#reloadFeedback')).pointerEvents,hit:whalePetController.hitTest((b.left+b.right)/2,(b.top+b.bottom)/2)};})()`);
    assert.equal(layout.pointer,'none');assert.equal(layout.hit,false,'feedback is never a mouse interception surface');
    assert.ok(layout.left>=0&&layout.right<=layout.w&&layout.top>=0&&layout.bottom<=layout.h,'small feedback stays inside every scaled viewport');
    measurements.push({scale,animation,layout});
    await eventually(async()=>assert.equal((await info()).phase,'idle'));
    assert.equal((await info()).visible,false);assert.equal((await info()).animated,false);
  }

  // Urgent AI state changes remain real and update wording while local feedback
  // is on screen; "synced" never means the work or unanswered question ended.
  send(++id,'reading');send(id,'synced','thinking');
  await js("whalePetController.setState({state:'needs_input',provider:'chatgpt',providerChanged:true,immediate:true})");
  await eventually(async()=>assert.equal((await info()).phase,'synced'));
  assert.match((await info()).label,/仍等你确认/);assert.equal((await state()).state,'needs_input');
  await js("whalePetController.setState({state:'blocked',provider:'chatgpt',providerChanged:true,immediate:true})");
  await eventually(async()=>assert.match((await info()).label,/仍有问题/));assert.equal((await state()).state,'blocked');
  await js("whalePetController.setState({state:'thinking',provider:'chatgpt',providerChanged:true,immediate:true})");

  await js('whalePetController.previewDrag(1000)');
  await eventually(async()=>assert.equal(await js('whalePetController.dragPhysicsInfo().active'),true));
  send(++id,'reading');send(id,'deferred');
  await eventually(async()=>assert.equal((await info()).phase,'deferred'));
  assert.equal((await info()).visible,false);assert.equal((await info()).animated,false);
  await eventually(async()=>assert.equal(await js('whalePetController.dragPhysicsInfo().active'),false));
  assert.equal((await info()).visible,false,'drag-suppressed action does not reappear on release');
  assert.equal((await info()).animated,false);

  window.webContents.send('pet:edge-action',{phase:'prepare'});
  await eventually(async()=>assert.equal(await js('whalePetController.edgeInfo().phase'),'prepare'));
  send(++id,'reading');send(id,'synced');
  await eventually(async()=>assert.equal((await info()).phase,'synced'));
  assert.equal((await info()).visible,false);assert.equal((await info()).animated,false);
  window.webContents.send('pet:edge-action',{phase:'normal'});
  await eventually(async()=>assert.equal(await js('whalePetController.edgeInfo().phase'),'normal'));
  assert.equal((await info()).visible,false,'edge-suppressed action never leaks from a hidden curl');

  await js("whalePetController.setState({state:'thinking',provider:'deepseek',providerChanged:true,immediate:true})");
  send(++id,'reading');send(id,'synced');
  await eventually(async()=>assert.equal((await info()).phase,'synced'));
  assert.equal((await info()).visible,false);assert.equal((await info()).animated,false);
  await js("whalePetController.setState({state:'thinking',provider:'chatgpt',providerChanged:true,immediate:true})");
  assert.equal((await info()).visible,false,'provider-suppressed result never replays');

  // Page visibility loss cancels progress immediately. Electron intentionally
  // keeps document.hidden false with backgroundThrottling:false, even for a
  // hidden native window, so simulate the visibility signal in our own renderer.
  // This never changes native focus, input or the user's desktop.
  send(++id,'reading');await eventually(async()=>assert.equal((await info()).animated,true));
  await js("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))");
  await eventually(async()=>{
    assert.equal(await js('document.hidden'),true);
    assert.equal((await info()).visible,false);assert.equal((await info()).animated,false);
  });
  await js("delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))");
  await eventually(async()=>assert.equal(await js('document.hidden'),false));
  assert.equal((await info()).visible,false);assert.equal((await info()).animated,false,'visibility restoration never replays');
  send(id,'synced');await eventually(async()=>assert.equal((await info()).phase,'synced'));
  assert.equal((await info()).visible,false);assert.equal((await info()).animated,false,'hidden result remains silent after visibility returns');

  preferences={...preferences,showSpeech:false};window.webContents.send('pet:preferences',preferences);await pause(60);
  send(++id,'reading');await eventually(async()=>assert.equal((await info()).phase,'reading'));
  assert.equal((await info()).visible,false,'user speech preference also hides local feedback');
  assert.equal((await info()).animated,true,'speech preference does not erase the requested character action');
  send(id,'failed');await eventually(async()=>assert.equal((await info()).phase,'failed'));
  assert.equal((await info()).visible,false);assert.equal((await info()).animated,false);
  preferences={...preferences,showSpeech:true};window.webContents.send('pet:preferences',preferences);await pause(60);

  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  send(++id,'reading');await eventually(async()=>{assert.equal((await info()).phase,'reading');assert.equal((await info()).visible,true);});
  assert.equal((await info()).animated,false,'reduced motion keeps static truthful progress');
  assert.equal(await js("getComputedStyle(document.querySelector('.reload-icon')).animationName"),'none');
  send(id,'synced');await eventually(async()=>assert.equal((await info()).phase,'synced'));
  assert.equal((await info()).animated,false);assert.equal((await info()).visible,true);
  assert.equal(window.getOpacity(),0);assert.equal(window.isFocusable(),false);
  assert.equal((await state()).state,'thinking');
  fs.writeFileSync(path.join(run,'measurements.json'),JSON.stringify(measurements,null,2));
  console.log('PASS: 65/75/100/150% bounded translation without scale, duplicate/outdated packet guards, untouched AI urgency, nonintercepting compact feedback, drag/edge/provider/visibility suppression without replay, speech preference and static reduced-motion cues. Invisible renderer artifacts: '+run);
  app.quit();
}).catch(error=>{console.error(error);console.error('Artifacts: '+run);app.exit(1);});
setTimeout(()=>{console.error('Reload action renderer timed out. Artifacts: '+run);app.exit(1);},60000).unref();
