'use strict';
// Run with Electron. No network, no real account, no camera, no public session.
const {app,BrowserWindow}=require('electron');const fs=require('node:fs/promises');const path=require('node:path');
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
    for(const [width,height]of[[1440,940],[1000,720]]){
      win.setContentSize(width,height);
      win.webContents.send('studio:state',{version:require('../package.json').version,user:{id:1,username:'demonstracao'},studio:{session:null},prepared:false,transmitting:false,muted:false});
      await new Promise(r=>setTimeout(r,400));
      const layout=await win.webContents.executeJavaScript("({overflow:document.documentElement.scrollWidth>innerWidth,button:[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Iniciar live'))?.getBoundingClientRect().bottom,height:innerHeight})");
      if(layout.overflow||!layout.button||layout.button>layout.height)throw new Error('Layout unusable: '+JSON.stringify(layout));
      await fs.writeFile(path.join(output,`studio-${width}.png`),(await win.webContents.capturePage()).toPNG());
    }
    await fs.writeFile(path.join(output,'ui-smoke.json'),JSON.stringify({ipc:true,rendererIsolated:true,layouts:[1440,1000],network:false,capture:false},null,2));
    process.stdout.write('UI smoke passed: IPC, renderer isolation, login and studio layouts.\n');app.exit(0);
  }catch(e){process.stderr.write(e.message+'\n');app.exit(1);}
});
