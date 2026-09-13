'use strict';
// Real bundled renderer, fake IPC data only. No accounts, network, payments or capture.
const {app,BrowserWindow,ipcMain,protocol,net}=require('electron');
const fs=require('node:fs/promises');const path=require('node:path');const assert=require('node:assert/strict');const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),output=path.join(root,'test-results','layout');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const id='01234567-89ab-4cde-8fab-0123456789ab';
const user={id:101,username:'conta_sintetica',name:'Conta de demonstração'};
let state={version:'teste-local',pendingAccount:user,user:null,studio:null,prepared:false,busy:false};const calls=[];let prepareLocks=0,saveLocks=0;let equipment={cameras:[],microphones:[],desktops:[],windows:[],displays:[],games:[{id:'any_fullscreen',name:'Qualquer jogo em tela cheia'}]};
const last=command=>calls.filter(c=>c.command===command).at(-1);
protocol.registerSchemesAsPrivileged([{scheme:'privex',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
app.setPath('userData',path.join(output,'profile'));
app.whenReady().then(async()=>{let win;try{
 await fs.mkdir(output,{recursive:true});
 protocol.handle('privex',request=>net.fetch(pathToFileURL(path.join(root,'ui',new URL(request.url).pathname)).href));
 ipcMain.handle('studio:command',async(_event,command,payload)=>{
  calls.push({command,payload});if(command==='snapshot')return{ok:true,data:state};
  if(command==='enumerate')return{ok:true,data:equipment};
  if(command==='prepare'&&prepareLocks-->0)return{ok:false,status:423,error:'Synthetic heartbeat lock'};
  if(command==='layout.save'&&saveLocks-->0)return{ok:false,status:423,error:'Synthetic save lock'};
  if(command==='volume'){await delay(40);return{ok:false,error:'Synthetic audio rejection'};}
  if(command==='image.pick')return{ok:true,data:{file:'C:\\synthetic\\logo.png',name:'logo.png'}};
  if(command==='manager'){
   const route=payload.path;
   if(route.endsWith('/commerce')||route==='/lives/commerce-preset')return{ok:true,data:{permissions:{manage:true},catalog_version:1,items:[{id:3,kind:'action',title:'Ação de demonstração',amount_cents:500,active:true,delivery_seconds:300,outcomes:[]}],goal:{title:'Meta de teste',active:true,target_cents:10000,raised_cents:0}}};
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
 const click=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click()`);
 const clickText=(selector,text)=>js(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(b=>b.textContent.includes(${JSON.stringify(text)})).click()`);
 const setValue=(selector,value)=>js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 assert.equal(await js("!![...document.querySelectorAll('button')].find(b=>b.textContent.includes('Continuar como @conta_sintetica'))"),true);
 assert.equal(await js("!!document.querySelector('.workspace')"),false,'Remembered account must remain on confirmation screen');
 await clickText('button','Usar outra conta');await delay(50);assert.ok(calls.some(c=>c.command==='account.switch'));
 await clickText('button','Continuar como @conta_sintetica');await delay(50);assert.ok(calls.some(c=>c.command==='account.confirm'));
 await fs.writeFile(path.join(output,'account-confirmation.png'),(await win.webContents.capturePage()).toPNG());
 // Fresh installation: no saved layout, preview closed. Discovery suggests devices but never starts capture.
 state={version:'teste-local',user,pendingAccount:null,studio:{session:{id,status:'reserved',managed_by_device:true}},prepared:false,transmitting:false,busy:false,muted:false,layout:{version:1,scenes:[{id:'principal',name:'Principal',layers:[]}],activeScene:'principal',microphoneId:'',desktopId:'',portrait:false,fresh:true}};win.webContents.send('studio:state',state);await delay(300);
 assert.equal(await js("document.querySelectorAll('.layer-list li').length"),0);
 assert.equal(await js("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Abrir prévia')).disabled"),false,'An empty scene can explicitly show a black frame without adding a camera');
 equipment={...equipment,cameras:[{id:'synthetic-camera',name:'Synthetic camera'}],microphones:[{id:'default',name:'Windows default'}]};
 await click('[aria-label="Atualizar equipamentos"]');await delay(150);
 assert.equal(await js("document.querySelectorAll('.layer-list li').length"),1,'A first camera attached after empty discovery should be suggested as the only source');
 assert.ok(await js("document.querySelector('.layer-list .layer-name').textContent.includes('Synthetic camera')"));
 assert.equal(await js("document.querySelector('[aria-label=\"Microfone\"]').value"),'default');
 assert.equal(calls.filter(c=>c.command==='prepare').length,0,'Discovery cannot enable capture');
 await setValue('[aria-label="Microfone"]','');await click('[aria-label="Atualizar equipamentos"]');await delay(100);
 assert.equal(await js("document.querySelector('[aria-label=\"Microfone\"]').value"),'','Explicit no-microphone choice must survive rediscovery');
 await delay(700);const saved=last('layout.save');assert.ok(saved,'Scenes are persisted for this computer');assert.equal(saved.payload.scenes[0].layers[0].kind,'camera');assert.equal(saved.payload.microphoneId,'');
 await clickText('button','Abrir prévia');await delay(100);
 const opened=last('prepare');assert.ok(opened,'Opening the preview is the explicit capture consent');assert.equal(opened.payload.layers.length,1);assert.equal(opened.payload.layers[0].id,'synthetic-camera');assert.equal(opened.payload.layers[0].fit,'fit');assert.equal(opened.payload.microphoneId,'');
 // Preview open: all composition edits share one serialized latest-wins queue.
 state={...state,prepared:true};win.webContents.send('studio:state',state);await delay(250);
 win.webContents.send('studio:audio-levels',{microphone:{configured:true,receiving:true,muted:false,state:'receiving',inputDb:0,outputDb:-12,inputClipping:true,outputClipping:false},desktop:{configured:true,receiving:false,state:'unavailable'}});await delay(80);
 assert.equal(await js("document.querySelector('[aria-label=\"Microfone · Entrada\"]').getAttribute('aria-valuenow')"),'0');
 assert.equal(await js("document.querySelector('[aria-label=\"Microfone · Saída\"]').getAttribute('aria-valuenow')"),'-12');
 assert.ok(await js("document.querySelector('.meter-clip').textContent.includes('Entrada no limite')"));
 assert.ok(await js("document.querySelector('[aria-label=\"Medidor de Computador\"]').textContent.includes('Sem dados')"));
 win.webContents.send('studio:audio-levels',{microphone:{configured:true,receiving:true,muted:true,state:'receiving',inputDb:-6,outputDb:-3,inputClipping:false,outputClipping:true}});await delay(80);
 assert.equal(await js("document.querySelector('[aria-label=\"Microfone · Saída\"]').getAttribute('aria-valuenow')"),'-60');
 assert.equal(await js("document.querySelectorAll('.meter-clip').length"),0);
 const prepares=calls.filter(c=>c.command==='prepare').length;
 await click('[aria-label="Adicionar fonte"]');await delay(50);await clickText('.add-panel button','Texto');await delay(600);
 assert.equal(await js("document.querySelectorAll('.layer-list li').length"),2);
 assert.equal(calls.filter(c=>c.command==='prepare').length,prepares+1,'Adding a source while the preview is open applies the scene automatically');
 const applied=last('prepare').payload;assert.equal(applied.layers[0].kind,'text');assert.equal(applied.layers[0].fit,'corner');assert.equal(applied.layers[1].kind,'camera');
 assert.equal(await js("!!document.querySelector('.layer-dialog [aria-label=\"Posição da fonte\"]')"),true,'The new source opens its settings sheet');
 await delay(150);assert.ok(last('bounds').payload.width>0,'The settings sheet sits below the preview and must not hide it');
 await click('[aria-label="Canto superior direito"]');await delay(600);assert.equal(last('prepare').payload.layers[0].corner,'tr');
 await click('[aria-label="Fechar ajustes"]');await delay(100);assert.equal(await js("!!document.querySelector('.layer-dialog')"),false);
 await click('.layer-list li:nth-child(2) .layer-main');await delay(100);assert.ok(await js("document.querySelector('.layer-dialog h3').textContent.includes('Synthetic camera')"),'Clicking a source opens its sheet');
 await js("document.querySelector('.layer-dialog').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");await delay(100);assert.equal(await js("!!document.querySelector('.layer-dialog')"),false,'Escape closes the sheet');
 await click('.layer-list li:nth-child(2) [aria-label="Ocultar fonte"]');await delay(600);
 assert.equal(last('prepare').payload.layers[1].visible,false,'Visibility follows the same serialized composition, never an index from a stale scene');
 assert.equal(calls.filter(c=>c.command==='prepare').length,prepares+3);
 await click('[aria-label="Adicionar fonte"]');await delay(50);await clickText('.add-panel button','Imagem');await delay(600);await click('[aria-label="Fechar ajustes"]');await delay(50);
 assert.ok(calls.some(c=>c.command==='image.pick'),'Images come from the native picker only');assert.equal(last('prepare').payload.layers[0].file,'C:\\synthetic\\logo.png');
 assert.equal(await js("!![...document.querySelectorAll('button')].find(b=>b.textContent.includes('Fechar prévia'))"),false,'The preview cannot be closed while a session is reserved or live');
 state={...state,studio:{session:null}};win.webContents.send('studio:state',state);await delay(150);
 await clickText('button','Fechar prévia');await delay(100);assert.ok(calls.some(c=>c.command==='preview.close'),'Closing the preview is explicit');
 state={...state,prepared:false};win.webContents.send('studio:state',state);await delay(100);
 const beforePreset=calls.length;
 await js("[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent.includes('Interações')).click()");await delay(400);
 assert.ok(await js("document.querySelector('.manager-content').textContent.includes('Prepare suas interações')"));
 assert.equal(await js("!!document.querySelector('.revenue-panel')"),false,'Prelive must not render revenue from another session');
 await clickText('.manager-content button','Salvar interações');await delay(200);
 const presetCalls=calls.slice(beforePreset);assert.ok(presetCalls.some(c=>c.command==='manager'&&c.payload.method==='GET'&&c.payload.path==='/lives/commerce-preset'));assert.ok(presetCalls.some(c=>c.command==='manager'&&c.payload.method==='PUT'&&c.payload.path==='/lives/commerce-preset'));
 assert.equal(presetCalls.some(c=>c.command==='start'||c.command==='manager'&&/orders|accounting/.test(c.payload.path)),false,'Prelive saves do not reserve a session or query orders/accounting');
 await clickText('button','Abrir prévia');await delay(100);state={...state,prepared:true};win.webContents.send('studio:state',state);await delay(100);
 state={...state,studio:{session:{id,status:'reserved',managed_by_device:true}}};win.webContents.send('studio:state',state);await delay(150);
 await click('[aria-label="Nova cena"]');await delay(100);assert.equal(await js("document.querySelectorAll('.scene-list li').length"),2);
 await delay(600);assert.equal(last('layout.save').payload.scenes.length,2);assert.equal(last('layout.save').payload.scenes[1].layers.length,0,'A new scene starts empty: two scenes never share what the other shows');
 assert.ok(last('prepare').payload.sceneId,'The scene identity reaches the engine so it can animate the change');
 assert.deepEqual(last('prepare').payload.transition,{style:'slide',durationMs:350},'The scene change carries the chosen animation');
 await clickText('.scene-button','Principal');await delay(300);await click('[aria-label="Editar cena"]');await delay(150);
 assert.equal(await js("!!document.querySelector('[aria-label=\"Ajustes da cena\"]')"),true,'The pencil opens the scene settings, where the animation lives');
 assert.equal(await js("document.querySelectorAll('.scene-transition').length"),0,'The scene dock no longer spends height on the animation controls');
 await clickText('[aria-label="Ajustes da cena"] button','Duplicar');await delay(700);
 const copied=last('layout.save').payload;assert.equal(copied.scenes.length,3);assert.equal(copied.scenes[2].layers.length,3,'Duplicating copies the sources of that scene, on purpose');
 await click('[aria-label="Editar cena"]');await delay(150);
 await setValue('[aria-label="Transição entre cenas"]','fade');await delay(600);
 assert.equal(last('prepare').payload.transition.style,'fade','Choosing another animation is applied to the engine');
 await setValue('[aria-label="Transição entre cenas"]','slide');await delay(600);
 await clickText('[aria-label="Ajustes da cena"] button','Concluir');await delay(150);
 assert.equal(await js("!!document.querySelector('[aria-label=\"Ajustes da cena\"]')"),false);
 // A game is captured through the window source; the separate game source is no longer offered.
 await click('[aria-label="Adicionar fonte"]');await delay(120);
 const offered=await js("[...document.querySelectorAll('.add-panel button')].map(b=>b.textContent.trim())");
 assert.deepEqual(offered,['Câmera','Janela / Jogo','Tela inteira','Imagem','Texto'],'One source covers window and game');
 assert.equal(await js("document.querySelector('.dock-sources .dock-hint').textContent.includes('modo janela')"),true,'Adding a source explains how a game must run');
 await click('[aria-label="Adicionar fonte"]');await delay(120);
 await clickText('.scene-button','Principal');await delay(600);assert.equal(await js("document.querySelector('.scene-list li.is-active').textContent.includes('Principal')"),true);
 await js("[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent.includes('Interações')).click()");await delay(400);
 const layouts=[];
 for(const [width,height,zoom]of[[1000,720,1],[1280,800,1],[1440,940,1.25],[1920,1080,1.5]]){
  win.setContentSize(width,height);win.webContents.setZoomFactor(zoom);await delay(250);
  const layout=await js(`(()=>{const manager=document.querySelector('.manager-content'),boxes=[...manager.querySelectorAll('input[type=checkbox]')].map(e=>{const r=e.getBoundingClientRect();return{width:r.width,height:r.height}}),fields=[...manager.querySelectorAll('input:not([type=checkbox])')].map(e=>e.getBoundingClientRect().width),bar=document.querySelector('.controlbar').getBoundingClientRect(),production=document.querySelector('.production'),preview=document.querySelector('.preview').getBoundingClientRect();return{overflow:document.documentElement.scrollWidth>innerWidth,managerOverflow:manager.scrollWidth>manager.clientWidth+1,productionScrolls:production.scrollHeight>production.clientHeight+1,boxes,fields,footerVisible:bar.bottom<=innerHeight+1,preview:preview.toJSON(),ratio:preview.width/preview.height,docksVisible:document.querySelector('.docks').getBoundingClientRect().bottom<=bar.top+1,
   insideShell:(()=>{const shell=document.querySelector('.preview-shell').getBoundingClientRect();return preview.top>=shell.top-.5&&preview.bottom<=shell.bottom+.5&&preview.left>=shell.left-.5&&preview.right<=shell.right+.5})(),
   aboveCaption:preview.bottom<=document.querySelector('.preview-caption').getBoundingClientRect().top+.5,
   belowTopbar:preview.top>=document.querySelector('.topbar').getBoundingClientRect().bottom-.5}})()`);
  assert.equal(layout.overflow,false);assert.equal(layout.managerOverflow,false);assert.equal(layout.footerVisible,true);assert.equal(layout.productionScrolls,false,'Preview, docks and controls fit without scrolling at '+width+'x'+height);assert.equal(layout.docksVisible,true);assert.ok(Math.abs(layout.ratio-16/9)<.02,'Landscape preview keeps the 16:9 canvas ratio');assert.ok(layout.preview.height>=150);
  // The native child window is placed exactly on this box, so the box itself must stay contained.
  assert.equal(layout.insideShell,true,'The preview box stays inside its frame at '+width+'x'+height+' zoom '+zoom);
  assert.equal(layout.aboveCaption,true,'The preview box never covers the caption at '+width+'x'+height+' zoom '+zoom);
  assert.equal(layout.belowTopbar,true,'The preview box never reaches the top bar at '+width+'x'+height+' zoom '+zoom);
  assert.ok(last('bounds').payload.ratio>=.5,'The page reports the pixel ratio its layout used');
  assert.ok(layout.boxes.length>=2);assert.ok(layout.boxes.every(b=>b.width>=14&&b.width<=18&&b.height>=14&&b.height<=18));assert.ok(layout.fields.every(w=>w>=150),'Manager fields must not compress into narrow columns');
  await click('.layer-list li:first-child .layer-main');await delay(150);
  const editor=await js("(()=>{const p=document.querySelector('.preview').getBoundingClientRect(),d=document.querySelector('.layer-dialog').getBoundingClientRect(),b=document.querySelector('.sheet-backdrop').getBoundingClientRect(),dock=document.querySelector('.docks').getBoundingClientRect();return {previewBottom:p.bottom,dialogTop:d.top,dialogBottom:d.bottom,dockTop:dock.top,dockBottom:dock.bottom,backdropTop:b.top}})()");
  assert.ok(editor.dialogTop>=editor.previewBottom,'Editor never covers the preview at '+width+'x'+height+' zoom '+zoom);
  assert.ok(editor.dialogBottom<=editor.dockBottom+13,'Editor stays within the production column');assert.ok(last('bounds').payload.width>0,'Native preview remains visible while editing');
  assert.ok(last('bounds').payload.width>0&&last('bounds').payload.viewport===undefined,'Bounds are CSS pixels; the main process converts them once');
  layouts.push({width,height,zoom,...layout,editor});await fs.writeFile(path.join(output,`studio-${width}-zoom-${zoom}.png`),(await win.webContents.capturePage()).toPNG());
  await click('[aria-label="Fechar ajustes"]');await delay(100);
 }
 win.setContentSize(1440,940);win.webContents.setZoomFactor(1);await delay(150);
 await setValue('[aria-label="Formato"]','portrait');await delay(150);
 const ratio=await js("(()=>{const r=document.querySelector('.preview').getBoundingClientRect();return r.width/r.height})()");assert.ok(Math.abs(ratio-9/16)<.01,'Portrait preview must actually use a 9:16 rectangle');
 await setValue('[aria-label="Formato"]','landscape');await delay(150);
 assert.ok(last('bounds').payload.width>0);
 await js("(()=>{const nested=document.createElement('div');nested.id='synthetic-dialog';nested.setAttribute('role','dialog');nested.style.cssText='position:fixed;inset:30%;background:black';document.querySelector('.manager-content').appendChild(nested)})()");await delay(100);
 assert.equal(last('bounds').payload.width,0,'Nested dialog must hide preview');
 await js("document.querySelector('#synthetic-dialog').remove()");await delay(150);assert.ok(last('bounds').payload.width>0);
 // Below the supported minimum the production column scrolls; a clipped preview must hide instead of drawing over the docks.
 win.setContentSize(1000,430);await delay(150);
 await js("document.querySelector('.production').scrollTop=1000");await delay(250);assert.equal(last('bounds').payload.width,0,'Clipped preview must hide on scroll '+JSON.stringify(await js("(()=>{const p=document.querySelector('.production');return{scroll:p.scrollTop,scrollHeight:p.scrollHeight,height:p.clientHeight,preview:document.querySelector('.preview').getBoundingClientRect().toJSON()}})()")));
 await js("document.querySelector('.production').scrollTop=0");await delay(150);assert.ok(last('bounds').payload.width>0);
 win.setContentSize(1440,940);await delay(150);
 // Remove every video source rapidly: the final request must be empty, and discovery cannot resurrect the camera.
 saveLocks=1;
 while(await js("document.querySelectorAll('.layer-list li').length")){await click('.layer-list li:last-child [aria-label="Remover fonte"]');await delay(20);}
 await delay(1600);assert.deepEqual(last('prepare').payload.layers,[],'Last source removal reaches the engine as an empty scene');
 assert.deepEqual(last('layout.save').payload.scenes.find(scene=>scene.id===last('layout.save').payload.activeScene).layers,[],'Last removal persists after a temporary save lock');
 await click('[aria-label="Atualizar equipamentos"]');await delay(400);assert.equal(await js("document.querySelectorAll('.layer-list li').length"),0,'Explicit deletion survives rediscovery');
 prepareLocks=1;const beforeRetry=calls.filter(c=>c.command==='prepare').length;
 await click('[aria-label="Adicionar fonte"]');await delay(50);await clickText('.add-panel button','Texto');await delay(1600);
 assert.equal(calls.filter(c=>c.command==='prepare').length,beforeRetry+2,'A temporary heartbeat lock retries once and applies the pending source');assert.equal(last('prepare').payload.layers[0].kind,'text');
 await click('[aria-label="Fechar ajustes"]');await delay(50);
 state={...state,studio:{session:{id,status:'live',managed_by_device:true,title:'Título original',interaction_seq:4}}};win.webContents.send('studio:state',state);await delay(250);
 assert.equal(await js("document.querySelector('[aria-label=\"Título da live\"]').value"),'Título original','the live title fills the field');
 assert.equal(await js("document.querySelector('[aria-label=\"Título da live\"]').disabled"),false,'the title stays editable during a live');
 assert.equal(await js("!![...document.querySelectorAll('button')].find(b=>b.textContent.includes('Salvar título'))"),false,'no save action until something changes');
 await js("(()=>{const input=document.querySelector('[aria-label=\"Título da live\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Título corrigido');input.dispatchEvent(new Event('input',{bubbles:true}));})()");await delay(150);
 await clickText('button','Salvar título');await delay(150);
 assert.equal(last('title').payload.title,'Título corrigido','saving sends the new title');
 assert.ok(await js("!!document.querySelector('[aria-label=\"Aviso de interação\"], .dock-audio input[type=checkbox]')"),'the interaction alert can be switched off');
 state={...state,updateInfo:{available:true,latestVersion:'futura',status:'available',progress:0}};win.webContents.send('studio:state',state);await delay(100);assert.equal(await js("[...document.querySelectorAll('button')].find(b=>b.textContent==='Atualizar app').disabled"),true);
 state={...state,studio:{session:{id,status:'live',managed_by_device:false}}};win.webContents.send('studio:state',state);await delay(100);assert.equal(await js("[...document.querySelectorAll('button')].find(b=>b.textContent==='Atualizar app').disabled"),true,'A live from another device also blocks installation');
 state={...state,studio:{session:null},prepared:false};win.webContents.send('studio:state',state);await delay(100);await js("[...document.querySelectorAll('button')].find(b=>b.textContent==='Atualizar app').click()");await delay(50);assert.ok(calls.some(c=>c.command==='updates.install'));
 await js("(()=>{const slider=document.querySelector('[aria-label=\"Volume do microfone\"]');slider.disabled=false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(slider,'35');slider.dispatchEvent(new Event('input',{bubbles:true}));slider.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowLeft',bubbles:true}));slider.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowLeft',bubbles:true}));})()");await delay(150);
 assert.equal(calls.filter(c=>c.command==='volume').length,1,'Duplicate commit must not overlap audio IPC');
 assert.equal(await js("document.querySelector('[aria-label=\"Volume do microfone\"]').value"),'100','Rejected volume must restore authoritative value even without a changed snapshot');
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,layouts,rememberedAccountConfirmation:true,scenesAndSources:true,automaticApply:true,serializedVisibility:true,emptySceneRemoval:true,noCameraResurrection:true,transientRetry:true,imagePicker:true,layoutPersistence:true,updateInstallAction:true,activeUpdateBlocked:true,modalHidesPreview:true,scrollHidesPreview:true,network:false,physicalCapture:false},null,2));
 console.log(JSON.stringify({passed:true,layouts:layouts.map(x=>[x.width,x.height,x.zoom,Math.round(x.preview.width)+'x'+Math.round(x.preview.height)]),checkboxesNormal:true,managerInputsReadable:true,previewModalAndScroll:true,accountConfirmation:true,updateAction:true,scenes:true}));win.destroy();app.exit(0);
}catch(error){console.error(error.stack);win?.destroy();app.exit(1)}});
