const { BrowserWindow, ipcMain, dialog, nativeImage, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { POSES } = require('./preferences');

// Import raster bytes only: never execute user scripts or load remote image URLs.
function normalizeSprite(bytes) {
  let image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) throw new Error('无法读取这张图片，请选择有效的 PNG 或 WebP。');
  const {width,height}=image.getSize();
  if (width>4096 || height>4096) throw new Error('图片过大，请先缩小到 4096 × 4096 以内。');
  const pixels=image.toBitmap();
  let left=width,top=height,right=-1,bottom=-1, transparent=0;
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const alpha=pixels[(y*width+x)*4+3];
    if(alpha<250) transparent++;
    if(alpha>10){ left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y); }
  }
  if(right<0) throw new Error('这张图片完全透明，没有可显示的角色。');
  image=image.crop({x:left,y:top,width:right-left+1,height:bottom-top+1});
  const size=image.getSize(), ratio=Math.min(300/size.width,319/size.height);
  const w=Math.max(1,Math.round(size.width*ratio)), h=Math.max(1,Math.round(size.height*ratio));
  image=image.resize({width:w,height:h,quality:'best'});
  const result=Buffer.alloc(384*384*4), raw=image.toBitmap();
  const x=Math.floor((384-w)/2), y=374-h;
  for(let row=0;row<h;row++) raw.copy(result,((row+y)*384+x)*4,row*w*4,(row+1)*w*4);
  return { png:nativeImage.createFromBitmap(result,{width:384,height:384}).toPNG(), opaque:transparent===0 };
}

function createSettingsController(api) {
  let window=null;
  const safe = fn => async(event,...args) => {
    if(!window || window.isDestroyed() || event.sender!==window.webContents || event.senderFrame!==window.webContents.mainFrame) throw new Error('无效的设置窗口');
    try {return {ok:true,value:await fn(...args)};} catch(error) {return {ok:false,error:error.message};}
  };
  ipcMain.handle('settings:get',safe(()=>api.snapshot()));
  ipcMain.handle('settings:save',safe(async patch=>{
    if(!patch || typeof patch!=='object') throw new Error('设置格式无效');
    await api.save(patch); return api.snapshot();
  }));
  ipcMain.handle('settings:preview',safe(state=>{if(!POSES.some(p=>p[0]===state)) throw new Error('未知姿势'); api.preview(state); return true;}));
  ipcMain.handle('settings:import',safe(async state=>{
    if(!POSES.some(p=>p[0]===state)) throw new Error('未知姿势');
    const pick=await dialog.showOpenDialog(window,{title:'为这个姿势选择图片',properties:['openFile'],filters:[{name:'透明角色图片',extensions:['png','webp']}]});
    if(pick.canceled) return {cancelled:true};
    const filename=pick.filePaths[0];
    if(!['.png','.webp'].includes(path.extname(filename).toLowerCase())) throw new Error('只支持 PNG / WebP。');
    if(fs.statSync(filename).size>8*1024*1024) throw new Error('图片请控制在 8 MB 以内。');
    const bytes=fs.readFileSync(filename);
    const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const webp=bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP';
    if(!png&&!webp) throw new Error('文件内容不是 PNG / WebP 图片。');
    // nativeImage on Windows does not decode WebP. Use Chromium's raster
    // decoder, then hand only the resulting PNG bytes to the local normalizer.
    let decoded=bytes;
    if(webp){
      const dataURL='data:image/webp;base64,'+bytes.toString('base64');
      const result=await window.webContents.executeJavaScript(`(async()=>{
        const image=new Image();image.src=${JSON.stringify(dataURL)};
        await image.decode();
        if(image.naturalWidth>4096||image.naturalHeight>4096)throw new Error('图片过大，请先缩小到 4096 × 4096 以内。');
        const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
        canvas.getContext('2d').drawImage(image,0,0);
        return canvas.toDataURL('image/png');
      })()`);
      decoded=Buffer.from(result.split(',')[1],'base64');
    }
    const normalized=normalizeSprite(decoded);
    const name=randomUUID()+'.png';
    fs.mkdirSync(api.imageDirectory,{recursive:true});
    fs.writeFileSync(path.join(api.imageDirectory,name),normalized.png,{flag:'wx'});
    api.setImage(state,name);
    return {snapshot:api.snapshot(),opaque:normalized.opaque};
  }));
  ipcMain.handle('settings:reset-image',safe(state=>{
    if(!POSES.some(p=>p[0]===state)) throw new Error('未知姿势');
    api.setImage(state,null); return api.snapshot();
  }));
  ipcMain.handle('settings:reset',safe(async()=>{
    const answer=await dialog.showMessageBox(window,{type:'question',title:'恢复默认外观',message:'恢复默认大小、提示显示和全部姿势图片？',detail:'不会删除导入图片或更改 AI 接入设置。',buttons:['取消','恢复默认'],defaultId:0,cancelId:0});
    if(answer.response!==1) return null;
    api.reset(); return api.snapshot();
  }));
  ipcMain.handle('settings:copy',safe(kind=>{
    const snapshot=api.snapshot();
    if(!Object.hasOwn(snapshot.snippets,kind)) throw new Error('未知示例');
    clipboard.writeText(snapshot.snippets[kind]); return true;
  }));
  return {
    open(tab='appearance') {
      if(window&&!window.isDestroyed()){window.show();window.focus();window.webContents.send('settings:tab',tab);return;}
      window=new BrowserWindow({width:940,height:740,minWidth:740,minHeight:580,title:'小鲸的控制室',autoHideMenuBar:true,backgroundColor:'#f5f7fc',show:false,
        webPreferences:{preload:path.join(__dirname,'settings-preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
      window.setMenu(null);
      window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      window.webContents.on('will-navigate',event=>event.preventDefault());
      window.loadFile(path.join(__dirname,'settings.html'),{query:{tab}});
      window.once('ready-to-show',()=>{if(process.env.WHALEPET_QA_HIDDEN!=='1')window.show();});
      window.on('closed',()=>{window=null;});
    }
  };
}
module.exports={createSettingsController,normalizeSprite};
