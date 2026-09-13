'use strict';
const {app,BrowserWindow,ipcMain,shell,safeStorage,dialog,Menu,protocol,net,powerMonitor}=require('electron');
const fs=require('node:fs/promises');const path=require('node:path');const {pathToFileURL}=require('node:url');const crypto=require('node:crypto');
const {Engine}=require('./engine.cjs');const {ORIGIN,managerRoute,verificationURL,prepareInput,audioInput,previewInput,IMAGE_EXTENSIONS}=require('./security.cjs');
const {defaultLayout,layoutInput,loadLayout,saveLayout,imageUsable}=require('./studio-layout.cjs');
const {checkForUpdates}=require('./updates.cjs');
const {normalizeAudioMeters}=require('./audio-meter.cjs');
const {loadUpdatePreferences,saveUpdatePreferences}=require('./update-preferences.cjs');
const {downloadInstaller,verifyInstaller,clearInstalledDownloads}=require('./installer-update.cjs');
const {spawn}=require('node:child_process');
protocol.registerSchemesAsPrivileged([{scheme:'privex',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
app.enableSandbox();
app.setPath('userData',path.join(app.getPath('appData'),app.getVersion().includes('-')?'Privex Studio Beta':'Privex Studio'));
if(!app.requestSingleInstanceLock()){app.quit();}else{app.on('second-instance',()=>{win?.restore();win?.focus();});app.whenReady().then(boot);}
let win,engine,token='',authorization=null,user=null,studio=null,prepared=false,transmitting=false,busy=false,quitting=false,epoch=0,intent=null,heartbeatBusy=false,lastControl=0,retryAt=0;
let notice='',failure='',uiAlive=Date.now(),credentialsFile,mediaConfig=null,muted=false,sceneMode='live',overlayEnabled=false,goal=null,mediaStatus=null,updateInfo=null,endRequested=false,pendingAccount=null,updateChecking=false,updateController=null,previewRevision=0;
let automaticUpdateChecks=true,updatePreferencesFile;
let microphoneVolume=100,desktopVolume=100,audioMeters=normalizeAudioMeters();
// Scenes/sources saved for this computer; image paths are accepted only after the native picker or the loader verified them.
let layout=defaultLayout(),layoutFile,allowedImages=new Set();
const active=()=>studio?.session?.managed_by_device&&['waiting','reserved','starting','live','reconnecting','ending'].includes(studio.session.status);
const snapshot=()=>({version:app.getVersion(),user,pendingAccount,studio,prepared,transmitting,canvasPortrait:!!mediaConfig&&mediaConfig.height>mediaConfig.width,microphoneVolume,desktopVolume,audioMeters,layout,muted:sceneMode==='pause'||muted,sceneMode,overlayEnabled,mediaStatus,automaticUpdateChecks,updateInfo:updateInfo?{available:updateInfo.available,latestVersion:updateInfo.latestVersion,status:updateInfo.status,progress:updateInfo.progress}:null,busy,notice,error:failure,authorization:authorization?{code:authorization.user_code,expiresAt:authorization.expiresAt}:null});
function emit(){if(win&&!win.isDestroyed())win.webContents.send('studio:state',snapshot());}
async function api(method,route,body,authenticated=true){
  if(authenticated&&!token)throw new Error('Entre com sua conta.');
  const response=await fetch(`${ORIGIN}/api${route}`,{method,redirect:'error',credentials:'omit',headers:{Accept:'application/json','Content-Type':'application/json',...(authenticated?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const raw=await response.text();if(raw.length>2000000)throw new Error('Resposta inválida do servidor.');
  let data;try{data=JSON.parse(raw);}catch{throw new Error('Servidor temporariamente indisponível.');}
  if(!response.ok){const e=new Error(data.message||'Não foi possível concluir a operação.');e.status=response.status;e.code=data.error;throw e;}return data;
}
async function persist(){if(!safeStorage.isEncryptionAvailable()){notice='Login válido nesta execução. O armazenamento protegido está indisponível.';return;}await fs.mkdir(path.dirname(credentialsFile),{recursive:true});const temp=credentialsFile+'.tmp';await fs.writeFile(temp,safeStorage.encryptString(token));await fs.rename(temp,credentialsFile);}
async function persistLayout(next){await saveLayout(layoutFile,next);}
async function clearCredentials(){token='';user=null;pendingAccount=null;authorization=null;await fs.rm(credentialsFile,{force:true});await fs.rm(credentialsFile+'.tmp',{force:true});}
async function identifyAccount(){const identity=(await api('GET','/obs/v1/me')).user;if(!Number.isSafeInteger(identity?.id)||typeof identity.username!=='string')throw new Error('Conta inválida.');pendingAccount={id:identity.id,username:identity.username,name:identity.name};user=null;studio=null;notice='Confira a conta antes de continuar. Nenhuma câmera ou transmissão foi iniciada.';}
const updateBlocked=()=>transmitting||endRequested||['waiting','reserved','starting','live','reconnecting','ending'].includes(studio?.session?.status);
async function checkUpdate(automatic=false){
  if(automatic&&!automaticUpdateChecks||updateChecking||updateController||quitting)return;updateChecking=true;
  try{const result=await checkForUpdates({currentVersion:app.getVersion(),publicKeyPem:await fs.readFile(path.join(__dirname,'update-public-key.pem'),'utf8')});updateInfo={...result,status:result.available?'available':'current',progress:0};if(!automatic)notice=result.available?'Nova versão disponível. Atualize quando estiver fora de uma live.':'Seu aplicativo está atualizado.';}
  catch(e){if(!automatic)throw e;}finally{updateChecking=false;emit();}
}
async function installUpdate(){
  if(!app.isPackaged)throw new Error('A atualização é disponibilizada no aplicativo instalado.');
  if(updateBlocked())throw new Error('Encerre sua live antes de atualizar o aplicativo.');
  await checkUpdate();if(!updateInfo?.available)throw new Error('Seu aplicativo já está atualizado.');
  const release=updateInfo,generation=epoch;updateController=new AbortController();let downloaded;
  try{
    updateInfo={...release,status:'downloading',progress:0};emit();
    downloaded=await downloadInstaller(release,{directory:path.join(app.getPath('userData'),'updates'),signal:updateController.signal,onProgress:progress=>{updateInfo={...release,status:'downloading',progress};emit();}});
    // Recheck after the download: a session may have been started through the website.
    if(token){const latest=await api('GET','/obs/v1/live/studio');studio=latest;}
    if(updateBlocked()||quitting||generation!==epoch)throw new Error('A atualização foi adiada. Encerre a live e tente novamente.');
    await stopLocal();await engine.close();
    if(updateBlocked()||quitting)throw new Error('A atualização foi adiada.');
    await verifyInstaller(downloaded,release.sha256);
    if(updateBlocked()||quitting||generation!==epoch||updateController.signal.aborted)throw new Error('A atualização foi cancelada ou adiada.');
    updateInfo={...release,status:'installing',progress:100};emit();
    // Only a locally verified installer, never renderer arguments or a shell command.
    await new Promise((resolve,reject)=>{const child=spawn(downloaded,['/SILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-','/PRIVEXUPDATE=1',`/DIR=${path.dirname(process.execPath)}`],{shell:false,windowsHide:true,detached:true,stdio:'ignore'});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});
    quitting=true;app.quit();
  }catch(e){updateInfo={...release,status:'error',progress:0};if(downloaded)await fs.rm(downloaded,{force:true});throw e;}
  finally{updateController=null;emit();}
}
function clearAudioMeters(){audioMeters=normalizeAudioMeters();if(win&&!win.isDestroyed())win.webContents.send('studio:audio-levels',audioMeters);}
async function stopLocal(){clearAudioMeters();transmitting=false;prepared=false;sceneMode='live';goal=null;mediaStatus=null;await engine?.request('stop').catch(()=>{});}
const enabledCatalogGoal=catalog=>catalog?.controls?.goals_enabled===true?catalog.goal:null;
async function syncOverlay(){if(!prepared)return;const visible=overlayEnabled&&goal?.active&&typeof goal.title==='string'&&Number.isSafeInteger(goal.raised_cents)&&Number.isSafeInteger(goal.target_cents)&&goal.target_cents>0;await engine.request('overlay',visible?{visible:true,title:goal.title,raisedCents:goal.raised_cents,targetCents:goal.target_cents}:{visible:false});}
async function endSession(){endRequested=true;epoch++;await stopLocal();if(active()){studio=await api('POST',`/obs/v1/live/${studio.session.id}/end`,{});}endRequested=false;intent=null;notice='Envio de vídeo interrompido. O servidor está finalizando a sessão.';}
async function mediaEvent(value){
  if(value.event==='audio-levels'){if(prepared){audioMeters=normalizeAudioMeters(value.channels);if(win&&!win.isDestroyed())win.webContents.send('studio:audio-levels',audioMeters);}return;}
  if(value.event!=='status')return;
  mediaStatus={state:value.state,width:value.width,height:value.height,fps:value.fps,totalBytes:value.totalBytes,droppedFrames:value.droppedFrames,layers:Array.isArray(value.layers)?value.layers.map(layer=>({kind:String(layer?.kind??''),ready:layer?.ready===true,visible:layer?.visible!==false})):[]};
  // A failed TLS/network/encoder start is terminal. A recoverable reconnect is not.
  if(transmitting&&Number.isInteger(value.stopCode)&&['ready','idle'].includes(value.state)){
    try{await endSession();}catch{notice='O envio foi interrompido. Vamos tentar finalizar a sessão no servidor novamente.';}
    failure='Não foi possível manter a conexão de vídeo. Verifique sua internet e prepare a transmissão novamente.';
  }
  emit();
}
function engineLost(){clearAudioMeters();epoch++;prepared=false;transmitting=false;if(active())endRequested=true;failure='Motor de vídeo interrompido. A sessão será encerrada; prepare os equipamentos novamente.';emit();}
async function refresh(){const generation=epoch;const data=await api('GET','/obs/v1/live/studio');if(generation!==epoch)return;lastControl=Date.now();studio=data;
  if(transmitting&&(!active()||studio.session.status==='ending')){epoch++;await stopLocal();notice='A transmissão foi encerrada pelo servidor.';}
}
async function publish(generation=epoch){if(generation!==epoch)return;if(!prepared)throw new Error('Prepare a câmera e o áudio antes de transmitir.');if(!active()||!['reserved','reconnecting'].includes(studio.session.status))throw new Error('Aguarde uma vaga.');
  const grant=await api('POST',`/obs/v1/live/${studio.session.id}/publish`,{});
  const server=new URL(grant.server);if(server.protocol!=='rtmps:'||server.username||server.password)throw new Error('Servidor de vídeo inválido.');
  if(generation!==epoch)return;await engine.request('start',{server:grant.server,streamKey:grant.stream_key});if(generation!==epoch){await stopLocal();return;}transmitting=true;notice='Conectando o vídeo. A confirmação de Ao vivo vem do servidor.';
}
async function tick(){if(heartbeatBusy||busy)return;heartbeatBusy=true;const tickEpoch=epoch;try{
  if(endRequested){await endSession();return;}
  if(authorization&&Date.now()>=authorization.expiresAt){authorization=null;failure='O código expirou. Entre novamente.';}
  if(authorization&&Date.now()>=authorization.nextPoll){authorization.nextPoll=Date.now()+6000;try{const current=authorization;const data=await api('POST','/obs/device/token',{device_code:current.device_code},false);if(authorization!==current)return;token=data.access_token;authorization=null;await identifyAccount();}catch(e){if(e.code==='slow_down'&&authorization)authorization.nextPoll=Date.now()+11000;else if(e.code!=='authorization_pending'){authorization=null;failure=e.code==='access_denied'?'Autorização recusada.':e.message;}}}
  if(token&&user&&!authorization){if(active()){const latest=await api('POST',`/obs/v1/live/${studio.session.id}/presence`,{});if(tickEpoch!==epoch)return;studio=latest;}await refresh();
    if(tickEpoch!==epoch)return;
    if(prepared&&overlayEnabled&&active()){const catalog=await api('GET',`/obs/v1/manager/live/${studio.session.id}/commerce`);if(tickEpoch!==epoch)return;goal=enabledCatalogGoal(catalog);await syncOverlay();}
    if(transmitting&&studio?.session?.status==='reconnecting'&&Date.now()>retryAt&&!busy){retryAt=Date.now()+10000;const priorScene=sceneMode;await stopLocal();if(mediaConfig&&tickEpoch===epoch){await engine.request('prepare',mediaConfig);if(tickEpoch!==epoch){await stopLocal();return;}prepared=true;if(priorScene==='pause'){await engine.request('scene',{mode:'pause'});sceneMode='pause';}await publish(tickEpoch);}}
  }
}catch(e){failure=e.status===401?'Sua autorização expirou ou foi revogada. Entre novamente.':'Não foi possível atualizar o servidor. Verifique sua conexão.';if(e.status===401){await stopLocal();await clearCredentials();studio=null;}if(transmitting&&Date.now()-lastControl>30000)await stopLocal();}finally{heartbeatBusy=false;emit();}}
async function command(name,data){
  if(name==='snapshot'){uiAlive=Date.now();return snapshot();}
  if(['start','resume','mute','volume','scene','overlay','layer','layout.save','image.pick','preview.close'].includes(name)&&!user)throw new Error('Confirme a conta antes de usar o Studio.');
  if(name==='manager'){if(!user)throw new Error('Confirme a conta antes de gerenciar interações.');const preset=data?.path==='/lives/commerce-preset';if(!preset&&!active()&&!studio?.session?.managed_by_device)throw new Error('Abra uma sessão deste computador.');const route=managerRoute(data?.method,data?.path,studio?.session?.id);if(JSON.stringify(data?.body||{}).length>64000)throw new Error('Conteúdo muito grande.');const generation=epoch;const result=await api(data.method,route,data.body);if((route.endsWith('/commerce')||preset&&!active())&&generation===epoch){goal=enabledCatalogGoal(result);if(prepared)await syncOverlay();}return result;}
  if(name==='bounds'){if(!prepared)return;let r;try{r=previewInput(data,win.getContentSize(),win.webContents.getZoomFactor());}catch(error){previewRevision++;await engine.request('preview',{visible:false}).catch(()=>{});throw error;}const revision=++previewRevision;await engine.request('preview',{visible:false});if(revision!==previewRevision||!r.width||!r.height)return;await engine.request('resize',{bounds:r});if(revision===previewRevision&&prepared)await engine.request('preview',{visible:true});return;}
  if(name==='end'){epoch++;return endSession();}
  // The file dialog is modal and may stay open for a while; it must not block the heartbeat, so it runs outside the busy section.
  if(name==='image.pick'){if(!win||win.isDestroyed())throw new Error('Janela indisponível.');const picked=await dialog.showOpenDialog(win,{title:'Escolher imagem',properties:['openFile'],filters:[{name:'Imagens',extensions:IMAGE_EXTENSIONS.map(ext=>ext.slice(1))}]});if(picked.canceled||!picked.filePaths?.length)return null;const file=picked.filePaths[0];if(!(await imageUsable(file)))throw new Error('Escolha uma imagem PNG, JPG, GIF, BMP ou WebP de até 25 MB.');allowedImages.add(file);return {file,name:path.basename(file)};}
  if(busy||heartbeatBusy&&['prepare','start','resume','logout'].includes(name))throw Object.assign(new Error('Aguarde a operação atual.'),{status:423});busy=true;failure='';emit();try{
    switch(name){
      case 'updates.check':return checkUpdate();
      case 'updates.automatic':{if(!data||Array.isArray(data)||Object.keys(data).length!==1||typeof data.enabled!=='boolean')throw new Error('Preferência de atualização inválida.');await saveUpdatePreferences(updatePreferencesFile,data.enabled);automaticUpdateChecks=data.enabled;notice=data.enabled?'Consultas automáticas de atualização ativadas.':'Novas consultas automáticas desativadas. Você pode verificar atualizações manualmente.';return;}
      case 'updates.install':return installUpdate();
      case 'account.confirm':{if(!pendingAccount||user)throw new Error('Confira sua conta novamente.');const expected=pendingAccount.id;const identity=(await api('GET','/obs/v1/me')).user;if(identity.id!==expected)throw new Error('A conta mudou. Conecte novamente.');user=identity;try{await refresh();await persist();}catch(e){user=null;throw e;}pendingAccount=null;notice=`Conectada como @${user.username}. Prepare sua live.`;return;}
      case 'account.switch':
      case 'logout':{if(active())throw new Error('Encerre a live antes de trocar a conta.');epoch++;if(token)await api('DELETE','/obs/v1/device');await engine.close();prepared=false;clearAudioMeters();await clearCredentials();studio=null;notice='Conexão removida deste Studio. Ao conectar, escolha a conta correta no navegador.';return;}
      case 'login':{if(active()||user||pendingAccount)throw new Error('Saia da conta atual antes de conectar outra.');authorization=null;if(token)await clearCredentials();const result=await api('POST','/obs/device/authorize',{device_name:'Privex Studio · Windows',scopes:['live:manage','studio:manager']},false);const url=verificationURL(result.verification_uri_complete);authorization={...result,expiresAt:Date.now()+result.expires_in*1000,nextPoll:Date.now()+6000};await shell.openExternal(url);return;}
      case 'login.cancel':authorization=null;return;
      case 'enumerate':if(!user)throw new Error('Entre antes de acessar equipamentos.');return engine.request('enumerate');
      case 'prepare':{if(!user||studio?.session&&!studio.session.managed_by_device)throw new Error('Encerre a sessão no outro dispositivo antes de trocar equipamentos.');const generation=epoch;const config={...prepareInput(data,allowedImages),muted,microphoneVolume,desktopVolume};const h=win.getNativeWindowHandle();config.parentHwnd=h.length>=8?h.readBigUInt64LE().toString():h.readUInt32LE().toString();const replacing=prepared&&mediaConfig&&config.width===mediaConfig.width&&config.height===mediaConfig.height;if(transmitting&&!replacing)throw new Error('Encerre a live antes de mudar o formato.');if(!replacing)prepared=false;const result=await engine.request(replacing?'reconfigure':'prepare',config);if(generation!==epoch){await stopLocal();throw Object.assign(new Error('Aplicação da cena cancelada porque a sessão foi encerrada.'),{status:409});}mediaConfig=config;if(!replacing)sceneMode='live';prepared=true;await syncOverlay();notice=transmitting?'Equipamentos aplicados. A live continua no ar.':'Equipamentos aplicados à prévia local.';return result;}
      case 'volume':{if(!prepared)throw new Error('Prepare os equipamentos antes de ajustar o áudio.');const config=audioInput(data);const result=await engine.request('volume',config);if(config.channel==='microphone')microphoneVolume=config.volume;else desktopVolume=config.volume;if(mediaConfig){mediaConfig.microphoneVolume=microphoneVolume;mediaConfig.desktopVolume=desktopVolume;}return result;}
      case 'layer':{if(!prepared||!mediaConfig)throw new Error('Abra a prévia antes de mostrar ou ocultar fontes.');if(!data||!Number.isInteger(data.index)||data.index<0||data.index>=mediaConfig.layers.length||typeof data.visible!=='boolean')throw new Error('Fonte inválida.');const result=await engine.request('layer',{index:data.index,visible:data.visible});mediaConfig.layers[data.index].visible=data.visible;return result;}
      case 'preview.close':{if(active()||transmitting)throw new Error('Encerre a live antes de fechar a prévia.');if(!prepared)return;await stopLocal();notice='Prévia fechada. Nenhuma câmera ou microfone está ligado.';return;}
      case 'layout.save':{const next=layoutInput(data,allowedImages);await persistLayout(next);layout=next;return;}
      case 'mute':{if(typeof data?.muted!=='boolean')throw new Error('Controle inválido.');const result=await engine.request('mute',{muted:data.muted});muted=data.muted;if(mediaConfig)mediaConfig.muted=muted;return result;}
      case 'scene':{if(!prepared||!['live','pause'].includes(data?.mode))throw new Error('Cena indisponível.');const result=await engine.request('scene',{mode:data.mode});sceneMode=data.mode;return result;}
      case 'overlay':{if(typeof data?.enabled!=='boolean')throw new Error('Controle inválido.');if(data.enabled&&active()){const catalog=await api('GET',`/obs/v1/manager/live/${studio.session.id}/commerce`);goal=enabledCatalogGoal(catalog);}overlayEnabled=data.enabled;await syncOverlay();return;}
      case 'start':{if(!prepared)throw new Error('Prepare os equipamentos primeiro.');if(mediaConfig?.layers?.length===0)throw new Error('Adicione uma fonte antes de iniciar a live.');if(typeof data?.title!=='string'||!data.title.trim()||data.title.length>100)throw new Error('Informe um título de até 100 caracteres.');if(active())throw new Error('Você já tem uma sessão.');const generation=epoch;intent||=crypto.randomUUID();const result=await api('POST','/obs/v1/live',{title:data.title.trim(),intent_id:intent});studio=result;if(generation!==epoch){await endSession();return;}lastControl=Date.now();if(studio.session?.status==='reserved')await publish(generation);else notice='Você está na fila. Confirme quando sua vaga estiver disponível.';return;}
      case 'resume':await refresh();return publish();
      case 'site':return shell.openExternal(`${ORIGIN}/lives`);
      case 'terms':return shell.openExternal(`${ORIGIN}/terms`);
      default:throw new Error('Operação não permitida.');
    }
  }finally{busy=false;emit();}
}
async function boot(){
  credentialsFile=path.join(app.getPath('userData'),'device.dpapi');
  updatePreferencesFile=path.join(app.getPath('userData'),'update-preferences.json');
  automaticUpdateChecks=await loadUpdatePreferences(updatePreferencesFile);
  layoutFile=path.join(app.getPath('userData'),'studio-layout.json');
  layout=await loadLayout(layoutFile,allowedImages);
  const root=path.resolve(__dirname,'../ui');
  protocol.handle('privex',request=>{const u=new URL(request.url);let file;try{file=decodeURIComponent(u.pathname);}catch{return new Response('Invalid',{status:400});}const resolved=path.resolve(root,'.'+file);if(u.host!=='studio'||resolved!==root&&!resolved.startsWith(root+path.sep))return new Response('Denied',{status:403});return net.fetch(pathToFileURL(resolved===root?path.join(root,'index.html'):resolved).href);});
  const enginePath=app.isPackaged?path.join(process.resourcesPath,'engine','PrivexStudioEngine.exe'):path.resolve(__dirname,'../build/engine/PrivexStudioEngine.exe');engine=new Engine(enginePath);engine.on('lost',engineLost);
  engine.on('status',value=>{void mediaEvent(value).catch(()=>{});});
  win=new BrowserWindow({width:1440,height:940,minWidth:1000,minHeight:720,title:'Privex Studio',backgroundColor:'#0c0c12',show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false,devTools:!app.isPackaged}});
  win.webContents.session.setPermissionRequestHandler((_w,_p,cb)=>cb(false));win.webContents.session.setPermissionCheckHandler(()=>false);win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());win.webContents.on('will-attach-webview',e=>e.preventDefault());
  win.webContents.on('render-process-gone',()=>{void endSession().catch(()=>{});});
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Privex Studio',submenu:[{label:'Encerrar transmissão',click:()=>{void endSession().catch(e=>{failure=e.message;emit();});}},{type:'separator'},{label:'Sair',click:()=>win.close()}]}]));
  ipcMain.handle('studio:command',async(event,name,data)=>{try{const frameURL=new URL(event.senderFrame.url);if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||frameURL.protocol!=='privex:'||frameURL.hostname!=='studio'||frameURL.pathname!=='/index.html'||frameURL.username||frameURL.password)throw new Error('Origem não permitida.');const value=await command(name,data);emit();return{ok:true,data:value};}catch(e){return{ok:false,error:e.message,status:e.status};}});
  win.on('close',async e=>{if(quitting)return;if(active()||transmitting||busy){e.preventDefault();const result=await dialog.showMessageBox(win,{type:'question',buttons:['Voltar','Encerrar e sair'],defaultId:0,cancelId:0,message:updateController?'Cancelar a atualização e fechar o Privex Studio?':'Encerrar sua live e fechar o Privex Studio?'});if(result.response!==1)return;updateController?.abort();try{await endSession();}catch{await stopLocal();}quitting=true;await engine.close();app.quit();}else{epoch++;quitting=true;await engine.close();}});
  await win.loadURL('privex://studio/index.html');win.show();
  try{if(safeStorage.isEncryptionAvailable()){token=safeStorage.decryptString(await fs.readFile(credentialsFile));if(!/^pxobs_[A-Za-z0-9]{64}$/.test(token))token='';}if(token)await identifyAccount();}catch(e){if(e.status===401)await clearCredentials();else failure=token?'Sem conexão. Sua autorização local foi preservada.':'';}
  setTimeout(()=>{void checkUpdate(true);void clearInstalledDownloads(path.join(app.getPath('userData'),'updates'),app.getVersion()).catch(()=>{});},12000).unref();setInterval(()=>void checkUpdate(true),6*60*60*1000).unref();
  powerMonitor.on('suspend',()=>{epoch++;void endSession().catch(()=>{});});setInterval(()=>void tick(),6000);setInterval(()=>{if(transmitting&&Date.now()-uiAlive>30000){void endSession().catch(()=>{});failure='A interface parou de responder. A transmissão foi interrompida.';emit();}},5000);emit();
}
app.on('window-all-closed',()=>app.quit());
