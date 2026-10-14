'use strict';
const {contextBridge,ipcRenderer}=require('electron');

// Receive-only bridge: the non-interactive surface has no main-process calls
// and accepts motion solely from its owning controller.
contextBridge.exposeInMainWorld('whaleEdgeTravel',Object.freeze({
  onPullPoint(listener){
    if(typeof listener!=='function')return ()=>{};
    const receive=(_event,value)=>listener(value);
    ipcRenderer.on('edge-travel:pull-point',receive);
    return ()=>ipcRenderer.removeListener('edge-travel:pull-point',receive);
  }
}));
