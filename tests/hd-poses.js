const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {app,BrowserWindow}=require('electron');
const root=path.resolve(__dirname,'..'),run=fs.mkdtempSync(path.join(root,'work/hd-runtime-'));
process.env.WHALEPET_RUNTIME_DIR=path.join(run,'runtime');
process.env.WHALEPET_QA_ALLOW_SECOND_INSTANCE='1';process.env.WHALEPET_QA_HIDDEN='1';process.env.WHALEPET_DISABLE_AUTO_FOLLOW='1';
process.env.WHALEPET_BRIDGE_PORT=String(45000+process.pid%1000);
app.setPath('userData',path.join(run,'electron'));app.setAppPath(root);require('../main');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 await pause(1800);const win=BrowserWindow.getAllWindows()[0],js=s=>win.webContents.executeJavaScript(s);
 const names=['idle','connecting','thinking','reading','searching','tool-use','working','testing','generating','needs-input','ready','blocked'];
 for(const name of names){
  await js(`window.whalePetController.setState({state:${JSON.stringify(name.replaceAll('-','_'))},preview:true})`);await pause(1150);
  const value=await js(`(()=>{const i=document.querySelector('.character-layer.is-visible'),c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;const g=c.getContext('2d');g.drawImage(i,0,0);const d=g.getImageData(0,0,c.width,c.height).data;let clear=0,bottom=0;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const a=d[(y*c.width+x)*4+3];if(a===0)clear++;if(a>24)bottom=Math.max(bottom,y);}return {src:i.src,width:i.naturalWidth,height:i.naturalHeight,clear,bottom,layers:window.whalePetController.layerInfo().visibleLayers};})()`);
  assert.ok(value.src.includes('/whalepet-hd/'+name+'.png'),value.src);assert.equal(value.width,1280);assert.equal(value.height,1280);assert.equal(value.layers,1);assert.ok(value.clear>1280*1280*.4);assert.ok(Math.abs(value.bottom-1246)<=2,'baseline');
  console.log('HD renderer:',name,'1280px, alpha, baseline, single layer passed');
  if(['idle','reading','ready'].includes(name)){
   win.showInactive();await pause(100);fs.writeFileSync(path.join(run,name+'.png'),(await win.webContents.capturePage()).toPNG());win.hide();
  }
 }
 await js('window.whalePetController.previewDrag(600)');await pause(200);
 assert.ok((await js('window.whalePetController.getState()')).frame.includes('tail-hang'));
 await pause(700);assert.equal(await js("document.querySelector('.character-layer.is-visible').naturalWidth"),1280);
 console.log('HD-to-tail-hang-to-HD passed; captures:',run);app.quit();
}).catch(e=>{console.error(e);app.exit(1);});setTimeout(()=>app.exit(1),60000).unref();
