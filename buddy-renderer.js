/* Desktop companionship is a visual overlay, not an AI-state mutation.
 * Source art stays intact; only the two bounded hand regions are resampled. */
(() => {
  const pet=document.querySelector('#pet'),stage=document.querySelector('.stage');
  const motion=window.WhaleBuddyMotion;
  if(!pet||!stage||!motion)return;
  const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const canvas=document.createElement('canvas');
  canvas.className='buddy-canvas';canvas.hidden=true;canvas.setAttribute('aria-hidden','true');stage.append(canvas);
  const source=document.createElement('canvas');
  source.className='buddy-source';source.width=source.height=1280;source.hidden=true;source.setAttribute('aria-hidden','true');stage.append(source);
  const presentation=canvas.getContext('2d');
  const gl=source.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:false,preserveDrawingBuffer:true});
  const references={};
  for(const mode of ['typing','gaming']){
    const reference=new Image();reference.className='buddy-reference';reference.hidden=true;reference.draggable=false;
    reference.alt=mode==='typing'?'小鲸陪你敲她的小键盘':'小鲸握着手柄陪你玩游戏';
    reference.dataset.filename=`buddy-${mode}-v1`;
    reference.src=`assets/whalepet-buddy/${mode}-v1.png`;stage.append(reference);references[mode]=reference;
  }
  const badge=document.createElement('div');badge.className='state-badge buddy-badge';badge.hidden=true;pet.append(badge);
  let requested={mode:'none',tempo:3},activeMode='none',reportedMode='none',loaded=false,failed=false,running=false;
  let raf=0,lastFrameAt=0,lastPhaseAt=0,phase=0,smoothTempo=3,frames=0,lastDrawKey='';
  let program,leftUniform,rightUniform,modeUniform,currentFrame={left:0,right:0};
  const textures={};
  function report(mode){
    if(mode===reportedMode)return;
    reportedMode=mode;
    // Main guards the sender. Report the visible overlay, never a request that
    // is still loading or preempted by an AI reminder, drag, preview or song.
    try{window.whalePet?.reportBuddy?.(mode);}catch{/* The window may be closing. */}
  }
  function eligible(){
    const controller=window.whalePetController;
    return loaded&&!failed&&!document.hidden&&requested.mode!=='none'&&
      !pet.classList.contains('is-dragging')&&!pet.classList.contains('is-transitioning')&&
      !document.body.classList.contains('music-playing')&&
      !['needs_input','blocked','ready'].includes(controller?.getState().state)&&
      (typeof controller?.companionEligible==='function'?controller.companionEligible():true);
  }
  function stop(){
    const wasActive=activeMode!=='none'||pet.classList.contains('has-buddy');
    running=false;activeMode='none';cancelAnimationFrame(raf);raf=0;
    canvas.hidden=true;badge.hidden=true;
    for(const reference of Object.values(references))reference.hidden=true;
    if(pet.classList.contains('has-buddy'))pet.classList.remove('has-buddy');
    report('none');
    if(wasActive)window.whalePetController?.idleLife.sync();
  }
  function fail(error){
    failed=true;stop();console.warn('Companion hand animation disabled:',error?.message||'WebGL context unavailable');
  }
  source.addEventListener('webglcontextlost',event=>{event.preventDefault();fail(new Error('WebGL context lost'));});
  function draw(mode,left,right,present=true){
    if(!loaded||failed||!textures[mode])return false;
    left=Math.max(-1,Math.min(1,Number(left)||0));right=Math.max(-1,Math.min(1,Number(right)||0));
    const pixels=Math.max(1,Math.min(1280,Math.round(245*window.devicePixelRatio)));
    const key=`${mode}/${left}/${right}/${pixels}`;
    if(present&&lastDrawKey===key)return true;
    gl.useProgram(program);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,textures[mode]);
    gl.uniform1f(leftUniform,left);gl.uniform1f(rightUniform,right);gl.uniform1f(modeUniform,mode==='gaming'?1:0);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);frames++;
    if(present){
      lastDrawKey=key;
      if(canvas.width!==pixels){canvas.width=canvas.height=pixels;}
      presentation.imageSmoothingEnabled=true;presentation.imageSmoothingQuality='high';
      presentation.globalCompositeOperation='copy';presentation.drawImage(source,0,0,pixels,pixels);
      currentFrame={left,right};
    }
    return true;
  }
  function tick(now){
    raf=0;
    if(!running)return;
    if(!eligible()){stop();return;}
    const delta=Math.max(0,Math.min(.1,(now-lastPhaseAt)/1000));lastPhaseAt=now;
    smoothTempo+=(requested.tempo-smoothTempo)*(1-Math.exp(-delta/0.25));
    phase=motion.advance(phase,delta,smoothTempo);
    if(now-lastFrameAt>=1000/30){
      // Keep the fractional cadence instead of dropping to 20 fps whenever a
      // nominal 60 Hz frame lands just before the 30 Hz boundary.
      lastFrameAt=now-((now-lastFrameAt)%(1000/30));
      const hands=motion.frame(now,{mode:activeMode,phase,reduced:reduceMotion.matches});
      draw(activeMode,hands.left,hands.right);
    }
    raf=requestAnimationFrame(tick);
  }
  function sync(){
    if(!eligible()){stop();return;}
    const changed=activeMode!==requested.mode;
    if(changed){
      activeMode=requested.mode;lastDrawKey='';
      for(const [mode,reference] of Object.entries(references))reference.hidden=mode!==activeMode;
      badge.textContent=activeMode==='typing'?'小鲸 · 陪你敲键盘':'小鲸 · 陪你玩游戏';
      canvas.hidden=false;badge.hidden=false;
    }
    if(!pet.classList.contains('has-buddy'))pet.classList.add('has-buddy');
    window.whalePetController?.idleLife.sync();
    const hands=motion.frame(performance.now(),{mode:activeMode,phase,reduced:reduceMotion.matches});
    draw(activeMode,hands.left,hands.right);
    report(activeMode);
    if(reduceMotion.matches){running=true;cancelAnimationFrame(raf);raf=0;return;}
    if(!running||!raf){running=true;lastPhaseAt=performance.now();lastFrameAt=0;raf=requestAnimationFrame(tick);}
  }
  function receive(packet){
    requested={mode:['typing','gaming'].includes(packet?.mode)?packet.mode:'none',tempo:motion.tempo(packet?.tempo)};
    sync();
  }
  const shader=(type,code)=>{
    const result=gl.createShader(type);gl.shaderSource(result,code);gl.compileShader(result);
    if(!gl.getShaderParameter(result,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(result));return result;
  };
  const ready=(async()=>{
    if(!gl||!presentation)throw new Error('Canvas unavailable; keeping the AI sprite');
    program=gl.createProgram();
    gl.attachShader(program,shader(gl.VERTEX_SHADER,`attribute vec2 position;varying vec2 uv;void main(){uv=vec2(position.x*.5+.5,.5-position.y*.5);gl_Position=vec4(position,0.,1.);}`));
    gl.attachShader(program,shader(gl.FRAGMENT_SHADER,`
      precision highp float;varying vec2 uv;
      uniform sampler2D original;uniform float leftHand;uniform float rightHand;uniform float game;
      float box(vec2 p,vec2 lo,vec2 hi){vec2 a=smoothstep(lo,lo+vec2(16.),p);vec2 b=1.-smoothstep(hi-vec2(16.),hi,p);return a.x*a.y*b.x*b.y;}
      void main(){
        vec2 p=uv*1280.;
        // Exact bounded fields: face, headband, hair, dress and legs remain fixed.
        vec2 loLeft=mix(vec2(440.,815.),vec2(445.,805.),game);
        vec2 hiLeft=mix(vec2(565.,921.),vec2(565.,932.),game);
        vec2 loRight=mix(vec2(650.,815.),vec2(650.,805.),game);
        vec2 hiRight=mix(vec2(760.,925.),vec2(762.,932.),game);
        float l=box(p,loLeft,hiLeft)*leftHand;
        float r=box(p,loRight,hiRight)*rightHand;
        // 15.67 / 7.84 source px = at most 3 / 1.5 desktop px at 100%.
        vec2 shift=vec2((l-r)*game*4.,(l+r)*mix(15.67,7.84,game));
        gl_FragColor=texture2D(original,(p+shift)/1280.);
      }`));
    gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    const location=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,2,gl.FLOAT,false,0,0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
    for(const [mode,reference] of Object.entries(references)){
      await reference.decode();
      const texture=gl.createTexture();textures[mode]=texture;gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,reference);
    }
    gl.uniform1i(gl.getUniformLocation(program,'original'),0);
    leftUniform=gl.getUniformLocation(program,'leftHand');rightUniform=gl.getUniformLocation(program,'rightHand');modeUniform=gl.getUniformLocation(program,'game');
    gl.viewport(0,0,1280,1280);loaded=true;sync();return true;
  })().catch(error=>{fail(error);return false;});
  // Only external eligibility classes are observed. Our canvas/source changes
  // cannot recursively trigger the observer; class additions are idempotent.
  const observer=new MutationObserver(sync);
  observer.observe(pet,{attributes:true,attributeFilter:['class','data-frame']});
  observer.observe(document.body,{attributes:true,attributeFilter:['class']});
  document.addEventListener('visibilitychange',sync);window.addEventListener('resize',()=>{lastDrawKey='';sync();});
  reduceMotion.addEventListener('change',sync);
  window.addEventListener('pagehide',()=>{requested={mode:'none',tempo:3};stop();observer.disconnect();});
  window.whaleBuddy=Object.freeze({
    sync,ready,
    hitLayer:()=>running&&eligible()?references[activeMode]||null:null,
    info:()=>({loaded,failed,active:running,mode:activeMode,requestedMode:requested.mode,tempo:requested.tempo,frames,reduced:reduceMotion.matches,presentationPixels:canvas.width,hands:{...currentFrame}}),
    inspectFrame:(mode,left=0,right=0)=>draw(mode,left,right,false)?source.toDataURL('image/png'):null
  });
  if(typeof window.whalePet?.onBuddy==='function')window.whalePet.onBuddy(receive);
  if(typeof window.whalePet?.requestBuddy==='function')Promise.resolve(window.whalePet.requestBuddy()).then(receive).catch(()=>{});
})();
