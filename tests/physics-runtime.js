const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {app,BrowserWindow,screen,ipcMain}=require('electron');
const root=path.resolve(__dirname,'..'),run=fs.mkdtempSync(path.join(root,'work/physics-qa-'));
Object.assign(process.env,{WHALEPET_RUNTIME_DIR:path.join(run,'runtime'),WHALEPET_QA_ALLOW_SECOND_INSTANCE:'1',WHALEPET_QA_HIDDEN:'1',WHALEPET_QA_FORCE_INTERACTIVE:'1',WHALEPET_DISABLE_AUTO_FOLLOW:'1',WHALEPET_QA_SETTINGS:'1',WHALEPET_BRIDGE_PORT:String(47000+process.pid%1000)});
app.setPath('userData',path.join(run,'electron'));app.setAppPath(root);require('../main');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 await pause(2000);const pet=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('index.html')),settings=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('settings.html')),js=s=>pet.webContents.executeJavaScript(s);
 settings.hide();pet.showInactive();pet.focus();
 // sendInputEvent presses a Chromium pointer, not the OS mouse button. Moving
 // the real native window can also deliver unrelated OS hover moves (buttons=0).
 // Native capture-loss notifications likewise see the unpressed OS button.
 // Exclude these fixture-only events; the synthetic pointerup is still tested.
 await js("for(const type of ['pointermove','lostpointercapture'])document.addEventListener(type,e=>{if(window.qaPressed&&e.buttons===0)e.stopImmediatePropagation();},true)");
 await js("commitState({state:'idle',preview:true},true)");
 const breath=await js(`(()=>{const a=stage.getAnimations().find(a=>a.animationName==='breathe');a.pause();const values=[];for(let t=0;t<=3600;t+=20){a.currentTime=t;values.push(new DOMMatrix(getComputedStyle(stage).transform).m42);}a.play();return values;})()`);
 for(let n=1;n<=90;n++)assert.ok(breath[n]<=breath[n-1]+.00001,'inhale monotonic');
 for(let n=91;n<breath.length;n++)assert.ok(breath[n]>=breath[n-1]-.00001,'exhale monotonic');
 let maxAcceleration=0;for(let n=1;n<breath.length-1;n++)maxAcceleration=Math.max(maxAcceleration,Math.abs(breath[n+1]-2*breath[n]+breath[n-1])/400);
 assert.ok(maxAcceleration<.00002,'smooth speed curve: '+maxAcceleration);
 const originalCursor=screen.getCursorScreenPoint,area=screen.getPrimaryDisplay().workArea;
 let cursor={x:Math.round(area.x+area.width*.5),y:Math.round(area.y+area.height*.35)};
 screen.getCursorScreenPoint=()=>cursor;
 const trials=[];
 for(const scale of [.75,1,1.5]){
  await settings.webContents.executeJavaScript(`petSettings.save({scale:${scale}})`);await js("commitState({state:'idle',preview:true},true)");await pause(200);
  const normalSize=pet.getContentBounds();
  await js("window.dragTrace=[];for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'])pet.addEventListener(type,e=>window.dragTrace.push({type,buttons:e.buttons,x:e.screenX,drag:dragVisualActive}),{capture:true});");
  // Electron takes window DIP coordinates; renderer hit tests take CSS pixels.
  const input=(type,x,y,extra={})=>pet.webContents.sendInputEvent({type,x:Math.round(x*scale),y:Math.round(y*scale),globalX:cursor.x,globalY:cursor.y,...extra});
  input('mouseMove',280,385);
  await pause(100);
  assert.equal(await js('window.whalePetController.hitTest(280,385)'),true,'drag starts on opaque character');
  await js('window.qaPressed=true');
  input('mouseDown',280,385,{button:'left',clickCount:1});await pause(50);
  cursor.x+=20;input('mouseMove',300,385,{button:'left',modifiers:['leftButtonDown']});await pause(120);
  assert.ok((await js('window.whalePetController.dragPhysicsInfo()')).anchorX!==null,'native movement reaches renderer: '+JSON.stringify(await js('({state:window.whalePetController.getState(),trace:window.dragTrace})')));
  const angles=[];
  // Native tracker keeps sampling even if renderer mouse events stop arriving.
  for(const direction of [1,-1,1])for(let i=0;i<18;i++){cursor.x+=direction*7*scale;await pause(16);angles.push((await js('window.whalePetController.dragPhysicsInfo()')).angle);}
  assert.ok(Math.max(...angles)>6,JSON.stringify({angles,state:await js('window.whalePetController.dragPhysicsInfo()')}));assert.ok(Math.min(...angles)<-6);
  assert.ok(angles.every(Number.isFinite));
  if(scale===1){
    for(const direction of [1,-1])for(let i=0;i<6;i++){
      cursor.x+=direction*30;await pause(16);
      const motion=await js('window.whalePetController.dragPhysicsInfo()');
      assert.equal(motion.angle,motion.internalAngle,'no visual angle compression');
    }
    assert.ok((await js('window.whalePetController.dragPhysicsInfo()')).excitement>.1,'native high-speed movement raises response tempo');
  }
  const stopped=[(await js('window.whalePetController.dragPhysicsInfo()')).angle];
  for(let i=0;i<6;i++){await pause(100);stopped.push((await js('window.whalePetController.dragPhysicsInfo()')).angle);}
  console.log('Stop-and-swing samples',scale,stopped);
  assert.ok(Math.max(...stopped)-Math.min(...stopped)>2,'keeps swinging after pointer stops');
  await pause(3800);const settled=(await js('window.whalePetController.dragPhysicsInfo()')).angle;assert.ok(Math.abs(settled)<.65,'damping '+settled);
  await js('cancelAnimationFrame(dragTiltRaf);dragTiltRaf=-1');
  for(const angle of [-180,-90,-60,-30,30,60,90,180]){
   const result=await js(`(()=>{stage.style.setProperty('--drag-angle','${angle}deg');const img=layers[visibleLayer],c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const g=c.getContext('2d');g.drawImage(img,0,0);const d=g.getImageData(0,0,c.width,c.height).data;const rad=${angle}*Math.PI/180;let outside=0;for(let y=0;y<c.height;y+=2)for(let x=0;x<c.width;x+=2){if(d[(y*c.width+x)*4+3]<24)continue;const px=img.offsetLeft+137.5+(x/c.width*275-137.5)*.86-138,py=img.offsetTop+275+(y/c.height*275-275)*.86-58;const xx=280+px*Math.cos(rad)-py*Math.sin(rad),yy=280+px*Math.sin(rad)+py*Math.cos(rad);if(xx<1||xx>559||yy<1||yy>559)outside++;}return {outside,wide:document.body.classList.contains('drag-room')};})()`);
   assert.equal(result.wide,true,'expanded drawing room');
   assert.equal(result.outside,0,'sprite stays inside window at '+angle);
   await pause(80);fs.writeFileSync(path.join(run,`limit-${scale}-${angle}.png`),(await pet.webContents.capturePage()).toPNG());
  }
  fs.writeFileSync(path.join(run,`drag-${scale}.png`),(await pet.webContents.capturePage()).toPNG());
  await js('window.qaPressed=false');
  input('mouseUp',280,280,{button:'left',clickCount:1});await pause(550);
  assert.equal((await js('window.whalePetController.dragPhysicsInfo()')).angle,0);
  assert.equal((await js('window.whalePetController.dragPhysicsInfo()')).active,false);
  assert.equal(await js("document.body.classList.contains('drag-room')"),true,'drawing surface stays stable after release');
  assert.ok(Math.abs(pet.getContentBounds().width-normalSize.width)<=2,'restored size '+JSON.stringify({before:normalSize,after:pet.getContentBounds()}));
  trials.push({scale,min:Math.min(...angles),max:Math.max(...angles),settled,stopped});
 }
 screen.getCursorScreenPoint=originalCursor;
 await settings.webContents.executeJavaScript('petSettings.save({scale:1})');await js("commitState({state:'idle',preview:true},true)");
 const pacing=await js(`new Promise(resolve=>{const times=[];let last;function sample(t){if(last)times.push(t-last);last=t;if(times.length<120)requestAnimationFrame(sample);else {times.sort((a,b)=>a-b);resolve({medianMs:times[60],p95Ms:times[114],maxMs:times[119]});}}requestAnimationFrame(sample);})`);
 fs.writeFileSync(path.join(run,'measurements.json'),JSON.stringify({maxAcceleration,trials,pacing},null,2));
 console.log('PASS: continuous breath; native unrestricted swing, damping, 75/100/150%, full-rotation drawing room, release restores size.',{maxAcceleration,trials,pacing},run);app.quit();
}).catch(e=>{console.error(e);app.exit(1);});setTimeout(()=>app.exit(1),65000).unref();
