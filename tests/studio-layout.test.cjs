'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {defaultLayout, layoutInput, loadLayout, saveLayout} = require('../main/studio-layout.cjs');
const {layerInput, prepareInput} = require('../main/security.cjs');

async function scratch() { return fs.mkdtemp(path.join(os.tmpdir(), 'privex-layout-')); }

test('missing or corrupt layout files fall back to a fresh default without throwing', async () => {
  const dir = await scratch();
  const missing = await loadLayout(path.join(dir, 'none.json'), new Set());
  assert.equal(missing.fresh, true); assert.equal(missing.scenes[0].layers.length, 0);
  await fs.writeFile(path.join(dir, 'bad.json'), '{not json');
  assert.equal((await loadLayout(path.join(dir, 'bad.json'), new Set())).fresh, true);
  await fs.writeFile(path.join(dir, 'huge.json'), '0'.repeat(300000));
  assert.equal((await loadLayout(path.join(dir, 'huge.json'), new Set())).scenes.length, 1);
});

test('the transition choice is remembered for this computer and repaired when the file is damaged', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'privex-transition-'));
  const file = path.join(directory, 'studio-layout.json');
  const allowed = new Set();
  await saveLayout(file, layoutInput({scenes: [{id: 'principal', name: 'Principal', layers: []}], activeScene: 'principal', transition: {style: 'cut', durationMs: 0}}, allowed));
  assert.deepEqual((await loadLayout(file, allowed)).transition, {style: 'cut', durationMs: 0});
  await fs.writeFile(file, JSON.stringify({version: 1, scenes: [{id: 'principal', name: 'Principal', layers: []}], activeScene: 'principal', transition: {style: 'stinger', durationMs: 99999}}));
  assert.deepEqual((await loadLayout(file, allowed)).transition, {style: 'slide', durationMs: 350}, 'A damaged choice falls back instead of refusing the layout');
  assert.throws(() => layoutInput({scenes: [{id: 'principal', name: 'P', layers: []}], activeScene: 'principal', transition: {style: 'wipe'}}, allowed), /Transição/);
  await fs.rm(directory, {recursive: true, force: true});
});

test('saved layouts round-trip and drop layers whose image disappeared instead of substituting', async () => {
  const dir = await scratch(), file = path.join(dir, 'studio-layout.json'), image = path.join(dir, 'logo.png');
  await fs.writeFile(image, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const allowed = new Set([image]);
  const layout = layoutInput({scenes: [{id: 'principal', name: ' Principal ', layers: [{kind: 'camera', id: 'cam-1', fit: 'corner', corner: 'tl', size: 0.42}, {kind: 'image', file: image}, {kind: 'text', text: 'Olá'}]}, {id: 'pausa', name: '', layers: []}], activeScene: 'pausa', microphoneId: 'mic-1', desktopId: '', portrait: true, fresh: true, extra: 'dropped'}, allowed);
  assert.equal(layout.fresh, undefined); assert.equal(layout.extra, undefined); assert.equal(layout.scenes[1].name, 'Cena 2'); assert.equal(layout.activeScene, 'pausa'); assert.equal(layout.portrait, true);
  await saveLayout(file, layout);
  const reloaded = await loadLayout(file, new Set());
  assert.deepEqual(reloaded, layout);
  await fs.rm(image);
  const afterRemoval = await loadLayout(file, new Set());
  assert.deepEqual(afterRemoval.scenes[0].layers.map(l => l.kind), ['camera', 'text'], 'a vanished image is removed, no other file is picked');
  assert.equal(afterRemoval.fresh, undefined);
});

test('renderer layouts are validated: ids, counts, kinds and image allowlist', () => {
  const allowed = new Set(['C:\\pictures\\ok.png']);
  for (const bad of [null, {}, {scenes: []}, {scenes: [{id: 'a/b', layers: []}]}, {scenes: [{id: 'a', layers: []}, {id: 'a', layers: []}]}, {scenes: [{id: 'a', layers: new Array(7).fill({kind: 'text', text: 'x'})}]}, {scenes: [{id: 'a', layers: [{kind: 'browser', url: 'https://evil.test'}]}]}, {scenes: [{id: 'a', layers: [{kind: 'image', file: 'C:\\pictures\\other.png'}]}]}, {scenes: [{id: 'a', layers: [{kind: 'image', file: '\\\\server\\share\\ok.png'}]}]}, {scenes: [{id: 'a', layers: [{kind: 'text', text: '   '}]}]}]) assert.throws(() => layoutInput(bad, allowed), bad === null ? /inválido/ : undefined);
  const ok = layoutInput({scenes: [{id: 'a', layers: [{kind: 'image', file: 'C:\\pictures\\ok.png', fit: 'fill', size: 9, visible: false, name: 'Logo'}]}]}, allowed);
  assert.deepEqual(ok.scenes[0].layers[0], {kind: 'image', fit: 'fill', corner: 'br', size: 0.6, visible: false, name: 'Logo', file: 'C:\\pictures\\ok.png'});
  assert.equal(defaultLayout().scenes[0].id, 'principal');
});

test('the scene identity and its transition are bounded before they reach the engine', () => {
  const applied = prepareInput({sceneId: 'cena-l2-abc', transition: {style: 'fade', durationMs: 200}, layers: [{kind: 'display', id: 'm1'}]});
  assert.equal(applied.sceneId, 'cena-l2-abc');
  assert.deepEqual(applied.transition, {style: 'fade', durationMs: 200});
  // Without a choice the engine still receives one, so a scene change is never silently instant.
  assert.deepEqual(prepareInput({layers: []}).transition, {style: 'slide', durationMs: 350});
  assert.equal('sceneId' in prepareInput({layers: []}), false, 'No scene identity means an edit of the scene on air');
  assert.throws(() => prepareInput({layers: [], sceneId: 'cena com espaço'}), /Cena/);
  assert.throws(() => prepareInput({layers: [], sceneId: 'x'.repeat(41)}), /Cena/);
  assert.throws(() => prepareInput({layers: [], transition: {style: 'stinger'}}), /Transição/);
  assert.throws(() => prepareInput({layers: [], transition: {style: 'slide', durationMs: 9000}}), /Duração/);
  assert.throws(() => prepareInput({layers: [], transition: {style: 'slide', durationMs: -1}}), /Duração/);
});

test('prepare input accepts explicit layers and keeps the single-source form for older callers', () => {
  const legacy = prepareInput({sourceType: 'window', sourceId: 'win-1', microphoneId: 'mic', portrait: false});
  assert.deepEqual(legacy.layers, [{kind: 'window', id: 'win-1', fit: 'fit', corner: 'br', size: 0.3, visible: true, name: ''}]);
  const layered = prepareInput({layers: [{kind: 'text', text: 'Oi', fit: 'corner', corner: 'bl'}, {kind: 'display', id: 'm1'}], microphoneId: 'mic'});
  assert.equal(layered.sourceType, 'display'); assert.equal(layered.layers.length, 2); assert.equal(layered.layers[0].corner, 'bl');
  assert.deepEqual(prepareInput({layers: []}).layers, []);
  assert.throws(() => prepareInput({layers: [{kind: 'camera', id: ''}]}), /equipamento/);
  assert.throws(() => layerInput({kind: 'text', text: 'a\u0000b'}, new Set()), /Texto/);
  assert.throws(() => prepareInput({layers: [{kind: 'image', file: 'C:\\x.png', server: 'rtmp://evil'}]}), /seletor/);
});
