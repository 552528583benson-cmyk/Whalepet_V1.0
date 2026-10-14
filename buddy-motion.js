/* Continuous, local hand motion. Never moves the whole sprite or the window. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.WhaleBuddyMotion=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const TAU=Math.PI*2;
  const tempo=value=>Number.isFinite(value)?Math.max(2,Math.min(7,value)):3;
  function frame(timeMs,{mode='typing',tempo:rate=3,reduced=false,phase}={}){
    if(reduced||!['typing','gaming'].includes(mode))return {left:0,right:0};
    const angle=Number.isFinite(phase)?phase:(Number.isFinite(timeMs)?timeMs:0)/1000*tempo(rate)*TAU;
    if(mode==='gaming'){
      // Smaller independent thumb presses, not a full controller/body shake.
      const left=Math.sin(angle),right=Math.sin(angle*.83+1.6);
      return {left:Math.max(0,left)**2,right:Math.max(0,right)**2};
    }
    const wave=Math.sin(angle);
    // Squared half-waves ease through contact and alternate the two hands.
    return {left:Math.max(0,wave)**2,right:Math.max(0,-wave)**2};
  }
  function advance(phase,deltaSeconds,rate){
    return (Number.isFinite(phase)?phase:0)+Math.max(0,Math.min(.1,Number.isFinite(deltaSeconds)?deltaSeconds:0))*tempo(rate)*TAU;
  }
  return Object.freeze({frame,advance,tempo});
});
