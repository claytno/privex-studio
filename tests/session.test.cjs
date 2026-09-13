'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ID = '01234567-89ab-4cde-8fab-0123456789ab';
const ownSession = (status = 'reserved') => ({ session: { id: ID, managed_by_device: true, status } });
const grant = { server: 'rtmps://ingest.example.test:1936', stream_key: 'synthetic-test-grant' };
const equipment = { sourceType: 'camera', cameraId: 'explicit-camera', microphoneId: 'explicit-mic', portrait: true };

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Execute the shipping main module, with no window, capture, disk write or network. */
function fixture(overrides={}) {
  const source = fs.readFileSync(path.join(__dirname, '../main/main.cjs'), 'utf8');
  const engineCalls = [];
  const requests = [];
  const electron = {
    app: { enableSandbox() {}, requestSingleInstanceLock: () => true, on() {}, setPath() {}, getPath: () => 'C:/synthetic-no-files',
      isPackaged:true, whenReady: () => new Promise(() => {}), getVersion: () => '0.2.0-beta.3', quit() { overrides.onQuit?.(); } },
    protocol: { registerSchemesAsPrivileged() {} },
    shell: { openExternal: async () => {} },
  };
  const context = {
    require(name) {
      if (name === 'electron') return electron;
      if(name==='node:child_process' && overrides.spawn)return {spawn:overrides.spawn};
      if(name==='node:fs/promises' && overrides.downloadInstaller)return {...require(name),rm:async()=>{}};
      if (name === './engine.cjs') return { Engine: class {} };
      if (name === './security.cjs') return require('../main/security.cjs');
      if (name === './studio-layout.cjs') return require('../main/studio-layout.cjs');
      if (name === './audio-meter.cjs') return require('../main/audio-meter.cjs');
      if (name === './installer-update.cjs') return overrides.downloadInstaller?{downloadInstaller:overrides.downloadInstaller,verifyInstaller:overrides.verifyInstaller||async function(){},clearInstalledDownloads:async function(){}}:require('../main/installer-update.cjs');
      if (name === './updates.cjs') return overrides.checkForUpdates?{checkForUpdates:overrides.checkForUpdates}:require('../main/updates.cjs');
      if (name === './update-preferences.cjs') return {loadUpdatePreferences:async()=>true,saveUpdatePreferences:overrides.saveUpdatePreferences||async function(){}};
      return require(name);
    },
    module: { exports: {} }, __dirname: path.join(__dirname, '../main'),
    URL, Buffer, AbortSignal, AbortController, setTimeout, clearTimeout, process,
    fetch: () => { throw new Error('Tests must never contact a server.'); },
  };
  // These lexical hooks are appended in memory only. The packaged main module is unmodified.
  vm.runInNewContext(source + `
    module.exports = {
      command, endSession, tick, refresh, snapshot, mediaEvent, engineLost, identifyAccount, updateBlocked, installUpdate, checkUpdate,
      configure(v) {
        if ('api' in v) api = v.api;
        if ('engine' in v) engine = v.engine;
        if ('win' in v) win = v.win;
        if ('user' in v) user = v.user;
        if ('pendingAccount' in v) pendingAccount=v.pendingAccount;
        if ('persist' in v) persist=v.persist;
        if ('endRequested' in v) endRequested=v.endRequested;
        if ('token' in v) token = v.token;
        if ('studio' in v) studio = v.studio;
        if ('prepared' in v) prepared = v.prepared;
        if ('transmitting' in v) transmitting = v.transmitting;
        if ('persistLayout' in v) persistLayout = v.persistLayout;
      },
      state() { return { prepared, transmitting, studio, intent, epoch, busy, mediaConfig }; }
    };
  `, context, { filename: 'main.cjs', timeout: 2000 });
  const subject = context.module.exports;
  const engine = {
    request: async (name, data) => { engineCalls.push({ name, data }); return { prepared: true }; },
    close: async () => {},
  };
  const api = async (method, route, body) => {
    requests.push({ method, route, body });
    if (route.endsWith('/publish')) return grant;
    if (route.endsWith('/end')) return ownSession('ended');
    return ownSession();
  };
  const nativeHandle = Buffer.alloc(8); nativeHandle.writeBigUInt64LE(123n);
  subject.configure({ engine, api, persist:async()=>{}, token: 'synthetic-device-token', user: { id: 12, username: 'synthetic' },
    prepared: true, win: { isDestroyed: () => false, getNativeWindowHandle: () => nativeHandle,
      webContents: { send() {} } } });
  return { subject, engine, api, engineCalls, requests };
}

test('ending during an in-flight reservation never starts video and closes the late reservation', async () => {
  const { subject, api, engineCalls, requests } = fixture();
  const pending = deferred();
  subject.configure({ api: (method, route, body) => route === '/obs/v1/live'
    ? (requests.push({ method, route, body }), pending.promise) : api(method, route, body) });
  const starting = subject.command('start', { title: 'Synthetic live' });
  await subject.command('end');
  pending.resolve(ownSession());
  await starting;
  assert.equal(engineCalls.filter(c => c.name === 'start').length, 0);
  assert.equal(requests.filter(c => c.route.endsWith('/end')).length, 1);
  assert.equal(subject.state().transmitting, false);
  assert.equal(subject.state().prepared, false);
});

test('ending during a pending publish grant prevents engine start', async () => {
  const { subject, api, engineCalls } = fixture();
  const requested = deferred(), pending = deferred();
  subject.configure({ api: (method, route, body) => {
    if (route.endsWith('/publish')) { requested.resolve(); return pending.promise; }
    return api(method, route, body);
  } });
  const starting = subject.command('start', { title: 'Synthetic live' });
  await requested.promise;
  await subject.command('end');
  pending.resolve(grant);
  await starting;
  assert.equal(engineCalls.filter(c => c.name === 'start').length, 0);
  assert.equal(subject.state().transmitting, false);
});

test('late engine acknowledgement after stop cannot restore transmitting state', async () => {
  const { subject, engineCalls } = fixture();
  const requested = deferred(), pending = deferred();
  subject.configure({ engine: { request(name, data) {
    engineCalls.push({ name, data });
    if (name === 'start') { requested.resolve(); return pending.promise; }
    return Promise.resolve({});
  } } });
  const starting = subject.command('start', { title: 'Synthetic live' });
  await requested.promise;
  await subject.command('end');
  pending.resolve({ state: 'connecting' });
  await starting;
  assert.equal(subject.state().transmitting, false);
  assert.equal(engineCalls.at(-1).name, 'stop');
});

test('direct endSession used by menu/watchdog invalidates pending start too', async () => {
  const { subject, api, engineCalls } = fixture();
  const requested = deferred(), pending = deferred();
  subject.configure({ api: (method, route, body) => {
    if (route.endsWith('/publish')) { requested.resolve(); return pending.promise; }
    return api(method, route, body);
  } });
  const starting = subject.command('start', { title: 'Synthetic live' });
  await requested.promise;
  await subject.endSession();
  pending.resolve(grant);
  await starting;
  assert.equal(engineCalls.filter(c => c.name === 'start').length, 0);
  assert.equal(subject.state().transmitting, false);
});

test('double click makes one reservation and timeout retry preserves intent UUID', async () => {
  const { subject, api, requests, engineCalls } = fixture();
  const pending = deferred(); let first = true;
  subject.configure({ api: (method, route, body) => {
    if (route === '/obs/v1/live' && first) {
      first = false; requests.push({ method, route, body }); return pending.promise;
    }
    return api(method, route, body);
  } });
  const starting = subject.command('start', { title: 'Synthetic live' });
  await assert.rejects(subject.command('start', { title: 'Synthetic live' }), /Aguarde/);
  assert.equal(requests.length, 1);
  pending.reject(new Error('Synthetic network timeout'));
  await assert.rejects(starting, /timeout/);
  await subject.command('start', { title: 'Synthetic live' });
  const reservations = requests.filter(c => c.route === '/obs/v1/live');
  assert.equal(reservations.length, 2);
  assert.equal(reservations[0].body.intent_id, reservations[1].body.intent_id);
  assert.equal(engineCalls.filter(c => c.name === 'start').length, 1);
});

test('own recovered session permits explicit preparation without publishing', async () => {
  const { subject, engineCalls, requests } = fixture();
  subject.configure({ prepared: false, studio: ownSession('reconnecting') });
  await subject.command('prepare', equipment);
  assert.equal(subject.state().prepared, true);
  assert.equal(subject.state().transmitting, false);
  assert.equal(engineCalls.filter(c => c.name === 'prepare').length, 1);
  assert.equal(engineCalls.filter(c => c.name === 'start').length, 0);
  assert.equal(requests.length, 0);
});

test('a session owned by another device cannot enable capture preparation', async () => {
  const { subject, engineCalls } = fixture();
  subject.configure({ prepared: false, studio: { session: { id: ID, status: 'live', managed_by_device: false } } });
  await assert.rejects(subject.command('prepare', equipment));
  assert.equal(engineCalls.length, 0);
});

test('server ending state prevents another reservation', async () => {
  const { subject, requests } = fixture();
  subject.configure({ studio: ownSession('ending') });
  await assert.rejects(subject.command('start', { title: 'Another live' }), /sessão/);
  assert.equal(requests.length, 0);
});

test('failed reconfiguration clears stale prepared state', async () => {
  const { subject } = fixture();
  subject.configure({ prepared: true, engine: { request: async () => { throw new Error('Synthetic capture failure'); } } });
  await assert.rejects(subject.command('prepare', equipment), /capture failure/);
  assert.equal(subject.state().prepared, false);
  assert.equal(subject.state().transmitting, false);
});

test('muted microphone remains muted when equipment is reapplied', async () => {
  const { subject, engineCalls } = fixture();
  await subject.command('prepare', equipment);
  await subject.command('mute', { muted: true });
  await subject.command('prepare', { ...equipment, cameraId: 'second-camera' });
  const lastPrepare = engineCalls.filter(c => c.name === 'prepare').at(-1);
  assert.equal(lastPrepare.data.muted, true, 'new microphone must receive authoritative mute state');
  assert.equal(subject.state().mediaConfig.muted, true, 'automatic recovery must preserve mute too');
});

test('ending during automatic reconnect preparation leaves capture unprepared and never restarts', async () => {
  const { subject, api, engineCalls } = fixture();
  await subject.command('prepare', equipment);
  subject.configure({ studio: ownSession('reconnecting'), transmitting: true,
    api: (method, route, body) => route.endsWith('/end') ? api(method, route, body) : Promise.resolve(ownSession('reconnecting')) });
  const requested = deferred(), pending = deferred();
  subject.configure({ engine: { request(name, data) {
    engineCalls.push({ name, data });
    if (name === 'prepare') { requested.resolve(); return pending.promise; }
    return Promise.resolve({});
  } } });
  const ticking = subject.tick();
  await requested.promise;
  await assert.rejects(subject.command('prepare', { ...equipment, cameraId: 'concurrent-camera' }), /Aguarde/);
  await subject.command('end');
  pending.resolve({ prepared: true });
  await ticking;
  assert.equal(subject.state().transmitting, false);
  assert.equal(subject.state().prepared, false);
  assert.equal(engineCalls.filter(c => c.name === 'start').length, 0);
});

test('terminal engine connection failure stops capture and releases reservation immediately', async () => {
  const {subject,engineCalls,requests}=fixture();
  subject.configure({studio:ownSession('starting'),transmitting:true});
  await subject.mediaEvent({event:'status',state:'ready',stopCode:-2,totalBytes:0});
  assert.equal(subject.state().transmitting,false);
  assert.equal(subject.state().prepared,false);
  assert.equal(engineCalls.filter(c=>c.name==='stop').length,1);
  assert.equal(requests.filter(c=>c.route.endsWith('/end')).length,1);
  assert.match(subject.snapshot().error,/conexão de vídeo/);
  await subject.mediaEvent({event:'status',state:'ready',stopCode:-2});
  assert.equal(requests.filter(c=>c.route.endsWith('/end')).length,1);
});

test('recoverable reconnect and normal stop do not trigger a terminal failure', async () => {
  const {subject,requests}=fixture();
  subject.configure({studio:ownSession('reconnecting'),transmitting:true});
  await subject.mediaEvent({event:'status',state:'reconnecting',stopCode:-5});
  assert.equal(subject.state().transmitting,true);
  assert.equal(requests.length,0);
  subject.configure({transmitting:false});
  await subject.mediaEvent({event:'status',state:'idle',stopCode:0});
  assert.equal(requests.length,0);
  assert.equal(subject.snapshot().error,'');
});

test('failed server end retries before sending another presence or reconnect request', async () => {
  const {subject,api,requests}=fixture();
  let fail=true;
  subject.configure({studio:ownSession('starting'),transmitting:true,api:async(method,route,body)=>{
    if(fail&&route.endsWith('/end')){fail=false;throw Error('Synthetic network outage');}
    return api(method,route,body);
  }});
  await subject.mediaEvent({event:'status',state:'ready',stopCode:-2});
  assert.equal(subject.state().transmitting,false);
  await subject.tick();
  assert.equal(requests.length,1);
  assert.ok(requests[0].route.endsWith('/end'));
  assert.equal(subject.state().studio.session.status,'ended');
});

test('engine crash cancels publication and releases its active session on the next control tick', async () => {
  const {subject,requests}=fixture();
  subject.configure({studio:ownSession('live'),transmitting:true});
  subject.engineLost();
  assert.equal(subject.state().transmitting,false);
  assert.equal(subject.state().prepared,false);
  await subject.tick();
  assert.equal(requests.length,1);
  assert.ok(requests[0].route.endsWith('/end'));
});

test('saved authorization identifies the account but cannot enable capture or live management before confirmation', async()=>{
 const {subject,requests,engineCalls}=fixture();
 const identity={id:1,username:'admin',name:'Synthetic admin'};
 subject.configure({user:null,prepared:false,api:async(method,route)=>{requests.push({method,route});return {user:identity};}});
 await subject.identifyAccount();
 assert.equal(subject.snapshot().user,null);
 assert.equal(subject.snapshot().pendingAccount.username,'admin');
 const before=requests.length;await subject.tick();assert.equal(requests.length,before);
 for(const name of ['enumerate','prepare','start','resume','overlay'])await assert.rejects(subject.command(name,equipment));
 assert.equal(engineCalls.length,0);
});

test('account confirmation revalidates identity and only then persists and enables the user',async()=>{
 const {subject}=fixture();let persisted=0;
 const identity={id:22,username:'creator'};
 subject.configure({user:null,prepared:false,pendingAccount:identity,persist:async()=>{persisted++;},api:async(method,route)=>route.endsWith('/me')?{user:identity}:{session:null}});
 await subject.command('account.confirm');
 assert.equal(subject.snapshot().user.id,22);assert.equal(subject.snapshot().pendingAccount,null);assert.equal(persisted,1);
});

test('changed identity cannot silently confirm a different account',async()=>{
 const {subject}=fixture();let persisted=0;
 subject.configure({user:null,prepared:false,pendingAccount:{id:22,username:'creator'},persist:async()=>{persisted++;},api:async()=>({user:{id:1,username:'admin'}})});
 await assert.rejects(subject.command('account.confirm'),/conta mudou/);
 assert.equal(subject.snapshot().user,null);assert.equal(persisted,0);
});

test('updater refuses every active session including a live owned by another device',async()=>{
 for(const status of ['waiting','reserved','starting','live','reconnecting','ending']){
  const {subject,requests,engineCalls}=fixture();
  subject.configure({studio:{session:{id:ID,status,managed_by_device:false}}});
  await assert.rejects(subject.command('updates.install'),/Encerre sua live/);
  assert.equal(requests.length,0);assert.equal(engineCalls.length,0);
 }
});

const updateFixture={available:true,currentVersion:'0.2.0-beta.3',latestVersion:'0.2.0-beta.4',downloadUrl:'https://privex.site/downloads/privex-studio/0.2.0-beta.4/Privex-Studio-0.2.0-beta.4-beta-unsigned-Windows-x64-Setup.exe',sha256:'a'.repeat(64)};
test('update rechecks server state after download and never installs over a newly started live',async()=>{
 let launched=false,verified=false;
 const {subject,engineCalls}=fixture({checkForUpdates:async()=>updateFixture,downloadInstaller:async()=> 'C:/synthetic-no-files/update.exe',verifyInstaller:async()=>{verified=true;},spawn:()=>{launched=true;}});
 subject.configure({studio:null,api:async()=>ownSession('live')});
 await assert.rejects(subject.command('updates.install'),/adiada/);
 assert.equal(launched,false);assert.equal(verified,false);assert.equal(engineCalls.length,0);
});
test('verified update closes capture, passes only fixed installer options, then quits for restart',async()=>{
 const events=[];
 const {subject}=fixture({checkForUpdates:async()=>updateFixture,downloadInstaller:async()=>{events.push('download');return 'C:/synthetic-no-files/update.exe';},verifyInstaller:async()=>events.push('verify'),onQuit:()=>events.push('quit'),spawn:(file,args,options)=>{
  assert.equal(file,'C:/synthetic-no-files/update.exe');assert.equal(options.shell,false);assert.ok(args.includes('/PRIVEXUPDATE=1'));assert.ok(args.includes('/NORESTART'));assert.ok(!args.includes('injected'));
  events.push('spawn');const child=new (require('node:events').EventEmitter)();child.unref=()=>{};process.nextTick(()=>child.emit('spawn'));return child;
 }});
 subject.configure({studio:null,api:async()=>({session:null}),engine:{request:async()=>events.push('stop'),close:async()=>events.push('close')}});
 await subject.command('updates.install',{file:'injected',args:['injected']});
 assert.deepEqual(events,['download','stop','close','verify','spawn','quit']);
});

test('cancelling during the final hash verification prevents installer launch',async()=>{
 const verifying=deferred(),finish=deferred();let launched=false;
 const {subject}=fixture({checkForUpdates:async()=>updateFixture,downloadInstaller:async()=> 'C:/synthetic-no-files/update.exe',verifyInstaller:async()=>{verifying.resolve();await finish.promise;},spawn:()=>{launched=true;}});
 subject.configure({studio:null,api:async()=>({session:null})});
 const installing=subject.command('updates.install');await verifying.promise;
 await subject.command('end');finish.resolve();
 await assert.rejects(installing,/cancelada ou adiada/);assert.equal(launched,false);
});


test('automatic update opt-out blocks background checks but preserves manual checks and validates IPC', async () => {
  const saved=[];let checks=0;
  const {subject}=fixture({saveUpdatePreferences:async(_file,value)=>saved.push(value),checkForUpdates:async()=>{checks++;return{available:false};}});
  assert.equal(subject.snapshot().automaticUpdateChecks,true);
  await subject.command('updates.automatic',{enabled:false});
  assert.deepEqual(saved,[false]);assert.equal(subject.snapshot().automaticUpdateChecks,false);
  await subject.checkUpdate(true);assert.equal(checks,0);
  await subject.command('updates.check');assert.equal(checks,1);
  for(const bad of [null,[],{enabled:'false'},{enabled:false,path:'other.json'},{enabled:0}])await assert.rejects(subject.command('updates.automatic',bad),/inválida/);
  assert.deepEqual(saved,[false]);
  await subject.command('updates.automatic',{enabled:true});await subject.checkUpdate(true);
  assert.equal(checks,2);assert.deepEqual(saved,[false,true]);
});

test('failed preference persistence does not pretend an opt-out was saved',async()=>{
  const {subject}=fixture({saveUpdatePreferences:async()=>{throw new Error('Disk unavailable');}});
  await assert.rejects(subject.command('updates.automatic',{enabled:false}),/Disk unavailable/);
  assert.equal(subject.snapshot().automaticUpdateChecks,true);
});


test('live source switching preserves publishing, interval and configuration on failure',async()=>{
 const {subject,engineCalls}=fixture();await subject.command('prepare',equipment);
 await subject.command('scene',{mode:'pause'});subject.configure({studio:ownSession('live'),transmitting:true});
 await subject.command('prepare',{...equipment,sourceType:'window',sourceId:'synthetic-window'});
 assert.equal(subject.state().transmitting,true);assert.equal(subject.snapshot().sceneMode,'pause');
 assert.equal(engineCalls.filter(c=>c.name==='reconfigure').length,1);assert.equal(engineCalls.filter(c=>c.name==='stop'||c.name==='start').length,0);
 const prior=subject.state().mediaConfig;subject.configure({engine:{request:async()=>{throw Error('Source unavailable');}}});
 await assert.rejects(subject.command('prepare',{...equipment,cameraId:'gone'}),/unavailable/);
 assert.equal(subject.state().prepared,true);assert.equal(subject.state().transmitting,true);assert.equal(subject.state().mediaConfig,prior);
});
test('live canvas resize is rejected before native changes',async()=>{
 const {subject,engineCalls}=fixture();await subject.command('prepare',equipment);subject.configure({studio:ownSession('live'),transmitting:true});
 const count=engineCalls.length;await assert.rejects(subject.command('prepare',{...equipment,portrait:false}),/formato/);assert.equal(engineCalls.length,count);assert.equal(subject.state().prepared,true);
});
test('independent audio levels survive preparation and reject invalid IPC',async()=>{
 const {subject,engineCalls}=fixture();await subject.command('prepare',equipment);
 await subject.command('volume',{channel:'microphone',volume:35});await subject.command('volume',{channel:'desktop',volume:65});
 await subject.command('prepare',{...equipment,desktopId:'chosen-speakers'});
 assert.equal(subject.snapshot().microphoneVolume,35);assert.equal(subject.snapshot().desktopVolume,65);
 const config=engineCalls.filter(c=>c.name==='reconfigure').at(-1).data;assert.equal(config.microphoneVolume,35);assert.equal(config.desktopVolume,65);assert.equal(config.desktopId,'chosen-speakers');
 for(const bad of [null,{channel:'system',volume:50},{channel:'desktop',volume:NaN},{channel:'microphone',volume:101},{channel:'desktop',volume:-1}])await assert.rejects(subject.command('volume',bad),/inválido/);
});
test('ending during a pending live source switch cannot restore preparation',async()=>{
 const {subject}=fixture();await subject.command('prepare',equipment);subject.configure({studio:ownSession('live'),transmitting:true});
 const pending=deferred();subject.configure({engine:{request:async(name)=>name==='reconfigure'?pending.promise:{}}});
 const changing=subject.command('prepare',{...equipment,cameraId:'second-camera'});await subject.command('end');pending.resolve({prepared:true});await changing;
 assert.equal(subject.state().prepared,false);assert.equal(subject.state().transmitting,false);
});


test('global goals switch hides native overlay through toggle, manager refresh and polling',async()=>{
 for(const path of ['toggle','manager','poll']){
  const {subject,engineCalls}=fixture();let enabled=true;
  await subject.command('prepare',equipment);
  subject.configure({studio:ownSession('live'),api:async(_method,route)=>route.endsWith('/commerce')?{controls:{goals_enabled:enabled},goal:{active:true,title:'Synthetic goal',target_cents:10000,raised_cents:2500}}:ownSession('live')});
  await subject.command('overlay',{enabled:true});
  assert.equal(engineCalls.filter(c=>c.name==='overlay').at(-1).data.visible,true,path+' initially shows enabled goal');
  enabled=false;
  if(path==='toggle')await subject.command('overlay',{enabled:true});
  else if(path==='manager')await subject.command('manager',{method:'GET',path:'/lives/'+ID+'/commerce'});
  else await subject.tick();
  assert.equal(engineCalls.filter(c=>c.name==='overlay').at(-1).data.visible,false,path+' must respect global disable even when goal.active remains true');
 }
});


test('native meter events expose bounded telemetry separately and clear on stop',async()=>{
 const {subject}=fixture();const sent=[];
 subject.configure({win:{isDestroyed:()=>false,webContents:{send:(channel,payload)=>sent.push({channel,payload})}}});
 await subject.mediaEvent({event:'audio-levels',channels:{microphone:{configured:true,receiving:true,muted:true,inputDb:0,outputDb:0,inputClipping:true,outputClipping:true,rawAudio:[123]}}});
 assert.equal(subject.snapshot().audioMeters.microphone.inputDb,0);assert.equal(subject.snapshot().audioMeters.microphone.outputDb,-60);
 assert.equal(sent.length,1);assert.equal(sent[0].channel,'studio:audio-levels');assert.ok(!JSON.stringify(sent).includes('rawAudio'));
 await subject.command('end');assert.equal(subject.snapshot().audioMeters.microphone.configured,false);
 await subject.mediaEvent({event:'audio-levels',channels:{microphone:{configured:true,receiving:true,inputDb:0}}});
 assert.equal(subject.snapshot().audioMeters.microphone.configured,false,'Late native event cannot restore capture indication after stopping');
});


test('layered scenes reach the engine only through validated layers and an image allowlist',async()=>{
 const {subject,engineCalls}=fixture();
 await subject.command('prepare',{layers:[{kind:'camera',id:'explicit-camera',fit:'corner',corner:'tl',size:.35},{kind:'display',id:'monitor-1'},{kind:'text',text:'Bem-vindas'}],microphoneId:'explicit-mic',portrait:false});
 const config=engineCalls.filter(c=>c.name==='prepare').at(-1).data;
 assert.equal(config.layers.length,3);assert.equal(config.layers[0].kind,'camera');assert.equal(config.layers[0].corner,'tl');assert.equal(config.sourceType,'camera');assert.equal(config.width,1280);
 await assert.rejects(subject.command('prepare',{layers:[{kind:'image',file:'C:\anywhere\secret.png'}]}),/seletor/,'renderer cannot point the engine at arbitrary files');
 await assert.rejects(subject.command('prepare',{layers:new Array(7).fill({kind:'text',text:'x'})}),/1 a 6/);
 assert.equal(engineCalls.filter(c=>c.name==='prepare'||c.name==='reconfigure').length,1);
});

test('layer visibility toggles are bounded, update the recovery configuration and need an open preview',async()=>{
 const {subject,engineCalls}=fixture();
 subject.configure({prepared:false});
 await assert.rejects(subject.command('layer',{index:0,visible:false}),/prévia/);
 await subject.command('prepare',{layers:[{kind:'camera',id:'explicit-camera'},{kind:'text',text:'Oi'}]});
 await subject.command('layer',{index:1,visible:false});
 const toggle=engineCalls.at(-1);assert.equal(toggle.name,'layer');assert.equal(toggle.data.index,1);assert.equal(toggle.data.visible,false);
 assert.equal(subject.state().mediaConfig.layers[1].visible,false,'automatic reconnect must restore the hidden state');
 for(const bad of [null,{index:2,visible:false},{index:-1,visible:true},{index:0,visible:'no'},{index:0.5,visible:true}])await assert.rejects(subject.command('layer',bad),/inválida/);
});

test('saved layouts are validated and persisted through the layout module only',async()=>{
 const {subject}=fixture();
 let written=null;subject.configure({persistLayout:async value=>{written=value;}});
 await subject.command('layout.save',{scenes:[{id:'principal',name:'Principal',layers:[{kind:'camera',id:'cam'}]},{id:'pausa',name:'Pausa',layers:[{kind:'text',text:'Volto já'}]}],activeScene:'pausa',microphoneId:'mic',desktopId:'',portrait:true});
 assert.equal(written.activeScene,'pausa');assert.equal(written.scenes.length,2);assert.equal(subject.snapshot().layout.portrait,true);assert.equal(subject.snapshot().layout.fresh,undefined);
 await assert.rejects(subject.command('layout.save',{scenes:[{id:'principal',layers:[{kind:'image',file:'C:\pictures\never-picked.png'}]}]}),/seletor/);
 assert.equal(subject.snapshot().layout.activeScene,'pausa','a rejected layout leaves the previous one untouched');
});
