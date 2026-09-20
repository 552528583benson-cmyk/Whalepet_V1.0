const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {app,BrowserWindow,nativeTheme}=require('electron');
const root=path.resolve(__dirname,'..'),run=fs.mkdtempSync(path.join(root,'work/idle-life-qa-'));
process.env.WHALEPET_RUNTIME_DIR=path.join(run,'runtime');
process.env.WHALEPET_QA_ALLOW_SECOND_INSTANCE='1';process.env.WHALEPET_QA_HIDDEN='1';process.env.WHALEPET_DISABLE_AUTO_FOLLOW='1';
process.env.WHALEPET_BRIDGE_PORT=String(46000+process.pid%1000);
app.setPath('userData',path.join(run,'electron'));app.setAppPath(root);require('../main');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 await pause(2000);const win=BrowserWindow.getAllWindows()[0],js=s=>win.webContents.executeJavaScript(s);
 assert.equal(await js('window.whalePetController.idleLife.ready'),true);
 await js("window.whalePetController.setState({state:'idle',preview:true})");
 win.showInactive();await pause(1300);
 assert.equal((await js('window.whalePetController.idleLife.info()')).running,true);
 await js("commitState({state:'idle',provider:'chatgpt'},true)");await pause(100);
 assert.equal(await js("document.querySelector('#pet').classList.contains('has-idle-life')"),true,'forced idle restart keeps original layer hidden');
 const result=await js(`(async()=>{
  const life=window.whalePetController.idleLife;
  const states=[life.inspectFrame(0,0),life.inspectFrame(1,0),life.inspectFrame(0,1),life.inspectFrame(0,-1)];
  const images=await Promise.all(states.map(async src=>{const i=new Image();i.src=src;await i.decode();return i;}));
  const c=document.createElement('canvas');c.width=c.height=1280;const g=c.getContext('2d');
  const pixels=images.map(i=>{g.clearRect(0,0,1280,1280);g.drawImage(i,0,0);return g.getImageData(0,0,1280,1280).data;});
  const changed=[];for(let n=1;n<4;n++){let total=0,outside=0;for(let y=0;y<1280;y++)for(let x=0;x<1280;x++){const p=(y*1280+x)*4;if(![0,1,2,3].some(k=>Math.abs(pixels[n][p+k]-pixels[0][p+k])>1))continue;total++;const allowed=n===1?((x>=478&&x<=594||x>=639&&x<=756)&&y>=607&&y<=705):(x>=824&&x<=1020&&y>=889&&y<=1090);if(!allowed)outside++;}changed.push({total,outside});}
  const sheets={};for(const [name,bg]of [['black','#080808'],['navy','#102045'],['gray','#888'],['checker',null]]){const s=document.createElement('canvas');s.width=1280;s.height=380;const sg=s.getContext('2d');if(bg){sg.fillStyle=bg;sg.fillRect(0,0,1280,380);}else for(let y=0;y<380;y+=16)for(let x=0;x<1280;x+=16){sg.fillStyle=(x/16+y/16)%2?'#ddd':'#fff';sg.fillRect(x,y,16,16);}images.forEach((i,n)=>{sg.drawImage(i,n*320,0,320,320);sg.fillStyle=bg?'white':'#142445';sg.font='18px sans-serif';sg.fillText(['Original','Blink','Tail +','Tail -'][n],n*320+100,350);});sheets[name]=s.toDataURL();}
  const face=document.createElement('canvas');face.width=900;face.height=400;const fg=face.getContext('2d');fg.fillStyle='#102045';fg.fillRect(0,0,900,400);images.slice(0,2).forEach((i,n)=>fg.drawImage(i,420,560,400,220,n*450,30,440,242));sheets.face=face.toDataURL();
  return {changed,sheets};})()`);
 for(const check of result.changed){assert.ok(check.total>500,JSON.stringify(check));assert.equal(check.outside,0,'Must not change headband/body/legs');}
 for(const [name,url]of Object.entries(result.sheets))fs.writeFileSync(path.join(run,name+'.png'),Buffer.from(url.split(',')[1],'base64'));
 const movie=await js(`new Promise(resolve=>{const c=document.createElement('canvas');c.width=450;c.height=450;const g=c.getContext('2d'),source=document.querySelector('.idle-life');const stream=c.captureStream(24);const r=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9'}),chunks=[];r.ondataavailable=e=>chunks.push(e.data);r.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());const b=new Uint8Array(await new Blob(chunks).arrayBuffer());let s='';for(const x of b)s+=String.fromCharCode(x);resolve(btoa(s));};const timer=setInterval(()=>{g.fillStyle='#102045';g.fillRect(0,0,450,450);g.drawImage(source,0,0,450,450);},1000/24);r.start();setTimeout(()=>{clearInterval(timer);r.stop();},6500);})`);
 fs.writeFileSync(path.join(run,'idle-life.webm'),Buffer.from(movie,'base64'));
 assert.ok((await js('window.whalePetController.idleLife.info()')).blinks>=1);
 await js('window.whalePetController.previewDrag(500)');await pause(80);
 assert.equal((await js('window.whalePetController.idleLife.info()')).running,false);
 await pause(850);assert.equal((await js('window.whalePetController.idleLife.info()')).running,true);
 await js("window.whalePetController.setState({state:'working',preview:true})");await pause(80);
 assert.equal((await js('window.whalePetController.idleLife.info()')).running,false);
 await pause(1000);await js("window.whalePetController.setState({state:'idle',preview:true})");await pause(1200);
 await js('applyPreferences({...userPreferences,idleLife:false})');await pause(100);
 assert.equal((await js('window.whalePetController.idleLife.info()')).running,false);
 await js('applyPreferences({...userPreferences,idleLife:true})');await pause(100);
 assert.equal((await js('window.whalePetController.idleLife.info()')).running,true);
 await js("applyPreferences({...userPreferences,images:{'idle.webp':asset('working.webp')}})");await pause(200);
 assert.equal((await js('window.whalePetController.idleLife.info()')).running,false);
 await js('applyPreferences({...userPreferences,images:{}})');await pause(200);
 win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await pause(150);
 assert.equal((await js('window.whalePetController.idleLife.info()')).running,false);
 await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});await pause(200);
 assert.equal((await js('window.whalePetController.idleLife.info()')).running,true);
 const before=await js('window.whalePetController.idleLife.info()');await js("document.querySelector('.idle-life-source').getContext('webgl').getExtension('WEBGL_lose_context').loseContext()");await pause(200);
 assert.equal((await js('window.whalePetController.idleLife.info()')).failed,true);
 assert.equal(await js("getComputedStyle(document.querySelector('.character-layer.is-visible')).visibility"),'visible');
 console.log('PASS: localized pixels, automatic blink, drag, state change, preference, custom image, reduced motion, GPU fallback.',JSON.stringify(result.changed),before,'QA:',run);app.quit();
}).catch(e=>{console.error(e);app.exit(1);});setTimeout(()=>app.exit(1),60000).unref();
