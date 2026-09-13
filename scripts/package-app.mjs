import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { packager } from '@electron/packager';
import { listPackage } from '@electron/asar';
import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses';
import { auditPayload, safeRelativeName, prohibitedFile } from './package-audit.mjs';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repository = root;
const engine = path.resolve(process.argv[2] || path.join(root, 'build/engine'));
const upstream = path.resolve(process.argv[3] || path.join(root, 'deps/obs-source'));
const nativeSources = path.resolve(process.argv[4] || path.join(root, 'deps/native-dependency-sources'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const nativeLock=JSON.parse(fs.readFileSync(path.join(root,'scripts/native-build.lock.json'),'utf8'));
if(execFileSync('git',['-C',upstream,'rev-parse','HEAD'],{encoding:'utf8'}).trim()!==nativeLock.obs.commit)throw new Error('Native source revision does not match the public build lock.');
for(const [relative,expected]of Object.entries(nativeLock.submodules)){
  if(execFileSync('git',['-C',path.join(upstream,relative),'rev-parse','HEAD'],{encoding:'utf8'}).trim()!==expected)throw new Error('Native submodule revision does not match the public build lock.');
}
if (!fs.existsSync(path.join(engine, 'PrivexStudioEngine.exe'))) throw new Error('Build the native engine runtime first; pass its directory as argument 1.');
if (!fs.existsSync(path.join(root, 'ui/index.html'))) throw new Error('Build the React UI to ui first.');
const build = path.join(root, 'build');
const input = path.join(build, 'package-input');
const output = path.join(build, 'app');
const resources = path.join(build, 'package-resources');
// These generated paths are fixed children of this project. Never clean a caller-provided path.
for (const directory of [input, output, resources, path.join(build, 'packaged')]) {
  if (!path.resolve(directory).startsWith(root + path.sep) || path.resolve(directory) === engine) throw new Error('Unsafe generated output path.');
  if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true });
  fs.mkdirSync(directory, { recursive: true });
}
fs.cpSync(path.join(root, 'main'), path.join(input, 'main'), { recursive: true });
fs.cpSync(path.join(root, 'ui'), path.join(input, 'ui'), { recursive: true });
fs.writeFileSync(path.join(input, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, productName: 'Privex Studio', main: 'main/main.cjs', license: pkg.license }, null, 2));

for (const sub of ['engine', 'licenses', 'source']) fs.mkdirSync(path.join(resources, sub), { recursive: true });
fs.cpSync(engine, path.join(resources, 'engine'), { recursive: true, filter: source => !/\.(pdb|log|dmp)$/i.test(source) });
fs.copyFileSync(path.join(root, 'installer/THIRD-PARTY-NOTICES.txt'), path.join(resources, 'licenses/THIRD-PARTY-NOTICES.txt'));
fs.copyFileSync(path.join(upstream, 'COPYING'), path.join(resources, 'licenses/libobs-COPYING.txt'));
fs.copyFileSync(path.join(root, 'installer/TERMS.pt-BR.txt'), path.join(resources, 'licenses/TERMS.pt-BR.txt'));
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(resources, 'licenses/Privex-Studio-GPL-3.0.txt'));
const dependencyInventory=JSON.parse(fs.readFileSync(path.join(nativeSources,'INVENTORY.json'),'utf8'));
if(dependencyInventory.recipeCommit!=='8683107a02300923abe4f293920f4b5edc8cb624')throw new Error('Unexpected native source provenance.');
const digest=filename=>createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
const sourceDestination=path.join(resources,'source/native-dependencies');
fs.mkdirSync(sourceDestination,{recursive:true});
for(const item of [...dependencyInventory.packages,{file:'obs-deps-build-recipes.zip',sha256:dependencyInventory.recipeArchiveSha256}]) {
  if(!safeRelativeName(item.file)||!/^[a-f0-9]{64}$/.test(item.sha256))throw new Error('Invalid native source artifact.');
  const original=path.join(nativeSources,item.file);
  if(digest(original)!==item.sha256)throw new Error(`Native source checksum mismatch: ${item.file}`);
  fs.copyFileSync(original,path.join(sourceDestination,item.file));
}
fs.copyFileSync(path.join(nativeSources,'INVENTORY.json'),path.join(sourceDestination,'INVENTORY.json'));
for (const dependency of ['obs-deps-2026-07-15-x64', 'obs-deps-qt6-2026-07-15-x64']) {
  const licenses = path.join(upstream, '.deps', dependency, 'licenses');
  if (!fs.existsSync(licenses)) throw new Error(`Missing native dependency licenses: ${dependency}`);
  fs.cpSync(licenses, path.join(resources, 'licenses', dependency), { recursive: true });
}
const lock = JSON.parse(fs.readFileSync(path.join(repository, 'package-lock.json'), 'utf8'));
const frontendInventory = [];
for (const [relative, locked] of Object.entries(lock.packages || {})) {
  if (!relative.startsWith('node_modules/') || locked.dev || !safeRelativeName(relative)) continue;
  const directory = path.join(repository, relative);
  if (!fs.existsSync(directory)) continue;
  const manifestPath = path.join(directory, 'package.json');
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const notices = fs.readdirSync(directory).filter(name => /^(license|licence|copying|notice|copyright)([.-]|$)/i.test(name) && fs.statSync(path.join(directory, name)).isFile());
  const destination = path.join(resources, 'licenses/frontend', relative.slice('node_modules/'.length));
  fs.mkdirSync(destination, { recursive: true });
  for (const name of notices) fs.copyFileSync(path.join(directory, name), path.join(destination, name));
  frontendInventory.push({ name: manifest.name, version: manifest.version, license: manifest.license, notices });
}
fs.writeFileSync(path.join(resources, 'licenses/frontend/INVENTORY.json'), JSON.stringify({ note: 'Production dependency notices from the shared frontend lockfile; some dependencies may be tree-shaken out of the Studio bundle.', packages: frontendInventory }, null, 2));
// Ship the exact current custom source plus upstream/submodules used by the engine.
const {auditSource}=await import('./audit-source.mjs');
const sourceListOwn=path.join(build,'studio-source-files.txt');
fs.writeFileSync(sourceListOwn,auditSource(root).join('\n')+'\n');
execFileSync('tar.exe', ['-a', '-cf', path.join(resources, 'source/Privex-Studio-source.zip'), '-C', root, '-T', sourceListOwn]);
if(execFileSync('git',['-C',upstream,'status','--porcelain','--untracked-files=normal'],{encoding:'utf8'}).trim())throw new Error('Upstream source must be a clean, pinned checkout.');
const upstreamFiles = execFileSync('git', ['-C', upstream, 'ls-files', '--recurse-submodules'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim().split(/\r?\n/);
// The existing media build tree has a custom plugin referenced by its CMake tree.
// Include that source too, even though this application never ships/loads the old frontend.
const extraSources=[];
if(extraSources.some(p=>prohibitedFile(p)))throw new Error('Unexpected private/debug file in upstream custom source.');
upstreamFiles.push(...extraSources);
if (upstreamFiles.some(p => !safeRelativeName(p))) throw new Error('Invalid upstream source list.');
const sourceList = path.join(build, 'upstream-source-files.txt');
fs.writeFileSync(sourceList, upstreamFiles.join('\n') + '\n');
execFileSync('tar.exe', ['-a', '-cf', path.join(resources, 'source/libobs-source.zip'), '-C', upstream, '-T', sourceList]);
const upstreamCommit = execFileSync('git', ['-C', upstream, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
fs.writeFileSync(path.join(resources, 'source/SOURCE-INFO.txt'), `Privex Studio ${pkg.version}\nCustom application and shared frontend source: Privex-Studio-source.zip\nMedia engine upstream source: libobs-source.zip\nUpstream git commit: ${upstreamCommit}\nArchives reflect working files at packaging time; engine build instructions are in the custom source archive.\nNative dependency source archives, pinned Windows patches/build recipes and checksums: native-dependencies/INVENTORY.json and obs-deps-build-recipes.zip. Extract each source and apply the patches in its listed Windows recipe. Submodule entries specify their extraction path in the parent source tree.\nQt runtime contains QtCore only; its source is qtbase 6.11.1. Engine DLLs remain replaceable for compatible modified library builds.\nElectron/Chromium notices are at installation root. Additional native and frontend dependency notices are in resources/licenses.\nThe prebuilt FFmpeg configuration enables GPL and version3; see its original COPYING.GPLv3 and dependency licenses. Source availability is preserved; these materials do not grant any rights to Privex accounts, trademarks or server infrastructure.\nThis public beta has no publisher signing. Updates use signed metadata and verified installer bytes after user confirmation, with no active live. It is not a certified or guaranteed malware-free release.\n`);
const version = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version;
const paths = await packager({ dir: input, out: path.join(build, 'packaged'), platform: 'win32', arch: 'x64', name: 'Privex Studio', executableName: 'Privex Studio', electronVersion: version, appVersion: pkg.version, icon: path.join(root, 'installer/privex-studio.ico'), asar: true, prune: false, overwrite: false, extraResource: ['engine','licenses','source'].map(p => path.join(resources, p)), win32metadata: { CompanyName: 'Privex', ProductName: 'Privex Studio', FileDescription: 'Privex Studio' } });
fs.rmdirSync(output);
fs.renameSync(paths[0], output);
await flipFuses(path.join(output, 'Privex Studio.exe'), { version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]: false, [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false, [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true });
const asarFiles = listPackage(path.join(output, 'resources/app.asar'));
if (asarFiles.some(p => prohibitedFile(p.replace(/^[/\\]+/, '').replaceAll('\\', '/')))) throw new Error('Secret or debug artifact found inside app.asar.');
const files = auditPayload(output);
fs.writeFileSync(path.join(build, 'package-manifest.json'), JSON.stringify({ version: pkg.version, electron: version, upstreamCommit, files }, null, 2));
console.log(JSON.stringify({ output, files: files.length, bytes: files.reduce((n, f) => n + f.bytes, 0), signed: false, installerRequired: true }));
