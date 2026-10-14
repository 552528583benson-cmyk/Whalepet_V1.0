'use strict';
const {BrowserWindow,ipcMain,screen}=require('electron');
const path=require('node:path');
const SIZE={width:300,height:300};

// A transparent character at the work-area edge, never a recovery panel.
function createRecoveryController({getPet,isHidden,restore,menu,beginPull=()=>false,movePull=()=>{},endPull=()=>{},onUnavailable=()=>{},getView=()=>({scale:1}),onChange=()=>{}}){
  let window=null,ready=false,wanted=false,disposed=false,stage='hidden',anchor=null;
  let readyPromise=null,resolveReady=null,rejectReady=null,readyTimer=null;
  let nativeInteractive=false,probeInside=false,signature='',placement='',pulling=false,pullRequestId=null;
  function geometry(){
    const pet=getPet(),bounds=pet&&!pet.isDestroyed()?pet.getBounds():null;
    const point=anchor||(bounds?{x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2}:{x:0,y:0});
    const display=anchor||bounds?screen.getDisplayNearestPoint(point):screen.getPrimaryDisplay();
    const area=display.workArea;
    const scale=Math.max(.1,Math.min(Number(getView().scale)||1,area.width/SIZE.width,area.height/SIZE.height));
    const width=Math.round(SIZE.width*scale),height=Math.round(SIZE.height*scale);
    const x=Math.round(Math.max(area.x,Math.min(point.x-width/2,area.x+area.width-width)));
    return {scale,area,centerX:x+width/2,x,y:Math.round(area.y+area.height-height),width,height};
  }
  function view(){
    const summary=getView(),layout=geometry(),visible=wanted&&isHidden(),peek=visible&&stage==='peeking'&&!pulling;
    return {stage,scale:layout.scale,visible,pulling,pullRequestId,showSpeech:summary.showSpeech!==false,
      conversations:peek&&Array.isArray(summary.conversations)?summary.conversations.map(item=>({
        title:typeof item.title==='string'?item.title.slice(0,120):'未命名会话',state:item.state,
        primary:item.primary===true,uncertain:item.uncertain===true
      })).slice(0,2):[],
      conversationOverflow:peek?{count:Math.max(0,Number(summary.conversationOverflow?.count)||0),uncertain:Math.max(0,Number(summary.conversationOverflow?.uncertain)||0)}:{count:0,uncertain:0}};
  }
  function place(){
    if(!window||window.isDestroyed())return;
    const layout=geometry(),key=JSON.stringify([layout.x,layout.y,layout.width,layout.height,layout.scale]);
    // Loading a local page can reset Chromium's zoom. Restore it even when
    // native geometry did not change (especially after ready-to-show).
    if(Math.abs(window.webContents.getZoomFactor()-layout.scale)>.001)window.webContents.setZoomFactor(layout.scale);
    if(key===placement)return;placement=key;
    window.setContentSize(layout.width,layout.height);
    // Windows DPI rounding can enlarge the actual content by a pixel or two.
    // Clamp that rendered viewport, not the requested logical dimensions.
    for(let attempt=0;attempt<2;attempt++){
      const outer=window.getBounds(),content=window.getContentBounds();
      const left=Math.max(layout.area.x,Math.min(layout.centerX-content.width/2,layout.area.x+layout.area.width-content.width));
      const top=layout.area.y+layout.area.height-content.height;
      window.setPosition(Math.round(left-(content.x-outer.x)),Math.round(top-(content.y-outer.y)));
    }
  }
  function publish(force=false){
    if(!window||window.isDestroyed()||!ready)return;
    const next=view(),key=JSON.stringify(next);
    if(force||key!==signature){signature=key;window.webContents.send('recovery:update',next);}
  }
  function display(){
    if(!window||!ready||!wanted||!isHidden()||disposed)return;
    place();publish(true);
    if(process.env.WHALEPET_QA_HIDDEN!=='1'){window.showInactive();window.moveTop();}
    onChange();
  }
  function prepare(){
    if(disposed)throw new Error('躲猫猫入口已关闭');
    if(window&&!window.isDestroyed())return window;
    ready=false;signature='';placement='';
    readyPromise=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
    readyPromise.catch(()=>{});
    const layout=geometry();
    window=new BrowserWindow({width:layout.width,height:layout.height,frame:false,transparent:true,backgroundColor:'#00000000',show:false,
      focusable:false,alwaysOnTop:true,skipTaskbar:true,resizable:false,minimizable:false,maximizable:false,hasShadow:false,
      webPreferences:{preload:path.join(__dirname,'recovery-preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
    const own=window;
    own.setMenu(null);own.setAlwaysOnTop(true,'screen-saver');
    own.setIgnoreMouseEvents(true,{forward:true});nativeInteractive=false;
    own.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    own.webContents.on('will-navigate',event=>event.preventDefault());
    readyTimer=setTimeout(()=>rejectReady?.(new Error('躲猫猫画面未能加载，请重试。')),2500);
    own.once('ready-to-show',()=>{if(window!==own)return;ready=true;place();clearTimeout(readyTimer);resolveReady?.();publish(true);display();});
    own.webContents.on('render-process-gone',()=>{if(window===own)onUnavailable();});
    own.on('closed',()=>{if(window===own){window=null;ready=false;wanted=false;pulling=false;clearTimeout(readyTimer);rejectReady?.(new Error('躲猫猫窗口已关闭'));if(!disposed)onUnavailable();onChange();}});
    own.loadFile(path.join(__dirname,'recovery.html')).catch(error=>rejectReady?.(error));place();return own;
  }
  const valid=event=>window&&!window.isDestroyed()&&event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame;
  const restoreHandler=event=>{if(valid(event)&&wanted&&isHidden())restore();};
  const menuHandler=event=>{if(valid(event)&&wanted&&isHidden())menu(window);};
  const toggleHandler=event=>{if(valid(event)&&wanted&&isHidden()&&!pulling){stage=stage==='hidden'?'peeking':'hidden';publish(true);onChange();}};
  const interactiveHandler=(event,value)=>{
    if(!valid(event)||!wanted||!isHidden()||typeof value!=='boolean'||value===nativeInteractive)return;
    if(pulling&&!value)return;
    nativeInteractive=value;window.setIgnoreMouseEvents(!value,{forward:true});
  };
  const requestHandler=event=>{if(!valid(event))throw new Error('Invalid recovery sender');return view();};
  const notifyPull=(phase,requestId)=>{if(window&&!window.isDestroyed())window.webContents.send('recovery:pull',{phase,requestId});};
  const pullStartHandler=(event,value)=>{
    if(!valid(event))return;
    if(!wanted||!isHidden()||stage!=='peeking'){notifyPull('cancelled',value?.requestId);return;}
    Promise.resolve(beginPull(value)).then(ok=>{if(!ok)notifyPull('cancelled',value?.requestId);},()=>notifyPull('cancelled',value?.requestId));
  };
  const pullMoveHandler=(event,value)=>{if(valid(event)&&wanted&&isHidden())movePull(value);};
  const pullEndHandler=(event,value)=>{if(valid(event)&&wanted&&isHidden())endPull(value);};
  ipcMain.on('recovery:restore',restoreHandler);ipcMain.on('recovery:menu',menuHandler);
  ipcMain.on('recovery:toggle',toggleHandler);ipcMain.on('recovery:interactive',interactiveHandler);
  ipcMain.handle('recovery:request',requestHandler);
  ipcMain.on('recovery:pull-start',pullStartHandler);ipcMain.on('recovery:pull-move',pullMoveHandler);ipcMain.on('recovery:pull-end',pullEndHandler);
  const reposition=()=>{if(wanted&&isHidden()){place();publish(true);}};
  for(const event of ['display-added','display-removed','display-metrics-changed'])screen.on(event,reposition);
  const probeTimer=setInterval(()=>{
    if(!window||!ready||!wanted||!isHidden()||!window.isVisible())return;
    const bounds=window.getContentBounds(),cursor=screen.getCursorScreenPoint();
    const inside=cursor.x>=bounds.x&&cursor.y>=bounds.y&&cursor.x<bounds.x+bounds.width&&cursor.y<bounds.y+bounds.height;
    if(inside){const z=window.webContents.getZoomFactor();window.webContents.send('recovery:cursor-probe',{x:(cursor.x-bounds.x)/z,y:(cursor.y-bounds.y)/z});}
    else if(probeInside){window.webContents.send('recovery:cursor-probe',null);}
    probeInside=inside;
  },120);
  return {
    prepare,ready(){prepare();return readyPromise;},
    setAnchor(point){anchor=Number.isFinite(point?.x)&&Number.isFinite(point?.y)?{x:point.x,y:point.y}:null;},
    geometry,
    show(){prepare();stage='hidden';pulling=false;wanted=true;display();onChange();},
    peek(){if(wanted&&isHidden()){stage='peeking';publish(true);onChange();}},
    setPulling(value,requestId){pulling=value===true;if(Number.isInteger(requestId))pullRequestId=requestId;if(pulling&&window&&!window.isDestroyed()){nativeInteractive=true;window.setIgnoreMouseEvents(false,{forward:true});}publish(true);},
    notifyPull,
    pullOrigin(){if(!window||window.isDestroyed())return null;const b=window.getContentBounds(),z=window.webContents.getZoomFactor();return {x:b.x+(b.width-275*z)/2,y:b.y+b.height-161.34765625*z,bottom:b.y+b.height,scale:z};},
    retract(){stage='hidden';publish(true);onChange();},
    refresh(){if(window&&!window.isDestroyed()){place();publish();}},
    hide(){wanted=false;stage='hidden';pulling=false;probeInside=false;publish(true);if(window&&!window.isDestroyed()){nativeInteractive=false;window.setIgnoreMouseEvents(true,{forward:true});window.hide();}onChange();},
    snapshot:()=>({recoveryAvailable:Boolean(window&&!window.isDestroyed()),recoveryVisible:Boolean(window&&!window.isDestroyed()&&window.isVisible()),recoveryStage:stage}),
    dispose(){disposed=true;wanted=false;clearInterval(probeTimer);clearTimeout(readyTimer);rejectReady?.(new Error('小鲸正在退出'));
      ipcMain.removeListener('recovery:restore',restoreHandler);ipcMain.removeListener('recovery:menu',menuHandler);
      ipcMain.removeListener('recovery:toggle',toggleHandler);ipcMain.removeListener('recovery:interactive',interactiveHandler);ipcMain.removeHandler('recovery:request');
      ipcMain.removeListener('recovery:pull-start',pullStartHandler);ipcMain.removeListener('recovery:pull-move',pullMoveHandler);ipcMain.removeListener('recovery:pull-end',pullEndHandler);
      for(const event of ['display-added','display-removed','display-metrics-changed'])screen.removeListener(event,reposition);
      window?.destroy();window=null;ready=false;}
  };
}
module.exports={createRecoveryController};
