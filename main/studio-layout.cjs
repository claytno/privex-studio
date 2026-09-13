'use strict';
// Saved scenes/sources for this computer. Contains device ids, image paths and names only: no tokens or session data.
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {layerInput, imageFileAllowed} = require('./security.cjs');

const MAX_SCENES = 12, MAX_LAYERS = 6, MAX_FILE = 262144, MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const idPattern = /^[A-Za-z0-9_-]{1,40}$/;

function cleanName(value, fallback) {
  if (typeof value !== 'string' || value.length > 40 || /[\x00-\x1f\x7f]/.test(value)) return fallback;
  return value.trim() || fallback;
}
function cleanDevice(value) {
  return typeof value === 'string' && value.length <= 4096 && !/[\x00-\x1f]/.test(value) ? value : '';
}
function defaultLayout() {
  // fresh: nothing saved yet, so the renderer may suggest the first camera and microphone.
  return {version: 1, scenes: [{id: 'principal', name: 'Principal', layers: []}], activeScene: 'principal', microphoneId: '', desktopId: '', portrait: false, fresh: true};
}
/** Validates a layout coming from the renderer. Unknown keys are dropped; invalid layers throw so the user sees why. */
function layoutInput(value, allowedFiles) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.scenes) || value.scenes.length < 1 || value.scenes.length > MAX_SCENES) throw new Error('Layout inválido.');
  const ids = new Set();
  const scenes = value.scenes.map((scene, index) => {
    if (!scene || typeof scene !== 'object' || !idPattern.test(scene.id ?? '') || ids.has(scene.id)) throw new Error('Cena inválida.');
    ids.add(scene.id);
    if (!Array.isArray(scene.layers) || scene.layers.length > MAX_LAYERS) throw new Error('A cena aceita até 6 fontes.');
    return {id: scene.id, name: cleanName(scene.name, `Cena ${index + 1}`), layers: scene.layers.map(layer => layerInput(layer, allowedFiles))};
  });
  const activeScene = ids.has(value.activeScene) ? value.activeScene : scenes[0].id;
  return {version: 1, scenes, activeScene, microphoneId: cleanDevice(value.microphoneId), desktopId: cleanDevice(value.desktopId), portrait: value.portrait === true};
}
async function imageUsable(file) {
  if (!imageFileAllowed(file)) return false;
  try { const stat = await fs.stat(file); return stat.isFile() && stat.size > 0 && stat.size <= MAX_IMAGE_BYTES; } catch { return false; }
}
/** Loads a saved layout. Corrupt files fall back to defaults; layers whose image disappeared are dropped, never silently replaced. */
async function loadLayout(file, allowedFiles) {
  let parsed;
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE) return defaultLayout();
    parsed = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch { return defaultLayout(); }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.scenes)) return defaultLayout();
  const scenes = [];
  for (const [index, scene] of parsed.scenes.slice(0, MAX_SCENES).entries()) {
    if (!scene || typeof scene !== 'object' || !idPattern.test(scene.id ?? '') || scenes.some(s => s.id === scene.id)) continue;
    const layers = [];
    for (const layer of Array.isArray(scene.layers) ? scene.layers.slice(0, MAX_LAYERS) : []) {
      if (layer?.kind === 'image') { if (!(await imageUsable(layer.file))) continue; allowedFiles.add(layer.file); }
      try { layers.push(layerInput(layer, allowedFiles)); } catch { /* dropped */ }
    }
    scenes.push({id: scene.id, name: cleanName(scene.name, `Cena ${index + 1}`), layers});
  }
  if (!scenes.length) return defaultLayout();
  return {version: 1, scenes, activeScene: scenes.some(s => s.id === parsed.activeScene) ? parsed.activeScene : scenes[0].id, microphoneId: cleanDevice(parsed.microphoneId), desktopId: cleanDevice(parsed.desktopId), portrait: parsed.portrait === true};
}
async function saveLayout(file, layout) {
  await fs.mkdir(path.dirname(file), {recursive: true});
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(layout) + '\n', {flag: 'wx', mode: 0o600});
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, {force: true});
  }
}
module.exports = {defaultLayout, layoutInput, loadLayout, saveLayout, imageUsable, MAX_IMAGE_BYTES};
