'use strict';
// Run with Electron. No network, no real account, no camera, no public session.
const {app,BrowserWindow,ipcMain}=require('electron');const fs=require('node:fs/promises');const path=require('node:path');
const output=path.resolve(__dirname,'../test-results');
global.fetch=async()=>{throw new Error('Network disabled for isolated UI smoke');};
app.getVersion=()=> require('../package.json').version;
const realGetPath=app.getPath.bind(app);app.getPath=name=>name==='appData'?path.join(output,'profile'):realGetPath(name);
require('../main/main.cjs');
app.whenReady().then(async()=>{
  try{
    await fs.mkdir(output,{recursive:true});
    let win;for(let i=0;i<50;i++){win=BrowserWindow.getAllWindows()[0];if(win&&!win.webContents.isLoading()&&win.webContents.getURL().startsWith('privex:'))break;await new Promise(r=>setTimeout(r,100));}
    await new Promise(r=>setTimeout(r,1500));
    const state=await win.webContents.executeJavaScript("window.privex.invoke('snapshot')");if(!state.ok)throw new Error('IPC blocked: '+state.error);
    const node=await win.webContents.executeJavaScript("typeof require + ':' + typeof process");if(node!=='undefined:undefined')throw new Error('Node exposed to renderer');
    await fs.writeFile(path.join(output,'welcome.png'),(await win.webContents.capturePage()).toPNG());
    // The real main process keeps broadcasting its own (signed-out) state and answers renderer commands; from here the
    // studio layout is measured against a synthetic signed-in snapshot, so its IPC replies and state pushes are replaced.
    const fake={version:require('../package.json').version,user:{id:1,username:'demonstracao'},studio:{session:null},prepared:false,transmitting:false,muted:false,layout:{version:1,scenes:[{id:'principal',name:'Principal',layers:[{kind:'camera',id:'synthetic-camera',fit:'fit',corner:'br',size:.3,visible:true,name:''}]}],activeScene:'principal',microphoneId:'',desktopId:'',portrait:false}};
    ipcMain.removeHandler('studio:command');ipcMain.handle('studio:command',async(_event,command)=>({ok:true,data:command==='snapshot'?fake:command==='enumerate'?{cameras:[{id:'synthetic-camera',name:'Synthetic camera'}],microphones:[],desktops:[],windows:[],displays:[]}:{}}));
    const send=win.webContents.send.bind(win.webContents);win.webContents.send=(channel,...args)=>channel==='studio:state'&&args[0]!==fake?undefined:send(channel,...args);
    for(const [width,height]of[[1440,940],[1000,720]]){
      win.setContentSize(width,height);
      win.webContents.send('studio:state',fake);
      await new Promise(r=>setTimeout(r,400));
      const layout=await win.webContents.executeJavaScript("({overflow:document.documentElement.scrollWidth>innerWidth,button:[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Iniciar live'))?.getBoundingClientRect().bottom,height:innerHeight})");
      if(layout.overflow||!layout.button||layout.button>layout.height)throw new Error('Layout unusable: '+JSON.stringify(layout));
      await fs.writeFile(path.join(output,`studio-${width}.png`),(await win.webContents.capturePage()).toPNG());
    }
    await fs.writeFile(path.join(output,'ui-smoke.json'),JSON.stringify({ipc:true,rendererIsolated:true,layouts:[1440,1000],network:false,capture:false},null,2));
    process.stdout.write('UI smoke passed: IPC, renderer isolation, login and studio layouts.\n');app.exit(0);
  }catch(e){process.stderr.write(e.message+'\n');app.exit(1);}
});
