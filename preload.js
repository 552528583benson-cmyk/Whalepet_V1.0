const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("whalePet", {
  idleSongActivity:()=>ipcRenderer.send('pet:idle-song-activity'),
  idleSongResult:value=>ipcRenderer.send('pet:idle-song-result',value),
  onIdleSong:listener=>ipcRenderer.on('pet:idle-song',(_event,value)=>listener(value)),
  onInteractionReset:listener=>ipcRenderer.on('pet:interaction-reset',()=>listener()),
  onCursorProbe:listener=>ipcRenderer.on('pet:cursor-probe',(_event,value)=>listener(value)),
  onEdgeAction:listener=>ipcRenderer.on('pet:edge-action',(_event,value)=>listener(value)),
  onReloadAction:listener=>ipcRenderer.on('pet:reload-action',(_event,value)=>listener(value)),
  onBuddy:listener=>ipcRenderer.on('pet:buddy',(_event,value)=>listener(value)),
  requestBuddy:()=>ipcRenderer.invoke('pet:request-buddy'),
  reportBuddy:mode=>ipcRenderer.send('pet:buddy-rendered',mode),
  beginDrag: (value) => ipcRenderer.send("pet:drag-start", value),
  moveDrag: () => ipcRenderer.send("pet:drag-move"),
  endDrag: (value) => ipcRenderer.send("pet:drag-end", value),
  onDragMotion: listener => {
    const handler=(_event,value)=>listener(value);
    ipcRenderer.on('pet:drag-motion',handler);
    return ()=>ipcRenderer.removeListener('pet:drag-motion',handler);
  },
  setInteractive: (interactive) => ipcRenderer.send("pet:set-interactive", interactive === true),
  reportState: (value) => ipcRenderer.send("pet:debug-state", value),
  reportStatusReload: value=>ipcRenderer.send('pet:status-reloaded',value),
  requestState: () => ipcRenderer.invoke("pet:request-state"),
  requestPreferences: () => ipcRenderer.invoke('pet:request-preferences'),
  onPreferences: listener => {
    const handler=(_event,value)=>listener(value);
    ipcRenderer.on('pet:preferences',handler);
    return ()=>ipcRenderer.removeListener('pet:preferences',handler);
  },
  openContextMenu: () => ipcRenderer.send("pet:context-menu"),
  onState: (listener) => {
    const handler = (_event, value) => listener(value);
    ipcRenderer.on("pet:state", handler);
    return () => ipcRenderer.removeListener("pet:state", handler);
  }
});
