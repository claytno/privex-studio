import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export function safeRelativeName(name) {
  return typeof name === 'string' && name.length > 0 && !path.isAbsolute(name)
    && !name.includes('\\') && !name.split('/').some(p => p === '..' || p === '.' || !p)
    && !/[\x00-\x1f:]/.test(name);
}
export function prohibitedFile(name) {
  return /(^|\/)(\.env(?:\..*)?|\.git|\.npmrc|credentials?\.json|tokens?\.json|obs64\.exe|obs32\.exe)$/i.test(name)
    || /\.(pfx|p12|key|pdb|log|dmp|dpapi)(?:\.tmp)?$/i.test(name)
    || /(^|\/)(Cookies|Local Storage|Session Storage|Login Data)$/i.test(name);
}
export function auditPayload(root) {
  const absolute = fs.realpathSync(root);
  const required = ['Privex Studio.exe', 'resources/app.asar', 'resources/engine/PrivexStudioEngine.exe',
    'LICENSE', 'LICENSES.chromium.html', 'resources/licenses/THIRD-PARTY-NOTICES.txt',
    'resources/source/Privex-Studio-source.zip', 'resources/source/libobs-source.zip', 'resources/source/SOURCE-INFO.txt',
    'resources/source/native-dependencies/INVENTORY.json', 'resources/source/native-dependencies/obs-deps-build-recipes.zip'];
  for (const rel of required) {
    const stat = fs.statSync(path.join(absolute, rel), { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.size < 1) throw new Error(`Required distribution artifact missing: ${rel}`);
  }
  const nativeRoot=path.join(absolute,'resources/source/native-dependencies');
  const nativeInventory=JSON.parse(fs.readFileSync(path.join(nativeRoot,'INVENTORY.json'),'utf8'));
  if(nativeInventory.recipeCommit!=='8683107a02300923abe4f293920f4b5edc8cb624'||!Array.isArray(nativeInventory.packages))throw new Error('Native source inventory is invalid.');
  for(const name of ['FFmpeg','x264','qtbase','lame','srt','librist','mbedtls','mbedtls-framework']) {
    if(!nativeInventory.packages.some(p=>p.name===name))throw new Error(`Native source missing: ${name}`);
  }
  for(const item of [...nativeInventory.packages,{file:'obs-deps-build-recipes.zip',sha256:nativeInventory.recipeArchiveSha256}]) {
    if(!safeRelativeName(item.file)||!/^[a-f0-9]{64}$/.test(item.sha256||''))throw new Error('Native source artifact is invalid.');
    const full=path.join(nativeRoot,item.file);
    if(!fs.existsSync(full)||createHash('sha256').update(fs.readFileSync(full)).digest('hex')!==item.sha256)throw new Error(`Native source checksum mismatch: ${item.file}`);
  }
  const artifacts = [];
  function walk(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const rel = prefix + entry.name;
      if (!safeRelativeName(rel) || prohibitedFile(rel)) throw new Error(`Forbidden distribution path: ${rel}`);
      const full = path.join(directory, entry.name);
      if (fs.lstatSync(full).isSymbolicLink()) throw new Error(`Links are not allowed in distribution: ${rel}`);
      if (entry.isDirectory()) walk(full, `${rel}/`);
      else if (entry.isFile()) artifacts.push({ path: rel, bytes: fs.statSync(full).size, sha256: createHash('sha256').update(fs.readFileSync(full)).digest('hex') });
      else throw new Error(`Unsupported distribution entry: ${rel}`);
    }
  }
  walk(absolute);
  return artifacts;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2]) throw new Error('Provide the packaged app path.');
    const files = auditPayload(process.argv[2]);
    console.log(JSON.stringify({ status: 'pass', files: files.length, bytes: files.reduce((n, f) => n + f.bytes, 0) }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
