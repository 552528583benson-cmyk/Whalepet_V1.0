const character=document.querySelector('#restorePet');
const head=document.querySelector('#headArt');
const curl=document.querySelector('#curlArt');
const bubbles=document.querySelector('#conversationBubbles');
const bridge=window.whaleRecovery;
const ART_WIDTH=275;
// Click the whole arch, including its transparent hole. The illustration and
// CSS clipping are unchanged; only this tightly bounded interaction grows.
const CURL_HIT_POLYGON=[[480,345],[480,280],[515,243],[556,224],[601,211],[642,218],[672,246],[677,280],[658,320],[624,355]];
const CURL_HIT_MARGIN=6; // Logical CSS pixels; native zoom scales it with the pet.
const PULL_THRESHOLD=6; // Screen DIPs; independent of pet zoom.
const LABELS={idle:'待机中',connecting:'正在连接',thinking:'正在思考',reading:'正在阅读',searching:'正在寻找',tool_use:'正在使用工具',working:'正在工作',testing:'正在检查',generating:'正在生成',needs_input:'等你确认',ready:'完成啦',blocked:'遇到一个问题'};
let view={stage:'hidden',scale:1,conversations:[],showSpeech:true};
let pixels=null;
let interactive=false;
let lastCursor=null;
let interactionFrame=null;
let requestSerial=0;
let pullGesture=null;
let pullActive=false;
let pullRequestSerial=0;
let latestPullRequestId=0;
let pullAwaitingNative=false;
let pullCancelledLocally=false;
let suppressClick=false;
let suppressClickTimer=null;

function insidePolygon(x,y){
  let inside=false;
  for(let i=0,j=CURL_HIT_POLYGON.length-1;i<CURL_HIT_POLYGON.length;j=i++){
    const [ax,ay]=CURL_HIT_POLYGON[i], [bx,by]=CURL_HIT_POLYGON[j];
    if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside;
  }
  return inside;
}

function hitCurl(x,y,margin){
  if(insidePolygon(x,y))return true;
  for(let i=0,j=CURL_HIT_POLYGON.length-1;i<CURL_HIT_POLYGON.length;j=i++){
    const [ax,ay]=CURL_HIT_POLYGON[i],[bx,by]=CURL_HIT_POLYGON[j];
    const dx=bx-ax,dy=by-ay,length=dx*dx+dy*dy;
    const t=length?Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/length)):0;
    if((x-ax-t*dx)**2+(y-ay-t*dy)**2<=margin*margin)return true;
  }
  return false;
}

function hitArt(element,x,y,onlyCurl){
  if(!pixels||Number(getComputedStyle(element).opacity)<.08)return false;
  const bounds=element.getBoundingClientRect();
  const sx=(x-bounds.left)*head.naturalWidth/bounds.width;
  const sy=(y-bounds.top)*head.naturalHeight/bounds.height;
  if(sx<0||sy<0||sx>=head.naturalWidth||sy>=head.naturalHeight)return false;
  if(onlyCurl)return hitCurl(sx,sy,CURL_HIT_MARGIN*head.naturalWidth/bounds.width);
  if(Math.floor(sy)>750)return false;
  return pixels[(Math.floor(sy)*head.naturalWidth+Math.floor(sx))*4+3]>=24;
}

function hitTest(x,y){
  if(view.visible===false||isPulling())return false;
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>=innerWidth||y>=innerHeight)return false;
  // Bubbles are visual only; desktop applications remain clickable behind them.
  return hitArt(head,x,y,false)||(view.stage==='peeking'&&hitArt(head,x,y,true))||hitArt(curl,x,y,true);
}

function hitAhoge(x,y){
  if(view.visible===false||view.stage!=='peeking'||isPulling())return false;
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>=innerWidth||y>=innerHeight)return false;
  return hitArt(head,x,y,true);
}

function hitPull(x,y){
  // Any visible part of the peeking head can begin the same upright pull.
  // Keep the loop's transparent hole usable, but not the empty art padding,
  // task bubbles, or the hidden-stage curl-only recovery interaction.
  if(view.visible===false||view.stage!=='peeking'||isPulling())return false;
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>=innerWidth||y>=innerHeight)return false;
  return hitArt(head,x,y,false)||hitArt(head,x,y,true);
}

function isPulling(){return pullActive||view.pulling===true;}

function probe(point){
  const x=Number(point?.x),y=Number(point?.y);
  lastCursor={x,y};
  // Capture must survive leaving the crop, including its transparent pixels.
  const next=Boolean(pullGesture)||pullAwaitingNative||isPulling()||hitTest(x,y);
  if(next!==interactive){interactive=next;bridge?.setInteractive?.(next);}
}

function syncPullAppearance(){
  document.body.dataset.pulling=String(isPulling());
  renderBubbles();
  probe(lastCursor);
}

function screenPoint(event,fallback){
  const x=Number(event?.screenX),y=Number(event?.screenY);
  return Number.isFinite(x)&&Number.isFinite(y)?{x,y}:fallback;
}

function suppressDragClick(){
  suppressClick=true;
  clearTimeout(suppressClickTimer);
  suppressClickTimer=setTimeout(()=>{suppressClick=false;suppressClickTimer=null;},800);
}

function finishPull(cancelled,event,notify=true){
  const gesture=pullGesture;
  if(!gesture)return;
  pullGesture=null;
  // Clear before releasing capture: lostpointercapture can fire synchronously.
  try{if(character.hasPointerCapture(gesture.pointerId))character.releasePointerCapture(gesture.pointerId);}catch{}
  if(gesture.dragging){
    suppressDragClick();
    if(cancelled){pullActive=false;view.pulling=false;pullCancelledLocally=true;}
    if(notify)bridge?.endPull?.({cancelled:cancelled===true,cursor:screenPoint(event,gesture.lastScreen),requestId:gesture.details.requestId});
  }
  syncPullAppearance();
}

function pointerDown(event){
  // A fresh press is never the click generated by the preceding drag.
  if(!pullGesture){suppressClick=false;clearTimeout(suppressClickTimer);suppressClickTimer=null;}
  if(pullGesture||isPulling()||event.button!==0||event.isPrimary===false||!hitPull(event.clientX,event.clientY)||typeof bridge?.beginPull!=='function')return;
  const press=screenPoint(event);
  if(!press)return;
  const bounds=head.getBoundingClientRect();
  if(!bounds.width||!bounds.height)return;
  const grabX=event.clientX-bounds.left,grabY=event.clientY-bounds.top;
  latestPullRequestId=++pullRequestSerial;pullAwaitingNative=false;pullCancelledLocally=false;
  pullGesture={pointerId:event.pointerId,dragging:false,lastScreen:press,details:{
    requestId:latestPullRequestId,pointerId:event.pointerId,pressScreenX:press.x,pressScreenY:press.y,
    grabX,grabY,artWidth:bounds.width,artHeight:bounds.height,
    sourceX:grabX*head.naturalWidth/bounds.width,sourceY:grabY*head.naturalHeight/bounds.height
  }};
  try{character.setPointerCapture(event.pointerId);}catch{pullGesture=null;return;}
  probe({x:event.clientX,y:event.clientY});
}

function pointerMove(event){
  const gesture=pullGesture;
  if(!gesture||event.pointerId!==gesture.pointerId)return;
  gesture.lastScreen=screenPoint(event,gesture.lastScreen);
  if(!(event.buttons&1)){finishPull(false,event);return;}
  if(!gesture.dragging){
    const dx=gesture.lastScreen.x-gesture.details.pressScreenX,dy=gesture.lastScreen.y-gesture.details.pressScreenY;
    if(dx*dx+dy*dy<=PULL_THRESHOLD*PULL_THRESHOLD)return;
    // The main process confirms after its upright sprite is visible, so this
    // crop stays in place while that surface is being prepared.
    gesture.dragging=true;pullAwaitingNative=true;suppressDragClick();
    bridge.beginPull({...gesture.details,cursor:gesture.lastScreen});
  }else bridge?.movePull?.({...gesture.lastScreen,requestId:gesture.details.requestId});
  event.preventDefault();
}

function receivePull(value){
  // The last ID survives pointerup while the native surface finishes readiness
  // and settlement. Receipts from a previous press cannot touch a new capture.
  if(value?.requestId!==latestPullRequestId||!pullAwaitingNative)return;
  if(value?.phase==='started'){
    if(pullCancelledLocally)return;
    pullActive=true;view.pulling=true;syncPullAppearance();return;
  }
  if(value?.phase!=='ended'&&value?.phase!=='cancelled')return;
  finishPull(value.phase==='cancelled',null,false);
  pullActive=false;view.pulling=false;pullAwaitingNative=false;syncPullAppearance();
}

function followAnimation(){
  cancelAnimationFrame(interactionFrame);
  const until=performance.now()+430;
  const tick=()=>{
    if(lastCursor)probe(lastCursor);
    if(performance.now()<until)interactionFrame=requestAnimationFrame(tick);
    else interactionFrame=null;
  };
  interactionFrame=requestAnimationFrame(tick);
}

function renderBubbles(){
  bubbles.replaceChildren();
  bubbles.hidden=true;
  if(view.stage!=='peeking'||view.showSpeech===false||isPulling())return;
  const conversations=Array.isArray(view.conversations)?view.conversations.slice(0,2):[];
  for(const item of conversations){
    const state=Object.hasOwn(LABELS,item.state)?item.state:'idle';
    const card=document.createElement('div');
    card.className='conversation-bubble';card.dataset.state=state;card.dataset.uncertain=String(item.uncertain===true);
    const name=document.createElement('span');name.className='conversation-name';
    name.textContent=typeof item.title==='string'&&item.title.trim()?item.title.trim().slice(0,120):'未命名任务';
    const urgent=state==='needs_input'||state==='blocked';
    const status=document.createElement('strong');
    status.textContent=`${item.primary?'● ':''}${item.uncertain&&!urgent?'状态待确认':LABELS[state]}${item.uncertain&&urgent?' · 待确认':''}`;
    card.setAttribute('aria-label',`${name.textContent}：${status.textContent}`);
    card.append(name,status);bubbles.append(card);
  }
  const count=Math.max(0,Math.floor(Number(view.conversationOverflow?.activeCount??view.conversationOverflow?.count)||0));
  if(count&&conversations.length){
    const uncertain=Math.min(count,Math.max(0,Math.floor(Number(view.conversationOverflow?.uncertain)||0)));
    const more=document.createElement('div');more.className='conversation-overflow';more.textContent=uncertain?`另有 ${count} 项 · ${uncertain} 待确认`:`另有 ${count} 个进行中`;bubbles.append(more);
  }
  bubbles.hidden=conversations.length===0;
}

function update(value){
  requestSerial++;
  const previous=view.stage;
  const incoming={...value};
  const tagged=Number.isSafeInteger(incoming.pullRequestId)&&incoming.pullRequestId>0;
  if((tagged&&incoming.pullRequestId!==latestPullRequestId)||(incoming.pulling===true&&pullCancelledLocally)){
    delete incoming.pulling;delete incoming.pullRequestId;
  }
  view={...view,...incoming,stage:incoming.stage==='peeking'?'peeking':'hidden'};
  if(incoming.pulling===true)pullActive=true;
  else if(incoming.pulling===false&&!pullGesture?.dragging)pullActive=false;
  if(pullGesture&&(view.visible===false||(view.stage!=='peeking'&&!isPulling())))finishPull(true);
  if(view.visible===false&&!pullGesture&&!isPulling()){interactive=false;lastCursor=null;bridge?.setInteractive?.(false);}
  document.body.dataset.stage=view.stage;
  document.body.dataset.pulling=String(isPulling());
  character.setAttribute('aria-label',view.stage==='peeking'?'轻轻点小鲸让她躲回边缘，或按住脸、脑袋或呆毛拖动把她拉出来':'轻轻点呆毛或圈内，让小鲸探出头');
  renderBubbles();
  if(previous!==view.stage)followAnimation();
  else if(lastCursor)probe(lastCursor);
}

function loadAlpha(){
  if(!head.naturalWidth||pixels)return;
  const canvas=document.createElement('canvas');canvas.width=head.naturalWidth;canvas.height=head.naturalHeight;
  const context=canvas.getContext('2d',{willReadFrequently:true});
  context.drawImage(head,0,0);pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
  if(lastCursor)probe(lastCursor);
}

character.addEventListener('pointerdown',pointerDown);
character.addEventListener('pointermove',pointerMove);
character.addEventListener('pointerup',event=>{if(event.pointerId===pullGesture?.pointerId)finishPull(false,event);});
character.addEventListener('pointercancel',event=>{if(event.pointerId===pullGesture?.pointerId)finishPull(true,event);});
character.addEventListener('lostpointercapture',event=>{if(event.pointerId===pullGesture?.pointerId)finishPull(true,event);});
character.addEventListener('click',event=>{
  if(suppressClick&&event.detail>0){suppressClick=false;clearTimeout(suppressClickTimer);suppressClickTimer=null;event.preventDefault();event.stopImmediatePropagation();return;}
  if(!isPulling()&&!pullGesture?.dragging&&(event.detail===0||hitTest(event.clientX,event.clientY)))bridge?.toggle?.();
});
character.addEventListener('contextmenu',event=>{event.preventDefault();if((!event.clientX&&!event.clientY)||hitTest(event.clientX,event.clientY))bridge?.menu?.();});
document.addEventListener('mousemove',event=>probe({x:event.clientX,y:event.clientY}));
document.addEventListener('mouseleave',()=>probe({x:-1,y:-1}));
head.addEventListener('load',loadAlpha);
if(head.complete)loadAlpha();
bridge?.onUpdate?.(update);
bridge?.onCursorProbe?.(probe);
bridge?.onPull?.(receivePull);
window.addEventListener('pagehide',()=>finishPull(true));
if(bridge?.request){
  const serial=requestSerial;
  bridge.request().then(value=>{if(serial===requestSerial)update(value);}).catch(()=>{});
}
window.whalePeekController=Object.freeze({
  hitTest,
  hitAhoge,
  hitPull,
  info:()=>({stage:view.stage,scale:view.scale,ready:pixels!==null,pulling:isPulling(),pullPending:Boolean(pullGesture&&!pullGesture.dragging),pullRequested:pullGesture?.dragging===true,pullAwaitingNative,pullRequestId:latestPullRequestId,pullPointerId:pullGesture?.pointerId??null,headVisible:view.stage==='peeking'&&!isPulling(),curlVisible:view.stage==='hidden'&&!isPulling(),bubbleCount:bubbles.children.length,viewport:{width:innerWidth,height:innerHeight},art:{width:ART_WIDTH,headSourceBottom:750,curlSourceBottom:310,curlHitMargin:CURL_HIT_MARGIN,curlHoleClickable:true,pullThreshold:PULL_THRESHOLD}})
});
