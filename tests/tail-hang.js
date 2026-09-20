const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {app, BrowserWindow, ipcMain, screen} = require('electron');
const root = path.resolve(__dirname, '..');
const run = fs.mkdtempSync(path.join(root, 'work/tail-hang-qa-'));
process.env.WHALEPET_RUNTIME_DIR = path.join(run, 'runtime');
process.env.WHALEPET_QA_ALLOW_SECOND_INSTANCE = '1';
process.env.WHALEPET_QA_HIDDEN = '1';
process.env.WHALEPET_QA_FORCE_INTERACTIVE = '1';
process.env.WHALEPET_DISABLE_AUTO_FOLLOW = '1';
process.env.WHALEPET_QA_SETTINGS = '1';
process.env.WHALEPET_BRIDGE_PORT = String(46000 + process.pid % 1000);
app.setPath('userData', path.join(run, 'electron'));
app.setAppPath(root);
require('../main');
const pause = ms => new Promise(r => setTimeout(r, ms));
app.whenReady().then(async () => {
  await pause(2000);
  const pet = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html'));
  const settings = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('settings.html'));
  const js = code => pet.webContents.executeJavaScript(code);
  const data = await js(`(async()=>{
    const img = new Image(); img.src='assets/generated-transitions/tail-hang/pose.png'; await img.decode();
    const c=document.createElement('canvas');c.width=img.width;c.height=img.height;
    const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
    const d=ctx.getImageData(0,0,c.width,c.height).data;
    let clear=0,solid=0,minX=c.width,minY=c.height,maxX=0,maxY=0;
    for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
      const a=d[(y*c.width+x)*4+3];if(a===0)clear++;if(a>240){solid++;minX=Math.min(x,minX);maxX=Math.max(x,maxX);minY=Math.min(y,minY);maxY=Math.max(y,maxY);}
    }
    const out=document.createElement('canvas');out.width=1100;out.height=600;const g=out.getContext('2d');
    ['#080808','#102045','#888888','checker'].forEach((bg,i)=>{
      if(bg==='checker'){for(let y=0;y<600;y+=16)for(let x=0;x<275;x+=16){g.fillStyle=((x/16+y/16)%2)?'#ddd':'#fff';g.fillRect(i*275+x,y,16,16);}}
      else {g.fillStyle=bg;g.fillRect(i*275,0,275,600);}
      g.drawImage(img,i*275,25,275,275);
      g.drawImage(img,img.width*.28,img.height*.65,img.width*.46,img.height*.31,i*275,320,275,220);
    });
    return {width:c.width,height:c.height,clear,solid,bounds:[minX,minY,maxX,maxY],corners:[d[3],d[(c.width-1)*4+3],d[d.length-1]],qa:out.toDataURL()};
  })()`);
  fs.writeFileSync(path.join(run,'four-backgrounds.png'), Buffer.from(data.qa.split(',')[1],'base64'));delete data.qa;
  assert.ok(data.clear > data.width*data.height*.4, 'background must be actual alpha');
  assert.deepEqual(data.corners,[0,0,0]);
  assert.ok(data.bounds[1] > 10 && data.bounds[3] < data.height-10,'complete sprite has margins');
  console.log('Alpha',JSON.stringify(data));
  assert.ok(Math.abs((data.bounds[3]-data.bounds[1]+1)/data.height*275*.86-220)<8,'inverted sprite must retain idle height');
  const cursorBefore = screen.getCursorScreenPoint;
  const area=screen.getPrimaryDisplay().workArea;
  let cursor={x:area.x+Math.round(area.width/2),y:area.y+Math.round(area.height/3)};
  screen.getCursorScreenPoint=()=>cursor;
  for(const scale of [.65,1,1.5]){
    const save=await settings.webContents.executeJavaScript(`petSettings.save({scale:${scale}})`);
    assert.equal(save.ok,true);await pause(120);
    const originalSize=pet.getContentBounds();
    ipcMain.emit('pet:drag-start',{}, {tailAnchor:{x:150,y:110}});
    await pause(80);
    const c=pet.getContentBounds();
    assert.ok(Math.abs(c.x+280*scale-cursor.x)<=2,'tail x pinned to pointer');
    assert.ok(Math.abs(c.y+280*scale-cursor.y)<=2,'tail y pinned to pointer');
    const dimensions=pet.getBounds();
    for(let i=0;i<20;i++){cursor={x:cursor.x+(i%2?10:-10),y:cursor.y+(i%2?6:-6)};ipcMain.emit('pet:drag-move',{});}
    ipcMain.emit('pet:drag-end',{},{});
    assert.ok(Math.abs(pet.getContentBounds().width-originalSize.width)<=2);
    assert.ok(Math.abs(pet.getContentBounds().height-originalSize.height)<=2);
    console.log('Anchor and drag bounds passed at scale',scale);
  }
  screen.getCursorScreenPoint=cursorBefore;
  const normalAgain=pet.getContentBounds();
  screen.getCursorScreenPoint=()=>cursor;
  for(let i=0;i<20;i++){
    ipcMain.emit('pet:drag-start',{}, {tailAnchor:{x:150,y:110}});
    ipcMain.emit('pet:drag-end',{},{});
  }
  assert.ok(Math.abs(pet.getContentBounds().width-normalAgain.width)<=2,'20 drags must not inflate window width');
  assert.ok(Math.abs(pet.getContentBounds().height-normalAgain.height)<=2,'20 drags must not inflate window height');
  screen.getCursorScreenPoint=cursorBefore;
  await settings.webContents.executeJavaScript('petSettings.save({scale:1})');
  await js("window.whalePetController.setState({state:'thinking',preview:true})");await pause(1100);
  await js('window.whalePetController.previewDrag(4000)');await pause(300);
  assert.match((await js('window.whalePetController.getState()')).frame,/tail-hang\/pose.png/);
  assert.equal(await js("getComputedStyle(document.querySelector('.thought-effect')).display"),'none');
  // A hidden Windows surface can return a cached pre-drag bitmap. Force a
  // compositor paint so the visual check actually shows the asserted pose.
  pet.showInactive();await pause(300);
  fs.writeFileSync(path.join(run,'runtime-drag.png'),(await pet.webContents.capturePage()).toPNG());
  pet.hide();
  await pause(2100);
  assert.match((await js('window.whalePetController.getState()')).frame,/tail-hang\/pose.png/,'must not return to old blink art');
  assert.equal((await js('window.whalePetController.layerInfo()')).visibleLayers,1);
  await pause(2200);
  assert.doesNotMatch((await js('window.whalePetController.getState()')).frame,/tail-hang/,'release returns to state pose');
  screen.getCursorScreenPoint=()=>cursor;
  pet.showInactive();
  pet.focus();
  // Chromium synthetic presses do not hold the real OS mouse button. Native
  // window movement can emit unrelated hover/capture-loss events with buttons=0.
  await js("for(const type of ['pointermove','lostpointercapture'])document.addEventListener(type,e=>{if(window.qaPressed&&e.buttons===0)e.stopImmediatePropagation();},true)");
  for(let i=0;i<3;i++){
    assert.equal(await js('window.whalePetController.hitTest(280,385)'),true);
    pet.webContents.sendInputEvent({type:'mouseMove',x:280,y:385,globalX:cursor.x,globalY:cursor.y});await pause(100);
    await js('window.qaPressed=true');
    pet.webContents.sendInputEvent({type:'mouseDown',x:280,y:385,globalX:cursor.x,globalY:cursor.y,button:'left',clickCount:1});
    await pause(100);
    cursor={x:cursor.x+20,y:cursor.y};
    pet.webContents.sendInputEvent({type:'mouseMove',x:300,y:385,globalX:cursor.x,globalY:cursor.y,button:'left',modifiers:['leftButtonDown']});
    await pause(200);
    console.log('Pointer drag/release cycle',i+1);
    assert.match((await js('window.whalePetController.getState()')).frame,/tail-hang\/pose.png/,'pointer drag starts inverted pose');
    await js('window.qaPressed=false');
    pet.webContents.sendInputEvent({type:'mouseUp',x:280,y:280,globalX:cursor.x,globalY:cursor.y,button:'left',clickCount:1});
    await pause(550);
    assert.equal(await js("document.querySelector('#pet').classList.contains('is-dragging')"),false,'pointer release clears dragging');
    assert.doesNotMatch((await js('window.whalePetController.getState()')).frame,/tail-hang/);
  }
  pet.hide();screen.getCursorScreenPoint=cursorBefore;
  // Regression: cancelling a state transition must not restore its old pose
  // through animation.finished.catch while a drag is active.
  await js("window.whalePetController.setState({state:'reading',preview:true});window.whalePetController.previewDrag(900)");
  await pause(200);
  assert.match((await js('window.whalePetController.getState()')).frame,/tail-hang\/pose.png/);
  await pause(900);
  await pet.webContents.debugger.attach('1.3');
  await pet.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await js('window.whalePetController.previewDrag(500)');await pause(100);
  assert.equal(await js("getComputedStyle(document.querySelector('.stage')).animationName"),'none');
  await pause(700);pet.webContents.debugger.detach();
  console.log('Tail hang renderer, alpha, release, reduced motion passed. QA:',run);
  app.quit();
}).catch(e=>{console.error(e);app.exit(1);});
setTimeout(()=>app.exit(1),60000).unref();
