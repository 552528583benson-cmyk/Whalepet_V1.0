'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
// Execute only the trusted menu factory and music actions, not Electron,
// monitoring, real preferences, or the app.
const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
const factory=source.match(/function buildPetMenu\(\) \{[\s\S]*?\n\}\n\nfunction showPetMenu\(/);
assert.ok(factory,'quick menu factory exists');
const musicActions=source.match(/function disableIdleSong\(\) \{[\s\S]*?\n\}\n\nfunction toggleIdleSong\(\) \{[\s\S]*?\n\}/);
assert.ok(musicActions,'actual persistent disable and toggle actions exist');
const calls=[],savedPatches=[];
const originalPreferences={scale:.75,idleSongEnabled:true,idleSongMode:'ai',idleSongVolume:.18,idleSongFile:'local-song.m4a',customLabel:'小鲸',showSpeech:false};
let playing=true;
const context={
  providerLocked:false,activeProvider:'chatgpt',autoFollow:true,codexFollower:{},petHidden:false,
  preferences:{...originalPreferences},
  Menu:{buildFromTemplate:items=>items},settingsController:{open:page=>calls.push(['settings',page])},
  togglePetVisibility:()=>calls.push(['visibility']),
  cyclePetSafeCorner:()=>calls.push(['recover']),
  idleSongController:{
    stop:()=>{playing=false;calls.push(['stop-song']);},
    start:()=>{throw new Error('enabling must never start a song immediately');},
    preview:()=>{throw new Error('enabling must never preview a song');}
  },
  saveAppearance:patch=>{
    calls.push(['save-song',patch.idleSongEnabled]);
    savedPatches.push(JSON.parse(JSON.stringify(patch)));
    context.preferences={...context.preferences,...patch};
  },
  reloadCodexStatus:async()=>calls.push(['reload']),petWindow:{},
  dialog:{showMessageBox:(_window,value)=>calls.push(['warning',value.message])},app:{quit:()=>calls.push(['quit'])}
};
vm.createContext(context);vm.runInContext(musicActions[0]+'\n'+factory[0].replace(/\n\nfunction showPetMenu\($/,''),context);
const readMenu=()=>Array.from(context.buildPetMenu());
function check(menu,refresh){
  assert.ok(menu.every(item=>!Object.hasOwn(item,'submenu')),'no list inside a list');
  const actions=menu.filter(item=>item.type!=='separator');
  assert.ok(actions.length<=7);assert.equal(actions[0].id,'settings');
  assert.deepEqual(actions.map(item=>item.id),['settings','size','visibility','recover','quiet',...(refresh?['reload-codex']:[]), 'quit']);
  assert.ok(actions.every(item=>typeof item.click==='function'),'no decorative or debug entries');
  assert.ok(actions.every(item=>item.label.length<=22),'labels stay concise');
  assert.equal(menu.findIndex(item=>item.id==='quiet'),4,'the music switch stays in the same flat-menu position');
  assert.equal(menu[4].label,context.preferences.idleSongEnabled?'关闭自动唱歌':'开启自动唱歌','the same action names its next operation');
}
(async()=>{
  const capturedQuiet=readMenu().find(item=>item.id==='quiet');
  await capturedQuiet.click({checked:true});
  assert.equal(playing,false,'turning automatic music off immediately stops current playback');
  assert.equal(context.preferences.idleSongEnabled,false);
  assert.deepEqual(calls,[['stop-song'],['save-song',false]],'stop happens before persisting off');
  assert.deepEqual(savedPatches,[{idleSongEnabled:false}],'disable only changes the music-enable preference');
  let disabledMenu=readMenu();check(disabledMenu,true);
  calls.length=0;
  await disabledMenu.find(item=>item.id==='quiet').click({checked:false});
  assert.equal(context.preferences.idleSongEnabled,true);
  assert.equal(playing,false,'turning automatic music on does not immediately resume playback');
  assert.deepEqual(calls,[['save-song',true]],'enable follows the ordinary settings path without an immediate play or preview');
  assert.deepEqual(context.preferences,originalPreferences,'off and on preserve all unrelated preferences');
  check(readMenu(),true);
  // A tray/menu callback may outlive the settings value used to build its label.
  // It must act on the current preference, not a captured flag or checked state.
  context.disableIdleSong();
  calls.length=0;
  await capturedQuiet.click({checked:true});
  assert.equal(context.preferences.idleSongEnabled,true,'a formerly enabled menu action enables when the live preference is now off');
  assert.deepEqual(calls,[['save-song',true]]);
  calls.length=0;
  let menu=readMenu();check(menu,true);
  for(const item of menu.filter(item=>item.type!=='separator'))await item.click({checked:true});
  assert.deepEqual(calls,[['settings','appearance'],['settings','appearance'],['visibility'],['recover'],['stop-song'],['save-song',false],['reload'],['quit']]);
  assert.match(menu.find(item=>item.id==='size').label,/75%/,'size is directly visible in the flat menu');
  calls.length=0;context.reloadCodexStatus=async()=>{throw new Error('safe reload failure');};
  await menu.find(item=>item.id==='reload-codex').click();assert.deepEqual(calls,[['warning','safe reload failure']]);
  context.petHidden=true;
  menu=readMenu();check(menu,false);assert.equal(menu.find(item=>item.id==='visibility').label,'显示小鲸');
  assert.ok(menu.every(item=>!/Codex|ChatGPT/.test(item.label||'')),'hidden curl/head menu exposes no Codex status or reload entry');
  await menu.find(item=>item.id==='quiet').click();
  assert.equal(context.preferences.idleSongEnabled,true,'hidden pet menu can enable automatic music in the same place');
  menu=readMenu();check(menu,false);
  await menu.find(item=>item.id==='quiet').click();
  assert.equal(context.preferences.idleSongEnabled,false,'hidden pet menu can disable automatic music in the same place');
  context.petHidden=false;
  assert.ok(menu.every(item=>item.id!=='click-through'&&!/鼠标穿透/.test(item.label||'')),'the obsolete mouse-lock action is absent');
  for(const provider of ['deepseek','custom']){
    context.activeProvider=provider;check(readMenu(),false);
    await readMenu().find(item=>item.id==='quiet').click();
    assert.equal(context.preferences.idleSongEnabled,true,`${provider} retains the same enable action`);
    check(readMenu(),false);
    await readMenu().find(item=>item.id==='quiet').click();
    assert.equal(context.preferences.idleSongEnabled,false,`${provider} retains the same disable action`);
    check(readMenu(),false);
  }
  context.activeProvider='chatgpt';context.providerLocked=true;check(readMenu(),false);
  context.providerLocked=false;context.autoFollow=false;check(readMenu(),false);
  context.autoFollow=true;context.codexFollower=null;check(readMenu(),false);
  console.log('PASS flat quick menu: at most seven actions, zero submenu or mouse lock, direct size/settings/recovery/music toggle/quit, persistent same-place on/off with immediate stop and no immediate replay, current-preference callback, preserved unrelated settings, hidden/other-provider toggles, eligible refresh only, safe failure and locked-provider separation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
