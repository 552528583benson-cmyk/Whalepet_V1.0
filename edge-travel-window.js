const {BrowserWindow,screen}=require('electron');
const path=require('node:path');
const AHOGE_PULL=require('./ahoge-pull-assets');

function createEdgeTravelController({onGeometryChanged=()=>{},onPullInterrupted=()=>{}}={}){
  let window=null,readyPromise=null,generation=0,active=false,disposed=false;
  let pending=null,lastPoint={x:0,y:0,opacity:0},pullSession=0,pullOwned=false;
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const finite=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
  const alive=()=>window&&!window.isDestroyed();

  function execute(owner,source,timeout=800){
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Journey renderer timed out')),timeout);
      try{
        owner.webContents.executeJavaScript(source).then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
      }catch(error){clearTimeout(timer);reject(error);}
    });
  }

  function finishPending(value){
    if(!pending)return;
    const job=pending;pending=null;clearTimeout(job.timer);job.resolve(value);
  }

  function prepare(){
    if(disposed)return Promise.reject(new Error('Journey surface disposed'));
    if(readyPromise)return readyPromise;
    window=new BrowserWindow({width:1,height:1,show:false,frame:false,transparent:true,
      backgroundColor:'#00000000',focusable:false,skipTaskbar:true,resizable:false,
      movable:false,minimizable:false,maximizable:false,fullscreenable:false,hasShadow:false,alwaysOnTop:true,
      webPreferences:{preload:path.join(__dirname,'edge-travel-preload.js'),contextIsolation:true,sandbox:true,nodeIntegration:false,devTools:false,spellcheck:false,backgroundThrottling:false}});
    const owner=window;
    owner.setMenu(null);
    window.setIgnoreMouseEvents(true,{forward:true});
    window.setAlwaysOnTop(true,'screen-saver');
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    window.webContents.on('will-navigate',event=>event.preventDefault());
    window.webContents.on('render-process-gone',()=>{
      if(window!==owner)return;
      const interrupted=active&&pullOwned;
      pullSession=0;pullOwned=false;
      active=false;finishPending(false);owner.hide();owner.destroy();
      if(interrupted&&!disposed)onPullInterrupted('renderer-gone');
    });
    window.on('closed',()=>{
      if(window!==owner)return;
      const interrupted=active&&pullOwned;
      window=null;readyPromise=null;active=false;pullSession=0;pullOwned=false;generation++;finishPending(false);
      if(interrupted&&!disposed)onPullInterrupted('window-closed');
    });
    readyPromise=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Journey image readiness timed out')),10_000);
      owner.loadFile(path.join(__dirname,'edge-travel.html'))
        .then(()=>window===owner&&!owner.isDestroyed()?execute(owner,'edgeTravel.ready()',10_000):false)
        .then(value=>{clearTimeout(timer);if(value)resolve(true);else reject(new Error('Journey image could not load'));},error=>{clearTimeout(timer);reject(error);});
    });
    readyPromise.catch(()=>{
      // A failed load/decoder must not poison all later hide attempts or leave
      // a hidden renderer around forever. The normal pet remains the fallback.
      if(window===owner&&!owner.isDestroyed()){owner.hide();owner.destroy();}
    });
    return readyPromise;
  }

  function cancel(){
    generation++;active=false;pullSession=0;pullOwned=false;finishPending(false);
    if(alive()){
      // Renderer freeze keeps the displayed point inline rather than reverting
      // to the initial keyframe; a concurrent freeze() can still recover it.
      window.webContents.executeJavaScript('edgeTravel.freeze()').catch(()=>{});
      window.hide();
    }
  }

  async function freeze(){
    // A prewarmed surface has not painted the pet yet. Its origin must never
    // replace the real pet position when an interaction interrupts preparation.
    const wasActive=active;
    if(!wasActive||!alive())return null;
    const owner=window,origin=owner.getContentBounds();
    // A freeze is also the end of cursor-driven IPC, so queued updates cannot
    // advance the actor while its actual displayed position is handed off.
    pullSession=0;
    const value=await execute(owner,'edgeTravel.freeze()',350).catch(()=>null);
    if(value&&Number.isFinite(value.x)&&Number.isFinite(value.y)){
      lastPoint={x:origin.x+value.x,y:origin.y+value.y,opacity:clamp(finite(value.opacity,0),0,1)};
    }
    return {...lastPoint};
  }

  async function beginPull(options,onStart=()=>{}){
    const token=++generation;active=false;pullSession=0;pullOwned=false;finishPending(false);
    if(alive()){
      const owner=window;owner.hide();
      try{await execute(owner,'edgeTravel.freeze()');}catch{
        if(token===generation&&window===owner&&!owner.isDestroyed())owner.destroy();
        return false;
      }
    }
    if(token!==generation||disposed)return false;
    const scale=clamp(finite(options?.scale,1),.1,3);
    const area={x:Math.round(finite(options?.area?.x,0)),y:Math.round(finite(options?.area?.y,0)),
      width:Math.max(1,Math.round(finite(options?.area?.width,275*scale))),
      height:Math.max(1,Math.round(finite(options?.area?.height,275*scale)))};
    // A held pet may cross screens without moving/resizing a native window on
    // every cursor sample. Clip the one virtual-desktop surface to each actual
    // work area, including differently positioned screens and their taskbars.
    let displays=[];
    try{displays=screen.getAllDisplays().map(display=>display.workArea);}catch{ /* Use the origin screen if enumeration is unavailable. */ }
    const workAreas=[area,...displays].filter(value=>value&&
      ['x','y','width','height'].every(key=>Number.isFinite(value[key]))&&value.width>0&&value.height>0)
      .filter((value,index,list)=>list.findIndex(other=>other.x===value.x&&other.y===value.y&&other.width===value.width&&other.height===value.height)===index);
    const left=Math.floor(Math.min(...workAreas.map(value=>value.x))),top=Math.floor(Math.min(...workAreas.map(value=>value.y)));
    const right=Math.ceil(Math.max(...workAreas.map(value=>value.x+value.width))),lower=Math.ceil(Math.max(...workAreas.map(value=>value.y+value.height)));
    const surface={x:left,y:top,width:right-left,height:lower-top};
    const from={x:finite(options?.from?.x,area.x),y:finite(options?.from?.y,area.y),opacity:1};
    lastPoint={...from};
    try{await prepare();}catch{return false;}
    if(token!==generation||disposed||!alive())return false;
    const owner=window;
    // The viewport stays at the virtual work-area union throughout the gesture.
    // Only the fixed-size artwork's compositor transform moves; the renderer
    // applies inertia around the authored tip without moving this native window.
    owner.webContents.setZoomFactor(1);
    owner.setContentSize(surface.width,surface.height);
    const outer=owner.getBounds(),content=owner.getContentBounds();
    owner.setPosition(Math.round(surface.x-(content.x-outer.x)),Math.round(surface.y-(content.y-outer.y)));
    const origin=owner.getContentBounds();
    const value={mode:'pull',session:token,scale,origin:{x:origin.x,y:origin.y},bottom:surface.y+surface.height-origin.y,
      from:{x:from.x-origin.x,y:from.y-origin.y,opacity:1},
      workAreas:workAreas.map(value=>({x:value.x-origin.x,y:value.y-origin.y,width:value.width,height:value.height})),
      pivot:{x:finite(options?.pivot?.x,AHOGE_PULL.pivot.x),y:finite(options?.pivot?.y,AHOGE_PULL.pivot.y)},
      reducedMotion:Boolean(options?.reducedMotion)};
    try{
      const configured=await execute(owner,`edgeTravel.configurePull(${JSON.stringify(value)})`);
      if(!configured?.ready){if(token===generation&&window===owner&&!owner.isDestroyed())owner.destroy();return false;}
    }catch{
      if(token===generation&&window===owner&&!owner.isDestroyed())owner.destroy();return false;
    }
    if(token!==generation||disposed||!alive())return false;
    active=true;pullSession=token;pullOwned=true;
    if(process.env.WHALEPET_QA_HIDDEN==='1')owner.setOpacity(0);
    owner.showInactive();owner.moveTop();
    // The replacement artwork must already be visible before the recovery
    // renderer hides its artwork. Its separate pointer capture stays intact.
    try{await onStart();}catch{if(token===generation)cancel();return false;}
    return token===generation&&!disposed&&alive()&&active&&pullSession===token;
  }

  function updatePull(point){
    if(!active||!pullSession||!alive())return false;
    if(!Number.isFinite(point?.x)||!Number.isFinite(point?.y))return false;
    try{
      // No per-frame promise/evaluation or native-window movement. The
      // preload delivers the newest target to one renderer RAF loop.
      window.webContents.send('edge-travel:pull-point',{session:pullSession,x:point.x,y:point.y});
      return true;
    }catch{return false;}
  }

  function finishPull(options={}){
    if(!active||!pullOwned||!alive()||disposed)return Promise.resolve(false);
    const token=++generation,owner=window,origin=owner.getContentBounds();
    pullSession=0;finishPending(false);
    const to={x:finite(options?.to?.x,lastPoint.x),y:finite(options?.to?.y,lastPoint.y)};
    const duration=clamp(finite(options?.duration,160),0,500);
    const value={to:{x:to.x-origin.x,y:to.y-origin.y},duration,reducedMotion:Boolean(options?.reducedMotion)};
    return new Promise(resolve=>{
      const job={resolve,timer:null};pending=job;
      job.timer=setTimeout(()=>{if(token===generation&&pending===job)cancel();},Math.max(1500,duration+1000));
      owner.webContents.executeJavaScript(`edgeTravel.finishPull(${JSON.stringify(value)})`).then(result=>{
        if(token!==generation||pending!==job)return;
        active=false;pullOwned=false;lastPoint={...to,opacity:1};
        // The final image remains in place until the normal pet paints its
        // replacement and main explicitly retires this surface.
        finishPending(Boolean(result));
      },()=>{
        if(token!==generation||pending!==job)return;
        active=false;pullOwned=false;if(alive())owner.hide();finishPending(false);
      });
    });
  }

  async function play(options,onStart=()=>{}){
    const token=++generation;active=false;pullSession=0;pullOwned=false;finishPending(false);
    if(alive()){
      const owner=window;owner.hide();
      try{await execute(owner,'edgeTravel.freeze()');}catch{
        if(token===generation&&window===owner&&!owner.isDestroyed())owner.destroy();
        return false;
      }
    }
    if(token!==generation||disposed)return false;
    const scale=clamp(finite(options?.scale,1),.1,3);
    const from={x:finite(options?.from?.x,0),y:finite(options?.from?.y,0),
      opacity:clamp(finite(options?.from?.opacity,options?.mode==='emerging'?0:1),0,1)};
    const to={x:finite(options?.to?.x,from.x),y:finite(options?.to?.y,from.y)};
    const mode=options?.mode==='emerging'?'emerging':'hiding';
    const bottom=finite(options?.bottom,Math.max(from.y,to.y)+275*scale);
    const runMs=clamp(finite(options?.runMs,650),0,3000),dipMs=clamp(finite(options?.dipMs,260),0,1500);
    const duration=clamp(finite(options?.duration,520),0,3000);
    const reducedMotion=Boolean(options?.reducedMotion);
    lastPoint={...from};
    if(reducedMotion){
      if(token!==generation||disposed)return false;
      try{await onStart();}catch{return false;}
      if(token!==generation||disposed)return false;
      lastPoint={...to,opacity:mode==='hiding'?0:1};return true;
    }
    try{await prepare();}catch{return false;}
    if(token!==generation||disposed||!alive())return false;
    const owner=window,padding=Math.ceil(16*scale),size=275*scale;
    const left=Math.floor(Math.min(from.x,to.x)-padding);
    const top=Math.floor(Math.min(from.y,to.y)-padding-4*scale);
    const right=Math.ceil(Math.max(from.x,to.x)+size+padding);
    const lower=Math.min(bottom,Math.ceil(Math.max(from.y,to.y)+(mode==='hiding'?205*scale:0)+size+padding));
    owner.webContents.setZoomFactor(1);
    owner.setContentSize(Math.max(1,right-left),Math.max(1,lower-top));
    const outer=owner.getBounds(),content=owner.getContentBounds();
    owner.setPosition(Math.round(left-(content.x-outer.x)),Math.round(top-(content.y-outer.y)));
    const origin=owner.getContentBounds();
    const value={mode,scale,bottom:bottom-origin.y,
      from:{x:from.x-origin.x,y:from.y-origin.y,opacity:from.opacity},
      to:{x:to.x-origin.x,y:to.y-origin.y},runMs,dipMs,duration,reducedMotion};
    try{
      const configured=await execute(owner,`edgeTravel.configure(${JSON.stringify(value)})`);
      if(!configured?.ready){if(token===generation&&window===owner&&!owner.isDestroyed())owner.destroy();return false;}
    }catch{
      if(token===generation&&window===owner&&!owner.isDestroyed())owner.destroy();return false;
    }
    if(token!==generation||disposed||!alive())return false;
    try{await onStart();}catch{return false;}
    if(token!==generation||disposed||!alive())return false;
    active=true;
    // Chromium can suspend compositor animations in a fully hidden window.
    // QA paints an invisible, non-interactive surface, never an on-screen pet.
    if(process.env.WHALEPET_QA_HIDDEN==='1')owner.setOpacity(0);
    owner.showInactive();owner.moveTop();
    return new Promise(resolve=>{
      const total=mode==='hiding'?runMs+dipMs:duration;
      const job={resolve,timer:null};pending=job;
      job.timer=setTimeout(()=>{
        if(token!==generation||pending!==job)return;
        cancel();
      },Math.max(2000,total+1500));
      owner.webContents.executeJavaScript('edgeTravel.play()').then(result=>{
        if(token!==generation||pending!==job)return;
        active=false;
        // Keep the final emergence picture until the normal window has painted
        // its own replacement; main cancels this surface after the handoff.
        if(mode==='hiding')owner.hide();
        lastPoint={x:to.x,y:to.y+(mode==='hiding'?205*scale:0),opacity:mode==='hiding'?0:1};
        finishPending(Boolean(result));
      },()=>{
        if(token!==generation||pending!==job)return;
        active=false;if(alive())owner.hide();finishPending(false);
      });
    });
  }

  const geometryChanged=()=>{if(active&&!disposed)onGeometryChanged();};
  for(const event of ['display-added','display-removed','display-metrics-changed'])screen.on(event,geometryChanged);

  function dispose(){
    if(disposed)return;
    cancel();disposed=true;
    for(const event of ['display-added','display-removed','display-metrics-changed'])screen.removeListener(event,geometryChanged);
    if(alive())window.destroy();
    window=null;
  }

  return {prepare,ready:prepare,play,beginPull,updatePull,finishPull,freeze,cancel,dispose};
}

module.exports={createEdgeTravelController};
