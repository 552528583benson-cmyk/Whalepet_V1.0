// Reload is a local interaction, never an AI work-state or a new bitmap pose.
window.createReloadAction=function({motion,feedback,label,eligible,showText,reducedMotion,onChange=()=>{}}){
  let id=0,phase='idle',state='idle',silent=false,terminal=false,animation=null,timer=null,expiry=null,started=0;
  const cancelMotion=()=>{animation?.cancel();animation=null;};
  const clear=()=>{clearTimeout(timer);clearTimeout(expiry);cancelMotion();feedback.hidden=true;};
  const text=()=>phase==='reading'?'让我重新确认一下…':phase==='failed'?'未能确认同步，请重试':phase==='deferred'?'已重读 · 松手后同步':
    state==='needs_input'?'已同步 · 仍等你确认':state==='blocked'?'已同步 · 仍有问题':'状态已同步';
  function animate(result=false){
    if(reducedMotion.matches||!eligible()||silent)return;
    // Only translation: no small-size resampling, anatomy edits or body scaling.
    const from=getComputedStyle(motion).transform;
    cancelMotion();
    const keys=result?[{transform:from==='none'?'translate3d(0,0,0)':from},
      {transform:'translate3d(0,3px,0)',offset:.45},{transform:'translate3d(0,-1px,0)',offset:.78},{transform:'translate3d(0,0,0)'}]:
      [{transform:'translate3d(0,0,0)'},{transform:'translate3d(-3px,-1px,0)',offset:.25},
        {transform:'translate3d(3px,-1px,0)',offset:.65},{transform:'translate3d(0,0,0)'}];
    animation=motion.animate(keys,{duration:result?460:1200,easing:'ease-in-out',iterations:result?1:Infinity});
    const own=animation;
    own.finished.catch(()=>{}).finally(()=>{if(animation===own)animation=null;});
  }
  function sync(){
    if(!eligible()){silent=true;cancelMotion();feedback.hidden=true;return;}
    feedback.hidden=silent||phase==='idle'||!showText();
    feedback.dataset.phase=phase;label.textContent=text();
    if(reducedMotion.matches)cancelMotion();
  }
  function receive(value){
    if(!Number.isInteger(value?.id)||value.id<1||!['reading','synced','deferred','failed'].includes(value.phase))return;
    if(value.phase==='reading'){
      if(value.id<=id)return;
      clear();id=value.id;phase='reading';terminal=false;state=value.state||'idle';silent=!eligible();started=performance.now();
      sync();onChange();animate();
      // A renderer lost before returning a receipt must not wiggle forever.
      const own=id;expiry=setTimeout(()=>{if(id===own){clear();phase='idle';onChange();}},12000);
      return;
    }
    if(value.id!==id||phase!=='reading'||terminal)return;
    terminal=true;state=value.state||state;
    clearTimeout(expiry);clearTimeout(timer);
    const own=id;
    const finish=()=>{
      if(id!==own||phase!=='reading')return;
      phase=value.phase;sync();onChange();
      if(phase==='synced')animate(true);else cancelMotion();
      expiry=setTimeout(()=>{if(id===own){clear();phase='idle';onChange();}},1800);
    };
    // The real pose updates immediately; only decorative acknowledgement waits.
    timer=setTimeout(finish,Math.max(0,650-(performance.now()-started)));
  }
  const suspend=()=>{silent=true;cancelMotion();feedback.hidden=true;};
  const dispose=()=>{clear();phase='idle';onChange();};
  reducedMotion.addEventListener('change',sync);
  document.addEventListener('visibilitychange',sync);
  window.addEventListener('pagehide',dispose);
  return Object.freeze({receive,sync,suspend,dispose,updateState:value=>{state=value;sync();},info:()=>({id,phase,state,visible:!feedback.hidden,animated:Boolean(animation),label:label.textContent,silent})});
};
