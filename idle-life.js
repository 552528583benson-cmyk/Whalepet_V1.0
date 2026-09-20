/* Localized runtime animation: original pixels outside the eye/tail regions.
 * No full-body frame replacement, segmentation, or destructive asset edits. */
window.createIdleLife = function createIdleLife({parent,pet,eligible,compact=()=>false}) {
  const canvas=document.createElement('canvas');
  canvas.className='idle-life';canvas.setAttribute('aria-hidden','true');
  parent.append(canvas);
  // Render at master resolution, then area-filter to physical display pixels.
  // A large WebGL surface directly CSS-minified can shimmer on thin outlines.
  const source=document.createElement('canvas');source.className='idle-life-source';source.hidden=true;
  source.width=source.height=1280;source.setAttribute('aria-hidden','true');parent.append(source);
  const presentation=canvas.getContext('2d');
  const gl=source.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:false,preserveDrawingBuffer:true});
  let loaded=false,failed=false,running=false,raf=0,last=0,started=0,nextBlink=0,blinkUntil=0,blinks=0,frames=0;
  let program,blinkUniform,tailUniform,lastDrawKey='';
  const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
  function stop(){running=false;cancelAnimationFrame(raf);raf=0;if(pet.classList.contains('has-idle-life'))pet.classList.remove('has-idle-life');canvas.hidden=true;}
  function fail(){failed=true;stop();}
  source.addEventListener('webglcontextlost',e=>{e.preventDefault();fail();});
  function draw(blink,tail){
    const pixels=Math.max(1,Math.min(1280,Math.round(275*window.devicePixelRatio)));
    const key=`${blink}/${tail}/${pixels}`;if(lastDrawKey===key)return;lastDrawKey=key;
    gl.uniform1f(blinkUniform,blink);gl.uniform1f(tailUniform,tail);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);frames++;
    if(canvas.width!==pixels){canvas.width=canvas.height=pixels;}
    presentation.imageSmoothingEnabled=true;presentation.imageSmoothingQuality='high';
    presentation.globalCompositeOperation='copy';presentation.drawImage(source,0,0,pixels,pixels);
  }
  function tick(now){
    if(!running)return;
    if(!eligible()||document.hidden){stop();return;}
    if(now-last>=1000/24){
      last=now;
      if(now>=nextBlink){blinkUntil=now+125;nextBlink=now+4200+Math.random()*3000;blinks++;}
      // Ease in after returning to idle; 2px max displacement at default size.
      const ramp=Math.min(1,(now-started)/1200);
      draw(now<blinkUntil?1:0,compact()?0:Math.sin((now-started)/1000*Math.PI*2/4.8)*ramp);
    }
    raf=requestAnimationFrame(tick);
  }
  function sync(){
    if(!loaded||failed||!eligible()||document.hidden){stop();return;}
    if(running){if(!pet.classList.contains('has-idle-life'))pet.classList.add('has-idle-life');if(compact())draw(performance.now()<blinkUntil?1:0,0);return;}
    started=performance.now();last=0;nextBlink=started+3000+Math.random()*1800;blinkUntil=0;
    draw(0,0);canvas.hidden=false;pet.classList.add('has-idle-life');running=true;raf=requestAnimationFrame(tick);
  }
  canvas.hidden=true;
  const ready=(async()=>{
    if(!gl||!presentation)throw Error('Canvas unavailable; keeping the original static sprite');
    program=gl.createProgram();
    gl.attachShader(program,shader(gl.VERTEX_SHADER,`attribute vec2 position;varying vec2 uv;void main(){uv=vec2(position.x*.5+.5,.5-position.y*.5);gl_Position=vec4(position,0.,1.);}`));
    gl.attachShader(program,shader(gl.FRAGMENT_SHADER,`
      precision highp float;varying vec2 uv;
      uniform sampler2D original;uniform sampler2D closed;uniform float blink;uniform float tail;
      float box(vec2 p,vec2 lo,vec2 hi){vec2 a=smoothstep(lo,lo+vec2(5.),p);vec2 b=1.-smoothstep(hi-vec2(5.),hi,p);return a.x*a.y*b.x*b.y;}
      void main(){
        vec2 p=uv*1280.;
        // Tail root and dress stay anchored. The field fades before the legs.
        float weight=smoothstep(824.,907.,p.x)*(1.-smoothstep(975.,1020.,p.x))*smoothstep(889.,959.,p.y)*(1.-smoothstep(1040.,1090.,p.y));
        vec2 q=p-vec2(9.,-4.)*weight*tail;
        vec4 color=texture2D(original,q/1280.);
        float eyes=max(box(p,vec2(478.,607.),vec2(594.,705.)),box(p,vec2(639.,607.),vec2(756.,705.)));
        vec2 closedUv=(p-vec2(-1.,32.5))/1.022/1254.;
        vec4 lid=texture2D(closed,closedUv);
        gl_FragColor=mix(color,lid,eyes*blink);
      }`));
    gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    const loc=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
    for(const [unit,name,url] of [[0,'original','assets/whalepet-hd/idle.png'],[1,'closed','assets/whalepet-hd/idle-life/blink-source.png']]){
      const img=new Image();img.src=url;await img.decode();
      gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,gl.createTexture());
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);gl.uniform1i(gl.getUniformLocation(program,name),unit);
    }
    blinkUniform=gl.getUniformLocation(program,'blink');tailUniform=gl.getUniformLocation(program,'tail');gl.viewport(0,0,1280,1280);
    loaded=true;sync();return true;
  })().catch(error=>{console.warn('Idle micro-motion disabled:',error.message);fail();return false;});
  const observer=new MutationObserver(sync);
  observer.observe(pet,{attributes:true,attributeFilter:['class','data-frame']});
  observer.observe(parent,{subtree:true,attributes:true,attributeFilter:['class','src']});
  document.addEventListener('visibilitychange',sync);
  window.addEventListener('resize',sync);
  window.addEventListener('pagehide',()=>{stop();observer.disconnect();});
  return Object.freeze({sync,ready,info:()=>({loaded,failed,running,blinks,frames,compact:compact(),presentationPixels:canvas.width}),
    // Deterministic inspection of the real renderer, also used for visual QA.
    inspectFrame:(blink=0,tail=0)=>{if(!loaded||failed)return null;draw(blink,tail);return source.toDataURL('image/png');}
  });
};
