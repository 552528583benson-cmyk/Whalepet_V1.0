const {contextBridge,ipcRenderer}=require('electron');
function listen(channel,listener){
  if(typeof listener!=='function')return ()=>{};
  const receive=(_event,value)=>listener(value);
  ipcRenderer.on(channel,receive);
  return ()=>ipcRenderer.removeListener(channel,receive);
}
contextBridge.exposeInMainWorld('whaleRecovery',Object.freeze({
  request:()=>ipcRenderer.invoke('recovery:request'),
  toggle:()=>ipcRenderer.send('recovery:toggle'),
  restore:()=>ipcRenderer.send('recovery:restore'),
  menu:()=>ipcRenderer.send('recovery:menu'),
  beginPull:details=>ipcRenderer.send('recovery:pull-start',details),
  movePull:point=>ipcRenderer.send('recovery:pull-move',point),
  endPull:details=>ipcRenderer.send('recovery:pull-end',details),
  setInteractive:value=>ipcRenderer.send('recovery:interactive',value===true),
  onUpdate:listener=>listen('recovery:update',listener),
  onCursorProbe:listener=>listen('recovery:cursor-probe',listener),
  onPull:listener=>listen('recovery:pull',listener)
}));
