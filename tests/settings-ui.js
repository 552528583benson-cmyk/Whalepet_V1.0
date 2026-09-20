const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const dgram=require('node:dgram');
const {app,BrowserWindow,dialog}=require('electron');
const root=path.resolve(__dirname,'..');
const run=fs.mkdtempSync(path.join(root,'work/settings-test-'));
const shots=path.join(root,'work/settings-qa');fs.mkdirSync(shots,{recursive:true});
process.env.WHALEPET_RUNTIME_DIR=path.join(run,'runtime');
process.env.WHALEPET_QA_ALLOW_SECOND_INSTANCE='1';
process.env.WHALEPET_QA_HIDDEN='1';
process.env.WHALEPET_QA_SETTINGS='1';
process.env.WHALEPET_DISABLE_AUTO_FOLLOW='1';
process.env.WHALEPET_BRIDGE_PORT=String(49000+process.pid%1000);
app.setPath('userData',path.join(run,'electron'));
app.setAppPath(root);
const {writePreferences,readPreferences,normalizePreferences}=require('../preferences');
writePreferences(path.join(run,'runtime/preferences.json'),{scale:.85});
assert.equal(normalizePreferences({scale:30}).scale,1.5);
assert.equal(normalizePreferences({scale:-3}).scale,.65);
assert.deepEqual(normalizePreferences({images:{idle:'../../secret.png'}}).images,{});
require('../main');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function eventually(fn){let last;for(let i=0;i<50;i++){try{return await fn();}catch(e){last=e;await pause(150);}}throw last;}
app.whenReady().then(async()=>{
  const settings=await eventually(async()=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('settings.html'));assert.ok(w);assert.equal(await w.webContents.executeJavaScript('Boolean(document.querySelector("#poseGrid")?.children.length)'),true);return w;});
  const pet=BrowserWindow.getAllWindows().find(w=>w!==settings);
  const invoke=expression=>settings.webContents.executeJavaScript(expression);
  const good=async expression=>{const result=await invoke(expression);assert.equal(result.ok,true,result.error);return result.value;};
  if(process.env.WHALEPET_PROVIDER_LOCK==='deepseek'){
    assert.equal((await good('petSettings.get()')).providerLocked,true);
    await good('petSettings.save({provider:"custom",autoFollowCodex:true})');
    assert.equal((await good('petSettings.get()')).provider,'deepseek');
    assert.equal(await invoke('document.querySelector("[data-tab=connections]").hidden'),true);
    console.log('Harness separation passed: provider stays DeepSeek, AI switch UI hidden.');app.quit();return;
  }
  // The settings renderer can finish before the pet's did-finish-load handler.
  await eventually(async()=>assert.equal(pet.webContents.getZoomFactor(),.85,'saved scale loaded at startup'));
  await good('petSettings.save({scale:1})');
  await invoke('petSettings.get().then(r=>{snapshot=r.value;render();})');
  await pause(350);
  for(const tab of ['appearance','poses','connections']){
    await invoke(`tab('${tab}')`);await pause(500);
    assert.equal(await invoke('document.documentElement.scrollWidth<=innerWidth'),true,'no horizontal overflow');
    fs.writeFileSync(path.join(shots,tab+'.png'),(await settings.webContents.capturePage()).toPNG());
  }
  await invoke("tab('connections'); document.querySelector('#integrationGuide').open=true");
  await pause(500);
  fs.writeFileSync(path.join(shots,'connections-guide.png'),(await settings.webContents.capturePage()).toPNG());
  settings.setSize(740,580);await invoke("tab('appearance')");await pause(500);
  assert.equal(await invoke('document.documentElement.scrollWidth<=innerWidth'),true,'compact layout has no horizontal overflow');
  fs.writeFileSync(path.join(shots,'compact.png'),(await settings.webContents.capturePage()).toPNG());
  settings.setSize(940,740);
  await good('petSettings.save({scale:1.5,showBadge:false,showSpeech:false,idleLife:false})');
  assert.equal(readPreferences(path.join(run,'runtime/preferences.json')).idleLife,false,'micro-motion preference persisted');
  await invoke('petSettings.get().then(r=>{snapshot=r.value;render();})');
  assert.equal(await invoke('document.querySelector("#idleLife").checked'),false);
  await pause(1600);
  assert.equal(pet.webContents.getZoomFactor(),1.5);
  assert.equal(settings.webContents.getZoomFactor(),1,'pet scaling does not scale its controls');
  assert.ok(Math.abs(pet.getContentBounds().width-840)<=4,'stable canvas preserves large size');
  assert.ok(Math.abs(await pet.webContents.executeJavaScript('document.querySelector("#pet").getBoundingClientRect().width')-300)<.01,'character CSS size unchanged');
  assert.equal(await pet.webContents.executeJavaScript('document.body.classList.contains("hide-badge")'),true);
  await good('petSettings.save({scale:.65})');await pause(1100);
  assert.ok(Math.abs(pet.getContentBounds().width-364)<=4,'small drawing surface');
  await good('petSettings.save({provider:"custom",customLabel:"Claude",scale:1})');
  const packet=Buffer.from(JSON.stringify({type:'whalepet-state',provider:'custom',state:'testing',message:'integration test'}));
  await new Promise(resolve=>{const socket=dgram.createSocket('udp4');socket.send(packet,Number(process.env.WHALEPET_BRIDGE_PORT),'127.0.0.1',()=>{socket.close();resolve();});});
  await eventually(async()=>assert.equal(await pet.webContents.executeJavaScript('window.whalePetController.getState().state'),'testing'));
  assert.equal((await good('petSettings.get()')).provider,'custom');
  assert.ok((await good('petSettings.get()')).lastReceivedAt);
  assert.match(await pet.webContents.executeJavaScript('document.querySelector("#stateBadge").textContent'),/Claude/);
  await good('petSettings.preview("tool_use")');
  await eventually(async()=>assert.equal(await pet.webContents.executeJavaScript('window.whalePetController.getState().state'),'tool_use'));
  pet.webContents.send('pet:state',{provider:'custom',state:'working',message:'busy during preview'});
  await pause(700);
  assert.equal(await pet.webContents.executeJavaScript('window.whalePetController.getState().state'),'tool_use','live events do not interrupt a user preview');
  await eventually(async()=>assert.equal(await pet.webContents.executeJavaScript('window.whalePetController.getState().state'),'working'));
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path.join(root,'assets/whalepet-hd/tool-use.png')]});
  const imported=await good('petSettings.importImage("idle")');
  assert.equal(imported.snapshot.poses[0].custom,true);
  const file=imported.snapshot.preferences.images.idle;
  assert.ok(fs.existsSync(path.join(run,'runtime/custom-images',file)));
  await eventually(async()=>assert.equal(await pet.webContents.executeJavaScript('document.querySelector(".character-layer.is-visible").src.startsWith("data:image/png")'),true));
  await good('petSettings.resetImage("idle")');
  await eventually(async()=>assert.equal(await pet.webContents.executeJavaScript('document.querySelector(".character-layer.is-visible").src.includes("/idle.png")'),true));
  // Fully transparent and invalid files must not replace a working sprite.
  const {nativeImage}=require('electron');
  const empty=path.join(run,'empty.png');fs.writeFileSync(empty,nativeImage.createFromBitmap(Buffer.alloc(16*16*4),{width:16,height:16}).toPNG());
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[empty]});
  assert.equal((await invoke('petSettings.importImage("idle")')).ok,false);
  dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});
  assert.equal((await good('petSettings.importImage("idle")')).cancelled,true);
  dialog.showMessageBox=async()=>({response:0});
  assert.equal(await good('petSettings.reset()'),null);
  dialog.showMessageBox=async()=>({response:1});
  await good('petSettings.reset()');
  const saved=readPreferences(path.join(run,'runtime/preferences.json'));
  assert.equal(saved.scale,1);assert.equal(saved.showBadge,true);assert.equal(saved.idleLife,true);assert.deepEqual(saved.images,{});assert.equal(saved.customLabel,'Claude');
  assert.equal((await good('petSettings.get()')).provider,'custom','appearance reset leaves connection alone');
  assert.equal(await pet.webContents.executeJavaScript('window.whalePet.requestPreferences().then(()=>true)'),true);
  // Settings-only mutations are rejected if another renderer attempts them.
  // Sender enforcement is exercised via the pet preload: it exposes no settings API.
  assert.equal(await pet.webContents.executeJavaScript('typeof window.petSettings'),'undefined');
  console.log('Settings integration passed: persisted scale, guard bounds, toggles, custom UDP AI, import, preview, restore, invalid image, cancellation and reset.');
  console.log('Screenshots: '+shots);
  app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
setTimeout(()=>app.exit(1),90000).unref();
