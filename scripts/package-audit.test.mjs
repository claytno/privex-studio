import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { auditPayload, safeRelativeName, prohibitedFile } from './package-audit.mjs';

test('rejects traversal, absolute and stream paths', () => {
  for (const value of ['../secret', '/etc/file', 'x/../../secret', 'C:/secret', 'x:stream', 'x\\y', 'x\nfile']) assert.equal(safeRelativeName(value), false, value);
  assert.equal(safeRelativeName('resources/engine/PrivexStudioEngine.exe'), true);
});
test('prevents secrets, dumps and old OBS frontend entering installer', () => {
  for (const name of ['.env', 'main/.env.production', 'nested/.git', 'cert.pfx', 'key.key', 'crash.dmp', 'main/token.json', 'bin/obs64.exe']) assert.equal(prohibitedFile(name), true, name);
  for (const name of ['resources/app.asar', 'resources/source/Privex-Studio-source.zip', 'LICENSE']) assert.equal(prohibitedFile(name), false, name);
});
test('packaging fails on incomplete engine, license or source bundle', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'privex-package-test-'));
  try { assert.throws(() => auditPayload(root), /Required distribution artifact missing/); }
  finally { fs.rmdirSync(root); }
});
test('validates nested distribution and catches a late-added secret', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'privex-package-test-'));
  const required = ['Privex Studio.exe', 'resources/app.asar', 'resources/engine/PrivexStudioEngine.exe', 'LICENSE', 'LICENSES.chromium.html', 'resources/licenses/THIRD-PARTY-NOTICES.txt', 'resources/source/Privex-Studio-source.zip', 'resources/source/libobs-source.zip', 'resources/source/SOURCE-INFO.txt'];
  try {
    for (const name of required) { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), 'fixture'); }
    const nativeRoot=path.join(root,'resources/source/native-dependencies');fs.mkdirSync(nativeRoot,{recursive:true});
    const hash=createHash('sha256').update('fixture').digest('hex');
    const packages=['FFmpeg','x264','qtbase','lame','srt','librist','mbedtls','mbedtls-framework'].map(name=>({name,file:`${name}.zip`,sha256:hash}));
    for(const item of packages)fs.writeFileSync(path.join(nativeRoot,item.file),'fixture');
    fs.writeFileSync(path.join(nativeRoot,'obs-deps-build-recipes.zip'),'fixture');
    fs.writeFileSync(path.join(nativeRoot,'INVENTORY.json'),JSON.stringify({recipeCommit:'8683107a02300923abe4f293920f4b5edc8cb624',recipeArchiveSha256:hash,packages}));
    assert.equal(auditPayload(root).length, required.length+packages.length+2);
    fs.writeFileSync(path.join(nativeRoot,'x264.zip'),'wrong source');
    assert.throws(()=>auditPayload(root),/Native source checksum mismatch/);
    fs.writeFileSync(path.join(nativeRoot,'x264.zip'),'fixture');
    fs.writeFileSync(path.join(root, 'resources/engine/.env'), 'fixture');
    assert.throws(() => auditPayload(root), /Forbidden distribution path/);
    fs.unlinkSync(path.join(root, 'resources/engine/.env'));
    fs.unlinkSync(path.join(root, 'resources/source/libobs-source.zip'));
    assert.throws(() => auditPayload(root), /Required distribution artifact missing/);
  } finally {
    const resolved = fs.realpathSync(root);
    assert.ok(resolved.startsWith(fs.realpathSync(os.tmpdir()) + path.sep));
    assert.ok(path.basename(resolved).startsWith('privex-package-test-'));
    fs.rmSync(resolved, { recursive: true });
  }
});
