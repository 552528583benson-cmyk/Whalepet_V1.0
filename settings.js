const $=selector=>document.querySelector(selector);
let snapshot, toastTimer, busy=false;
let actionQueue=Promise.resolve();
let renderedGamesKey;
const names={idle:'待机',thinking:'思考中',reading:'阅读文件',searching:'搜索文件',tool_use:'调用工具',working:'工作中',testing:'检查结果',generating:'生成内容',needs_input:'需要你',ready:'完成',blocked:'遇到问题',connecting:'连接网络'};
function notify(message,error=false){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.toggle('error',error);$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,error?9000:4200);}
async function call(promise){const result=await promise;if(!result.ok)throw new Error(result.error||'操作未完成，请重试');return result.value;}
function action(fn,{transient=false}={}){const run=async()=>{busy=true;$('#saveStatus').textContent='正在处理…';try{await fn();$('#saveStatus').textContent=transient?'操作已完成':'更改已保存在本机';}catch(e){notify(e.message,true);$('#saveStatus').textContent='操作未完成，请重试';}finally{busy=false;}};actionQueue=actionQueue.then(run,run);return actionQueue;}
function tab(name){if(!['appearance','companion','poses','music','connections'].includes(name))name='appearance';if(snapshot?.providerLocked&&name==='connections')name='appearance';document.querySelectorAll('.page').forEach(p=>p.hidden=p.id!==name);document.querySelectorAll('[data-tab]').forEach(b=>{const active=b.dataset.tab===name;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});$('main').scrollTop=0;}
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>tab(b.dataset.tab)));
window.petSettings.onTab(tab);
function scaleLabels(value){$('#scaleValue').textContent=value+'%';$('#sizeCaption').textContent=value+'%'+(Number(value)===100?' · 默认大小':' · 等比例显示');document.querySelectorAll('[data-scale]').forEach(b=>b.classList.toggle('selected',Math.round(Number(b.dataset.scale)*100)===Number(value)));}
function showBuddyStatus(){
  const prefs=snapshot.preferences||{}, buddy=snapshot.companion?.buddy||{}, monitor=buddy.monitor||{};
  $('#typingCompanion').checked=prefs.typingCompanion===true;
  $('#gameCompanion').checked=prefs.gameCompanion===true;
  $('#manualGaming').checked=buddy.manualGame===true;
  const enabled=prefs.typingCompanion===true||prefs.gameCompanion===true;
  const mode=buddy.mode==='typing'?'正陪你敲键盘':buddy.mode==='gaming'?'正陪你玩游戏':buddy.manualGame?'手动陪玩已开启':enabled?'等待你的活动':'陪伴互动尚未开启';
  const monitorText=monitor.state==='starting'?'正在准备检测':monitor.state==='running'?'本地检测中':monitor.state==='unavailable'?'检测暂不可用':enabled?'检测已暂停':'';
  const hidden=snapshot.companion?.hidden===true;
  $('#buddyStatus').textContent=hidden?'小鲸藏起来了 · 检测已暂停':mode+(monitorText?' · '+monitorText:'');
  const warning=$('#buddyMonitorWarning');
  warning.hidden=monitor.state!=='unavailable';
  warning.textContent=monitor.state==='unavailable'?'本地活动检测暂不可用，自动跟随不会生效。'+(typeof monitor.reason==='string'&&monitor.reason.trim()?monitor.reason.trim()+' ':'')+'仍可用下方的手动陪玩；小鲸不会猜测你正在做什么。':'';
  renderGameList(prefs.games);
}
function renderGameList(value){
  const games=Array.isArray(value)?value.filter(name=>typeof name==='string'&&name.trim()):[];
  const key=JSON.stringify(games);
  if(key===renderedGamesKey)return;
  renderedGamesKey=key;
  const list=$('#gameList');list.replaceChildren();
  if(!games.length){
    const empty=document.createElement('li');empty.className='buddy-game-empty';empty.textContent='还没有选择游戏。也可以先用下方的手动陪玩。';list.append(empty);return;
  }
  for(const name of games){
    const item=document.createElement('li');
    const label=document.createElement('span');label.textContent=name;label.title=name;
    const remove=document.createElement('button');remove.type='button';remove.className='quiet-button';remove.textContent='移除';remove.setAttribute('aria-label','移除游戏 '+name);
    remove.onclick=()=>action(async()=>{snapshot=await call(window.petSettings.removeGame(name));showBuddyStatus();notify('已移除游戏：'+name);});
    item.append(label,remove);list.append(item);
  }
}
function showCompanionStatus(){
  showBuddyStatus();
  const companion=snapshot.companion||{}, shortcuts=companion.shortcuts||{};
  $('#companionStatus').textContent=companion.hidden?(companion.hideStage==='peeking'?'小鲸正探头看你':'小鲸在屏幕下沿躲猫猫'):'在身边 · 可以互动';
  $('#toggleCompanion').textContent=companion.hidden?'显示小鲸':'暂时隐藏小鲸';
  $('#recoverCompanion').textContent=companion.hidden?'找回小鲸':'带回屏幕角落';
  $('#companionTrayHint').textContent='点呆毛让小鲸探头，再点她让她缩回。右键呆毛或小脑袋，选择“找回小鲸”让她跳回身边。'+(companion.trayAvailable?'也可使用上方按钮、托盘或快捷键。':'托盘暂不可用，仍可使用上方按钮或快捷键。');
  const list=$('#companionShortcuts');list.replaceChildren();
  for(const [key,label,combination] of [['visibility','躲猫猫 / 回到身边','Ctrl + Alt + H'],['corner','找回小鲸 / 切换角落','Ctrl + Alt + W']]){
    const item=document.createElement('li');
    item.textContent=shortcuts[key]?`${combination} · ${label}`:`${label}：快捷键不可用，请使用控制室${companion.trayAvailable?'或托盘':''}`;
    item.classList.toggle('unavailable',!shortcuts[key]);list.append(item);
  }
}
function showStatus(){
  showCompanionStatus();
  const song=snapshot.idleSong||{};
  $('#songStatus').textContent=song.error||(song.playing?'♫ 小鲸正在唱歌':song.available?(snapshot.preferences.idleSongEnabled?'已准备好 · 静置满 5 分钟唱一次':'已导入 · 自动播放已关闭'):'需要先导入本地歌曲文件');
  $('#previewSong').disabled=!song.available;$('#stopSong').disabled=!song.playing;
  const auto=snapshot.provider==='chatgpt'&&snapshot.autoFollowCodex;
  $('#reloadCodex').disabled=!auto||snapshot.providerLocked;
  const freshAuto=auto&&snapshot.follower.status==='following';
  const time=auto?snapshot.follower.lastEventAt:snapshot.lastReceivedAt;
  const fresh=!!time&&Date.now()-time<60000;
  $('#liveDot').classList.toggle('waiting',!fresh);
  $('#connectionStatus').textContent=fresh?'已收到状态 · '+(names[snapshot.state]||snapshot.state):freshAuto?'自动跟随已开启':auto?'正在等待本机 Codex 事件':'等待外部 AI 发送状态';
  $('#connectionDetail').textContent=(time?'最近事件 '+new Date(time).toLocaleTimeString('zh-CN')+' · ':'')+'桌面姿势：'+(names[snapshot.renderedState]||'等待显示')+(auto&&snapshot.activeConversation?' · 来自会话：'+snapshot.activeConversation.title:'')+(auto&&['not-found','unavailable'].includes(snapshot.follower.status)?' · 未能读取本机任务目录':'');
}
function render(){
  const p=snapshot.preferences;
  $('#scale').value=Math.round(p.scale*100);scaleLabels(Math.round(p.scale*100));
  if(document.activeElement!==$('#scaleNumber'))$('#scaleNumber').value=Math.round(p.scale*100);
  $('#bubbleScale').value=Math.round((p.bubbleScale||1)*100);
  $('#bubbleOffset').value=p.bubbleOffset||0;bubbleLabels();
  $('#bubbleControls').disabled=!p.showSpeech;
  $('#showBadge').checked=p.showBadge;$('#showSpeech').checked=p.showSpeech;$('#idleLife').checked=p.idleLife!==false;
  $('#idleSongEnabled').checked=p.idleSongEnabled;$('#idleSongMode').value=p.idleSongMode;
  $('#idleSongVolume').value=Math.round(p.idleSongVolume*100);$('#songVolumeValue').textContent=Math.round(p.idleSongVolume*100)+'%';
  $('#songName').textContent=p.idleSongName||'还没有导入音频';
  $('#musicMuteHint').textContent=snapshot.musicMuteShortcut?'快捷键 Ctrl + Alt + M：立即停歌并关闭自动唱歌。右键同一位置可再次开启。':`右键小鲸 → ${p.idleSongEnabled?'关闭自动唱歌':'开启自动唱歌'}。紧急静音快捷键当前不可用（可能被其他程序占用）。`;
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
$('#scaleNumber').addEventListener('change',e=>{
  if(!e.target.checkValidity()||e.target.value===''){notify('请输入 65 到 150 之间的整数。',true);return;}
  save({scale:Number(e.target.value)/100});
});
$('#scaleNumber').addEventListener('keydown',e=>{if(e.key==='Enter')e.target.blur();});
function bubbleLabels(){
  $('#bubbleScaleValue').textContent=$('#bubbleScale').value+'%';
  const offset=Number($('#bubbleOffset').value);
  $('#bubbleOffsetValue').textContent=offset===0?'默认':`${offset>0?'下移':'上移'} ${Math.abs(offset)}`;
}
for(const id of ['bubbleScale','bubbleOffset']){
  $('#'+id).addEventListener('input',bubbleLabels);
  $('#'+id).addEventListener('change',e=>save({[id]:Number(e.target.value)/(id==='bubbleScale'?100:1)}));
}
$('#resetBubbles').onclick=()=>save({bubbleScale:1,bubbleOffset:0});
$('#toggleCompanion').onclick=()=>action(async()=>{snapshot=await call(window.petSettings.companion(snapshot.companion?.hidden?'show':'hide'));showCompanionStatus();});
$('#recoverCompanion').onclick=()=>action(async()=>{snapshot=await call(window.petSettings.companion('corner'));showCompanionStatus();});
for(const id of ['typingCompanion','gameCompanion'])$('#'+id).onchange=e=>save({[id]:e.target.checked});
$('#demoTypingBuddy').onclick=()=>action(async()=>{snapshot=await call(window.petSettings.previewBuddy('typing'));showBuddyStatus();notify('小鲸正在试敲键盘；演示不会开启自动检测，AI 紧急提醒仍然优先。');},{transient:true});
$('#manualGaming').onchange=e=>{const enabled=e.target.checked;action(async()=>{snapshot=await call(window.petSettings.gameMode(enabled));showBuddyStatus();notify(enabled?'本次手动陪玩已开启，AI 紧急提醒仍然优先。':'手动陪玩已关闭。');},{transient:true});};
$('#addGame').onclick=()=>action(async()=>{
  const result=await call(window.petSettings.addGame());if(result.cancelled)return;
  snapshot=result;render();notify('已登记游戏程序名，没有启动游戏。'+(snapshot.preferences.gameCompanion?'游戏进入前台时，小鲸会陪你玩。':'需要时开启“跟随我选的游戏”。'));
});
document.querySelectorAll('[data-scale]').forEach(b=>b.onclick=()=>save({scale:Number(b.dataset.scale)}));
for(const id of ['showBadge','showSpeech','idleLife','idleSongEnabled'])$('#'+id).onchange=e=>save({[id]:e.target.checked});
$('#idleSongMode').onchange=e=>save({idleSongMode:e.target.value});
$('#idleSongVolume').oninput=e=>$('#songVolumeValue').textContent=e.target.value+'%';
$('#idleSongVolume').onchange=e=>save({idleSongVolume:Number(e.target.value)/100});
$('#importSong').onclick=()=>action(async()=>{const result=await call(window.petSettings.importSong());if(result.cancelled)return;snapshot=result.snapshot;render();notify(snapshot.preferences.idleSongEnabled?'歌曲已导入，从现在开始重新计时。':'歌曲已导入；自动唱歌仍然关闭，需要时手动开启。');});
$('#disableSong').onclick=()=>action(async()=>{snapshot=await call(window.petSettings.disableSong());render();notify('已安静下来。自动唱歌已关闭，重启后也不会自行开启。');});
$('#previewSong').onclick=()=>action(async()=>{await call(window.petSettings.previewSong());snapshot=await call(window.petSettings.get());showStatus();});
$('#stopSong').onclick=()=>action(async()=>{await call(window.petSettings.stopSong());snapshot=await call(window.petSettings.get());showStatus();});
$('#songSource').onclick=()=>action(async()=>{await call(window.petSettings.openSongSource());});
$('#provider').onchange=e=>save({provider:e.target.value});
$('#autoFollow').onchange=e=>save({autoFollowCodex:e.target.checked});
$('#saveName').onclick=()=>save({customLabel:$('#customLabel').value});
$('#resetAll').onclick=()=>action(async()=>{const result=await call(window.petSettings.reset());if(result){snapshot=result;render();notify('已恢复默认外观，AI 接入设置未改变。');}});
$('#copyPython').onclick=()=>action(async()=>{await call(window.petSettings.copy('python'));notify('Python 接入示例已复制');});
$('#copyPacket').onclick=()=>action(async()=>{await call(window.petSettings.copy('packet'));notify('JSON 消息已复制');});
$('#refresh').onclick=()=>action(async()=>{snapshot=await call(window.petSettings.get());render();});
$('#reloadCodex').onclick=()=>action(async()=>{
  const button=$('#reloadCodex');button.disabled=true;button.textContent='正在重新读取…';
  try{snapshot=await call(window.petSettings.reloadCodex());render();notify(snapshot.reloadDisplay?.deferred?'已重新读取 Codex 状态，松开拖动后显示当前姿势。':snapshot.reloadDisplay?.state==='needs_input'?'已同步；仍有会话等待你的确认。':snapshot.reloadDisplay?.state==='blocked'?'已同步；仍有会话遇到问题。':'已重新读取 Codex 状态，并确认小鲸姿势已同步。');}
  finally{button.textContent='重新读取 Codex 状态';showStatus();}
});
document.querySelectorAll('[data-bg]').forEach(b=>b.onclick=()=>{$('#appearanceStage').className='preview-stage bg-'+b.dataset.bg;document.querySelectorAll('[data-bg]').forEach(s=>{s.classList.toggle('selected',s===b);s.setAttribute('aria-pressed',String(s===b));});});
window.petSettings.get().then(callResult=>{if(!callResult.ok)throw new Error(callResult.error);snapshot=callResult.value;render();tab(new URLSearchParams(location.search).get('tab')||'appearance');}).catch(e=>notify(e.message,true));
setInterval(async()=>{if(busy||document.hidden||!snapshot)return;try{const next=await call(window.petSettings.get());const changed=next.provider!==snapshot.provider||next.autoFollowCodex!==snapshot.autoFollowCodex||JSON.stringify(next.preferences)!==JSON.stringify(snapshot.preferences);snapshot=next;if(changed)render();else showStatus();}catch{/* Explicit refresh reports persistent failures. */}},2500);
