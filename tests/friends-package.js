const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {app,BrowserWindow}=require('electron');
const target=path.resolve(process.env.WHALEPET_PACKAGE_APP||'missing');
assert.ok(fs.existsSync(path.join(target,'main.js')),'explicit installed package path required');
const run=fs.mkdtempSync(path.join(__dirname,'../work/friends-smoke-'));
Object.assign(process.env,{WHALEPET_RUNTIME_DIR:path.join(run,'runtime'),WHALEPET_QA_ALLOW_SECOND_INSTANCE:'1',WHALEPET_QA_HIDDEN:'1',WHALEPET_QA_SETTINGS:'1',WHALEPET_DISABLE_AUTO_FOLLOW:'1',WHALEPET_BRIDGE_PORT:String(46000+process.pid%1000)});
app.setPath('userData',path.join(run,'electron'));app.setAppPath(target);require(path.join(target,'main.js'));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 await pause(2000);
 const pet=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('index.html'));
 const settings=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('settings.html'));
 assert.ok(pet&&settings);const js=s=>pet.webContents.executeJavaScript(s);
 for(const state of ['idle','connecting','thinking','reading','searching','tool_use','working','testing','generating','needs_input','ready','blocked']){
  await js(`commitState({state:'${state}',preview:true},true)`);await pause(180);
  const info=await js('({state:activeState,width:layers[visibleLayer].naturalWidth,src:layers[visibleLayer].src,layers:window.whalePetController.layerInfo().visibleLayers})');
  assert.equal(info.state,state);assert.equal(info.width,1280);assert.equal(info.layers,1);assert.match(info.src,/whalepet-hd/);
 }
 await js("commitState({state:'idle',preview:true},true)");await pause(300);
 assert.equal(await js('window.whalePetController.idleLife.info().failed'),false);
 await js('window.whalePetController.previewDrag(700)');await pause(220);
 assert.equal(await js('layers[visibleLayer].naturalWidth'),1254);
 await pause(700);assert.equal(await js('dragVisualActive'),false);
 const saved=await settings.webContents.executeJavaScript('petSettings.save({scale:.75})');assert.equal(saved.ok,true);
 await pause(150);assert.equal(pet.webContents.getZoomFactor(),.75);
 assert.equal(await js('window.whalePetController.hitTest(10,10)'),false);
 console.log('Packaged installation PASS: 12 HD poses, tail drag/release, idle-life, settings and 75% scaling.');app.quit();
}).catch(e=>{console.error(e);app.exit(1)});
setTimeout(()=>app.exit(1),30000).unref();
