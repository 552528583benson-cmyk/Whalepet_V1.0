// One coherent sprite, no part slicing or repeated scaling of fine linework.
// The audio clock makes pauses/buffering pause the dance, without timer drift.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.WhaleMusicDance=api;
})(typeof window==='object'?window:globalThis,()=>{
  function frame(seconds,{compact=false,dpr=1,reduced=false}={}) {
    if(reduced)return {x:0,y:0,angle:0};
    const t=Number.isFinite(seconds)?Math.max(0,seconds):0;
    const phase=t*Math.PI*2/1.6;
    const strength=Math.min(1,t/.35);
    // Two soft hops per left/right cycle; never squash the headband or legs.
    let x=7*Math.sin(phase)*strength;
    let y=-5*(1-Math.cos(phase*2))*.5*strength;
    const angle=compact?0:5*Math.sin(phase)*strength;
    // Keep compact sprites unrotated, but do not quantize translation. Rounding
    // a slow 5px hop to device pixels creates long holds then visible jumps.
    // A fixed-size composited image can translate smoothly without rescaling.
    return {x,y,angle};
  }
  function localPoint(rect,width,height,angle,x,y) {
    // Bounding-box center equals the rotated image center (origin 50% 50%).
    const dx=x-(rect.left+rect.width/2),dy=y-(rect.top+rect.height/2);
    const a=-angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
    return {x:dx*c-dy*s+width/2,y:dx*s+dy*c+height/2};
  }
  return {frame,localPoint};
});
