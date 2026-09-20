const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("whalePet", {
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
