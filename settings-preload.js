const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('petSettings',{
  get:()=>ipcRenderer.invoke('settings:get'),
  save:value=>ipcRenderer.invoke('settings:save',value),
  preview:state=>ipcRenderer.invoke('settings:preview',state),
  importImage:state=>ipcRenderer.invoke('settings:import',state),
  resetImage:state=>ipcRenderer.invoke('settings:reset-image',state),
  reset:()=>ipcRenderer.invoke('settings:reset'),
  copy:kind=>ipcRenderer.invoke('settings:copy',kind),
  onTab:fn=>ipcRenderer.on('settings:tab',(_event,value)=>fn(value))
});
