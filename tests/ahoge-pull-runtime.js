'use strict';

// A standalone renderer fixture: it never runs the desktop bridge, preferences,
// activity/keyboard monitor, tray, native cursor polling or the user's actual pet.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {app,BrowserWindow}=require('electron');
const root=path.resolve(__dirname,'..'),run=fs.mkdtempSync(path.join(root,'work','ahoge-pull-qa-'));
const AHOGE=require('../ahoge-pull-assets');
// High-angle input is deterministic here, not dependent on the host display's
// message coalescing or refresh rate. Runtime traces below verify that CSS
// displays this same solver angle without compressing it.
const probe=require('../drag-physics').create();let probeMaximum=0;probe.reset(0,0);
for(let frame=1;frame<=120;frame++)probeMaximum=Math.max(probeMaximum,Math.abs(probe.advance(frame*16,900*Math.sin(frame*Math.PI/10))));
app.setPath('userData',path.join(run,'electron'));
app.setAppPath(root);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const measurements=[];
const percentile=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted.length?sorted[Math.floor((sorted.length-1)*p)]:0;};

app.whenReady().then(async()=>{
  assert.ok(probeMaximum>22.1,'the shared high-speed pendulum permits swings larger than 22 degrees');
  const window=new BrowserWindow({width:1400,height:1100,show:false,frame:false,
    transparent:true,backgroundColor:'#00000000',focusable:false,skipTaskbar:true,
    resizable:false,hasShadow:false,
    webPreferences:{preload:path.join(root,'edge-travel-preload.js'),contextIsolation:true,
      sandbox:true,nodeIntegration:false,backgroundThrottling:false}});
  const nativeOpacity=window.setOpacity.bind(window),nativeFocus=window.setFocusable.bind(window);
  window.setOpacity=()=>nativeOpacity(0);window.setFocusable=()=>nativeFocus(false);
  window.setOpacity(0);window.setFocusable(false);window.setIgnoreMouseEvents(true,{forward:true});
  window.webContents.setAudioMuted(true);window.setMenu(null);
  window.webContents.on('console-message',event=>{if(event.level==='error'||event.level===3)console.error('Own fixture renderer: '+event.message);});
  await window.loadFile(path.join(root,'edge-travel.html'));
  const js=source=>window.webContents.executeJavaScript(source).catch(error=>{error.message+='\nOwn fixture expression: '+source.slice(0,240);throw error;});
  assert.equal(await js('edgeTravel.ready()'),true,'all three predecoded textures are ready');
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  window.showInactive();
  const info=()=>js('edgeTravel.info()');
  const settle=()=>js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const pivot=AHOGE.pivot,origin={x:100,y:40};
  let session=0;
  const configure=async(scale,reducedMotion=false,workAreas)=>{
    const value={mode:'pull',session:++session,scale,origin,bottom:1100,
      from:{x:600,y:230,opacity:1},pivot,reducedMotion,workAreas};
    const configured=await js(`edgeTravel.configurePull(${JSON.stringify(value)})`);
    assert.equal(configured.ready,true);await settle();return value;
  };
  const point=(value,x,y)=>window.webContents.send('edge-travel:pull-point',
    {session:value.session,x:origin.x+x,y:origin.y+y});
  const record=ms=>js(`new Promise(resolve=>{const samples=[],start=performance.now();function sample(time){const state=edgeTravel.info(),actor=document.querySelector('#actor'),style=getComputedStyle(actor),m=new DOMMatrix(style.transform),marker=document.querySelector('#qaPivot');const rect=marker.getBoundingClientRect();samples.push({time,pose:state.pullPose,elapsed:state.pullElapsedMs,angle:state.pullAngle,solverAngle:state.pullPhysics.internalAngle,omega:state.pullAngularVelocity,anchor:state.pullAnchor,point:state.pullPoint,size:state.actorSize,smile:state.pullSmileOpacity,baseOpacity:Number(getComputedStyle(document.querySelector('#pullOpen')).opacity),pivot:{x:rect.x,y:rect.y},matrix:{a:m.a,b:m.b,c:m.c,d:m.d,e:m.e,f:m.f}});if(performance.now()-start<${ms})requestAnimationFrame(sample);else resolve(samples);}requestAnimationFrame(sample);})`);
  const marker=()=>js(`(()=>{let marker=document.querySelector('#qaPivot');if(!marker){marker=document.createElement('i');marker.id='qaPivot';marker.style.cssText='position:absolute;width:0;height:0;pointer-events:none';document.querySelector('#actor').append(marker);}const p=edgeTravel.info().pullPivot;marker.style.left=p.x+'px';marker.style.top=p.y+'px';})()`);
  const capture=async(name)=>{
    await settle();const crop=await js(`(()=>{const b=document.querySelector('#actor').getBoundingClientRect(),x=Math.max(0,Math.floor(b.x-4)),y=Math.max(0,Math.floor(b.y-4));return {x,y,width:Math.max(1,Math.min(innerWidth-x,Math.ceil(b.right+4)-x)),height:Math.max(1,Math.min(innerHeight-y,Math.ceil(b.bottom+4)-y))};})()`);
    const image=await window.webContents.capturePage(crop,{stayHidden:true});assert.equal(image.isEmpty(),false);
    fs.writeFileSync(path.join(run,name),image.toPNG());
  };

  for(const scale of [.65,.75,1,1.5]){
    const value=await configure(scale);await marker();const initial=await info();
    assert.equal(initial.pullPose,'open','each gesture starts with the relaxed open eyes');
    assert.ok(initial.pullElapsedMs<1000,'the expression timer belongs to this gesture');
    assert.equal(initial.pullAngle,0,'the new gesture does not inherit another swing');
    assert.equal(initial.pullAngularVelocity,0);
    assert.deepEqual(initial.actorSize,{width:275*scale,height:275*scale});
    assert.equal(initial.pullTexturesReady,true,'both expressions are decoded before the pull starts');
    assert.equal(await js('document.body.innerText.trim()'),'','the drag has no AI labels/status bubbles');
    if(scale===.75)await capture('open-75.png');

    // Only synthetic fixture positions are sent. The viewport never moves.
    const bounds=window.getBounds(),tracePromise=record(1550);
    let last={x:600,y:230};
    for(let frame=0;frame<40;frame++){
      last={x:600+220*Math.sin(frame*Math.PI/9),y:230+(frame%3)*.37};
      point(value,last.x,last.y);await pause(16);
    }
    const traces=await tracePromise;assert.deepEqual(window.getBounds(),bounds,'the native viewport stays fixed');
    assert.ok(traces.length>=25,'small-size renderer receives real compositor frame samples');
    assert.ok(traces.some(sample=>sample.angle>1)&&traces.some(sample=>sample.angle<-1),'horizontal flicks sway both left and right');
    for(const sample of traces){
      assert.ok(Math.abs(sample.angle-sample.solverAngle)<.000001,'the renderer never clamps or compresses the shared solver angle');
      const paintedAngle=Math.atan2(sample.matrix.b,sample.matrix.a)*180/Math.PI;
      const angleError=((paintedAngle-sample.angle+180)%360+360)%360-180;
      assert.ok(Math.abs(angleError)<.01,'CSS paints the complete simulated angle');
      assert.deepEqual(sample.size,{width:275*scale,height:275*scale},'rotation does not alter the authored sprite scale');
      assert.ok(Math.abs(sample.matrix.a*sample.matrix.d-sample.matrix.b*sample.matrix.c-1)<.002,'transform is rotation+translation, not rescaling');
      assert.ok(Math.abs(sample.pivot.x-sample.anchor.x)<.02&&Math.abs(sample.pivot.y-sample.anchor.y)<.02,'the actual transformed ahoge tip stays pinned to its cursor anchor');
      assert.ok(Math.abs(sample.anchor.x-(sample.point.x+pivot.x*scale))<.002);
      assert.ok(Math.abs(sample.anchor.y-(sample.point.y+pivot.y*scale))<.002);
    }
    const stopped=traces.filter(sample=>Math.abs(sample.point.x-last.x)<.001&&Math.abs(sample.point.y-last.y)<.001);
    assert.ok(stopped.length>=10,'fixture cursor remains still long enough to measure momentum');
    assert.ok(Math.max(...stopped.map(sample=>sample.angle))-Math.min(...stopped.map(sample=>sample.angle))>1,'sway continues with inertia after the cursor stops');
    assert.ok(stopped.some(sample=>Math.abs(sample.omega)>.05),'continuing motion retains angular velocity');

    // Timing is measured in the renderer itself, not from unrelated page load
    // or hide time. Every trace strictly before 3s must retain the open eyes.
    const elapsed=(await info()).pullElapsedMs;
    const expression=await record(Math.max(0,3300-elapsed));
    for(const sample of [...traces,...expression].filter(sample=>sample.elapsed<3000))assert.equal(sample.pose,'open');
    assert.ok(expression.some(sample=>sample.smile>0&&sample.smile<1),'the expression change uses a short continuous fade, not a texture jump');
    for(const sample of [...traces,...expression]){
      const coverage=sample.baseOpacity+sample.smile-sample.baseOpacity*sample.smile;
      assert.ok(coverage>.999,'an opaque source body never dips to 75% alpha during the eye fade');
      if(sample.smile===1)assert.equal(sample.baseOpacity,0,'the completed smile retires the open-eye layer instead of leaving a permanent ghost');
    }
    const smile=await info();assert.equal(smile.pullPose,'smile');
    assert.ok(smile.pullElapsedMs>=3000,'closed smile waits for the complete three-second hold');
    assert.ok(smile.pullSmileOpacity>.99,'the short expression fade finishes at a stable opaque smile');
    if(scale===.75)await capture('smile-75.png');
    const pointBeforeFreeze={...smile.pullPoint},frozen=await js('edgeTravel.freeze()');
    assert.ok(Math.abs(frozen.x-pointBeforeFreeze.x)<.002&&Math.abs(frozen.y-pointBeforeFreeze.y)<.002,'freeze returns unrotated origin, never the rotating bbox');
    const a=await info();await pause(80);const b=await info();
    assert.equal(b.pulling,false);assert.equal(a.pullAngle,b.pullAngle,'cancellation cannot keep an orphan physics RAF running');
    const intervals=traces.slice(1).map((sample,index)=>sample.time-traces[index].time).filter(value=>value>0);
    const cadence={p50Ms:percentile(intervals,.5),p95Ms:percentile(intervals,.95),maxMs:Math.max(0,...intervals)};
    measurements.push({scale,frameCount:traces.length,maxSwing:Math.max(...traces.map(sample=>Math.abs(sample.angle))),cadence,initial,smile,traces,expression});
  }

  // Replay resets expression and momentum rather than keeping the last smile.
  const replay=await configure(.75);await marker();assert.equal((await info()).pullPose,'open');
  assert.equal((await info()).pullAngle,0);await pause(120);assert.equal((await info()).pullPose,'open');
  const stalePoint={...((await info()).pullPoint)};
  point({...replay,session:replay.session-1},30,30);await settle();
  assert.deepEqual((await info()).pullPoint,stalePoint,'stale gesture targets cannot move the new pull');
  const destination={x:430,y:220};
  assert.equal(await js(`edgeTravel.finishPull({to:${JSON.stringify(destination)},duration:160,reducedMotion:false})`),true);
  const finished=await info();assert.equal(finished.pulling,false);
  assert.equal(finished.pullAngle,0,'release settles upright before replacing the transient sprite');
  assert.deepEqual(finished.pullPoint,destination);
  await pause(180);assert.equal((await info()).mode,'pull-settling','release leaves a single settled frame, not a late new pull');

  // Reduced motion still gets the requested expression, but no pendulum sway.
  const reduced=await configure(.75,true);await marker();point(reduced,750,300);await settle();
  assert.equal((await info()).pullAngle,0);assert.equal((await info()).pullReducedMotion,true);
  assert.equal(await js('edgeTravel.finishPull({to:{x:400,y:200},duration:160,reducedMotion:true})'),true);
  assert.equal((await info()).pullAngle,0);
  // The fixed viewport covers multiple displays, but the union clip excludes
  // their taskbars and offset gaps. Pixel capture is limited to this own fixture.
  const areas=[{x:0,y:0,width:800,height:1100},{x:800,y:100,width:600,height:1000}];
  const clipped=await configure(.75,true,areas);await marker();point(clipped,900,0);await settle();
  const clip=await js(`(()=>{const p=getComputedStyle(document.querySelector('#floor')).clipPath;return {value:p,supported:CSS.supports('clip-path',p)};})()`);
  assert.notEqual(clip.value,'none');assert.equal(clip.supported,true,'Chromium accepts the multi-work-area union clip');
  assert.deepEqual((await info()).pullWorkAreas,areas);
  const bitmapImage=await window.webContents.capturePage(undefined,{stayHidden:true}),bitmap=bitmapImage.toBitmap(),bitmapSize=bitmapImage.getSize();
  const viewport=await js('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})');
  fs.writeFileSync(path.join(run,'union-clip.png'),bitmapImage.toPNG());
  fs.writeFileSync(path.join(run,'union-clip.json'),JSON.stringify({info:await info(),bitmapSize,viewport},null,2));
  const alphaAt=(x,y)=>bitmap[(Math.round(y*bitmapSize.height/viewport.height)*bitmapSize.width+Math.round(x*bitmapSize.width/viewport.width))*4+3];
  assert.equal(alphaAt(900+600/1254*275*.75,400/1254*275*.75),0,'offset-display gap clips otherwise opaque hair pixels');
  assert.ok(alphaAt(900+600/1254*275*.75,800/1254*275*.75)>240,'the lower part of the same actor remains painted inside that display work area');
  await js('edgeTravel.freeze()');
  assert.equal(window.getOpacity(),0);assert.equal(window.isFocusable(),false);
  assert.equal(window.webContents.isAudioMuted(),true);assert.equal(window.hasShadow(),false);
  fs.writeFileSync(path.join(run,'measurements.json'),JSON.stringify(measurements,null,2));
  window.destroy();
  console.log('PASS: 65/75/100/150% decoded open/smile ahoge sprites, per-gesture three-second expression/reset, left/right rapid-flick inertia without 22-degree clamp, physical pivot pinned through rotation, constant sprite size/fractional translation, stationary viewport, cancel/release/stale-session and reduced-motion safety. Own renderer only: invisible, muted, unfocusable and native-input-through. Artifacts: '+run);
  console.log('Measured 75% RAF cadence (not a hardware guarantee): '+JSON.stringify(measurements.find(value=>value.scale===.75).cadence));
  app.quit();
}).catch(error=>{console.error(error);console.error('Artifacts: '+run);app.exit(1);});
setTimeout(()=>{console.error('Ahoge pull renderer QA timed out. Artifacts: '+run);app.exit(1);},45000).unref();
