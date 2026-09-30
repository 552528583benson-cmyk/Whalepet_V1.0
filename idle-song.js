// No input contents are recorded: only elapsed idle time from the OS is used.
class IdleSongGate {
  constructor(now = 0, delay = 300000) { this.delay=delay; this.reset(now); }
  reset(now) { this.since=now; this.used=false; this.lastIdle=null; }
  sample({now,idleSeconds,enabled,available,blocked}) {
    if (!Number.isFinite(idleSeconds) || idleSeconds<0 || blocked || !enabled || !available) {
      this.reset(now); return 'stop';
    }
    const active=idleSeconds<1 || (this.lastIdle!==null && idleSeconds<this.lastIdle);
    this.lastIdle=idleSeconds;
    if(active) { this.since=now; this.used=false; return 'stop'; }
    if(!this.used && Math.min(now-this.since,idleSeconds*1000)>=this.delay) {
      this.used=true; return 'play';
    }
    return 'wait';
  }
}

function createIdleSongController({getWindow,getPreferences,getDirectory,isBlocked,isAiIdle=()=>false,clock=()=>performance.now()}) {
  const {powerMonitor,ipcMain}=require('electron');
  const fs=require('node:fs');
  const path=require('node:path');
  const {pathToFileURL}=require('node:url');
  const now=clock;
  const gate=new IdleSongGate(now());
  let petActivityAt=now(), locked=false, suspended=false, token=0, playing=false, manual=false;
  let error='', startedAt=0;
  let aiIdleSince=null;
  const send=payload=>{const w=getWindow();if(w&&!w.isDestroyed())w.webContents.send('pet:idle-song',payload);};
  function stop() {
    if(playing)send({action:'stop',token});
    playing=false; manual=false;
  }
  function activity() { petActivityAt=now();aiIdleSince=null;gate.reset(now());stop(); }
  function stateChanged() { if(getPreferences().idleSongMode==='ai'&&!isAiIdle())activity(); }
  function file() {
    const name=getPreferences().idleSongFile;
    if(!name)return '';
    const target=path.join(getDirectory(),name);
    return fs.existsSync(target)?target:'';
  }
  function start(preview=false) {
    const target=file(), w=getWindow();
    if(!target)throw new Error('先导入这首歌的本地音频文件。');
    if(!w||w.isDestroyed()||w.webContents.isLoadingMainFrame()||locked||suspended||isBlocked())throw new Error('小鲸当前不能播放，请显示她并结束拖动后重试。');
    stop();token++;playing=true;manual=preview;error='';startedAt=now();
    send({action:'play',token,url:pathToFileURL(target).href,volume:getPreferences().idleSongVolume});
  }
  function tick() {
    let idle=0, osBlocked=false;
    try {
      const mode=getPreferences().idleSongMode;
      if(mode==='ai') {
        if(isAiIdle()) {if(aiIdleSince===null)aiIdleSince=now();idle=(now()-aiIdleSince)/1000;}
        else aiIdleSince=null;
      } else idle=mode==='pet'?(now()-petActivityAt)/1000:powerMonitor.getSystemIdleTime();
      osBlocked=powerMonitor.getSystemIdleState(300)==='locked';
    } catch {osBlocked=true;}
    const blocked=locked||suspended||osBlocked||isBlocked()||(getPreferences().idleSongMode==='ai'&&!isAiIdle());
    if(manual) { if(locked||suspended||osBlocked||isBlocked()||now()-startedAt>600000)stop();return; }
    const action=gate.sample({now:now(),idleSeconds:idle,enabled:getPreferences().idleSongEnabled,available:Boolean(file()),blocked});
    if(action==='stop')stop();
    if(action==='play') {try {start();}catch(e){error=e.message;}}
    // A broken decoder or an unexpectedly long file must not play forever.
    if(playing&&now()-startedAt>600000)stop();
  }
  const handlers={
    'lock-screen':()=>{locked=true;activity();},'unlock-screen':()=>{locked=false;activity();},
    suspend:()=>{suspended=true;activity();},resume:()=>{suspended=false;activity();}
  };
  for(const [event,fn] of Object.entries(handlers))powerMonitor.on(event,fn);
  const valid=event=>{const w=getWindow();return w&&!w.isDestroyed()&&event.sender===w.webContents&&event.senderFrame===w.webContents.mainFrame;};
  const onActivity=event=>{if(valid(event))activity();};
  const onResult=(event,value)=>{
    if(!valid(event)||value?.token!==token)return;
    if(['ended','error'].includes(value.status)) {
      playing=false;manual=false;
      if(value.status==='error')error='音频无法播放，请换用有效的 MP3 / WAV 文件。';
    }
  };
  ipcMain.on('pet:idle-song-activity',onActivity);
  ipcMain.on('pet:idle-song-result',onResult);
  const timer=setInterval(tick,500);
  return {
    activity,stop,stateChanged,
    changed(){activity();error='';},
    preview(){gate.used=true;start(true);},
    snapshot:()=>({available:Boolean(file()),playing,error}),
    dispose(){clearInterval(timer);stop();for(const [e,fn] of Object.entries(handlers))powerMonitor.removeListener(e,fn);ipcMain.removeListener('pet:idle-song-activity',onActivity);ipcMain.removeListener('pet:idle-song-result',onResult);}
  };
}
module.exports={IdleSongGate,createIdleSongController};
