const $=selector=>document.querySelector(selector);
let snapshot, toastTimer, busy=false;
let actionQueue=Promise.resolve();
const names={idle:'待机',thinking:'思考中',reading:'阅读文件',searching:'搜索文件',tool_use:'调用工具',working:'工作中',testing:'检查结果',generating:'生成内容',needs_input:'需要你',ready:'完成',blocked:'遇到问题',connecting:'连接网络'};
function notify(message,error=false){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.toggle('error',error);$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,error?9000:4200);}
async function call(promise){const result=await promise;if(!result.ok)throw new Error(result.error||'操作未完成，请重试');return result.value;}
function action(fn){const run=async()=>{busy=true;$('#saveStatus').textContent='正在处理…';try{await fn();$('#saveStatus').textContent='更改已保存在本机';}catch(e){notify(e.message,true);$('#saveStatus').textContent='操作未完成，请重试';}finally{busy=false;}};actionQueue=actionQueue.then(run,run);return actionQueue;}
function tab(name){if(!['appearance','poses','connections'].includes(name))name='appearance';if(snapshot?.providerLocked&&name==='connections')name='appearance';document.querySelectorAll('.page').forEach(p=>p.hidden=p.id!==name);document.querySelectorAll('[data-tab]').forEach(b=>{const active=b.dataset.tab===name;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});$('main').scrollTop=0;}
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>tab(b.dataset.tab)));
window.petSettings.onTab(tab);
function scaleLabels(value){$('#scaleValue').textContent=value+'%';$('#sizeCaption').textContent=value+'%'+(Number(value)===100?' · 默认大小':' · 等比例显示');document.querySelectorAll('[data-scale]').forEach(b=>b.classList.toggle('selected',Math.round(Number(b.dataset.scale)*100)===Number(value)));}
function showStatus(){
  const auto=snapshot.provider==='chatgpt'&&snapshot.autoFollowCodex;
  const freshAuto=auto&&snapshot.follower.status==='following';
  const time=auto?snapshot.follower.lastEventAt:snapshot.lastReceivedAt;
  const fresh=!!time&&Date.now()-time<60000;
  $('#liveDot').classList.toggle('waiting',!fresh);
  $('#connectionStatus').textContent=fresh?'已收到状态 · '+(names[snapshot.state]||snapshot.state):freshAuto?'自动跟随已开启':auto?'正在等待本机 Codex 事件':'等待外部 AI 发送状态';
  $('#connectionDetail').textContent=(time?'最近事件 '+new Date(time).toLocaleTimeString('zh-CN')+' · ':'')+'桌面姿势：'+(names[snapshot.renderedState]||'等待显示')+(auto&&['not-found','unavailable'].includes(snapshot.follower.status)?' · 未能读取本机任务目录':'');
}
function render(){
  const p=snapshot.preferences;
  $('#scale').value=Math.round(p.scale*100);scaleLabels(Math.round(p.scale*100));
  $('#showBadge').checked=p.showBadge;$('#showSpeech').checked=p.showSpeech;$('#idleLife').checked=p.idleLife!==false;
  $('#appearancePet').src=snapshot.poses[0].url;
  $('#provider').value=snapshot.provider;$('#provider').disabled=snapshot.providerLocked;
  $('[data-tab="connections"]').hidden=snapshot.providerLocked;
  $('#autoFollow').checked=snapshot.autoFollowCodex;
  $('#followRow').hidden=snapshot.provider!=='chatgpt'||snapshot.providerLocked;
  $('#customNameRow').hidden=snapshot.provider!=='custom';
  if(document.activeElement!==$('#customLabel'))$('#customLabel').value=p.customLabel;
  $('#sourceHint').textContent=snapshot.provider==='chatgpt'?'自动跟随只支持本机 Codex 任务；普通 ChatGPT 网页 / 客户端需另行接入。':snapshot.provider==='deepseek'?'通过本地状态桥或状态文件接收 DeepSeek 的事件。选择来源不会自动连接网页。':'适用于可以运行脚本或发送工具事件的 AI。小鲸不调用模型，不需要填写 API 密钥。';
  $('#endpoint').textContent=snapshot.endpoint;$('#pythonExample').textContent=snapshot.snippets.python;
  $('#stateNames').textContent=snapshot.snippets.states;$('#stateFile').textContent=snapshot.stateFile;
  showStatus();
  const grid=$('#poseGrid');grid.replaceChildren();
  for(const pose of snapshot.poses){
    const card=document.createElement('article');card.className='pose-card';
    const head=document.createElement('div');head.className='pose-heading';
    const title=document.createElement('span');title.textContent=pose.label;
    const tag=document.createElement('span');tag.className='pose-tag';tag.textContent=pose.custom?'自定义':'原作';head.append(title,tag);
    const stage=document.createElement('div');stage.className='pose-image';
    const image=document.createElement('img');image.src=pose.url;image.alt=pose.label+'姿势';stage.append(image);
    const buttons=document.createElement('div');buttons.className='pose-actions';
    const preview=document.createElement('button');preview.textContent='预览动作';preview.setAttribute('aria-label','预览'+pose.label);preview.onclick=()=>action(async()=>{await call(window.petSettings.preview(pose.state));notify('小鲸正在预览：'+pose.label);});
    const change=document.createElement('button');change.textContent='更换图片';change.className='primary';change.setAttribute('aria-label','更换'+pose.label+'图片');change.onclick=()=>action(async()=>{const result=await call(window.petSettings.importImage(pose.state));if(result.cancelled)return;snapshot=result.snapshot;render();notify(result.opaque?'已导入。图片没有透明背景，桌面会显示整块底色；建议换用透明 PNG。':'已导入并对齐脚底，原作图片保留。',result.opaque);});
    buttons.append(preview,change);card.append(head,stage,buttons);
    const reset=document.createElement('button');reset.className='restore-pose';reset.textContent=pose.custom?'恢复这个姿势':'原作已保留';reset.disabled=!pose.custom;reset.setAttribute('aria-label','恢复'+pose.label+'默认图片');reset.onclick=()=>action(async()=>{snapshot=await call(window.petSettings.resetImage(pose.state));render();notify('已恢复原作：'+pose.label);});card.append(reset);grid.append(card);
  }
}
function save(patch){return action(async()=>{snapshot=await call(window.petSettings.save(patch));render();});}
$('#scale').addEventListener('input',e=>scaleLabels(e.target.value));
$('#scale').addEventListener('change',e=>save({scale:Number(e.target.value)/100}));
document.querySelectorAll('[data-scale]').forEach(b=>b.onclick=()=>save({scale:Number(b.dataset.scale)}));
for(const id of ['showBadge','showSpeech','idleLife'])$('#'+id).onchange=e=>save({[id]:e.target.checked});
$('#provider').onchange=e=>save({provider:e.target.value});
$('#autoFollow').onchange=e=>save({autoFollowCodex:e.target.checked});
$('#saveName').onclick=()=>save({customLabel:$('#customLabel').value});
$('#resetAll').onclick=()=>action(async()=>{const result=await call(window.petSettings.reset());if(result){snapshot=result;render();notify('已恢复默认外观，AI 接入设置未改变。');}});
$('#copyPython').onclick=()=>action(async()=>{await call(window.petSettings.copy('python'));notify('Python 接入示例已复制');});
$('#copyPacket').onclick=()=>action(async()=>{await call(window.petSettings.copy('packet'));notify('JSON 消息已复制');});
$('#refresh').onclick=()=>action(async()=>{snapshot=await call(window.petSettings.get());render();});
document.querySelectorAll('[data-bg]').forEach(b=>b.onclick=()=>{$('#appearanceStage').className='preview-stage bg-'+b.dataset.bg;document.querySelectorAll('[data-bg]').forEach(s=>{s.classList.toggle('selected',s===b);s.setAttribute('aria-pressed',String(s===b));});});
window.petSettings.get().then(callResult=>{if(!callResult.ok)throw new Error(callResult.error);snapshot=callResult.value;render();tab(new URLSearchParams(location.search).get('tab')||'appearance');}).catch(e=>notify(e.message,true));
setInterval(async()=>{if(busy||document.hidden||!snapshot)return;try{const next=await call(window.petSettings.get());const changed=next.provider!==snapshot.provider||next.autoFollowCodex!==snapshot.autoFollowCodex||JSON.stringify(next.preferences)!==JSON.stringify(snapshot.preferences);snapshot=next;if(changed)render();else showStatus();}catch{/* Explicit refresh reports persistent failures. */}},2500);
