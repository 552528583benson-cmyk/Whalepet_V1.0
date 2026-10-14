/* A stationary native surface with fixed-size predecoded textures. Ordinary
   journeys use translation only; an ahoge pull rotates around the grabbed tip. */
(() => {
  const actor=document.querySelector('#actor'),floor=document.querySelector('#floor');
  const idlePose=document.querySelector('#idlePose'),pullOpen=document.querySelector('#pullOpen'),pullSmile=document.querySelector('#pullSmile');
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const pendulum=window.WhaleDragPhysics.create();
  const pullAssets=window.WhaleAhogePullAssets;
  let options=null,animation=null,mode='',generation=0,ready=false;
  let duration=0,completion=null;
  let pullFrame=0,pullActive=false,pullTarget=null,pullPoint=null,pullFrames=0;
  let pullStart=0,pullElapsedMs=0,pullAngle=0,pullPose='open',pullSmileOpacity=0,pullTexturesReady=false;
  let pullPivot={x:0,y:0},actorSize=275,pullReducedMotion=false;
  let pullWorkAreas=[];
  const SMILE_AFTER_MS=pullAssets.smileDelayMs,SMILE_FADE_MS=pullAssets.fadeMs;
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const smooth=value=>value*value*(3-2*value);
  const transform=(x,y)=>`translate3d(${x}px,${y}px,0)`;
  const decode=image=>image.decode().then(()=>image.complete&&image.naturalWidth>0,()=>false);
  const decoded=Promise.all([decode(idlePose),decode(pullOpen),decode(pullSmile)]).then(([idle,open,smile])=>{
    ready=idle;
    // Both expressions must share one authored canvas, otherwise an eye swap
    // could move her body or move the cursor's grabbed ahoge tip.
    pullTexturesReady=open&&smile&&pullOpen.naturalWidth===pullSmile.naturalWidth&&pullOpen.naturalHeight===pullSmile.naturalHeight;
    return ready;
  });

  function setPullExpression(opacity){
    pullSmileOpacity=opacity;
    // Fade the new face over one fully opaque base. Fading BOTH transparent
    // sprites would thin the shared dress/headband at the midpoint (a flash).
    // Once the smile is opaque, retire the old canvas so no outline ghost stays.
    const open=opacity>=1?'0':'1',smile=String(opacity);
    if(pullOpen.style.opacity!==open)pullOpen.style.opacity=open;
    if(pullSmile.style.opacity!==smile)pullSmile.style.opacity=smile;
  }

  function paintPull(){
    // Translation is the unrotated origin. CSS rotates about this fixed tip,
    // so even a strong throw never displaces the grabbed point from the cursor.
    actor.style.transform=`${transform(pullPoint.x,pullPoint.y)} rotate(${pullAngle}deg)`;
  }

  function settleCompletion(value){
    const finish=completion;completion=null;
    if(finish)finish(value);
  }

  function freeze(){
    pullActive=false;
    if(pullFrame){cancelAnimationFrame(pullFrame);pullFrame=0;}
    if(animation){
      // Commit the displayed compositor value before cancelling. Inline state
      // survives cancellation, including a cancel queued before a freeze call.
      const style=getComputedStyle(actor),position=style.transform,opacity=style.opacity;
      animation.pause();actor.style.transform=position;actor.style.opacity=opacity;
      animation.cancel();animation=null;
    }
    generation++;settleCompletion(false);
    pendulum.reset();
    const rect=actor.getBoundingClientRect();
    // A rotated bounding box is not a sprite origin. Returning that box used
    // to make a subsequent handoff drift down/right after a quick release.
    const point=(mode==='pull'||mode==='pull-settling')&&pullPoint?pullPoint:rect;
    return {x:point.x,y:point.y,opacity:Number(getComputedStyle(actor).opacity),angle:pullAngle};
  }

  function configure(value){
    freeze();options=value;mode=value.mode;duration=0;
    actorSize=pullAssets.size*value.scale;
    actor.style.width=`${actorSize}px`;actor.style.height=`${actorSize}px`;
    actor.style.transformOrigin='0 0';
    actor.style.transform=transform(value.from.x,value.from.y);
    actor.style.opacity=String(value.from.opacity);
    floor.style.height=`${Math.max(0,value.bottom)}px`;
    floor.style.clipPath='none';pullWorkAreas=[];
    idlePose.style.opacity='1';setPullExpression(0);pullOpen.style.opacity='0';
    pullTarget=pullPoint=null;pullPivot={x:0,y:0};pullFrames=0;
    pullStart=pullElapsedMs=pullAngle=0;pullPose='open';pullReducedMotion=false;
    return {ready};
  }

  function configurePull(value){
    configure(value);
    if(!pullTexturesReady)return {ready:false};
    const pivot=value.pivot||pullAssets.pivot;
    if(!Number.isFinite(pivot?.x)||!Number.isFinite(pivot?.y)||pivot.x<0||pivot.x>pullAssets.size||pivot.y<0||pivot.y>pullAssets.size)return {ready:false};
    pullWorkAreas=(Array.isArray(value.workAreas)?value.workAreas:[]).filter(area=>
      Number.isFinite(area?.x)&&Number.isFinite(area?.y)&&Number.isFinite(area?.width)&&Number.isFinite(area?.height)&&
      area.width>0&&area.height>0&&Number.isFinite(area.x+area.width)&&Number.isFinite(area.y+area.height))
      .map(area=>({x:area.x,y:area.y,width:area.width,height:area.height}));
    if(pullWorkAreas.length){
      // The stationary viewport spans the monitors, but a pet must stay behind
      // each monitor's own edge/taskbar while coming out. All clockwise paths
      // use nonzero winding: overlapping work areas form a union, never a hole.
      const path=pullWorkAreas.map(area=>`M ${area.x} ${area.y} h ${area.width} v ${area.height} h ${-area.width} Z`).join(' ');
      floor.style.clipPath=`path('${path}')`;
    }
    pullPivot={x:pivot.x*value.scale,y:pivot.y*value.scale};
    actor.style.transformOrigin=`${pullPivot.x}px ${pullPivot.y}px`;
    idlePose.style.opacity='0';setPullExpression(0);
    pullTarget={x:value.from.x,y:value.from.y};pullPoint={...pullTarget};pullFrames=0;
    pullStart=performance.now();pullReducedMotion=Boolean(value.reducedMotion)||reducedMotion.matches;
    pendulum.reset(pullStart,pullPoint.x+pullPivot.x);paintPull();
    pullActive=true;
    function frame(now){
      pullFrame=0;
      if(!pullActive||mode!=='pull')return;
      pullPoint={...pullTarget};
      pullElapsedMs=Math.max(0,now-pullStart);
      pullAngle=pullReducedMotion?0:pendulum.advance(now,pullPoint.x+pullPivot.x);
      const smile=pullElapsedMs>=SMILE_AFTER_MS;
      pullPose=smile?'smile':'open';
      setPullExpression(smile?(pullReducedMotion?1:smooth(clamp((pullElapsedMs-SMILE_AFTER_MS)/SMILE_FADE_MS,0,1))):0);
      paintPull();pullFrames++;
      pullFrame=requestAnimationFrame(frame);
    }
    pullFrame=requestAnimationFrame(frame);
    return {ready};
  }

  function updatePull(value){
    if(!pullActive||mode!=='pull'||value?.session!==options?.session)return;
    if(!Number.isFinite(value?.x)||!Number.isFinite(value?.y))return;
    pullTarget={x:value.x-options.origin.x,y:value.y-options.origin.y};
  }
  window.whaleEdgeTravel?.onPullPoint(updatePull);

  reducedMotion.addEventListener('change',()=>{
    if(!pullActive)return;
    pullReducedMotion=Boolean(options?.reducedMotion)||reducedMotion.matches;
    pendulum.reset(performance.now(),pullPoint.x+pullPivot.x);
    if(pullReducedMotion){pullAngle=0;paintPull();if(pullPose==='smile')setPullExpression(1);}
  });

  function finishPull(value){
    const from=freeze(),token=++generation;mode='pull-settling';duration=value.duration;
    const to=value.to;
    if(value.reducedMotion||!duration){
      pullPoint={...to};pullAngle=0;paintPull();actor.style.opacity='1';return Promise.resolve(true);
    }
    return new Promise(resolve=>{
      completion=resolve;
      const started=performance.now();
      function frame(now){
        pullFrame=0;
        if(token!==generation||mode!=='pull-settling')return;
        const progress=clamp((now-started)/duration,0,1),ease=1-Math.pow(1-progress,3);
        pullPoint={x:from.x+(to.x-from.x)*ease,y:from.y+(to.y-from.y)*ease};
        pullAngle=from.angle*(1-ease);paintPull();actor.style.opacity='1';
        if(progress>=1){settleCompletion(true);return;}
        pullFrame=requestAnimationFrame(frame);
      }
      pullFrame=requestAnimationFrame(frame);
    });
  }

  function makeKeys(value){
    const from=value.from,to=value.to,scale=value.scale;
    const hide=value.mode==='hiding';
    const run=hide?value.runMs:value.duration,dip=hide?value.dipMs:0;
    duration=run+dip;
    if(!duration)return [];
    const keys=[],samples=Math.max(30,Math.ceil(run/12));
    const hops=clamp(Math.round(run/300),2,3),amplitude=3.2*scale;
    for(let index=0;index<=samples;index++){
      const progress=index/samples,ease=smooth(progress);
      // sin^2 has zero vertical velocity at every footfall, unlike alternating
      // piecewise-linear hops. The endpoints are exactly the provided points.
      const hop=-amplitude*Math.pow(Math.sin(progress*Math.PI*hops),2);
      const x=from.x+(to.x-from.x)*ease,y=from.y+(to.y-from.y)*ease+hop;
      const opacity=hide?from.opacity:from.opacity+(1-from.opacity)*Math.min(1,progress*3);
      keys.push({offset:run*progress/duration,transform:transform(x,y),opacity});
    }
    if(dip){
      const steps=Math.max(20,Math.ceil(dip/12));
      for(let index=1;index<=steps;index++){
        const progress=index/steps,ease=smooth(progress);
        keys.push({offset:(run+dip*progress)/duration,
          transform:transform(to.x,to.y+205*scale*ease),
          opacity:from.opacity*(1-smooth(clamp((progress-.35)/.65,0,1)))});
      }
    }
    return keys;
  }

  async function play(){
    if(animation)freeze();
    const token=++generation,value=options;
    if(!value||!await decoded||token!==generation||options!==value)return false;
    if(value.reducedMotion){
      actor.style.transform=transform(value.to.x,value.to.y);
      actor.style.opacity=value.mode==='hiding'?'0':'1';return true;
    }
    const keys=makeKeys(value);
    if(!keys.length){
      actor.style.transform=transform(value.to.x,value.to.y);
      actor.style.opacity=value.mode==='hiding'?'0':'1';return true;
    }
    return new Promise(resolve=>{
      completion=resolve;
      animation=actor.animate(keys,{duration,easing:'linear',fill:'forwards'});
      const active=animation;
      active.finished.then(()=>{
        if(token!==generation||animation!==active)return;
        const last=keys[keys.length-1];
        actor.style.transform=last.transform;actor.style.opacity=String(last.opacity);
        active.cancel();animation=null;settleCompletion(true);
      },()=>{
        if(token===generation&&animation===active){animation=null;settleCompletion(false);}
      });
    });
  }

  window.edgeTravel={
    ready:()=>decoded,
    configure,configurePull,play,finishPull,freeze,
    info:()=>{
      const rect=actor.getBoundingClientRect();
      return {mode,animated:Boolean(animation)||(mode==='pull-settling'&&Boolean(pullFrame)),ready,
        actorRect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},
        actorSize:{width:actorSize,height:actorSize},actorOrigin:pullPoint?{...pullPoint}:{x:rect.x,y:rect.y},
        from:options?.from||null,to:options?.to||null,duration,
        pulling:pullActive,pullFrames,pullTarget:pullTarget?{...pullTarget}:null,pullPoint:pullPoint?{...pullPoint}:null,
        pullPose,pullElapsedMs,pullAngle,pullAngularVelocity:pendulum.info().omega,pullPhysics:pendulum.info(),
        pullPivot:{...pullPivot},pullAnchor:pullPoint?{x:pullPoint.x+pullPivot.x,y:pullPoint.y+pullPivot.y}:null,
        pullSmileOpacity,pullReducedMotion,pullTexturesReady,
        pullWorkAreas:pullWorkAreas.map(area=>({...area})),pullClipPath:floor.style.clipPath,
        pullTextures:{open:pullOpen.getAttribute('src'),smile:pullSmile.getAttribute('src'),
          width:pullOpen.naturalWidth,height:pullOpen.naturalHeight},smileAfterMs:SMILE_AFTER_MS,smileFadeMs:SMILE_FADE_MS};
    }
  };
})();
