'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('privex',Object.freeze({
  invoke:async(command,payload)=>ipcRenderer.invoke('studio:command',command,payload),
  onState:callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('studio:state',listener);return()=>ipcRenderer.removeListener('studio:state',listener);},
}));
