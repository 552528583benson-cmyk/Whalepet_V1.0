const assert=require('node:assert/strict');
const motion=require('../buddy-motion');
assert.equal(motion.tempo(0),2);assert.equal(motion.tempo(20),7);assert.equal(motion.tempo(NaN),3);
assert.deepEqual(motion.frame(200,{mode:'none'}),{left:0,right:0});
assert.deepEqual(motion.frame(200,{mode:'typing',reduced:true}),{left:0,right:0});
for(const mode of ['typing','gaming'])for(let time=0;time<2000;time+=5){
  const a=motion.frame(time,{mode,tempo:7}),b=motion.frame(time+1,{mode,tempo:7});
  for(const side of ['left','right']){
    assert.ok(a[side]>=0&&a[side]<=1,'bounded hand displacement');
    assert.ok(Math.abs(a[side]-b[side])<.05,'continuous movement, including contact');
  }
}
assert.equal(motion.advance(2,-1,4),2,'negative clocks cannot reverse phase');
assert.ok(motion.advance(2,100,4)<5,'resuming after sleep never catches up a long stall');
const left=motion.frame(0,{mode:'typing',phase:Math.PI/2});
const right=motion.frame(0,{mode:'typing',phase:3*Math.PI/2});
assert.ok(left.left>.999&&left.right===0&&right.right>.999&&right.left===0,'hands alternate');
console.log('PASS: bounded continuous hands, alternating typing, reduced motion and clamped phase/tempo.');
