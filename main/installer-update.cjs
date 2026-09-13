'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');
const {createHash, randomUUID} = require('node:crypto');
const {Transform} = require('node:stream');
const {pipeline} = require('node:stream/promises');
const {compareVersions} = require('./updates.cjs');
const MAX_INSTALLER_BYTES = 512 * 1024 * 1024;

function validRelease(release) {
  if (!release?.available || compareVersions(release.latestVersion, release.currentVersion) <= 0
    || !/^[a-f0-9]{64}$/.test(release.sha256 || '')
    || release.downloadUrl !== `https://privex.site/downloads/privex-studio/${release.latestVersion}/Privex-Studio-${release.latestVersion}-beta-unsigned-Windows-x64-Setup.exe`) {
    throw new Error('Atualização não autorizada. Verifique a versão novamente.');
  }
}

async function verifyInstaller(file, expectedHash) {
  const stat = await fsp.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_INSTALLER_BYTES) throw new Error('Instalador inválido.');
  const hash = createHash('sha256'); let header = Buffer.alloc(0);
  for await (const chunk of fs.createReadStream(file)) {
    if (header.length < 2) header = Buffer.concat([header, chunk.subarray(0, 2 - header.length)]);
    hash.update(chunk);
  }
  if (header.toString('ascii') !== 'MZ' || hash.digest('hex') !== expectedHash) throw new Error('A atualização não passou na verificação de integridade.');
}

async function downloadInstaller(release, {directory, onProgress = () => {}, signal, requestImpl = https.get, timeoutMs = 600000, maxBytes = MAX_INSTALLER_BYTES} = {}) {
  validRelease(release);
  await fsp.mkdir(directory, {recursive: true});
  const folder = await fsp.lstat(directory);
  if (!folder.isDirectory() || folder.isSymbolicLink()) throw new Error('Pasta de atualização inválida.');
  const file = path.join(directory, `update-${release.latestVersion}-${randomUUID()}.exe`);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, {once: true});
  if (signal?.aborted) cancel();
  const timer = setTimeout(cancel, timeoutMs);
  let request;
  try {
    const response = await new Promise((resolve, reject) => {
      request = requestImpl(release.downloadUrl, {headers: {'Accept': 'application/octet-stream', 'Accept-Encoding': 'identity'}, signal: controller.signal}, resolve);
      request.on('error', reject);
    });
    const length = response.headers['content-length'];
    if (response.statusCode !== 200 || response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity'
      || length !== undefined && (!/^\d+$/.test(length) || Number(length) < 2 || Number(length) > maxBytes)) {
      response.destroy(); throw new Error('O servidor recusou o download da atualização.');
    }
    let bytes = 0, lastProgress = -1;
    const meter = new Transform({transform(chunk, _encoding, done) {
      bytes += chunk.length;
      if (bytes > maxBytes) return done(new Error('Instalador maior que o limite permitido.'));
      const progress = length ? Math.min(99, Math.floor(bytes * 100 / Number(length))) : 0;
      if (progress !== lastProgress) { lastProgress = progress; onProgress(progress); }
      done(null, chunk);
    }});
    await pipeline(response, meter, fs.createWriteStream(file, {flags: 'wx', mode: 0o600}), {signal: controller.signal});
    if (length !== undefined && bytes !== Number(length)) throw new Error('Download incompleto.');
    await verifyInstaller(file, release.sha256);
    if (controller.signal.aborted) throw new Error('Atualização cancelada.');
    if (process.platform === 'win32') await fsp.writeFile(file + ':Zone.Identifier', `[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=${release.downloadUrl}\r\n`);
    onProgress(100);
    return file;
  } catch (error) {
    request?.destroy(); await fsp.rm(file, {force: true}); throw error;
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', cancel);
  }
}
async function clearInstalledDownloads(directory, currentVersion) {
  const folder = await fsp.lstat(directory).catch(() => null);
  if (!folder?.isDirectory() || folder.isSymbolicLink()) return;
  for (const name of await fsp.readdir(directory)) {
    const match = /^update-(\d+\.\d+\.\d+-beta\.\d+)-[a-f0-9-]{36}\.exe$/.exec(name);
    if (match && compareVersions(match[1], currentVersion) <= 0) await fsp.rm(path.join(directory, name), {force: true}).catch(() => {});
  }
}
module.exports = {downloadInstaller, verifyInstaller, clearInstalledDownloads, MAX_INSTALLER_BYTES};
