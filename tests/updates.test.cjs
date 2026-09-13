'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, sign } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { MANIFEST_URL, MAX_BYTES, compareVersions, validateManifest, fetchManifest, checkForUpdates } = require('../main/updates.cjs');
const keys = generateKeyPairSync('ed25519');
const publicKeyPem = keys.publicKey.export({ format: 'pem', type: 'spki' });
const version = '0.2.0-beta.2';
function manifest(overrides = {}) { return { schema_version: 1, channel: 'beta', version,
  download_url: `https://privex.site/downloads/privex-studio/${version}/Privex-Studio-${version}-beta-unsigned-Windows-x64-Setup.exe`,
  sha256: 'a'.repeat(64), published_at: '2026-09-12T23:00:00.000Z', ...overrides }; }
function signed(value, privateKey = keys.privateKey) {
  const bytes = Buffer.from(JSON.stringify(value));
  return Buffer.from(JSON.stringify({ payload: bytes.toString('base64'), signature: sign(null, bytes, privateKey).toString('base64') }));
}
function transport({ status = 200, headers = { 'content-type': 'application/json' }, data = signed(manifest()), hang = false, abort = false } = {}) {
  const calls = [];
  const requestImpl = (url, options, callback) => {
    calls.push({ url, options }); const request = new EventEmitter(); request.destroy = () => { request.destroyed = true; };
    if (!hang) process.nextTick(() => {
      const response = new EventEmitter(); response.statusCode = status; response.headers = headers; response.resume = () => {};
      callback(response); response.emit('data', data);
      if (abort) response.emit('aborted'); else response.emit('end');
    });
    return request;
  };
  return { requestImpl, calls };
}

test('orders semantic numeric versions and stable releases without string sorting', () => {
  assert.equal(compareVersions('0.2.0-beta.10', '0.2.0-beta.2'), 1);
  assert.equal(compareVersions('0.2.0', '0.2.0-beta.20'), 1);
  assert.equal(compareVersions('0.2.0-beta.20', '0.2.0'), -1);
  assert.equal(compareVersions('0.2.0-beta.2', '0.2.0-beta.2'), 0);
  assert.equal(compareVersions('0.10.0-beta.1', '0.9.9'), 1);
  for (const value of ['01.2.0', '1.0', '1.0.0+evil', '1.0.0-beta.01', '1.0.0-alpha.1', null, '1.0.0\n']) assert.throws(() => compareVersions(value, version));
});

test('accepts signed newer release and returns only validated data', async () => {
  const fake = transport(); const result = await checkForUpdates({ currentVersion: '0.2.0-beta.1', publicKeyPem, requestImpl: fake.requestImpl });
  assert.equal(result.available, true); assert.equal(result.downloadUrl, manifest().download_url);
  assert.deepEqual(fake.calls, [{ url: MANIFEST_URL, options: { headers: { Accept: 'application/json', 'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache' } } }]);
  assert.equal(Object.isFrozen(result), true);
});

test('equal or older manifest never offers a download or downgrade', () => {
  for (const currentVersion of [version, '0.2.0-beta.3', '0.2.0', '1.0.0']) {
    const result = validateManifest(signed(manifest()), publicKeyPem, currentVersion);
    assert.equal(result.available, false); assert.equal(result.downloadUrl, null); assert.equal(result.sha256, null);
  }
});

test('rejects changed payload, forged signatures, wrong keys and unsigned manifests', () => {
  const envelope = JSON.parse(signed(manifest()));
  envelope.payload = Buffer.from(JSON.stringify(manifest({ version: '0.3.0' }))).toString('base64');
  assert.throws(() => validateManifest(Buffer.from(JSON.stringify(envelope)), publicKeyPem, '0.2.0-beta.1'));
  assert.throws(() => validateManifest(signed(manifest(), generateKeyPairSync('ed25519').privateKey), publicKeyPem, '0.2.0-beta.1'));
  for (const value of [manifest(), {}, { ...JSON.parse(signed(manifest())), signature: 'bad' }, { ...JSON.parse(signed(manifest())), redirect: 'evil' }])
    assert.throws(() => validateManifest(Buffer.from(JSON.stringify(value)), publicKeyPem, version));
});

test('rejects hostile URLs, unexpected commands, channels, hashes and malformed dates even when signed', () => {
  for (const override of [
    { download_url: 'https://privex.site.evil.test/setup.exe' }, { download_url: 'http://privex.site/setup.exe' },
    { download_url: manifest().download_url + '?next=evil' }, { download_url: manifest().download_url + '#fragment' },
    { download_url: manifest().download_url.replace('https://', 'https://evil@') },
    { download_url: manifest().download_url.replace('/downloads/', '/%64ownloads/') },
    { download_url: manifest().download_url.replace('/downloads/', '/old/../downloads/') },
    { channel: 'stable' }, { schema_version: 2 }, { command: 'run.exe' }, { sha256: 'oops' },
    { published_at: '2026-02-30T00:00:00.000Z' }, { published_at: '2026-09-12' }, { version: '0.2.0-beta.3' }
  ]) assert.throws(() => validateManifest(signed(manifest(override)), publicKeyPem, '0.2.0-beta.1'));
});

test('rejects redirects without following them, wrong media type and compressed bodies', async () => {
  for (const settings of [{ status: 302, headers: { location: 'https://evil.test', 'content-type': 'application/json' } }, { status: 404 }, { headers: { 'content-type': 'text/html' } }, { headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' } }]) {
    const fake = transport(settings); await assert.rejects(fetchManifest({ requestImpl: fake.requestImpl })); assert.equal(fake.calls.length, 1);
  }
});

test('bounds response bytes and wall-clock time and fails aborted requests', async () => {
  for (const settings of [{ data: Buffer.alloc(MAX_BYTES + 1) }, { headers: { 'content-type': 'application/json', 'content-length': String(MAX_BYTES + 1) } }, { abort: true }])
    await assert.rejects(fetchManifest({ requestImpl: transport(settings).requestImpl }));
  await assert.rejects(fetchManifest({ requestImpl: transport({ hang: true }).requestImpl, timeoutMs: 10 }), /demorou/);
  assert.throws(() => validateManifest(Buffer.alloc(MAX_BYTES + 1), publicKeyPem, version));
  assert.throws(() => validateManifest(Buffer.from([0xff]), publicKeyPem, version));
});
