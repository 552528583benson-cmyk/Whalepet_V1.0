// Visual QA: decode the actual recorded runtime dance, not re-rendered poses.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const source=path.resolve(process.argv[2]);
app.whenReady().then(async()=>{
  const w=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,sandbox:true}});
  await w.loadFile(path.join(__dirname,'dance-qa.html'));
  await w.webContents.executeJavaScript(`document.querySelector('video').src=${JSON.stringify(pathToFileURL(source).href)}`);
  const png=await w.webContents.executeJavaScript(`(async()=>{
    const v=document.querySelector('video');if(v.readyState<2)await new Promise(r=>v.addEventListener('loadeddata',r,{once:true}));v.pause();
    const c=document.createElement('canvas');c.width=1440;c.height=720;const g=c.getContext('2d');
    for(let n=0;n<6;n++){v.currentTime=.25+n*.4;await new Promise(r=>v.addEventListener('seeked',r,{once:true}));g.drawImage(v,n%3*480,Math.floor(n/3)*360,480,360);g.fillStyle='white';g.font='16px sans-serif';g.fillText(v.currentTime.toFixed(2)+' s',n%3*480+12,Math.floor(n/3)*360+24);}
    return c.toDataURL();})()`);
  const dest=path.join(path.dirname(source),'dance-filmstrip.png');fs.writeFileSync(dest,Buffer.from(png.split(',')[1],'base64'));console.log(dest);app.quit();
}).catch(e=>{console.error(e);app.exit(1);});
