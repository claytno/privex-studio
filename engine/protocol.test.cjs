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
  for (const type of ['cameras','microphones','displays','windows']) assert.ok(Array.isArray(devices.result[type]));
  assert.equal((await call('prepare', {sourceType:'camera',cameraId:'missing-device'})).ok, false);
  assert.equal((await call('status')).result.prepared, false);
  assert.equal((await call('mute', {muted:'yes'})).ok, false);
  assert.equal((await call('mute', {muted:true})).ok, true);
  assert.equal((await call('stop')).result.state, 'idle');
  assert.equal((await call('stop')).result.state, 'idle');
  child.stdin.end();
  const timeout = setTimeout(() => child.kill(), 10000);
  assert.equal(await exited, 0); clearTimeout(timeout);
  assert.equal(stderr, '');
  process.stdout.write(JSON.stringify({ok:true,synthetic:syntheticResult,protocolChecks:12,deviceEnumeration:true,eofCleanup:true,networkPublish:false})+'\n');
 } finally { child.kill(); }
}
protocol().catch(error => { console.error(error.message); process.exitCode = 1; });
