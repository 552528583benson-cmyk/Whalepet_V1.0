const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {app,BrowserWindow,screen,ipcMain}=require('electron');
const root=path.resolve(__dirname,'..'),run=fs.mkdtempSync(path.join(root,'work/rapid-drag-qa-'));
Object.assign(process.env,{WHALEPET_RUNTIME_DIR:path.join(run,'runtime'),WHALEPET_QA_ALLOW_SECOND_INSTANCE:'1',WHALEPET_QA_HIDDEN:'1',WHALEPET_QA_FORCE_INTERACTIVE:'1',WHALEPET_DISABLE_AUTO_FOLLOW:'1',WHALEPET_QA_SETTINGS:'1',WHALEPET_BRIDGE_PORT:String(45000+process.pid%1000)});
app.setPath('userData',path.join(run,'electron'));app.setAppPath(root);require('../main');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 await pause(2000);const pet=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('index.html')),settings=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('settings.html')),js=s=>pet.webContents.executeJavaScript(s);
 settings.hide();pet.showInactive();pet.focus();
 let cursor={x:700,y:400};const previous=screen.getCursorScreenPoint;screen.getCursorScreenPoint=()=>cursor;
 const results=[];
 for(const scale of [.75,1,1.5]){
  await settings.webContents.executeJavaScript(`petSettings.save({scale:${scale}})`);await pause(150);
  pet.setPosition(300,120);
  // Normalize Windows' initial transparent-frame rounding before measuring.
  const warm=pet.getContentBounds();cursor={x:Math.round(warm.x+310*scale),y:Math.round(warm.y+390*scale)};
  ipcMain.emit('pet:drag-start',{}, {tailAnchor:{x:150,y:110},pressScreenX:cursor.x,pressScreenY:cursor.y});ipcMain.emit('pet:drag-end',{}, {cursor});
  await js("commitState({state:'idle',preview:true},true)");await pause(200);
  const initial=pet.getBounds();let resizes=0,maxError=0,surfaceResizes=0;
  const originalSetContentSize=pet.setContentSize.bind(pet);pet.setContentSize=(...args)=>{surfaceResizes++;return originalSetContentSize(...args);};
  const resized=()=>resizes++;pet.on('resize',resized);
  for(let n=0;n<100;n++){
   const before=pet.getBounds(),content=pet.getContentBounds();
   // Click the body, not the tail. Alternating deltas must return to the start.
   const press={x:Math.round(content.x+310*scale),y:Math.round(content.y+390*scale)};
   const delta={x:n%2?-17:17,y:n%2?-9:9};cursor={x:press.x+delta.x,y:press.y+delta.y};
   await js("pet.classList.add('is-dragging');startDragVisual()");
   ipcMain.emit('pet:drag-start',{}, {tailAnchor:{x:150,y:110},pressScreenX:press.x,pressScreenY:press.y});
   if(n%3===0)await pause(5);
   ipcMain.emit('pet:drag-end',{}, {cursor});
   await js("pet.classList.remove('is-dragging');stopDragVisual()");
   const after=pet.getBounds();
   maxError=Math.max(maxError,Math.abs(after.x-before.x-delta.x),Math.abs(after.y-before.y-delta.y));
   assert.ok(Math.abs(after.width-initial.width)<=2,'no canvas expansion');assert.ok(Math.abs(after.height-initial.height)<=2,'no canvas expansion');
   assert.ok(maxError<=1,'drop point must use click-to-release displacement');
   if(n%10===0)assert.equal(await js('window.whalePetController.layerInfo().visibleLayers'),1);
  }
  await pause(800);pet.removeListener('resize',resized);
  pet.setContentSize=originalSetContentSize;
  const final=pet.getBounds();assert.equal(final.x,initial.x,'no cumulative horizontal drift');assert.equal(final.y,initial.y,'no cumulative vertical drift');assert.equal(surfaceResizes,0,'no drawing-surface resize during rapid dragging');
  assert.equal(await js("document.querySelectorAll('.character-layer.is-visible').length"),1);
  assert.equal(await js("motionLayer.getAnimations().filter(a=>a.playState==='running').length"),0,'no leftover landing animation');
  assert.equal(await js('window.whalePetController.dragPhysicsInfo().active'),false);
  assert.equal(await js('window.whalePetController.hitTest(10,10)'),false,'empty margin remains click-through');
  fs.writeFileSync(path.join(run,`after-${scale}.png`),(await pet.webContents.capturePage()).toPNG());
  results.push({scale,cycles:100,resizes,surfaceResizes,maxError,initial,final});console.log('Rapid dragging passed:',scale,'100 cycles, zero position drift, zero surface resizes');
 }
 screen.getCursorScreenPoint=previous;
 fs.writeFileSync(path.join(run,'results.json'),JSON.stringify(results,null,2));console.log('QA:',run);app.quit();
}).catch(e=>{console.error(e);app.exit(1);});setTimeout(()=>app.exit(1),90000).unref();
