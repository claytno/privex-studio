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
function prepareInput(value) {
  if (!value || !['camera','window','display'].includes(value.sourceType)) throw new Error('Escolha uma fonte.');
  const result = { sourceType:value.sourceType, width:value.portrait ? 720 : 1280, height:value.portrait ? 1280 : 720, fps:30 };
  for (const key of ['cameraId','microphoneId','desktopId','sourceId']) {
    if (value[key] != null && (typeof value[key] !== 'string' || value[key].length > 4096 || /[\x00-\x1f]/.test(value[key]))) throw new Error('Equipamento inválido.');
    result[key] = value[key] || '';
  }
  return result;
}
function audioInput(value) {
  if (!value || !['microphone','desktop'].includes(value.channel) || !Number.isFinite(value.volume) || value.volume < 0 || value.volume > 100) throw new Error('Volume inválido.');
  return {channel:value.channel,volume:value.volume};
}
module.exports = { ORIGIN, managerRoute, verificationURL, prepareInput, audioInput, uuid };
