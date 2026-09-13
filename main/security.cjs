'use strict';
const ORIGIN = 'https://privex.site';
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const uuid = new RegExp(`^${UUID}$`, 'i');
function managerRoute(method, input, sessionId) {
  if (!uuid.test(sessionId || '') || typeof input !== 'string' || input.length > 500) throw new Error('Sessão indisponível.');
  const url = new URL(input, ORIGIN);
  if (url.origin !== ORIGIN || url.pathname.includes('%') || input.includes('..') || input.includes('\\') || url.hash || url.username || url.password) throw new Error('Endereço não permitido.');
  const prefix = `/lives/${sessionId}/`;
  if (!url.pathname.startsWith(prefix)) throw new Error('Acesso restrito à live deste computador.');
  const tail = url.pathname.slice(prefix.length);
  const routes = {
    GET: [/^commerce$/, /^orders$/, /^chat$/, /^restrictions$/, /^accounting$/, /^moderation$/, /^users$/, /^audience$/],
    PUT: [/^commerce$/, /^chat\/(rules|pin)$/, /^moderators\/\d+$/],
    POST: [/^chat$/, /^reports$/, /^restrictions$/, /^moderation$/, /^orders\/\d+\/transition$/],
    DELETE: [/^chat\/\d+$/, /^restrictions\/\d+$/, /^moderation\/\d+$/],
  };
  if (!routes[method]?.some(pattern => pattern.test(tail))) throw new Error('Operação não disponível no Studio.');
  for (const [key, value] of url.searchParams) {
    if(tail==='users'&&key==='q'&&value.length>=2&&value.length<=80&&!/[\x00-\x1f]/.test(value))continue;
    if (!['page', 'after'].includes(key) || !/^\d{1,9}$/.test(value)) throw new Error('Filtro inválido.');
  }
  return `/obs/v1/manager/live/${sessionId}/${tail}${url.search}`;
}
function verificationURL(input) {
  const u = new URL(input);
  if (u.origin !== ORIGIN || u.pathname !== '/live/connect' && u.pathname !== '/obs/connect' && u.pathname !== '/lives/connect' || u.username || u.password) throw new Error('Endereço de autorização inválido.');
  if (!/^[A-Z0-9]{4}-?[A-Z0-9]{4}$/.test(u.searchParams.get('code') || '') || [...u.searchParams.keys()].some(k => k !== 'code')) throw new Error('Código inválido.');
  return u.href;
}
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];
const LAYER_KINDS = ['camera', 'window', 'display', 'image', 'text'];
const CAPTURE_KINDS = ['camera', 'window', 'display'];
const CORNERS = ['tl', 'tr', 'bl', 'br'];
function cleanText(value, max, message) {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new Error(message);
  return value;
}
/** Absolute Windows path with an image extension. Existence is checked by the picker or the saved-layout loader. */
function imageFileAllowed(file) {
  return typeof file === 'string' && file.length <= 1024 && !/[\x00-\x1f\x7f]/.test(file) && /^[A-Za-z]:\\/.test(file) && IMAGE_EXTENSIONS.includes(require('node:path').extname(file).toLowerCase());
}
/** One composition layer chosen in the renderer. Image files must come from the native picker or a validated saved layout. */
function layerInput(value, allowedFiles) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !LAYER_KINDS.includes(value.kind)) throw new Error('Fonte inválida.');
  const layer = {
    kind: value.kind,
    fit: ['fit', 'fill', 'corner'].includes(value.fit) ? value.fit : 'fit',
    corner: CORNERS.includes(value.corner) ? value.corner : 'br',
    size: Number.isFinite(value.size) ? Math.min(.6, Math.max(.15, Math.round(value.size * 100) / 100)) : .3,
    visible: value.visible !== false,
    name: cleanText(value.name ?? '', 40, 'Nome da fonte inválido.'),
  };
  if (CAPTURE_KINDS.includes(layer.kind)) { layer.id = cleanText(value.id ?? '', 4096, 'Equipamento inválido.'); if (!layer.id) throw new Error('Escolha o equipamento dessa fonte.'); }
  else if (layer.kind === 'image') { if (!imageFileAllowed(value.file) || !allowedFiles?.has(value.file)) throw new Error('Escolha a imagem pelo seletor do Studio.'); layer.file = value.file; }
  else { layer.text = cleanText(value.text ?? '', 120, 'Texto inválido.').trim(); if (!layer.text) throw new Error('Digite o texto dessa fonte.'); }
  return layer;
}
function layersInput(value, allowedFiles) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) throw new Error('A cena precisa de 1 a 6 fontes.');
  return value.map(layer => layerInput(layer, allowedFiles));
}
function prepareInput(value, allowedFiles = new Set()) {
  if (!value || typeof value !== 'object') throw new Error('Escolha uma fonte.');
  const result = { width: value.portrait ? 720 : 1280, height: value.portrait ? 1280 : 720, fps: 30 };
  for (const key of ['cameraId', 'microphoneId', 'desktopId', 'sourceId']) {
    if (value[key] != null && (typeof value[key] !== 'string' || value[key].length > 4096 || /[\x00-\x1f]/.test(value[key]))) throw new Error('Equipamento inválido.');
    result[key] = value[key] || '';
  }
  if (Array.isArray(value.layers)) {
    result.layers = layersInput(value.layers, allowedFiles);
    const primary = result.layers.find(layer => CAPTURE_KINDS.includes(layer.kind));
    result.sourceType = primary ? primary.kind : result.layers[0].kind;
  } else {
    if (!CAPTURE_KINDS.includes(value.sourceType)) throw new Error('Escolha uma fonte.');
    result.sourceType = value.sourceType;
    result.layers = [{ kind: value.sourceType, id: value.sourceType === 'camera' ? result.cameraId : result.sourceId, fit: 'fit', corner: 'br', size: .3, visible: true, name: '' }];
  }
  return result;
}
function audioInput(value) {
  if (!value || !['microphone','desktop'].includes(value.channel) || !Number.isFinite(value.volume) || value.volume < 0 || value.volume > 100) throw new Error('Volume inválido.');
  return {channel:value.channel,volume:value.volume};
}
module.exports = { ORIGIN, managerRoute, verificationURL, prepareInput, audioInput, layerInput, layersInput, imageFileAllowed, IMAGE_EXTENSIONS, LAYER_KINDS, CAPTURE_KINDS, uuid };
