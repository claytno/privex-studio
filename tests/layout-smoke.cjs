'use strict';
// Real bundled renderer, fake IPC data only. No accounts, network, payments or capture.
const {app,BrowserWindow,ipcMain,protocol,net}=require('electron');
const fs=require('node:fs/promises');const path=require('node:path');const assert=require('node:assert/strict');const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),output=path.join(root,'test-results','layout');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const id='01234567-89ab-4cde-8fab-0123456789ab';
const user={id:101,username:'conta_sintetica',name:'Conta de demonstração'};
let state={version:'teste-local',pendingAccount:user,user:null,studio:null,prepared:false,busy:false};const calls=[];let equipment={cameras:[],microphones:[],desktops:[],windows:[],displays:[]};
protocol.registerSchemesAsPrivileged([{scheme:'privex',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
app.setPath('userData',path.join(output,'profile'));
app.whenReady().then(async()=>{let win;try{
 await fs.mkdir(output,{recursive:true});
 protocol.handle('privex',request=>net.fetch(pathToFileURL(path.join(root,'ui',new URL(request.url).pathname)).href));
 ipcMain.handle('studio:command',async(_event,command,payload)=>{
  calls.push({command,payload});if(command==='snapshot')return{ok:true,data:state};
  if(command==='enumerate')return{ok:true,data:equipment};
  if(command==='volume'){await delay(40);return{ok:false,error:'Synthetic audio rejection'};}
  if(command==='manager'){
   const route=payload.path;
   if(route.endsWith('/commerce'))return{ok:true,data:{permissions:{manage:true},catalog_version:1,items:[{id:3,kind:'action',title:'Ação de demonstração',amount_cents:500,active:true,delivery_seconds:300,outcomes:[]}],goal:{title:'Meta de teste',active:true,target_cents:10000,raised_cents:0}}};
   if(route.includes('/accounting'))return{ok:true,data:{received:{net_cents:500,gross_cents:500,refunded_cents:0}}};
   if(route.includes('/orders'))return{ok:true,data:{data:[{id:17,live_session_id:id,title:'Presente de teste',kind:'gift',status:'completed',amount_cents:500,allowed_actions:['refund'],created_at:'2026-09-13T00:00:00Z'}],last_page:1}};
   return{ok:true,data:{messages:[],enabled:true,can_send:true,moderation:{can_moderate:true},rules:'',data:[]}};
  }
  return{ok:true,data:{}};
 });
 win=new BrowserWindow({width:1440,height:940,show:false,webPreferences:{preload:path.join(root,'main','preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});win.setMenu(null);
 win.webContents.on('console-message',(_event,level,message)=>{if(level>=2)console.error('Renderer:',message)});
 win.webContents.session.webRequest.onBeforeRequest({urls:['https://*/*','http://*/*']},(_details,callback)=>callback({cancel:true}));
 await win.loadURL('privex://studio/index.html');win.showInactive();await delay(300);
 const js=code=>win.webContents.executeJavaScript(code);
 assert.equal(await js("!![...document.querySelectorAll('button')].find(b=>b.textContent.includes('Continuar como @conta_sintetica'))"),true);
 assert.equal(await js("!!document.querySelector('.workspace')"),false,'Remembered account must remain on confirmation screen');
 await js("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Usar outra conta')).click()");await delay(50);assert.ok(calls.some(c=>c.command==='account.switch'));
 await js("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Continuar como @conta_sintetica')).click()");await delay(50);assert.ok(calls.some(c=>c.command==='account.confirm'));
 await fs.writeFile(path.join(output,'account-confirmation.png'),(await win.webContents.capturePage()).toPNG());
 state={version:'teste-local',user,pendingAccount:null,studio:{session:{id,status:'reserved',managed_by_device:true}},prepared:true,transmitting:false,busy:false,muted:false};win.webContents.send('studio:state',state);await delay(250);
 win.webContents.send('studio:audio-levels',{microphone:{configured:true,receiving:true,muted:false,state:'receiving',inputDb:0,outputDb:-12,inputClipping:true,outputClipping:false},desktop:{configured:true,receiving:false,state:'unavailable'}});await delay(80);
 assert.equal(await js("document.querySelector('[aria-label=\"Microfone · Entrada\"]').getAttribute('aria-valuenow')"),'0');
 assert.equal(await js("document.querySelector('[aria-label=\"Microfone · Saída\"]').getAttribute('aria-valuenow')"),'-12');
 assert.ok(await js("document.querySelector('.meter-clip').textContent.includes('Entrada no limite')"));
 assert.ok(await js("document.querySelector('[aria-label=\"Medidor de Computador\"]').textContent.includes('Sem dados')"));
 win.webContents.send('studio:audio-levels',{microphone:{configured:true,receiving:true,muted:true,state:'receiving',inputDb:-6,outputDb:-3,inputClipping:false,outputClipping:true}});await delay(80);
 assert.equal(await js("document.querySelector('[aria-label=\"Microfone · Saída\"]').getAttribute('aria-valuenow')"),'-60');
 assert.equal(await js("document.querySelectorAll('.meter-clip').length"),0);
 equipment={...equipment,cameras:[{id:'synthetic-camera',name:'Synthetic camera'}],microphones:[{id:'default',name:'Windows default'}]};
 await js("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Atualizar lista')).click()");await delay(100);
 assert.equal(await js("document.querySelectorAll('.settings-grid select')[1].value"),'synthetic-camera','A first camera attached after empty discovery should be suggested');
 assert.equal(await js("document.querySelectorAll('.settings-grid select')[2].value"),'default');
 assert.equal(calls.filter(c=>c.command==='prepare').length,0,'Discovery cannot enable capture');
 await js("(()=>{const mic=document.querySelectorAll('.settings-grid select')[2];mic.value='';mic.dispatchEvent(new Event('change',{bubbles:true}));})()");
 await js("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Atualizar lista')).click()");await delay(100);
 assert.equal(await js("document.querySelectorAll('.settings-grid select')[2].value"),'','Explicit no-microphone choice must survive rediscovery');
 await js("(()=>{const slider=document.querySelector('[aria-label=\"Volume do microfone\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(slider,'35');slider.dispatchEvent(new Event('input',{bubbles:true}));slider.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowLeft',bubbles:true}));slider.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowLeft',bubbles:true}));})()");await delay(150);
 assert.equal(calls.filter(c=>c.command==='volume').length,1,'Duplicate commit must not overlap audio IPC');
 assert.equal(await js("document.querySelector('[aria-label=\"Volume do microfone\"]').value"),'100','Rejected volume must restore authoritative value even without a changed snapshot');
 await js("[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent.includes('Interações')).click()");await delay(400);
 const layouts=[];
 for(const [width,height,zoom]of[[1000,720,1],[1280,800,1],[1440,940,1.25],[1920,1080,1.5]]){
  win.setContentSize(width,height);win.webContents.setZoomFactor(zoom);await delay(250);
  const layout=await js(`(()=>{const manager=document.querySelector('.manager-content'),boxes=[...manager.querySelectorAll('input[type=checkbox]')].map(e=>{const r=e.getBoundingClientRect();return{width:r.width,height:r.height}}),fields=[...manager.querySelectorAll('input:not([type=checkbox])')].map(e=>e.getBoundingClientRect().width),bar=document.querySelector('.controlbar').getBoundingClientRect();return{overflow:document.documentElement.scrollWidth>innerWidth,managerOverflow:manager.scrollWidth>manager.clientWidth+1,boxes,fields,footerVisible:bar.bottom<=innerHeight+1,preview:document.querySelector('.preview').getBoundingClientRect().toJSON()}})()`);
  assert.equal(layout.overflow,false);assert.equal(layout.managerOverflow,false);assert.equal(layout.footerVisible,true);assert.ok(layout.boxes.length>=2);assert.ok(layout.boxes.every(b=>b.width>=14&&b.width<=18&&b.height>=14&&b.height<=18));assert.ok(layout.fields.every(w=>w>=150),'Manager fields must not compress into narrow columns');
  layouts.push({width,height,zoom,...layout});await fs.writeFile(path.join(output,`studio-${width}-zoom-${zoom}.png`),(await win.webContents.capturePage()).toPNG());
 }
 win.setContentSize(1440,940);win.webContents.setZoomFactor(1);await delay(150);
 await js("(()=>{const select=[...document.querySelectorAll('.settings-grid select')].find(e=>[...e.options].some(o=>o.value==='portrait'));select.value='portrait';select.dispatchEvent(new Event('change',{bubbles:true}))})()");await delay(150);
 const ratio=await js("(()=>{const r=document.querySelector('.preview').getBoundingClientRect();return r.width/r.height})()");assert.ok(Math.abs(ratio-9/16)<.01,'Portrait preview must actually use a 9:16 rectangle');
 await js("(()=>{const select=[...document.querySelectorAll('.settings-grid select')].find(e=>[...e.options].some(o=>o.value==='portrait'));select.value='landscape';select.dispatchEvent(new Event('change',{bubbles:true}))})()");await delay(150);
 assert.ok(calls.filter(c=>c.command==='bounds').at(-1).payload.width>0);
 await js("(()=>{const nested=document.createElement('div');nested.id='synthetic-dialog';nested.setAttribute('role','dialog');nested.style.cssText='position:fixed;inset:30%;background:black';document.querySelector('.manager-content').appendChild(nested)})()");await delay(100);
 assert.equal(calls.filter(c=>c.command==='bounds').at(-1).payload.width,0,'Nested dialog must hide preview');
 await js("document.querySelector('#synthetic-dialog').remove()");await delay(150);assert.ok(calls.filter(c=>c.command==='bounds').at(-1).payload.width>0);
 win.setContentSize(1000,720);await delay(150);
 await js("document.querySelector('.production').scrollTop=1000");await delay(250);assert.equal(calls.filter(c=>c.command==='bounds').at(-1).payload.width,0,'Clipped preview must hide on scroll '+JSON.stringify(await js("(()=>{const p=document.querySelector('.production');return{scroll:p.scrollTop,scrollHeight:p.scrollHeight,height:p.clientHeight,preview:document.querySelector('.preview').getBoundingClientRect().toJSON()}})()")));
 await js("document.querySelector('.production').scrollTop=0");await delay(150);assert.ok(calls.filter(c=>c.command==='bounds').at(-1).payload.width>0);
 state={...state,updateInfo:{available:true,latestVersion:'futura',status:'available',progress:0}};win.webContents.send('studio:state',state);await delay(100);assert.equal(await js("[...document.querySelectorAll('button')].find(b=>b.textContent==='Atualizar app').disabled"),true);
 state={...state,studio:{session:{id,status:'live',managed_by_device:false}}};win.webContents.send('studio:state',state);await delay(100);assert.equal(await js("[...document.querySelectorAll('button')].find(b=>b.textContent==='Atualizar app').disabled"),true,'A live from another device also blocks installation');
 state={...state,studio:{session:null},prepared:false};win.webContents.send('studio:state',state);await delay(100);await js("[...document.querySelectorAll('button')].find(b=>b.textContent==='Atualizar app').click()");await delay(50);assert.ok(calls.some(c=>c.command==='updates.install'));
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,layouts,rememberedAccountConfirmation:true,updateInstallAction:true,activeUpdateBlocked:true,modalHidesPreview:true,scrollHidesPreview:true,network:false,physicalCapture:false},null,2));
 console.log(JSON.stringify({passed:true,layouts:layouts.map(x=>[x.width,x.height,x.zoom]),checkboxesNormal:true,managerInputsReadable:true,previewModalAndScroll:true,accountConfirmation:true,updateAction:true}));win.destroy();app.exit(0);
}catch(error){console.error(error.stack);win?.destroy();app.exit(1)}});
