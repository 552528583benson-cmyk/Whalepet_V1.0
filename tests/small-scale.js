const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {app,BrowserWindow}=require('electron');
const root=path.resolve(__dirname,'..'),run=fs.mkdtempSync(path.join(root,'work/small-scale-qa-'));
process.env.WHALEPET_RUNTIME_DIR=path.join(run,'runtime');process.env.WHALEPET_QA_ALLOW_SECOND_INSTANCE='1';
process.env.WHALEPET_QA_HIDDEN='1';process.env.WHALEPET_QA_SETTINGS='1';process.env.WHALEPET_DISABLE_AUTO_FOLLOW='1';process.env.WHALEPET_QA_BACKGROUND='#102045';
process.env.WHALEPET_BRIDGE_PORT=String(47000+process.pid%1000);
app.setPath('userData',path.join(run,'electron'));app.setAppPath(root);require('../main');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 await pause(2000);const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('index.html')),settings=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('settings.html')),js=s=>win.webContents.executeJavaScript(s),reports=[];
 settings.hide();
 win.showInactive();
 for(const scale of [.65,.75,.85,.9,1,1.5]){
  await settings.webContents.executeJavaScript(`petSettings.save({scale:${scale}})`);
  await js(`commitState({state:'idle',provider:'chatgpt'},true)`);await pause(300);
  const area=await js(`(()=>{const r=document.querySelector('.idle-life').getBoundingClientRect();return{x:r.x+320/1280*r.width,y:r.y+220/1280*r.height,w:640/1280*r.width,h:370/1280*r.height,inner:innerWidth,dpr:devicePixelRatio};})()`);
  let previous=null,total=0,maximum=0;const transforms=[];
  for(let n=0;n<10;n++){
   await pause(80);transforms.push(await js("getComputedStyle(document.querySelector('.stage')).transform"));
   const shot=await win.webContents.capturePage(),ratio=shot.getSize().width/area.inner;
   const crop=shot.crop({x:Math.round(area.x*ratio),y:Math.round(area.y*ratio),width:Math.round(area.w*ratio),height:Math.round(area.h*ratio)}),pixels=crop.toBitmap();
   if(n===0)fs.writeFileSync(path.join(run,`scale-${scale}.png`),shot.toPNG());
   if(previous){let changed=0;for(let p=0;p<pixels.length;p+=4)if([0,1,2].some(k=>Math.abs(pixels[p+k]-previous[p+k])>12))changed++;total+=changed;maximum=Math.max(maximum,changed);}previous=pixels;
  }
  const report={scale,dpr:area.dpr,headChangedPixels:total,maxChangedPerFrame:maximum,uniqueTransforms:new Set(transforms).size,life:await js('window.whalePetController.idleLife.info()')};reports.push(report);console.log(report);
  if(!process.env.WHALEPET_MEASURE_BASELINE&&scale<.9){assert.equal(report.uniqueTransforms,1);assert.equal(transforms[0],'none');assert.equal(total,0,'Head pixels must not shimmer between blinks');}
 }
 if(!process.env.WHALEPET_MEASURE_BASELINE){
  await js('applyPreferences({...userPreferences,scale:.75})');
  for(const state of ['connecting','thinking','reading','searching','tool_use','working','testing','generating','needs_input','ready','blocked']){
   await js(`commitState({state:'${state}',preview:true},true)`);await pause(1100);
   assert.equal(await js("getComputedStyle(document.querySelector('.stage')).animationName"),'none',state+' compact stable stage');
   assert.equal(await js('window.whalePetController.layerInfo().visibleLayers'),1);
  }
  await js('window.whalePetController.previewDrag(600)');await pause(100);
  assert.equal(await js("getComputedStyle(document.querySelector('.stage')).animationName"),'none');
  assert.match(await js('window.whalePetController.getState().frame'),/tail-hang/);
  await pause(700);
 }
 fs.writeFileSync(path.join(run,'metrics.json'),JSON.stringify(reports,null,2));console.log('Small scale QA:',run);app.quit();
}).catch(e=>{console.error(e);app.exit(1);});setTimeout(()=>app.exit(1),70000).unref();
