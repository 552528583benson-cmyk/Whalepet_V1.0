(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
  else root.WhaleDragPhysics=api;
})(typeof window==='object'?window:globalThis,function(){
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  // No visual angle clamp or compression: display the simulated angle directly.
  const displayAngle=angle=>angle*180/Math.PI;
  // A damped pendulum hanging below a horizontally moving support. Positions
  // are CSS pixels, timestamps milliseconds; integration is independent of Hz.
  function create(){
    let angle=0,omega=0,velocity=0,lastTime=null,lastX=0,excitement=0;
    function reset(time=null,x=0){angle=omega=velocity=excitement=0;lastTime=time;lastX=x;}
    function advance(time,x){
      if(!Number.isFinite(time)||!Number.isFinite(x))return displayAngle(angle);
      if(lastTime===null){reset(time,x);return 0;}
      const dt=(time-lastTime)/1000;if(dt<=0)return displayAngle(angle);
      if(dt>.2){reset(time,x);return 0;}
      const raw=clamp((x-lastX)/dt,-3200,3200);
      excitement=Math.max(excitement*Math.exp(-dt/.8),clamp((Math.abs(raw)-700)/1500,0,1));
      // A fast flick needs a snappy cartoon response, not the same slow sway
      // played at a larger amplitude. Shorten input lag and increase swing tempo.
      const next=velocity+(raw-velocity)*(1-Math.exp(-dt/(.055-.035*excitement)));
      const acceleration=(next-velocity)/dt;
      const steps=Math.ceil(dt*240),h=dt/steps;
      for(let n=0;n<steps;n++){
        // Positive CSS rotation makes the body lag left when the pivot moves right.
        // A linear restoring spring stays stable even when internal momentum
        // exceeds the visible angle. Strong throws decay a little more slowly.
        const force=.55*acceleration/160;
        const frequency=4.7+4.5*excitement;
        omega+=(-frequency*frequency*angle-(2.7-.7*excitement)*omega+force)*h;
        omega=clamp(omega,-8,8);angle+=omega*h;
      }
      velocity=next;lastTime=time;lastX=x;
      if(Math.abs(velocity)<.01&&Math.abs(omega)<.0001&&Math.abs(angle)<.0001)angle=omega=0;
      return displayAngle(angle);
    }
    return {advance,reset,info:()=>({angle:displayAngle(angle),internalAngle:angle*180/Math.PI,omega,velocity,excitement})};
  }
  return Object.freeze({create});
});
