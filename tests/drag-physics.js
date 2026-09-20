const assert=require('node:assert/strict');
const {create}=require('../drag-physics');
function run(hz,path,seconds=8){const p=create(),out=[];for(let n=0;n<=hz*seconds;n++){let t=n/hz;out.push(p.advance(t*1000,path(t)));}return out;}
const path=t=>t<.3?0:t<.6?(t-.3)*700:210;
const at60=run(60,path),at120=run(120,path),at144=run(144,path);
assert.ok(Math.max(...at60)>8,'fast horizontal movement must produce visible lag');
assert.ok(Math.min(...at60)<-3,'stopping causes a swing through centre');
assert.ok(Math.abs(at60.at(-1))<.05,'damping returns to rest');
let hzError=0;for(let i=0;i<at60.length;i++)hzError=Math.max(hzError,Math.abs(at60[i]-at120[i*2]));
assert.ok(hzError<1.6,'frame rate divergence '+hzError);
const reverse=run(60,t=>-path(t));for(let i=0;i<at60.length;i++)assert.ok(Math.abs(at60[i]+reverse[i])<.00001,'left/right symmetry');
const violent=run(60,t=>Math.sin(t*15)*1000);
assert.ok(violent.every(Number.isFinite));
assert.ok(Math.max(...violent.map(Math.abs))>22,'large movements must exceed the old limit');
const still=run(60,()=>500);assert.ok(still.every(a=>a===0),'no unsolicited rocking when held still');
const p=create();p.advance(0,0);p.advance(16,200);assert.equal(p.advance(1000,400),0,'long frame gap resets safely');
assert.ok(Number.isFinite(p.advance(NaN,Infinity)));
const throws=[];
for(const speed of [300,700,1400,2500,5000]){
  const model=create();let max=0,hardStops=0,remaining=0,internalPeak=0,turns=0,lastSign=0;
  for(let n=0;n<=120*10;n++){
    const t=n/120,x=t<.3?0:t<.5?(t-.3)*speed:.2*speed;
    const visible=model.advance(t*1000,x),state=model.info();
    assert.ok(Number.isFinite(visible));
    assert.equal(visible,state.internalAngle,'display must not compress the simulated angle');
    max=Math.max(max,Math.abs(visible));internalPeak=Math.max(internalPeak,Math.abs(state.internalAngle));
    if(Math.abs(visible)>21.99&&state.omega===0)hardStops++;
    if(t>1&&t<2.5)remaining=Math.max(remaining,Math.abs(visible));
    if(t>.5&&Math.abs(visible)>.5){const sign=Math.sign(visible);if(lastSign&&sign!==lastSign)turns++;lastSign=sign;}
  }
  assert.equal(hardStops,0,'no momentum deletion at visual limit');
  assert.ok(Math.abs(model.info().angle)<.05,'eventually settles at speed '+speed);
  if(speed>=1400){assert.ok(turns>=3,'fast throw must keep swinging');assert.ok(internalPeak>22,'momentum retained beyond visual cap');}
  throws.push({speed,max,remaining,turns,internalPeak});
}
assert.ok(throws[3].remaining>throws[1].remaining*1.25,'high-speed throws retain more visible after-swing');
function reversalDelay(speed){
  const model=create();let previous=0;
  for(let n=0;n<240*2;n++){
    const t=n/240,x=t<.3?0:t<.5?(t-.3)*speed:.2*speed;
    const a=model.advance(t*1000,x);
    if(t>.5&&previous>0&&a<=0)return t-.5;
    previous=a;
  }
  throw Error('no reversal');
}
const slowReversal=reversalDelay(700),fastReversal=reversalDelay(2500);
assert.ok(fastReversal<slowReversal*.65,'fast flick must reverse faster, not just swing longer');
const fast60=run(60,t=>t<.3?0:t<.5?(t-.3)*2500:500),fast120=run(120,t=>t<.3?0:t<.5?(t-.3)*2500:500);
assert.ok(Math.max(...fast60.map((a,i)=>Math.abs(a-fast120[i*2])))<2,'high speed remains frame-rate independent');
console.log('Fast-flick reversal after stopping (seconds):',{slowReversal,fastReversal});
console.log('High-speed momentum checks:',throws);
console.log('Pendulum passed: lag, counter-swing, damping, 60/120/144 Hz, symmetry, unrestricted angle, stationary and long-frame safety.',{peak:Math.max(...at60),counter:Math.min(...at60),hzError,at144:at144.at(-1)});
