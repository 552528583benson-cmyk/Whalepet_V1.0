const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {app,BrowserWindow}=require('electron');
const target=path.resolve(process.env.WHALEPET_PACKAGE_APP||'missing');
assert.ok(fs.existsSync(path.join(target,'main.js')),'explicit installed package path required');
for(const file of ['buddy-motion.js','buddy-renderer.js','buddy-policy.js','user-activity.js','native/user-activity.ps1','assets/whalepet-buddy/typing-v1.png','assets/whalepet-buddy/gaming-v1.png','assets/whalepet-buddy/PROMPTS.md','assets/whalepet-v015/WhalePet.ico','recovery-window.js','recovery-preload.js','recovery.html','recovery.js','recovery.css']){
 assert.ok(fs.existsSync(path.join(target,file)),`companion/recovery runtime file required: ${file}`);
}
assert.equal(fs.existsSync(path.join(target,'preferences.json')),false,'no personal preferences shipped');
assert.equal(fs.existsSync(path.join(target,'runtime')),false,'no personal runtime directory shipped');
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
 const initial=await settings.webContents.executeJavaScript('petSettings.get()');
 assert.equal(initial.value.preferences.idleSongEnabled,false);assert.equal(initial.value.idleSong.available,false,'no personal song shipped');
 assert.equal(initial.value.preferences.typingCompanion,false,'typing detection is opt-in');
 assert.equal(initial.value.preferences.gameCompanion,false,'game detection is opt-in');
 assert.deepEqual(initial.value.preferences.games,[],'no personal game process names shipped');
 assert.equal(initial.value.companion.buddy.monitor.state,'stopped','native monitoring does not start by default');
 assert.equal(await js('window.whaleBuddy.ready'),true,'companion renderer loads both packaged sprites');
 for(const mode of ['typing','gaming']){
  const dimensions=await js(`(async()=>{const image=new Image();image.src='assets/whalepet-buddy/${mode}-v1.png';await image.decode();return {width:image.naturalWidth,height:image.naturalHeight};})()`);
  assert.ok(dimensions.width>=1024,'companion source is high resolution');assert.equal(dimensions.width,dimensions.height,'companion source is square');
 }
 assert.equal(await js(`(async()=>{const image=new Image();image.src='assets/whalepet-music/dancing-v1.png';await image.decode();return image.naturalWidth;})()`),1254);
 const adjusted=await settings.webContents.executeJavaScript('petSettings.save({bubbleScale:.9,bubbleOffset:12,scale:.83})');assert.equal(adjusted.ok,true);
 await pause(100);assert.equal(await js('document.documentElement.style.getPropertyValue("--bubble-scale")'),'.9'.replace(/^\./,'0.'));
 assert.equal(await settings.webContents.executeJavaScript('typeof petSettings.reloadCodex'),'function');
 console.log('Packaged installation PASS: 12 HD poses, tail drag/release, idle-life, precise scaling/bubbles, music CG, companion sprites/helper, recovery files, opt-in monitoring, default silence and reload API.');app.quit();
}).catch(e=>{console.error(e);app.exit(1)});
setTimeout(()=>app.exit(1),30000).unref();
