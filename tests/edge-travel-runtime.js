'use strict';

const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {app,BrowserWindow,globalShortcut,screen,dialog}=require('electron');
const root=path.resolve(__dirname,'..'),run=fs.mkdtempSync(path.join(root,'work','edge-travel-qa-'));
const runtime=path.join(run,'runtime'),sessions=path.join(run,'sessions');
fs.mkdirSync(runtime);fs.mkdirSync(sessions);
Object.assign(process.env,{WHALEPET_RUNTIME_DIR:runtime,WHALEPET_CODEX_SESSIONS:sessions,WHALEPET_DISABLE_AUTO_FOLLOW:'1',WHALEPET_QA_ALLOW_SECOND_INSTANCE:'1',WHALEPET_QA_HIDDEN:'1',WHALEPET_QA_SETTINGS:'1',WHALEPET_BRIDGE_PORT:String(56000+process.pid%1000)});
app.setPath('userData',path.join(run,'electron'));app.setAppPath(root);
globalShortcut.register=()=>false;
const warnings=[];
dialog.showMessageBox=async(_window,options)=>{warnings.push(options);return {response:0};};
// Isolated fixture: no real keyboard/cursor capture, process listing, shortcuts,
// tray icon, audible playback, focus changes or visible test artwork.
app.whenReady().then(()=>{screen.getCursorScreenPoint=()=>({x:-1000000,y:-1000000});});
require('../user-activity').createUserActivity=()=>({start:()=>false,stop(){},dispose(){},getStatus:()=>({state:'stopped',available:false})});
const normalize=require('../preferences').normalizePreferences;
const originalPreferences=normalize({scale:.75,idleLife:false,idleSongEnabled:false});
fs.writeFileSync(path.join(runtime,'preferences.json'),JSON.stringify(originalPreferences));
const observed=new Map();
app.on('browser-window-created',(_event,window)=>{
  window.setOpacity(0);window.setSkipTaskbar(true);window.setFocusable(false);window.webContents.setAudioMuted(true);
  const events={positions:[],ignored:[]};observed.set(window.id,events);
  const setBounds=window.setBounds.bind(window),setPosition=window.setPosition.bind(window),setIgnore=window.setIgnoreMouseEvents.bind(window);
  window.setBounds=(bounds,animate)=>{events.positions.push({time:performance.now(),kind:'bounds',...bounds});return setBounds(bounds,animate);};
  window.setPosition=(x,y,animate)=>{events.positions.push({time:performance.now(),kind:'position',x,y});return setPosition(x,y,animate);};
  window.setIgnoreMouseEvents=(ignored,options)=>{events.ignored.push(ignored);return setIgnore(ignored,options);};
});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function eventually(fn){let last;for(let i=0;i<150;i++)try{return await fn();}catch(error){last=error;await pause(40);}throw last;}
const percentile=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted.length?sorted[Math.floor((sorted.length-1)*p)]:0;};
const measurements=[];
require('../main');
app.whenReady().then(async()=>{
  const findWindow=name=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().split(/[?#]/)[0].endsWith(name));
  const pet=await eventually(()=>{const window=findWindow('index.html');assert.ok(window);return window;});
  const settings=await eventually(()=>{const window=findWindow('settings.html');assert.ok(window);return window;});
  const js=source=>pet.webContents.executeJavaScript(source),ui=source=>settings.webContents.executeJavaScript(source);
  const good=async source=>{const result=await ui(source);assert.equal(result.ok,true,result.error);return result.value;};
  const snapshot=()=>good('petSettings.get()');
  const action=name=>good(`petSettings.companion(${JSON.stringify(name)})`);
  const stage=value=>eventually(async()=>assert.equal((await snapshot()).companion.hideStage,value));
  const captureActor=async(window,name)=>{
    const crop=await window.webContents.executeJavaScript(`(()=>{const actor=document.querySelector('#actor'),animation=actor.getAnimations()[0];if(!animation)throw new Error('No active compositor animation to capture');animation.pause();const box=actor.getBoundingClientRect(),x=Math.max(0,Math.floor(box.x-8)),y=Math.max(0,Math.floor(box.y-8)),right=Math.min(innerWidth,Math.ceil(box.right+8)),bottom=Math.min(innerHeight,Math.ceil(box.bottom+8));return {x,y,width:Math.max(1,right-x),height:Math.max(1,bottom-y)};})()`);
    try{
      await window.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const image=await window.webContents.capturePage(crop,{stayHidden:true});
      assert.equal(image.isEmpty(),false,'own journey actor crop is available for visual QA');
      fs.writeFileSync(path.join(run,name),image.toPNG());
      fs.writeFileSync(path.join(run,name+'.json'),JSON.stringify(crop,null,2));
    }finally{
      if(!window.isDestroyed())await window.webContents.executeJavaScript("document.querySelector('#actor').getAnimations()[0]?.play()");
    }
  };
  await eventually(async()=>assert.equal(await js('typeof whalePetController'),'object'));
  await eventually(async()=>assert.equal(await ui('typeof petSettings.companion'),'function'));
  pet.webContents.debugger.attach('1.3');
  await pet.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  process.env.WHALEPET_QA_HIDDEN='0';
  await action('show');await stage('normal');
  const area=screen.getPrimaryDisplay().workArea;
  let journeyId;
  for(const scale of [.65,.75,1,1.5]){
    await good(`petSettings.save({scale:${scale}})`);
    pet.setPosition(area.x+80,area.y+70);
    const home=pet.getBounds(),nativeEvents=observed.get(pet.id);
    nativeEvents.positions.length=0;
    const hiding=action('hide');
    await eventually(async()=>{const info=await js('whalePetController.edgeInfo()');assert.equal(info.phase,'hiding');assert.equal(info.traveling,true);});
    const journey=await eventually(()=>{const window=findWindow('edge-travel.html');assert.ok(window);return window;});
    if(journeyId!==undefined)assert.equal(journey.id,journeyId,'journey surface is reused across hide/show without accumulating windows');
    journeyId=journey.id;
    const travel=source=>journey.webContents.executeJavaScript(source);
    await eventually(async()=>{const info=await travel('edgeTravel.info()');assert.equal(info.ready,true);assert.equal(info.mode,'hiding');assert.equal(info.animated,true);});
    const bounds=journey.getBounds(),initialMoves=observed.get(journey.id).positions.length;
    assert.equal(pet.isVisible(),false,'normal main window is not repainted while the separate actor travels');
    assert.equal(await travel('document.body.textContent.trim()'),'','escape contains no AI labels, status bubble, provider or message');
    const recording=travel(`new Promise(resolve=>{const samples=[],start=performance.now();function sample(time){const info=edgeTravel.info();samples.push({time,mode:info.mode,animated:info.animated,actor:info.actorRect});if(performance.now()-start<1250)requestAnimationFrame(sample);else resolve(samples);}requestAnimationFrame(sample);})`);
    await pause(150);
    assert.deepEqual(journey.getBounds(),bounds,'native journey bounds do not move during visible travel');
    assert.equal(observed.get(journey.id).positions.length,initialMoves,'compositor travel makes no frame-by-frame native position calls');
    assert.deepEqual(pet.getBounds(),home,'invisible main window remains at its original position until the final handoff');
    await hiding;await stage('hidden');
    const samples=await recording;
    const frames=samples.filter(sample=>sample.mode==='hiding'&&sample.animated&&sample.actor);
    assert.ok(frames.length>=5,'renderer receives animation-frame samples at '+scale);
    const points=frames.map(sample=>sample.actor.x.toFixed(3)+','+sample.actor.y.toFixed(3));
    assert.ok(new Set(points).size>=5,'compositor actor visits fractional intermediate positions at '+scale);
    assert.ok(frames.some(sample=>Math.abs(sample.actor.y-frames[0].actor.y)>20),'actor moves toward the screen edge at '+scale);
    assert.ok(frames.some(sample=>Math.abs(sample.actor.y-Math.round(sample.actor.y))>.01),'motion keeps sub-DIP precision rather than integer OS position steps');
    assert.ok(observed.get(journey.id).ignored.every(value=>value===true),'the entire transient journey surface always passes pointer input through');
    assert.equal(journey.isVisible(),false,'finished hide dismisses the transient journey surface');
    const moves=nativeEvents.positions.filter(event=>event.x!==undefined&&event.y!==undefined);
    assert.ok(new Set(moves.map(point=>point.x+','+point.y)).size<=2,'only setup/handoff may relocate the invisible main window');
    const intervals=frames.slice(1).map((sample,i)=>sample.time-frames[i].time).filter(value=>value>0);
    measurements.push({scale,frameCount:frames.length,uniquePositions:new Set(points).size,medianMs:percentile(intervals,.5),p95Ms:percentile(intervals,.95),maxMs:Math.max(0,...intervals),mainPositionCalls:moves.length,journeyPositionCallsDuringMotion:observed.get(journey.id).positions.length-initialMoves});
    fs.writeFileSync(path.join(run,'frames-'+scale+'.json'),JSON.stringify(samples,null,2));
    const showing=action('show');
    await eventually(async()=>{const info=await js('whalePetController.edgeInfo()');assert.equal(info.phase,'emerging');assert.equal(info.traveling,true);});
    assert.equal(pet.isVisible(),false,'return journey also keeps the real pet hidden until handoff');
    await showing;await stage('normal');
    assert.equal(pet.isVisible(),true);await eventually(()=>assert.equal(journey.isVisible(),false,'normal handoff retires the final travel frame after the pet is drawn'));
    const returned=pet.getBounds();assert.equal(returned.x,home.x);assert.equal(returned.y,home.y);
    assert.ok(Math.abs(returned.width-home.width)<=3&&Math.abs(returned.height-home.height)<=3,'normal window size is restored without frame drift');
    assert.equal(await js('whalePetController.edgeInfo().traveling'),false,'normal handoff clears compositor-travel state');
  }
  // Visual QA uses a separate journey so paused captures never affect the
  // measured frame traces above. Capture only this fixture's actor viewport.
  await good('petSettings.save({scale:.75})');pet.setPosition(area.x+90,area.y+80);
  const visualHide=action('hide'),visualJourney=findWindow('edge-travel.html');
  await eventually(async()=>{const info=await visualJourney.webContents.executeJavaScript('edgeTravel.info()');assert.equal(info.mode,'hiding');assert.equal(info.animated,true);});
  await pause(150);await captureActor(visualJourney,'travel-75-mid-run.png');
  await visualHide;await stage('hidden');
  const visualShow=action('show');
  await eventually(async()=>{const info=await visualJourney.webContents.executeJavaScript('edgeTravel.info()');assert.equal(info.mode,'emerging');assert.equal(info.animated,true);});
  await pause(200);await captureActor(visualJourney,'travel-75-jump-out.png');
  await visualShow;await stage('normal');await eventually(()=>assert.equal(visualJourney.isVisible(),false));
  // Latest user intent must cancel the compositor and prevent late native moves.
  await good('petSettings.save({scale:.75})');pet.setPosition(area.x+90,area.y+80);
  const cancelHome=pet.getBounds(),hiding=action('hide');
  await eventually(async()=>assert.equal(await js('whalePetController.edgeInfo().phase'),'hiding'));
  await pause(90);const showing=action('show');await Promise.all([hiding,showing]);await stage('normal');
  assert.equal(pet.getBounds().x,cancelHome.x);assert.equal(pet.getBounds().y,cancelHome.y);
  await pause(1100);assert.equal((await snapshot()).companion.hideStage,'normal','cancelled escape cannot tuck the pet after she returned');
  const race=await ui('Promise.all([petSettings.companion("hide"),petSettings.companion("show"),petSettings.companion("hide")])');
  assert.ok(race.every(reply=>reply.ok),JSON.stringify(race));await stage('hidden');
  await action('show');await stage('normal');
  // Changing size during a journey must leave a reachable curl, not an orphan actor.
  const resizing=action('hide');await eventually(async()=>assert.equal(await js('whalePetController.edgeInfo().phase'),'hiding'));
  await good('petSettings.save({scale:1})');await resizing;await stage('hidden');
  assert.equal(findWindow('edge-travel.html').isVisible(),false);
  const dock=findWindow('recovery.html');assert.ok(dock);assert.equal(dock.isVisible(),true);
  await action('show');await stage('normal');await good('petSettings.save({scale:.75})');
  // Respect accessibility: no compositor animation when reduced motion is set.
  await pet.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await action('hide');await stage('hidden');assert.equal(findWindow('edge-travel.html').isVisible(),false);
  await action('show');await stage('normal');assert.equal(await js('whalePetController.edgeInfo().traveling'),false);
  // Crashing only this fixture's transient renderer must restore the real pet,
  // report through our mock dialog, and allow the next hide to recreate it.
  assert.equal(warnings.length,0,'successful journeys need no warning dialogs');
  await pet.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  const crashHome=pet.getBounds(),failedHide=action('hide'),crashed=findWindow('edge-travel.html');
  await eventually(async()=>{const info=await crashed.webContents.executeJavaScript('edgeTravel.info()');assert.equal(info.mode,'hiding');assert.equal(info.animated,true);});
  crashed.webContents.forcefullyCrashRenderer();
  await failedHide;await stage('normal');await eventually(()=>assert.equal(crashed.isDestroyed(),true));
  assert.equal(pet.isVisible(),true,'a crashed journey cannot lose the normal pet');
  assert.equal(pet.getBounds().x,crashHome.x);assert.equal(pet.getBounds().y,crashHome.y);
  assert.equal(findWindow('recovery.html').isVisible(),false,'crashed hide leaves no orphan curl');
  assert.equal(warnings.length,1);assert.match(warnings[0].message,/小跑画面未能完成|躲猫猫画面未能准备好/);
  await action('hide');await stage('hidden');
  const recreated=findWindow('edge-travel.html');assert.ok(recreated);assert.notEqual(recreated.id,crashed.id,'next hide creates a healthy transient renderer');
  assert.equal(recreated.isVisible(),false,'retried hide completes without an orphan travel frame');
  await action('show');await stage('normal');await eventually(()=>assert.equal(recreated.isVisible(),false));
  assert.equal(warnings.length,1,'successful retry does not repeat the mocked warning');
  assert.deepEqual((await snapshot()).preferences,originalPreferences,'travel leaves artwork, music, scale and opt-in preferences unchanged');
  for(const window of BrowserWindow.getAllWindows())assert.equal(window.getOpacity(),0,'all runtime QA windows remain invisible');
  fs.writeFileSync(path.join(run,'frame-metrics.json'),JSON.stringify(measurements,null,2));
  let travelClosed=false;findWindow('edge-travel.html').once('closed',()=>{travelClosed=true;});
  app.on('will-quit',()=>{
    assert.equal(travelClosed,true,'application quit destroys the reusable transient travel surface');
    console.log('PASS: fixed compositor travel at 65/75/100/150%, sub-DIP frame samples, stationary native surface, single main-window handoff, pointer-through/AI-free journey, own-window 75% visual crops, home/size restoration, fast cancellation, mid-travel resize, reduced motion, renderer-crash fallback/retry and cleanup. Frame timings are measurements, not hardware FPS guarantees. Artifacts: '+run);
    console.log(JSON.stringify(measurements));
  });
  app.quit();
}).catch(error=>{console.error(error);console.error('Artifacts: '+run);app.exit(1);});
setTimeout(()=>{console.error('Edge travel runtime QA timed out. Artifacts: '+run);app.exit(1);},60000).unref();
