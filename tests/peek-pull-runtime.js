'use strict';

const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {app,BrowserWindow,globalShortcut,ipcMain,screen,dialog}=require('electron');
const AHOGE=require('../ahoge-pull-assets');
const root=path.resolve(__dirname,'..'),run=fs.mkdtempSync(path.join(root,'work','peek-pull-qa-'));
const runtime=path.join(run,'runtime'),sessions=path.join(run,'sessions');
fs.mkdirSync(runtime);fs.mkdirSync(sessions);
Object.assign(process.env,{WHALEPET_RUNTIME_DIR:runtime,WHALEPET_CODEX_SESSIONS:sessions,WHALEPET_QA_ALLOW_SECOND_INSTANCE:'1',WHALEPET_QA_HIDDEN:'1',WHALEPET_QA_SETTINGS:'1',WHALEPET_BRIDGE_PORT:String(57000+process.pid%1000)});
delete process.env.WHALEPET_DISABLE_AUTO_FOLLOW;
app.setPath('userData',path.join(run,'electron'));app.setAppPath(root);

const shortcuts=new Map(),warnings=[],observed=new Map(),packets=[];
globalShortcut.register=(key,callback)=>{shortcuts.set(key,callback);return false;};
dialog.showMessageBox=async(_window,options)=>{warnings.push(options);return {response:0};};
// Every surface belongs to this isolated fixture. Keep native input passing
// through even when recording the application requesting an interactive area.
// Neither focus, desktop capture, keyboard/process polling nor audible playback
// is used; screen points and AI/game/activity summaries below are all fixtures.
app.on('browser-window-created',(_event,window)=>{
  const nativeOpacity=window.setOpacity.bind(window),nativeFocus=window.setFocusable.bind(window);
  window.setOpacity=()=>nativeOpacity(0);window.setFocusable=()=>nativeFocus(false);
  window.setOpacity(0);window.setFocusable(false);window.setSkipTaskbar(true);window.webContents.setAudioMuted(true);
  const events={positions:[],ignored:[]};observed.set(window.id,events);
  const bounds=window.setBounds.bind(window),position=window.setPosition.bind(window),ignore=window.setIgnoreMouseEvents.bind(window);
  window.setBounds=(value,animate)=>{events.positions.push({kind:'bounds',...value});return bounds(value,animate);};
  window.setPosition=(x,y,animate)=>{events.positions.push({kind:'position',x,y});return position(x,y,animate);};
  window.setIgnoreMouseEvents=(value,options)=>{events.ignored.push(value);return ignore(true,options);};
  window.setIgnoreMouseEvents(true,{forward:true});
  const send=window.webContents.send.bind(window.webContents);
  window.webContents.send=(channel,...args)=>{packets.push({id:window.id,channel,value:args[0]});return send(channel,...args);};
});

const monitor={starts:0,stops:0,disposed:0};
require('../user-activity').createUserActivity=options=>{
  let state='stopped';const status=()=>({state,reason:null,available:state==='running'});
  return {start(){monitor.starts++;state='running';options.onStatus?.(status());return true;},
    stop(){monitor.stops++;state='stopped';options.onStatus?.(status());},
    dispose(){monitor.disposed++;state='stopped';},getStatus:status};
};
let fixtureState={state:'reading',message:'PRIVATE_QA_PROMPT_OR_FILE_PATH'},follower;
const conversations=()=>[{id:'fixture',title:'测试任务',state:fixtureState.state,primary:true,uncertain:false,message:fixtureState.message}];
require('../codex-state-follower').CodexStateFollower=class {
  constructor(options){this.options=options;follower=this;this.reducer={current:()=>fixtureState,conversations,overflow:()=>({count:0,uncertain:0}),hasUnresolved:()=>true};}
  start(){this.options.onStatus?.({status:'following'});this.options.onState?.(fixtureState);}
  stop(){}
  async reload(){this.options.onState?.(fixtureState);}
};
const preferences=require('../preferences').normalizePreferences({scale:.75,idleLife:false,idleSongEnabled:false,typingCompanion:true,gameCompanion:true,games:['qa-game'],bubbleScale:.93,bubbleOffset:4});
fs.writeFileSync(path.join(runtime,'preferences.json'),JSON.stringify(preferences));

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function eventually(check){let last;for(let attempt=0;attempt<150;attempt++)try{return await check();}catch(error){last=error;await pause(40);}throw last;}
const inside=(bounds,area)=>bounds.x>=area.x-2&&bounds.y>=area.y-2&&bounds.x+bounds.width<=area.x+area.width+2&&bounds.y+bounds.height<=area.y+area.height+2;
const samePoint=(actual,expected,label)=>{assert.ok(Math.abs(actual.x-expected.x)<=2&&Math.abs(actual.y-expected.y)<=2,label+': '+JSON.stringify({actual,expected}));};
let cursor={x:-1000000,y:-1000000},displays,primary,secondary,initialListeners;
app.whenReady().then(()=>{
  screen.getCursorScreenPoint=()=>({...cursor});
  initialListeners=Object.fromEntries(['display-added','display-removed','display-metrics-changed'].map(event=>[event,screen.listenerCount(event)]));
  const actual=screen.getPrimaryDisplay(),make=(id,area)=>({...actual,id,bounds:{...area},workArea:{...area},size:{width:area.width,height:area.height},workAreaSize:{width:area.width,height:area.height}});
  primary=make(111,{x:0,y:0,width:1600,height:1200});secondary=make(222,{x:-1600,y:-150,width:1600,height:1200});displays=[primary,secondary];
  screen.getPrimaryDisplay=()=>primary;screen.getAllDisplays=()=>displays.map(display=>({...display}));
  screen.getDisplayNearestPoint=point=>displays.reduce((best,display)=>{
    const area=display.workArea,dx=point.x-Math.max(area.x,Math.min(point.x,area.x+area.width)),dy=point.y-Math.max(area.y,Math.min(point.y,area.y+area.height));
    const distance=dx*dx+dy*dy;return !best||distance<best.distance?{display,distance}:best;
  },null).display;
});

require('../main');
app.whenReady().then(async()=>{
  const find=name=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().split(/[?#]/)[0].endsWith(name));
  const pet=await eventually(()=>{const window=find('index.html');assert.ok(window);return window;}),settings=await eventually(()=>{const window=find('settings.html');assert.ok(window);return window;});
  const js=source=>pet.webContents.executeJavaScript(source),ui=source=>settings.webContents.executeJavaScript(source);
  const good=async source=>{const result=await ui(source);assert.equal(result.ok,true,result.error);return result.value;};
  const snapshot=()=>good('petSettings.get()'),action=name=>good(`petSettings.companion(${JSON.stringify(name)})`);
  const stage=value=>eventually(async()=>assert.equal((await snapshot()).companion.hideStage,value));
  await eventually(async()=>assert.equal(await js('typeof whalePetController'),'object'));
  await eventually(async()=>assert.equal(await ui('typeof petSettings.companion'),'function'));
  await eventually(async()=>assert.equal(await js('whalePetController.getState().state'),'reading'));
  assert.ok(monitor.starts>0,'only the opt-in fake activity monitor runs');
  assert.equal((await snapshot()).companion.trayAvailable,false,'QA does not replace the running desktop companion tray');
  pet.webContents.debugger.attach('1.3');
  await pet.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  // Native visibility is exercised with opacity and focus forcibly disabled.
  process.env.WHALEPET_QA_HIDDEN='0';await action('show');await stage('normal');
  pet.setPosition(secondary.workArea.x+350,secondary.workArea.y+200);
  const oldHome=pet.getBounds();await action('hide');await stage('hidden');
  const dock=await eventually(()=>{const window=find('recovery.html');assert.ok(window);return window;});
  const recovery=source=>dock.webContents.executeJavaScript(source),peek=()=>recovery('whalePeekController.info()');
  const travel=source=>find('edge-travel.html').webContents.executeJavaScript(source);
  await eventually(async()=>assert.equal((await peek()).ready,true));
  for(const window of [pet,dock])await window.webContents.executeJavaScript(`for(const type of ['mousemove','pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'])document.addEventListener(type,event=>{if(event.isTrusted)event.stopImmediatePropagation();},true)`);
  const sourcePoint=async(id,x,y)=>recovery(`(()=>{const art=document.querySelector(${JSON.stringify(id)}),b=art.getBoundingClientRect();return {x:b.left+${x}*b.width/art.naturalWidth,y:b.top+${y}*b.height/art.naturalHeight};})()`);
  const toScreen=point=>{const b=dock.getContentBounds(),z=dock.webContents.getZoomFactor();return {x:Math.round(b.x+point.x*z),y:Math.round(b.y+point.y*z)};};
  const click=point=>recovery(`document.querySelector('#restorePet').dispatchEvent(new MouseEvent('click',{detail:1,button:0,bubbles:true,clientX:${point.x},clientY:${point.y}}))`);
  const peekHead=async()=>{if((await peek()).stage==='hidden')await click(await sourcePoint('#curlArt',600,280));await stage('peeking');await eventually(async()=>assert.equal((await peek()).headVisible,true));await pause(440);};
  const trusted=window=>({sender:window.webContents,senderFrame:window.webContents.mainFrame});
  const captureOwn=async(window,name)=>{
    await window.webContents.capturePage(undefined,{stayHidden:true});await pause(80);
    const image=await window.webContents.capturePage(undefined,{stayHidden:true});assert.equal(image.isEmpty(),false);
    fs.writeFileSync(path.join(run,name),image.toPNG());
  };

  // Untrusted DOM PointerEvents cannot own native pointer capture. The fixture
  // supplies that bookkeeping inside its own renderer so all gestures remain
  // synthetic, including releases outside the old crop.
  await recovery(`(()=>{const target=document.querySelector('#restorePet');let captured=null;target.setPointerCapture=id=>{captured=id};target.hasPointerCapture=id=>captured===id;target.releasePointerCapture=id=>{if(captured===id)captured=null};})()`);
  let pointerId=1,directRequestId=1000;
  const pointer=(type,point,global,buttons=1,id=pointerId)=>recovery(`document.querySelector('#restorePet').dispatchEvent(new PointerEvent(${JSON.stringify(type)},{pointerId:${id},pointerType:'mouse',isPrimary:true,button:0,buttons:${buttons},bubbles:true,cancelable:true,clientX:${point.x},clientY:${point.y},screenX:${global.x},screenY:${global.y}}))`);
  const ahogeDetails=async()=>recovery(`(()=>{const art=document.querySelector('#headArt'),b=art.getBoundingClientRect(),sourceX=600,sourceY=280,grabX=sourceX*b.width/art.naturalWidth,grabY=sourceY*b.height/art.naturalHeight;return {grabX,grabY,sourceX,sourceY,artWidth:b.width,artHeight:b.height,x:b.left+grabX,y:b.top+grabY};})()`);
  const beginGesture=async()=>{
    const details=await ahogeDetails(),point={x:details.x,y:details.y},press=toScreen(point);cursor={...press};pointerId++;
    await pointer('pointerdown',point,press);
    cursor={x:press.x+20,y:press.y-35};
    await pointer('pointermove',{x:point.x+20/dock.webContents.getZoomFactor(),y:point.y-35/dock.webContents.getZoomFactor()},cursor);
    await stage('pulling');await eventually(async()=>assert.equal((await peek()).pulling,true));
    return {details,point,press,id:pointerId};
  };
  const releaseGesture=async(gesture,cancelled=false)=>{
    const content=dock.getContentBounds(),z=dock.webContents.getZoomFactor(),point={x:(cursor.x-content.x)/z,y:(cursor.y-content.y)/z};
    await pointer(cancelled?'pointercancel':'pointerup',point,cursor,0,gesture.id);
  };
  const beginDirect=async extra=>{
    const details=await ahogeDetails(),press=toScreen(details);
    const value={...details,pressScreenX:press.x,pressScreenY:press.y,cursor:{x:press.x+20,y:press.y-35},pointerId:++pointerId,requestId:++directRequestId,...extra};
    cursor={...value.cursor};ipcMain.emit('recovery:pull-start',trusted(dock),value);return value;
  };
  const assertNormal=async expectedState=>{
    await stage('normal');await eventually(async()=>assert.equal((await snapshot()).companion.pullActive,false));
    await eventually(()=>assert.equal(find('edge-travel.html')?.isVisible()||false,false,'final upright surface is retired after handoff'));
    assert.equal(dock.isVisible(),false);assert.equal(pet.isVisible(),true);
    assert.equal(await js('whalePetController.dragPhysicsInfo().active'),false,'peek pulling never starts the inverted tail pendulum');
    assert.equal(await js("document.querySelector('#pet').classList.contains('is-dragging')"),false);
    if(expectedState)await eventually(async()=>assert.equal(await js('whalePetController.getState().state'),expectedState));
    assert.doesNotMatch(await js('whalePetController.getState().frame'),/tail-hang/,'release displays a real AI pose');
    await eventually(async()=>assert.equal(await js('whalePetController.layerInfo().visibleLayers'),1));
  };
  const assertCancelled=async()=>{
    await stage('peeking');await eventually(async()=>assert.equal((await peek()).pulling,false));
    assert.equal((await snapshot()).companion.pullActive,false);assert.equal(pet.isVisible(),false);assert.equal(dock.isVisible(),true);
    await eventually(()=>assert.equal(find('edge-travel.html')?.isVisible()||false,false,'cancellation leaves no upright surface'));
    assert.equal(await js('whalePetController.dragPhysicsInfo().active'),false);
  };

  // A hidden-only curl stays a click target. Dragging it cannot reveal a body.
  const hiddenHole=await sourcePoint('#curlArt',600,280),hiddenPress=toScreen(hiddenHole);
  await pointer('pointerdown',hiddenHole,hiddenPress);await pointer('pointermove',hiddenHole,{x:hiddenPress.x+30,y:hiddenPress.y-80});await pointer('pointerup',hiddenHole,hiddenPress,0);
  assert.equal((await peek()).pullRequested,false);assert.equal((await snapshot()).companion.pullActive,false);
  await beginDirect();await pause(100);await stage('hidden');
  assert.equal(pet.isVisible(),false,'hidden-only curl rejects forged pull-start as well');
  await peekHead();
  const details=await ahogeDetails(),hole={x:details.x,y:details.y};
  assert.equal(await recovery(`whalePeekController.hitAhoge(${hole.x},${hole.y})`),true,'peeking curl hole is a drag handle');
  assert.equal(await recovery(`(()=>{const art=document.querySelector('#headArt'),c=document.createElement('canvas');c.width=art.naturalWidth;c.height=art.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(art,0,0);return ctx.getImageData(600,280,1,1).data[3];})()`),0,'the pull test uses the truly transparent inside of the ahoge');

  // Unauthorized renderers/subframes and a non-ahoge head press cannot start.
  const valid={...details,pressScreenX:toScreen(hole).x,pressScreenY:toScreen(hole).y,cursor:toScreen(hole),pointerId:++pointerId,requestId:++directRequestId};
  for(const event of [trusted(pet),trusted(settings),{sender:dock.webContents,senderFrame:{}}])ipcMain.emit('recovery:pull-start',event,valid);
  ipcMain.emit('recovery:pull-start',trusted(dock),{...valid,grabY:129,sourceY:600});
  await pause(100);assert.equal((await snapshot()).companion.pullActive,false);await stage('peeking');
  const face=await sourcePoint('#headArt',600,675),faceScreen=toScreen(face);
  assert.equal(await recovery(`whalePeekController.hitTest(${face.x},${face.y})`),true,'the head fixture is visible and interactive');
  assert.equal(await recovery(`whalePeekController.hitAhoge(${face.x},${face.y})`),false,'the cheek cannot act as the ahoge handle');
  await pointer('pointerdown',face,faceScreen);await pointer('pointermove',face,{x:faceScreen.x+15,y:faceScreen.y-15});await pointer('pointerup',face,faceScreen,0);await click(face);
  await stage('hidden');assert.equal(pet.isVisible(),false,'a head click retracts without pulling');await peekHead();

  // Exactly six screen DIPs remains a click, across the scaled renderer.
  const clickHole=await sourcePoint('#headArt',600,280),clickPress=toScreen(clickHole);pointerId++;
  await pointer('pointerdown',clickHole,clickPress);assert.equal((await peek()).pullPending,true);
  await pointer('pointermove',clickHole,{x:clickPress.x+6,y:clickPress.y});
  assert.equal((await peek()).pullRequested,false,'the six-DIP threshold does not start a pull');
  await pointer('pointerup',clickHole,clickPress,0);await click(clickHole);await stage('hidden');assert.equal(pet.isVisible(),false);await peekHead();

  const measurements=[];let surfaceId;
  for(const [index,scale]of [.65,.75,1,1.5].entries()){
    if((await snapshot()).companion.hideStage!=='normal'){await action('show');await assertNormal();}
    await good(`petSettings.save({scale:${scale}})`);
    const homeDisplay=index%2?secondary:primary,targetDisplay=index%2?primary:secondary;
    pet.setPosition(homeDisplay.workArea.x+350,homeDisplay.workArea.y+200);
    const home=pet.getBounds();await action('hide');await stage('hidden');await peekHead();
    const geometry=dock.getContentBounds(),gesture=await beginGesture();
    const surface=find('edge-travel.html');assert.ok(surface);
    if(surfaceId!==undefined)assert.equal(surface.id,surfaceId,'pull surface is reused instead of accumulating windows');surfaceId=surface.id;
    await eventually(async()=>{const value=await travel('edgeTravel.info()');assert.equal(value.mode,'pull');assert.equal(value.pulling,true);});
    if(index===0){
      const requestId=(await peek()).pullRequestId;
      for(const event of [trusted(pet),trusted(settings),{sender:dock.webContents,senderFrame:{}}])ipcMain.emit('recovery:pull-end',event,{cancelled:true,requestId});
      ipcMain.emit('recovery:pull-end',trusted(dock),{cancelled:true,requestId:requestId+9999});
      await pause(100);await stage('pulling');assert.equal((await snapshot()).companion.pullActive,true,'unauthorized or stale end packets cannot stop the current pull');
    }
    const initialBounds=surface.getBounds(),initialMoves=observed.get(surface.id).positions.length;
    assert.ok(inside({x:targetDisplay.workArea.x+800,y:targetDisplay.workArea.y+600,width:1,height:1},surface.getContentBounds()),'one stationary compositor covers the other monitor before the cross-display drag');
    assert.equal(pet.isVisible(),false,'the normal pet stays hidden during the extraction');
    assert.equal((await peek()).headVisible,false);assert.equal((await peek()).bubbleCount,0,'the pulled actor leaves no status bubbles behind');
    assert.equal(surface.hasShadow(),false,'the upright transient window has no native shadow');
    assert.equal(await travel('document.body.innerText.trim()'),'','pull artwork has no provider/status/message labels');
    const shape=await travel(`(()=>{const actor=document.querySelector('#actor'),style=getComputedStyle(actor),m=new DOMMatrix(style.transform),info=edgeTravel.info();return {a:m.a,b:m.b,c:m.c,d:m.d,width:parseFloat(style.width),height:parseFloat(style.height),filter:style.filter,shadow:style.boxShadow,src:document.querySelector('#pullOpen')?.getAttribute('src'),pose:info.pullPose,texturesReady:info.pullTexturesReady};})()`);
    assert.ok(Math.abs(shape.a*shape.d-shape.b*shape.c-1)<.002,'swing rotates the fixed texture without stretching it');
    assert.ok(Math.abs(shape.width-275*scale)<=1&&Math.abs(shape.height-275*scale)<=1,'upright actor preserves its authored CSS size at '+scale);
    assert.equal(shape.filter,'none');assert.equal(shape.shadow,'none');assert.match(shape.src,/ahoge-pull\/open\.png$/);
    assert.equal(shape.pose,'open','the new upright gesture opens her eyes first');assert.equal(shape.texturesReady,true);
    cursor={x:targetDisplay.workArea.x+800,y:targetDisplay.workArea.y+600};
    assert.equal(inside({x:cursor.x,y:cursor.y,width:1,height:1},geometry),false,'cursor leaves the old recovery window');
    // No recovery:pull-move is sent here: the authoritative native cursor poll
    // must keep tracking after the pointer leaves the cropped recovery window.
    await eventually(async()=>{const value=await travel('edgeTravel.info()'),content=surface.getContentBounds();samePoint({x:content.x+value.pullAnchor.x,y:content.y+value.pullAnchor.y},cursor,'the new stretched ahoge tip follows the actual cursor outside the crop despite inertia');});
    assert.deepEqual(surface.getBounds(),initialBounds,'native pull surface stays stationary while the compositor follows the cursor');
    assert.equal(observed.get(surface.id).positions.length,initialMoves,'cursor tracking makes no per-frame native movement');
    fixtureState={state:index%2?'working':'needs_input',message:'PRIVATE_QA_PROMPT_OR_FILE_PATH'};follower.options.onState(fixtureState);
    const crop=await travel(`(()=>{const b=document.querySelector('#actor').getBoundingClientRect();return {x:Math.max(0,Math.floor(b.left-8)),y:Math.max(0,Math.floor(b.top-8)),width:Math.ceil(b.width+16),height:Math.ceil(b.height+16)};})()`);
    fs.writeFileSync(path.join(run,'upright-pull-'+Math.round(scale*100)+'.png'),(await surface.webContents.capturePage(crop,{stayHidden:true})).toPNG());
    const drop={...cursor};await releaseGesture(gesture);await assertNormal(fixtureState.state);
    await click(gesture.point);await pause(80);await stage('normal');
    const content=pet.getContentBounds();samePoint({x:content.x+(142.5+AHOGE.pivot.x)*scale,y:content.y+(225+AHOGE.pivot.y)*scale},drop,'release keeps the final stretched ahoge drop position instead of returning to the old home');
    assert.ok(inside(content,targetDisplay.workArea),'release restores the normal pet inside the destination monitor work area');
    assert.notDeepEqual({x:pet.getBounds().x,y:pet.getBounds().y},{x:home.x,y:home.y});
    samePoint(JSON.parse(fs.readFileSync(path.join(runtime,'window-state.json'),'utf8')),{x:Math.round(pet.getBounds().x+130*scale),y:Math.round(pet.getBounds().y+170*scale)},'saved position records the drop rather than the old hidden home');
    assert.equal(dock.hasShadow(),false,'the reused recovery crop has no native shadow');
    measurements.push({scale,home,drop,final:pet.getBounds(),surface:initialBounds,shape});
    assert.equal(BrowserWindow.getAllWindows().filter(window=>window.webContents.getURL().endsWith('edge-travel.html')).length,1,'at most one transient actor exists');
  }
  await good('petSettings.save({scale:.75})');

  // Capture loss and an explicit cancelled release restore the same peeking
  // head instead of converting cancellation into a normal desktop drag.
  await action('hide');await stage('hidden');await peekHead();let gesture=await beginGesture();
  cursor={x:primary.workArea.x+750,y:primary.workArea.y+400};await releaseGesture(gesture,true);await assertCancelled();
  await pause(240);assert.equal((await peek()).headVisible,true);assert.equal((await peek()).bubbleCount,1);
  await captureOwn(dock,'cancelled-back-to-peek.png');
  gesture=await beginGesture();await pointer('lostpointercapture',gesture.point,cursor,0,gesture.id);await assertCancelled();

  // Display removal and size changes cancel safely, keep the reachable head
  // inside a remaining work area, and permit another pull immediately.
  await action('show');await assertNormal();pet.setPosition(secondary.workArea.x+350,secondary.workArea.y+200);
  await action('hide');await stage('hidden');await peekHead();await beginGesture();
  displays=[primary];screen.emit('display-removed',{},secondary);await assertCancelled();
  await eventually(()=>assert.ok(inside(dock.getContentBounds(),primary.workArea),'monitor removal keeps the peeking recovery reachable'));
  displays=[primary,secondary];screen.emit('display-added',{},secondary);
  await eventually(()=>assert.ok(inside(dock.getContentBounds(),secondary.workArea),'the old monitor can receive recovery again'));
  await beginGesture();await good('petSettings.save({scale:1})');await assertCancelled();
  await eventually(()=>assert.equal(dock.webContents.getZoomFactor(),1));
  assert.ok(inside(dock.getContentBounds(),secondary.workArea),'resized recovery remains on the hidden display');
  await good('petSettings.save({scale:.75})');

  // End packets can arrive while async sprite preparation is still pending.
  // Repeated immediate release must never leave a late actor or inverted pose.
  for(let cycle=0;cycle<6;cycle++){
    if((await snapshot()).companion.hideStage==='normal'){await action('hide');await stage('hidden');}
    await peekHead();
    const start=await beginDirect(),drop={x:primary.workArea.x+700+cycle*10,y:primary.workArea.y+600};cursor={...drop};
    ipcMain.emit('recovery:pull-end',trusted(dock),{cancelled:false,cursor:drop,requestId:start.requestId});
    await assertNormal(fixtureState.state);await pause(100);
    assert.equal((await snapshot()).companion.pullActive,false);assert.equal(find('edge-travel.html').isVisible(),false);
    assert.ok(start.grabX>0);
  }
  await action('hide');await stage('hidden');await peekHead();const pendingCancel=await beginDirect();
  ipcMain.emit('recovery:pull-end',trusted(dock),{cancelled:true,cursor,requestId:pendingCancel.requestId});await assertCancelled();
  await pause(300);assert.equal(find('edge-travel.html').isVisible(),false,'a cancelled pending preparation cannot reappear');

  // Only this fixture's transient renderer is crashed. Its loss cancels back
  // to the reachable peeking head and a new surface can handle the next pull.
  await beginGesture();const crashed=find('edge-travel.html');crashed.webContents.forcefullyCrashRenderer();
  await assertCancelled();await eventually(()=>assert.equal(crashed.isDestroyed(),true));
  gesture=await beginGesture();assert.notEqual(find('edge-travel.html').id,crashed.id,'the next pull recreates a healthy compositor surface');
  await releaseGesture(gesture,true);await assertCancelled();

  // The existing normal body drag still pins its short tail and releases using
  // click-to-release displacement; the new gesture never replaces that path.
  await action('show');await assertNormal();pet.setPosition(primary.workArea.x+350,primary.workArea.y+180);
  const before=pet.getBounds(),content=pet.getContentBounds(),scale=pet.webContents.getZoomFactor();
  const press={x:Math.round(content.x+310*scale),y:Math.round(content.y+390*scale)};cursor={...press};
  await js("pet.classList.add('is-dragging');startDragVisual()");
  ipcMain.emit('pet:drag-start',trusted(pet),{tailAnchor:{x:150,y:110},pressScreenX:press.x,pressScreenY:press.y});
  await eventually(async()=>assert.match(await js('whalePetController.getState().frame'),/tail-hang\/pose.png/));
  const tailContent=pet.getContentBounds();samePoint({x:tailContent.x+280*scale,y:tailContent.y+280*scale},cursor,'normal drag keeps its original inverted tail anchor');
  cursor={x:press.x+17,y:press.y-9};ipcMain.emit('pet:drag-end',trusted(pet),{cursor});
  await js("pet.classList.remove('is-dragging');stopDragVisual()");
  samePoint(pet.getBounds(),{x:before.x+17,y:before.y-9},'normal drag releases by its original pointer displacement');
  await eventually(async()=>assert.equal(await js('whalePetController.dragPhysicsInfo().active'),false));
  await good('petSettings.save({scale:.75})');
  fs.writeFileSync(path.join(run,'measurements.json'),JSON.stringify({oldHome,measurements},null,2));

  assert.equal(warnings.length,0,'successful pull recovery needs no dialogs');
  assert.deepEqual((await snapshot()).preferences,preferences,'pull actions preserve appearance and companion preferences');
  assert.ok(!JSON.stringify(packets.filter(packet=>packet.channel==='recovery:update')).includes('PRIVATE_QA_PROMPT_OR_FILE_PATH'),'recovery/pull packets never contain the arbitrary AI message');
  for(const window of BrowserWindow.getAllWindows()){
    assert.equal(window.getOpacity(),0,'all QA surfaces remain invisible');assert.equal(window.isFocusable(),false,'QA cannot steal focus');
    assert.equal(window.webContents.isAudioMuted(),true,'every own renderer remains muted');
  }
  app.on('will-quit',()=>{
    for(const channel of ['recovery:pull-start','recovery:pull-move','recovery:pull-end'])assert.equal(ipcMain.listenerCount(channel),0,'quit removes pull IPC');
    for(const [event,count]of Object.entries(initialListeners))assert.equal(screen.listenerCount(event),count,'quit removes display listeners');
    assert.equal(monitor.disposed,1,'quit disposes the fixture monitor');
    console.log('PASS: hidden-only rejection, trusted sender/ahoge validation, click threshold/head retraction, upright scale-preserving extraction through the alpha hole at 65/75/100/150%, actual cursor tracking outside the crop across monitors, stationary native surface, latest AI/drop-position restore, cancellation/capture loss, monitor/resize recovery, immediate releases without orphan windows, and unchanged normal tail dragging. All QA surfaces invisible/muted/input-through with fake activity/AI/game/cursor. Artifacts: '+run);
  });
  app.quit();
}).catch(error=>{console.error(error);console.error('Artifacts: '+run);app.exit(1);});
setTimeout(()=>{console.error('Peek pull runtime QA timed out. Artifacts: '+run);app.exit(1);},90000).unref();
