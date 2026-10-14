const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {app,BrowserWindow,ipcMain,nativeImage}=require('electron');
const root=path.resolve(__dirname,'..');
const run=fs.mkdtempSync(path.join(root,'work/peek-renderer-qa-'));
app.setPath('userData',path.join(run,'electron'));
app.disableHardwareAcceleration();
let dock;
const fixtureConversations=[{title:'一个很长的任务标题，也会在泡泡里温柔省略',state:'working',primary:true,uncertain:false,message:'PRIVATE_QA_AI_INFORMATION'},{title:'第二个任务',state:'needs_input',primary:false,uncertain:true}];
let view={stage:'hidden',scale:1,showSpeech:true,conversations:fixtureConversations,conversationOverflow:{count:3,uncertain:1}};
let interactive=false;
let toggleCount=0;
const pullStarts=[],pullMoves=[],pullEnds=[];
let autoPullAcks=true;
ipcMain.handle('recovery:request',()=>view);
ipcMain.on('recovery:interactive',(_event,value)=>{interactive=value;});
ipcMain.on('recovery:toggle',()=>{
  toggleCount++;
  view={...view,stage:view.stage==='hidden'?'peeking':'hidden'};
  dock.webContents.send('recovery:update',view);
});
ipcMain.on('recovery:pull-start',(_event,value)=>{
  pullStarts.push(value);if(!autoPullAcks)return;view={...view,pulling:true};
  dock.webContents.send('recovery:pull',{phase:'started',requestId:value.requestId});dock.webContents.send('recovery:update',view);
});
ipcMain.on('recovery:pull-move',(_event,value)=>pullMoves.push(value));
ipcMain.on('recovery:pull-end',(_event,value)=>{
  pullEnds.push(value);if(!autoPullAcks)return;view={...view,pulling:false};
  dock.webContents.send('recovery:pull',{phase:value.cancelled?'cancelled':'ended',requestId:value.requestId});dock.webContents.send('recovery:update',view);
});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function eventually(check){let error;for(let i=0;i<50;i++)try{return await check();}catch(e){error=e;await pause(40);}throw error;}
async function captureOwnWindow(){
  // Hidden Chromium surfaces can retain the previous animation frame. Prime
  // only this QA window, let its compositor repaint, then inspect that result.
  await dock.webContents.capturePage(undefined,{stayHidden:true});await pause(80);
  return dock.webContents.capturePage(undefined,{stayHidden:true});
}
const SCALES=[.65,.75,1,1.5];
const QA_BACKGROUNDS=[
  ['black','#000'],['navy','#101d3b'],['gray','#81868e'],['white','#fff'],
  ['checker','repeating-conic-gradient(#c5c9cf 0 25%,#eef0f3 0 50%) 0 / 16px 16px']
];
function inspectHiddenCrop(image,scale){
  const bitmap=image.toBitmap();const {width,height}=image.getSize();
  const whitePixels=[];const opaque=new Uint8Array(width*height);let opaqueCount=0;
  let minX=width,minY=height,maxX=-1,maxY=-1;
  for(let i=0;i<opaque.length;i++){
    const offset=i*4;if(bitmap[offset+3]<64)continue;
    opaque[i]=1;opaqueCount++;const x=i%width,y=Math.floor(i/width);
    minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
    if(bitmap[offset]>165&&bitmap[offset+1]>165&&bitmap[offset+2]>165)whitePixels.push({x:i%width,y:Math.floor(i/width)});
  }
  assert.ok(opaqueCount>30*scale*scale,`the hidden curl remains visible at ${scale}`);
  assert.equal(whitePixels.length,0,`the hidden crop contains no white headband at ${scale}: ${JSON.stringify(whitePixels.slice(0,20))}`);
  const components=[];
  for(let start=0;start<opaque.length;start++){
    if(!opaque[start])continue;
    opaque[start]=0;const pending=[start];let count=0;
    while(pending.length){
      const current=pending.pop();count++;const x=current%width,y=Math.floor(current/width);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        if(!dx&&!dy)continue;
        const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=width||ny>=height)continue;
        const next=ny*width+nx;if(opaque[next]){opaque[next]=0;pending.push(next);}
      }
    }
    components.push(count);
  }
  components.sort((a,b)=>b-a);
  assert.equal(components.filter(count=>count>=2).length,1,`only the continuous curl is visible; no detached black stubs at ${scale}: ${components}`);
  return {width,height,opaqueCount,components,bounds:{x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1}};
}
async function captureCurlBackgrounds(js,scale,bounds){
  const images=[];
  for(const [name,background] of QA_BACKGROUNDS){
    await js(`document.body.style.background=${JSON.stringify(background)}`);await pause(35);
    const capture=await captureOwnWindow();
    const size=capture.getSize(),margin=Math.ceil(12*scale);
    const crop={x:Math.max(0,bounds.x-margin),y:Math.max(0,bounds.y-margin),width:0,height:0};
    crop.width=Math.min(size.width-crop.x,bounds.width+margin*2);
    crop.height=Math.min(size.height-crop.y,bounds.height+margin*2);
    images.push(capture.crop(crop));
    fs.writeFileSync(path.join(run,`hidden-${scale}-${name}.png`),capture.toPNG());
  }
  await js('document.body.style.background="transparent"');await pause(35);
  const {width,height}=images[0].getSize();const sheetWidth=width*images.length;
  const sheet=Buffer.alloc(sheetWidth*height*4);
  images.forEach((image,column)=>{
    const bitmap=image.toBitmap();
    for(let y=0;y<height;y++)bitmap.copy(sheet,(y*sheetWidth+column*width)*4,y*width*4,(y+1)*width*4);
  });
  fs.writeFileSync(path.join(run,`hidden-${scale}-backgrounds.png`),nativeImage.createFromBitmap(sheet,{width:sheetWidth,height}).toPNG());
}
app.whenReady().then(async()=>{
  // This renderer-only fixture does not import main, start activity/follower
  // helpers, observe real cursor input, or capture the desktop. All probes and
  // clicks below are synthetic; native input always passes through the dock.
  dock=new BrowserWindow({width:300,height:300,show:false,opacity:0,focusable:false,skipTaskbar:true,transparent:true,frame:false,webPreferences:{preload:path.join(root,'recovery-preload.js'),contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  dock.setOpacity(0);dock.setSkipTaskbar(true);dock.setFocusable(false);dock.webContents.setAudioMuted(true);
  const nativeIgnore=dock.setIgnoreMouseEvents.bind(dock);
  dock.setIgnoreMouseEvents=()=>nativeIgnore(true,{forward:true});dock.setIgnoreMouseEvents(true,{forward:true});
  await dock.loadFile(path.join(root,'recovery.html'));
  const js=source=>dock.webContents.executeJavaScript(source);
  // Forwarded real movement is deliberately excluded from the test results.
  await js('document.addEventListener("mousemove",event=>event.stopImmediatePropagation(),true)');
  await eventually(async()=>assert.equal((await js('whalePeekController.info()')).ready,true));
  assert.equal(await js('document.body.innerText.trim()'),'','hidden stage contains no visible text');
  assert.equal(await js('whalePeekController.hitTest(2,2)'),false);
  const sourcePoint=async(id,x,y)=>js(`(()=>{const art=document.querySelector(${JSON.stringify(id)}),b=art.getBoundingClientRect();return {x:b.left+${x}*b.width/art.naturalWidth,y:b.top+${y}*b.height/art.naturalHeight};})()`);
  const hit=async point=>js(`whalePeekController.hitTest(${point.x},${point.y})`);
  const click=async point=>js(`document.querySelector("#restorePet").dispatchEvent(new MouseEvent("click",{detail:1,button:0,clientX:${point.x},clientY:${point.y},bubbles:true}))`);
  const sendView=async value=>{view={...view,...value};dock.webContents.send('recovery:update',view);await pause(100);};
  assert.equal(await js('(()=>{const art=document.querySelector("#curlArt"),canvas=document.createElement("canvas");canvas.width=art.naturalWidth;canvas.height=art.naturalHeight;const context=canvas.getContext("2d");context.drawImage(art,0,0);return context.getImageData(600,280,1,1).data[3];})()'),0,'the fixture really targets an alpha-transparent curl hole');
  assert.equal(await hit(await sourcePoint('#curlArt',600,280)),true,'the transparent hole inside the curl is interactive');
  assert.equal(await hit(await sourcePoint('#curlArt',600,228)),true,'the blue curl is interactive');
  assert.equal(await hit(await sourcePoint('#curlArt',518,336)),false,'the lower outline/headband artifact stays below the screen border');
  dock.webContents.send('recovery:cursor-probe',await sourcePoint('#curlArt',600,228));
  await eventually(()=>assert.equal(interactive,true));
  dock.webContents.send('recovery:cursor-probe',await sourcePoint('#curlArt',600,280));
  await eventually(()=>assert.equal(interactive,true));
  dock.webContents.send('recovery:cursor-probe',{x:2,y:2});
  await eventually(()=>assert.equal(interactive,false));
  let image;const hiddenCrops=[];
  assert.equal((await js('whalePeekController.info()')).art.curlSourceBottom,310,'only the upper continuous curl is exposed');
  for(const scale of SCALES){
    dock.setContentSize(Math.round(300*scale),Math.round(300*scale));dock.webContents.setZoomFactor(scale);
    await sendView({scale});
    assert.equal(await hit(await sourcePoint('#curlArt',600,228)),true,`the blue curl remains clickable at ${scale}`);
    const hole=await sourcePoint('#curlArt',600,280);
    const edge=await sourcePoint('#curlArt',677,280);
    const nearBorder={x:edge.x+4,y:edge.y};
    const farBorder={x:edge.x+13,y:edge.y};
    assert.equal(await hit(hole),true,`the alpha-transparent inner gap is clickable at ${scale}`);
    assert.equal(await hit(nearBorder),true,`a modest 4 CSS px curl margin is clickable at ${scale}`);
    assert.equal(await hit(farBorder),false,`transparent space 13 CSS px beyond the curl passes through at ${scale}`);
    assert.equal(await hit(await sourcePoint('#curlArt',460,280)),true,`the left curl border allows a small margin at ${scale}`);
    assert.equal(await hit(await sourcePoint('#curlArt',449,280)),false,`the left margin stays bounded at ${scale}`);
    assert.equal(await hit(await sourcePoint('#curlArt',600,190)),true,`the upper curl border allows a small margin at ${scale}`);
    assert.equal(await hit(await sourcePoint('#curlArt',600,175)),false,`the upper margin stays bounded at ${scale}`);
    assert.equal(await hit({x:2,y:2}),false,`far transparent padding passes through at ${scale}`);
    assert.equal(await hit(await sourcePoint('#curlArt',518,336)),false,`no black lower stub appears at ${scale}`);
    assert.equal(await hit(await sourcePoint('#curlArt',600,600)),false,`the cropped body cannot receive clicks at ${scale}`);
    assert.equal(await js('document.body.innerText.trim()'),'','hidden curl does not reveal task or AI information');
    dock.webContents.send('recovery:cursor-probe',hole);await eventually(()=>assert.equal(interactive,true));
    dock.webContents.send('recovery:cursor-probe',farBorder);await eventually(()=>assert.equal(interactive,false));
    await sendView({visible:false});assert.equal(await hit(hole),false,'a hidden recovery window cannot intercept clicks');
    await sendView({visible:true});
    const ignoredClicks=toggleCount;await click(farBorder);await pause(30);assert.equal(toggleCount,ignoredClicks,'far transparent click does not toggle the dock');
    image=await captureOwnWindow();fs.writeFileSync(path.join(run,`hidden-${scale}.png`),image.toPNG());
    const crop=inspectHiddenCrop(image,scale);hiddenCrops.push({scale,...crop});
    fs.writeFileSync(path.join(run,'hidden-crop-metrics.json'),JSON.stringify(hiddenCrops,null,2));
    await captureCurlBackgrounds(js,scale,crop.bounds);
  }
  fs.writeFileSync(path.join(run,'hidden-crop-metrics.json'),JSON.stringify(hiddenCrops,null,2));
  // Check all stable hidden crops before exercising transitions: a never-shown
  // compositor may retain an intermediate head frame after a quick toggle.
  for(const scale of SCALES){
    dock.setContentSize(Math.round(300*scale),Math.round(300*scale));dock.webContents.setZoomFactor(scale);
    await sendView({scale});
    const hole=await sourcePoint('#curlArt',600,280),edge=await sourcePoint('#curlArt',677,280);
    for(const point of [hole,{x:edge.x+4,y:edge.y}]){
      const previous=toggleCount;await click(point);
      await eventually(async()=>assert.equal((await js('whalePeekController.info()')).stage,'peeking'));
      assert.equal(toggleCount,previous+1,`the enlarged hit area triggers one peek at ${scale}`);
      await pause(500);
      assert.equal(await hit({x:150,y:80}),false,`the bubble area remains clickthrough at ${scale}`);
      const bubblePoint=await js('(()=>{const b=document.querySelector(".conversation-bubble").getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2};})()');
      assert.equal(await hit(bubblePoint),false,`the visible task bubble center passes through at ${scale}`);
      assert.doesNotMatch(await js('document.body.innerText'),/PRIVATE_QA_AI_INFORMATION/,'task bubbles do not expose AI message details');
      await click({x:141.40625,y:283.671875});
      await eventually(async()=>assert.equal((await js('whalePeekController.info()')).stage,'hidden'));
      await pause(500);
    }
  }
  dock.setContentSize(300,300);dock.webContents.setZoomFactor(1);
  view={...view,scale:1};dock.webContents.send('recovery:update',view);await pause(100);
  view={...view,conversations:fixtureConversations,conversationOverflow:{count:3,uncertain:1}};
  await js('document.querySelector("#restorePet").click()');
  await eventually(async()=>assert.equal((await js('whalePeekController.info()')).stage,'peeking'));
  await pause(500);
  const info=await js('whalePeekController.info()');
  assert.equal(info.headVisible,true);assert.equal(info.curlVisible,false);assert.equal(info.bubbleCount,3);
  assert.equal(await js('whalePeekController.hitTest(141.40625,283.671875)'),true,'the face is interactive');
  assert.equal(await js('whalePeekController.hitTest(150,80)'),false,'the bubble area passes through');
  assert.doesNotMatch(await js('document.body.innerText'),/Codex|ChatGPT|GPT/);
  for(const scale of SCALES){
    dock.setContentSize(Math.round(300*scale),Math.round(300*scale));dock.webContents.setZoomFactor(scale);
    view={...view,scale};dock.webContents.send('recovery:update',view);await pause(100);
    image=await captureOwnWindow();fs.writeFileSync(path.join(run,`peeking-${scale}.png`),image.toPNG());
    const layout=await js('({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,head:document.querySelector("#headArt").getBoundingClientRect().toJSON(),bubbles:document.querySelector("#conversationBubbles").getBoundingClientRect().toJSON()})');
    assert.ok(Math.abs(layout.width-300)<=2,JSON.stringify({scale,layout,bounds:dock.getContentBounds(),zoom:dock.webContents.getZoomFactor()}));assert.ok(Math.abs(layout.height-300)<=2);
    assert.ok(layout.scrollWidth<=layout.width&&layout.scrollHeight<=layout.height,'the crop adds no page scrolling');
    assert.ok(layout.bubbles.top>=0&&layout.bubbles.left>=0&&layout.bubbles.right<=layout.width,'bubbles fit at every supported scale');
  }
  await js('document.querySelector("#restorePet").click()');
  await eventually(async()=>assert.equal((await js('whalePeekController.info()')).stage,'hidden'));
  assert.equal(await js('document.body.innerText.trim()'),'','retracting removes all task text immediately');
  // Synthetic PointerEvents do not create native capture. Supply capture
  // bookkeeping only in this isolated renderer; no desktop input is injected.
  await js(`(()=>{const target=document.querySelector('#restorePet');let captured=null;target.setPointerCapture=id=>{captured=id};target.hasPointerCapture=id=>captured===id;target.releasePointerCapture=id=>{if(captured===id)captured=null};})()`);
  let pointerId=1;
  const pointer=(type,point,delta={x:0,y:0},buttons=1,id=pointerId)=>js(`document.querySelector('#restorePet').dispatchEvent(new PointerEvent(${JSON.stringify(type)},{pointerId:${id},pointerType:'mouse',isPrimary:true,button:0,buttons:${buttons},bubbles:true,cancelable:true,clientX:${point.x},clientY:${point.y},screenX:${900+delta.x},screenY:${600+delta.y}}))`);
  const gestureInfo=()=>js('whalePeekController.info()');
  const hiddenHole=await sourcePoint('#curlArt',600,280);
  await pointer('pointerdown',hiddenHole);await pointer('pointermove',hiddenHole,{x:30,y:-80});await pointer('pointerup',hiddenHole,{x:30,y:-80},0);
  assert.equal(pullStarts.length,0,'the hidden-only curl cannot be dragged out');
  assert.equal(await js(`whalePeekController.hitAhoge(${hiddenHole.x},${hiddenHole.y})`),false);
  await sendView({stage:'peeking',pulling:false,visible:true});await pause(450);
  const hole=await sourcePoint('#headArt',600,280),face=await sourcePoint('#headArt',600,675);
  assert.equal(await js(`whalePeekController.hitAhoge(${hole.x},${hole.y})`),true,'the same transparent curl hole can pull only while peeking');
  assert.equal(await js(`whalePeekController.hitAhoge(${face.x},${face.y})`),false,'the head outside the ahoge remains a click target');
  await pointer('pointerdown',face);await pointer('pointermove',face,{x:20,y:-30});await pointer('pointerup',face,{x:20,y:-30},0);
  assert.equal(pullStarts.length,0);const beforeHeadClick=toggleCount;await click(face);
  await eventually(async()=>assert.equal((await gestureInfo()).stage,'hidden'));assert.equal(toggleCount,beforeHeadClick+1);
  await sendView({stage:'peeking',pulling:false});await pause(450);
  const thresholdHole=await sourcePoint('#headArt',600,280);pointerId++;
  await pointer('pointerdown',thresholdHole);assert.equal((await gestureInfo()).pullPending,true);
  await pointer('pointermove',thresholdHole,{x:6,y:0});assert.equal(pullStarts.length,0,'six screen DIPs retains click behavior regardless of zoom');
  await pointer('pointerup',thresholdHole,{x:6,y:0},0);const beforeShortClick=toggleCount;await click(thresholdHole);
  await eventually(async()=>assert.equal((await gestureInfo()).stage,'hidden'));assert.equal(toggleCount,beforeShortClick+1);
  for(const cancelled of [false,true]){
    await sendView({stage:'peeking',pulling:false,visible:true});await pause(450);pointerId++;
    const pullHole=await sourcePoint('#headArt',600,280),previous=pullStarts.length;
    await pointer('pointerdown',pullHole);await pointer('pointermove',pullHole,{x:7,y:0});
    await eventually(()=>assert.equal(pullStarts.length,previous+1));await eventually(async()=>assert.equal((await gestureInfo()).pulling,true));
    const request=pullStarts.at(-1);assert.ok(Math.abs(request.sourceX-600)<.001&&Math.abs(request.sourceY-280)<.001,'main receives the authored ahoge source point');
    assert.ok(Math.abs(request.grabX-600*275/1280)<.001&&Math.abs(request.grabY-280*275/1280)<.001,'grab offsets remain art CSS pixels instead of zoomed screen pixels');
    assert.equal((await gestureInfo()).bubbleCount,0);assert.equal((await gestureInfo()).headVisible,false);
    assert.equal(await js('getComputedStyle(document.querySelector("#headArt")).visibility'),'hidden','pull confirmation removes the old head crop');
    assert.equal(await js(`whalePeekController.hitTest(${pullHole.x},${pullHole.y})`),false,'old alpha surface cannot toggle while pulled');
    await pointer('pointermove',{x:-500,y:-500},{x:180,y:-240});await eventually(()=>assert.ok(pullMoves.length>0));
    await pointer('pointerup',pullHole,{x:180,y:-240},0,pointerId+999);assert.equal((await gestureInfo()).pullRequested,true,'another pointer cannot release the pull');
    const beforeRelease=toggleCount;await pointer(cancelled?'pointercancel':'pointerup',{x:-500,y:-500},{x:180,y:-240},0);
    await eventually(async()=>assert.equal((await gestureInfo()).pulling,false));assert.equal(pullEnds.at(-1).cancelled,cancelled);
    assert.deepEqual(pullEnds.at(-1).cursor,{x:1080,y:360},'release reports the last screen point even outside the crop');
    await click(pullHole);await pause(40);assert.equal(toggleCount,beforeRelease,'drag-generated click never retracts or immediately re-peeks');
    assert.equal((await gestureInfo()).headVisible,true);assert.equal((await gestureInfo()).pullPending,false);
  }
  await sendView({stage:'peeking',pulling:false,visible:true});await pause(450);pointerId++;
  const captureHole=await sourcePoint('#headArt',600,280);await pointer('pointerdown',captureHole);await pointer('pointermove',captureHole,{x:10,y:-10});
  await eventually(async()=>assert.equal((await gestureInfo()).pulling,true));
  await pointer('lostpointercapture',captureHole,{x:10,y:-10},0);await eventually(async()=>assert.equal((await gestureInfo()).pulling,false));
  assert.equal(pullEnds.at(-1).cancelled,true,'capture loss explicitly cancels the pull');
  // Native readiness is asynchronous. A release keeps awaiting its own ID,
  // while cancelled or older preparations cannot erase a newer head/capture.
  autoPullAcks=false;await sendView({stage:'peeking',pulling:false,visible:true});await pause(450);pointerId++;
  const earlyHole=await sourcePoint('#headArt',600,280),earlyStarts=pullStarts.length;
  await pointer('pointerdown',earlyHole);await pointer('pointermove',earlyHole,{x:10,y:-10});
  await eventually(()=>assert.equal(pullStarts.length,earlyStarts+1));const earlyId=pullStarts.at(-1).requestId;
  await pointer('pointerup',earlyHole,{x:100,y:-150},0);assert.equal((await gestureInfo()).pullAwaitingNative,true);assert.equal((await gestureInfo()).pulling,false);
  dock.webContents.send('recovery:pull',{phase:'started',requestId:earlyId});await eventually(async()=>assert.equal((await gestureInfo()).pulling,true));
  dock.webContents.send('recovery:pull',{phase:'ended',requestId:earlyId});await eventually(async()=>assert.equal((await gestureInfo()).pulling,false));
  assert.equal((await gestureInfo()).pullAwaitingNative,false,'matching terminal finishes an early release');
  pointerId++;const cancelledStarts=pullStarts.length;
  await pointer('pointerdown',earlyHole);await pointer('pointermove',earlyHole,{x:10,y:-10});await eventually(()=>assert.equal(pullStarts.length,cancelledStarts+1));
  const cancelledId=pullStarts.at(-1).requestId;await pointer('pointercancel',earlyHole,{x:10,y:-10},0);
  dock.webContents.send('recovery:pull',{phase:'started',requestId:cancelledId});dock.webContents.send('recovery:update',{...view,pulling:true,pullRequestId:cancelledId});
  await pause(60);assert.equal((await gestureInfo()).pulling,false,'locally cancelled readiness cannot later hide the head');
  pointerId++;const newerStarts=pullStarts.length;
  await pointer('pointerdown',earlyHole);await pointer('pointermove',earlyHole,{x:10,y:-10});await eventually(()=>assert.equal(pullStarts.length,newerStarts+1));
  const newerId=pullStarts.at(-1).requestId;assert.ok(newerId>cancelledId,'each ahoge press has a newer request ID');
  dock.webContents.send('recovery:pull',{phase:'started',requestId:cancelledId});dock.webContents.send('recovery:update',{...view,pulling:true,pullRequestId:cancelledId});
  await pause(60);assert.equal((await gestureInfo()).pulling,false,'a stale started receipt cannot hide a new pending capture');
  dock.webContents.send('recovery:pull',{phase:'started',requestId:newerId});await eventually(async()=>assert.equal((await gestureInfo()).pulling,true));
  dock.webContents.send('recovery:pull',{phase:'ended',requestId:cancelledId});await pause(40);assert.equal((await gestureInfo()).pulling,true,'a stale terminal cannot release the newer actor');
  await pointer('pointerup',earlyHole,{x:10,y:-10},0);dock.webContents.send('recovery:pull',{phase:'ended',requestId:newerId});
  await eventually(async()=>assert.equal((await gestureInfo()).pulling,false));autoPullAcks=true;
  await sendView({stage:'hidden',pulling:false,visible:true});assert.equal(await js('document.body.innerText.trim()'),'','gesture tests still end with a private hidden curl');
  assert.equal(dock.getOpacity(),0,'the QA dock stays invisible');assert.equal(dock.isVisible(),false,'capturePage never shows the QA dock');assert.equal(dock.isFocusable(),false,'the QA dock cannot steal focus');assert.equal(dock.webContents.isAudioMuted(),true,'the QA dock stays muted');
  console.log(`PASS: original continuous curl without black stubs or white headband at 65/75/100/150%; alpha-transparent hole and modest border clicks; far transparent/bubble clickthrough; hidden privacy and peek/retract; peeking-only ahoge pull with six-DIP click threshold, zoom-independent grab offsets, matching pointer release/cancellation outside crop, capture-loss cleanup and post-drag click suppression. Invisible own-window black/navy/gray/white/checker captures, synthetic input only. Artifacts: ${run}`);
  app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
setTimeout(()=>app.exit(1),45000).unref();
