const assert=require('node:assert/strict');
const {frame,localPoint}=require('../music-dance');
assert.deepEqual(frame(0),{x:0,y:-0,angle:0});
assert.deepEqual(frame(15,{reduced:true}),{x:0,y:0,angle:0});
for(const dpr of [.75,1,1.125,1.5,2])for(let t=0;t<180;t+=.017){
  const p=frame(t,{compact:true,dpr});
  assert.equal(p.angle,0,'small-scale linework is never rotated');
  const next=frame(t+1/60,{compact:true,dpr});
  assert.ok(Math.abs(next.x-p.x)<.8&&Math.abs(next.y-p.y)<.8,'continuous subpixel motion, no one-pixel jumps');
  assert.ok(Math.abs(p.x)<=8&&Math.abs(p.y)<=6);
}
assert.ok(frame(.4).x>0&&frame(1.2).x<0);
assert.equal(frame(8.4).angle,frame(8.4).angle,'audio pause repeats the same pose');
for(const angle of [-5,0,5]) {
  const a=angle*Math.PI/180,w=245,h=245;
  const rw=Math.abs(w*Math.cos(a))+Math.abs(h*Math.sin(a));
  const rh=Math.abs(w*Math.sin(a))+Math.abs(h*Math.cos(a));
  const rect={left:300-rw/2,top:300-rh/2,width:rw,height:rh};
  for(const [x,y] of [[30,150],[122.5,122.5],[200,40]]) {
    const dx=x-w/2,dy=y-h/2;
    const p=localPoint(rect,w,h,angle,300+dx*Math.cos(a)-dy*Math.sin(a),300+dx*Math.sin(a)+dy*Math.cos(a));
    assert.ok(Math.abs(p.x-x)<1e-8&&Math.abs(p.y-y)<1e-8);
  }
}
const samples=Array.from({length:60},(_,n)=>frame(4+n/60,{compact:true,dpr:.75}).x);
assert.ok(samples.slice(1).filter((x,n)=>Math.abs(x-samples[n])>.0001).length>55,'no consecutive pixel-rounding plateaus');
console.log('Dance: continuous audio-time motion, compact smooth translation, reduced motion, inverse rotated hit coordinates passed.');
