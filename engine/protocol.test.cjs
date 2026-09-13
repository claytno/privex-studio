const { spawn, spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');
const executable = path.resolve(__dirname, '../build/engine/PrivexStudioEngine.exe');
const synthetic = spawnSync(executable, ['--self-test'], { encoding: 'utf8', timeout: 30000, windowsHide: true });
assert.equal(synthetic.status, 0, synthetic.stdout + synthetic.stderr);
const syntheticResult = JSON.parse(synthetic.stdout.trim());
assert.ok(syntheticResult.validFitFrames > 5);
assert.ok(syntheticResult.validPauseFrames > 5);
assert.ok(syntheticResult.validOverlayFrames > 5);
assert.equal(syntheticResult.pauseRestoresMute, true);
assert.equal(syntheticResult.reconnectionStateChecks, 5);
assert.equal(syntheticResult.sourceSwitchAndAudioChecks, 7);
assert.equal(syntheticResult.layerCompositionChecks, 9);
assert.equal(syntheticResult.previewGeometryChecks, 4);
assert.ok(syntheticResult.validEmptyFrames > 5);
assert.ok(syntheticResult.validCornerFrames > 5);
assert.ok(syntheticResult.validHiddenFrames > 5);
assert.equal(syntheticResult.audioMeterChecks, 8);
assert.equal(syntheticResult.h264AndAacAvailable, true);
assert.equal(syntheticResult.networkUsed, false);
assert.equal(syntheticResult.physicalCaptureUsed, false);

async function protocol() {
 const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
 let buffer = '', stderr = '', seq = 0; const requests = new Map();
 child.stderr.on('data', c => { stderr += c; });
 child.stdout.on('data', c => { buffer += c; for (;;) { const end = buffer.indexOf('\n'); if (end < 0) break; const msg = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1); if (requests.has(msg.id)) { requests.get(msg.id)(msg); requests.delete(msg.id); } } });
 const call = (command, args = {}) => new Promise((resolve, reject) => { const id = ++seq; const timeout = setTimeout(() => reject(new Error(`Timeout: ${command}`)), 15000); requests.set(id, msg => { clearTimeout(timeout); resolve(msg); }); child.stdin.write(JSON.stringify({ id, command, ...args }) + '\n'); });
 const exited = new Promise(resolve => child.once('exit', code => resolve(code)));
 try {
  assert.equal((await call('status')).result.state, 'idle');
  assert.equal((await call('start', {server:'rtmps://127.0.0.1:65534/live',streamKey:'SYNTHETIC_SECRET_NOT_TO_LOG'})).ok, false);
  assert.equal((await call('unknown')).ok, false);
  assert.equal((await call('resize', {bounds:{width:-1,height:100}})).ok, false);
  const devices = await call('enumerate'); assert.equal(devices.ok, true);
  for (const type of ['cameras','microphones','desktops','displays','windows','games']) assert.ok(Array.isArray(devices.result[type]));
  assert.equal(devices.result.games[0].id, 'any_fullscreen');
  assert.equal((await call('prepare', {sourceType:'camera',cameraId:'missing-device'})).ok, false);
  assert.equal((await call('status')).result.prepared, false);
  const emptyScene=await call('prepare',{layers:[],width:1280,height:720,fps:30});
  assert.equal(emptyScene.ok,true);assert.equal(emptyScene.result.layers.length,0);assert.equal(emptyScene.result.prepared,true);
  assert.equal((await call('scene',{mode:'pause'})).result.sceneMode,'pause');assert.equal((await call('scene',{mode:'live'})).result.sceneMode,'live');
  assert.equal((await call('start',{server:'rtmps://127.0.0.1:65534/live',streamKey:'SYNTHETIC_SECRET_NOT_TO_LOG'})).ok,false,'Empty initial scene cannot publish');
  assert.equal((await call('stop')).result.prepared,false);
  assert.equal((await call('prepare', {layers:[{kind:'image',file:'C:/missing/privex-missing.png'}]})).ok, false, 'Missing image must be refused');
  assert.equal((await call('prepare', {layers:[{kind:'text',text:'   '}]})).ok, false, 'Blank text must be refused');
  assert.equal((await call('layer', {index:0,visible:false})).ok, false, 'Layer toggles need prepared capture');
  // A text-only scene composes without any camera, window or screen capture and no preview window.
  const textScene = await call('prepare', {layers:[{kind:'text',text:'Voltamos já',fit:'corner',corner:'tl',size:0.4},{kind:'text',text:'Privex'}],width:1280,height:720,fps:30});
  assert.equal(textScene.ok, true, JSON.stringify(textScene)); assert.equal(textScene.result.prepared, true); assert.equal(textScene.result.layers.length, 2);
  let composed = textScene.result; for (let attempt = 0; attempt < 40 && !composed.layers[0].ready; attempt++) { await new Promise(r => setTimeout(r, 100)); composed = (await call('status')).result; }
  assert.equal(composed.layers[0].ready, true, 'Text layers render on the GPU without any capture device'); assert.ok(composed.sourceWidth > 0);
  assert.equal((await call('layer', {index:1,visible:false})).result.layers[1].visible, false);
  assert.equal((await call('layer', {index:2,visible:false})).ok, false);
  assert.equal((await call('layer', {index:0.5,visible:false})).ok, false, 'Fractional index cannot toggle a different layer');
  assert.equal((await call('reconfigure', {layers:[{kind:'text',text:'Trocado'}],width:1280,height:720,fps:30,microphoneId:'',desktopId:''})).result.layers.length, 1);
  assert.equal((await call('reconfigure', {layers:[{kind:'camera',id:'missing-device'}],width:1280,height:720,fps:30})).ok, false, 'Unavailable device preserves the composition');
  assert.equal((await call('status')).result.layers.length, 1);
  const emptied=await call('reconfigure',{layers:[],width:1280,height:720,fps:30,microphoneId:'',desktopId:''});
  assert.equal(emptied.ok,true);assert.equal(emptied.result.layers.length,0);assert.equal(emptied.result.prepared,true);assert.equal(emptied.result.sourceWidth,0);
  assert.equal((await call('scene',{mode:'pause'})).result.sceneMode,'pause');assert.equal((await call('scene',{mode:'live'})).result.sceneMode,'live');
  assert.equal((await call('reconfigure',{layers:[{kind:'text',text:'Restaurada'}],width:1280,height:720,fps:30})).result.layers.length,1);

  assert.equal((await call('stop')).result.prepared, false);
  // Never enable automatic fullscreen capture in a test: a user may have a game running.
  assert.equal((await call('prepare', {layers:[{kind:'game',id:'missing-window'}]})).ok, false);
  assert.equal((await call('stop')).result.prepared, false);
  assert.equal((await call('mute', {muted:'yes'})).ok, false);
  assert.equal((await call('mute', {muted:true})).ok, true);
  assert.equal((await call('stop')).result.state, 'idle');
  assert.equal((await call('stop')).result.state, 'idle');
  child.stdin.end();
  const timeout = setTimeout(() => child.kill(), 10000);
  assert.equal(await exited, 0); clearTimeout(timeout);
  assert.equal(stderr, '');
  process.stdout.write(JSON.stringify({ok:true,synthetic:syntheticResult,protocolChecks:33,deviceEnumeration:true,eofCleanup:true,networkPublish:false})+'\n');
 } finally { child.kill(); }
}
protocol().catch(error => { console.error(error.message); process.exitCode = 1; });
