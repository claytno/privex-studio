'use strict';

const https = require('node:https');
const { createPublicKey, verify } = require('node:crypto');
const { TextDecoder } = require('node:util');

const MANIFEST_URL = 'https://privex.site/downloads/privex-studio/latest.json';
const MAX_BYTES = 16384;
const TIMEOUT_MS = 10000;
const VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})(?:-beta\.(0|[1-9]\d{0,5}))?$/;

function parseVersion(value) {
  const match = typeof value === 'string' && VERSION.exec(value);
  if (!match) throw new Error('Versão de atualização inválida.');
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? Infinity : Number(match[4])];
}

function compareVersions(left, right) {
  const a = parseVersion(left), b = parseVersion(right);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}

function decodeBase64(value, maxBytes) {
  if (typeof value !== 'string' || value.length > Math.ceil(maxBytes / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('Assinatura de atualização inválida.');
  const decoded = Buffer.from(value, 'base64');
  if (!decoded.length || decoded.length > maxBytes || decoded.toString('base64') !== value) throw new Error('Assinatura de atualização inválida.');
  return decoded;
}

function decodeJSON(bytes) {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

function validateManifest(bytes, publicKeyPem, currentVersion) {
  parseVersion(currentVersion);
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_BYTES) throw new Error('Manifesto de atualização inválido.');
  const envelope = decodeJSON(bytes);
  if (!exactKeys(envelope, ['payload', 'signature'])) throw new Error('Manifesto de atualização inválido.');
  const payloadBytes = decodeBase64(envelope.payload, 8192);
  const signature = decodeBase64(envelope.signature, 64);
  const key = createPublicKey(publicKeyPem);
  if (key.asymmetricKeyType !== 'ed25519' || signature.length !== 64 || !verify(null, payloadBytes, key, signature)) throw new Error('Não foi possível confirmar a origem da atualização.');
  const manifest = decodeJSON(payloadBytes);
  if (!exactKeys(manifest, ['schema_version', 'channel', 'version', 'download_url', 'sha256', 'published_at']) || manifest.schema_version !== 1 || manifest.channel !== 'beta') throw new Error('Formato de atualização não suportado.');
  parseVersion(manifest.version);
  // The beta channel offers only its own immutable Windows installer. No arbitrary URLs,
  // redirects, query parameters or release-supplied commands ever reach the renderer.
  const expectedURL = `https://privex.site/downloads/privex-studio/${manifest.version}/Privex-Studio-${manifest.version}-beta-unsigned-Windows-x64-Setup.exe`;
  if (manifest.download_url !== expectedURL || !/^[a-f0-9]{64}$/.test(manifest.sha256)
    || typeof manifest.published_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(manifest.published_at)
    || !Number.isFinite(Date.parse(manifest.published_at)) || new Date(manifest.published_at).toISOString() !== manifest.published_at) throw new Error('Dados de atualização inválidos.');
  const available = compareVersions(manifest.version, currentVersion) > 0;
  return Object.freeze({ available, currentVersion, latestVersion: manifest.version,
    downloadUrl: available ? manifest.download_url : null,
    sha256: available ? manifest.sha256 : null, publishedAt: manifest.published_at });
}

function fetchManifest({ requestImpl = https.get, timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false, request, timer;
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) { request?.destroy(); reject(error); } else resolve(result);
    };
    timer = setTimeout(() => finish(new Error('A consulta de atualização demorou demais.')), timeoutMs);
    try {
      request = requestImpl(MANIFEST_URL, { headers: { Accept: 'application/json', 'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache' } }, response => {
        if (response.statusCode !== 200 || !/^application\/json(?:\s*;|$)/i.test(response.headers['content-type'] || '')
          || response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity'
          || response.headers['content-length'] !== undefined && (!/^\d+$/.test(response.headers['content-length']) || Number(response.headers['content-length']) > MAX_BYTES)) {
          response.resume(); finish(new Error('Resposta de atualização recusada.')); return;
        }
        let size = 0; const parts = [];
        response.on('data', chunk => {
          if (settled) return;
          const data = Buffer.from(chunk); size += data.length;
          if (size > MAX_BYTES) { finish(new Error('Manifesto de atualização muito grande.')); return; }
          parts.push(data);
        });
        response.on('end', () => finish(null, Buffer.concat(parts)));
        response.on('error', error => finish(error));
        response.on('aborted', () => finish(new Error('Consulta de atualização interrompida.')));
      });
      request.on('error', error => finish(error));
    } catch (error) { finish(error); }
  });
}

async function checkForUpdates({ currentVersion, publicKeyPem, requestImpl, timeoutMs } = {}) {
  parseVersion(currentVersion);
  return validateManifest(await fetchManifest({ requestImpl, timeoutMs }), publicKeyPem, currentVersion);
}

module.exports = { MANIFEST_URL, MAX_BYTES, compareVersions, validateManifest, fetchManifest, checkForUpdates };
