// Collect the exact native dependency sources selected by the OBS binary build.
// This script downloads sources only. It never executes an upstream build script.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {fileURLToPath} from 'node:url';
const run = promisify(execFile);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const recipes = path.resolve(process.argv[2] || path.join(root,'deps/obs-deps-source'));
const destination = path.resolve(process.argv[3] || path.join(root,'deps/native-dependency-sources'));
const expectedCommit = '8683107a02300923abe4f293920f4b5edc8cb624';
const commit = execFileSync('git', ['-C', recipes, 'rev-parse', 'HEAD'], {encoding:'utf8'}).trim();
if (commit !== expectedCommit) throw new Error('Dependency recipes must be pinned to OBS deps 2026-07-15.');
if (execFileSync('git', ['-C', recipes, 'status', '--porcelain'], {encoding:'utf8'}).trim()) throw new Error('Dependency recipes must be unmodified.');
fs.mkdirSync(destination, {recursive:true});
const sha256 = filename => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
const sourceChecksum = filename => fs.readFileSync(filename,'utf8').match(/[0-9a-f]{64}/i)?.[0];
const selection = [
  ...fs.readdirSync(path.join(recipes, 'deps.ffmpeg')).filter(x => x.endsWith('.ps1') && !x.includes('gas-preprocessor') && !x.includes('libdatachannel')).map(x => `deps.ffmpeg/${x}`),
  ...['30-curl.ps1','30-jansson.ps1','30-speexdsp.ps1','30-rnnoise.ps1','40-detours.ps1','60-simde.ps1','60-nlohmann-json.ps1','80-wil.ps1'].map(x => `deps.windows/${x}`),
];
const inventory = [];
async function download(url, target, expected) {
  if (fs.existsSync(target) && (!expected || sha256(target) === expected.toLowerCase())) return;
  await run('curl.exe', ['--fail','--location','--retry','2','--connect-timeout','20','--max-time','300','--silent','--show-error',url,'--output',target+'.download'], {maxBuffer:1048576});
  if (expected && sha256(target+'.download') !== expected.toLowerCase()) throw new Error(`Upstream checksum mismatch: ${path.basename(target)}`);
  fs.renameSync(target+'.download',target);
}
async function collect(recipe) {
  const content = fs.readFileSync(path.join(recipes, recipe), 'utf8');
  const literal = key => content.match(new RegExp(`\\$${key}\\s*=\\s*['\"]([^'\"]+)['\"]`))?.[1];
  const name=literal('Name'), version=literal('Version'), uri=literal('Uri'), hash=literal('Hash') || content.match(/x64\s*=\s*'([a-f0-9]{40})'/)?.[1];
  if (![name,version,uri,hash].every(Boolean) || !/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error(`Cannot parse pinned recipe ${recipe}`);
  let filename, sourceURL=uri, expectedHash=null;
  if (/^[0-9a-f]{40}$/i.test(hash)) {
    filename=`${name}-${hash}.tar.gz`;
    const github=uri.match(/^https:\/\/github.com\/([^/]+)\/([^/]+)\.git$/);
    if (github) sourceURL=`https://codeload.github.com/${github[1]}/${github[2]}/tar.gz/${hash}`;
    else if (uri.startsWith('https://aomedia.googlesource.com/')) sourceURL=`${uri.replace(/\.git$/,'')}/+archive/${hash}.tar.gz`;
    else sourceURL=`${uri.replace(/\.git$/,'')}/-/archive/${hash}/${path.basename(uri,'.git')}-${hash}.tar.gz`;
  } else {
    filename=`${name}-${version}${uri.endsWith('.zip')?'.zip':'.tar.gz'}`;
    const hashfile=hash.replace('${PSScriptRoot}',path.dirname(path.join(recipes,recipe)));
    expectedHash=sourceChecksum(hashfile);
    if (!/^[0-9a-f]{64}$/i.test(expectedHash)) throw new Error(`Missing source checksum ${recipe}`);
  }
  let target=path.join(destination,filename);
  await download(sourceURL,target,expectedHash);
  let sourceSubset;
  if(name==='amf') {
    // OBS installs only these headers. Exclude unrelated sample media, SDK DLLs and third-party SDKs.
    const upstreamRoot=`AMF-${hash}`,subsetRoot=path.join(destination,'amf-header-extract');
    fs.mkdirSync(subsetRoot,{recursive:true});
    execFileSync('tar.exe',['-xf',target,'-C',subsetRoot,`${upstreamRoot}/amf/public/include`,`${upstreamRoot}/LICENSE.txt`,`${upstreamRoot}/README.md`]);
    filename=`amf-${hash}-headers.tar.gz`;target=path.join(destination,filename);
    execFileSync('tar.exe',['-czf',target,'-C',subsetRoot,upstreamRoot]);
    sourceSubset='amf/public/include plus upstream LICENSE.txt and README.md, matching the sparse header-only Windows build recipe';
  }
  // Verify this really is an archive and inspect submodule metadata before shipping.
  const entries=execFileSync('tar.exe',['-tf',target],{encoding:'utf8',maxBuffer:16777216}).split(/\r?\n/);
  const submodules=entries.filter(x=>/(^|\/)\.gitmodules$/.test(x));
  const recordedSubmodules=[];
  for (const entry of submodules) {
    const text=execFileSync('tar.exe',['-xOf',target,entry],{encoding:'utf8'});
    if (text.trim()) recordedSubmodules.push({path:entry,configuration:text});
  }
  inventory.push({name,version,recipe,upstream:uri,revision:/^[0-9a-f]{40}$/i.test(hash)?hash:null,sourceURL,file:filename,sha256:sha256(target),bytes:fs.statSync(target).size,sourceSubset,submodules:recordedSubmodules});
  console.log(`Collected ${name} ${version}`);
}
const queue=[...selection];
const errors=[];
await Promise.all(Array.from({length:4},async()=>{while(queue.length){const next=queue.shift();try{await collect(next);}catch(e){errors.push(`${next}: ${e.message}`);console.error(errors.at(-1));}}}));
if(errors.length)throw new Error(errors.join('\n'));
// Gitlink revisions verified against each parent commit; include build/test helpers too.
for (const [name,repo,revision,parent,submodulePath] of [
  ['mbedtls-framework','Mbed-TLS/mbedtls-framework','2a3e2c5ea053c14b745dbdf41f609b1edc6a72fa','mbedtls','framework'],
  ['munit','nemequ/munit','da8f73412998e4f1adf1100dc187533a51af77fd','simde','test/munit'],
]) {
  const filename=`${name}-${revision}.tar.gz`,sourceURL=`https://codeload.github.com/${repo}/tar.gz/${revision}`;
  await download(sourceURL,path.join(destination,filename));
  inventory.push({name,revision,parent,submodulePath,sourceURL,file:filename,sha256:sha256(path.join(destination,filename)),bytes:fs.statSync(path.join(destination,filename)).size});
}
// Only QtCore is shipped, so qtbase is the corresponding module source.
const qtFile='qtbase-everywhere-src-6.11.1.zip';
const qtURL=`https://download.qt.io/archive/qt/6.11/6.11.1/submodules/${qtFile}`;
const qtHash=sourceChecksum(path.join(recipes,`deps.qt/checksums/${qtFile}.sha256`));
await download(qtURL,path.join(destination,qtFile),qtHash);
inventory.push({name:'qtbase',version:'6.11.1',recipe:'deps.qt/qt6.ps1',sourceURL:qtURL,file:qtFile,sha256:sha256(path.join(destination,qtFile)),bytes:fs.statSync(path.join(destination,qtFile)).size});
execFileSync('git',['-C',recipes,'archive','--format=zip','--output',path.join(destination,'obs-deps-build-recipes.zip'),commit]);
inventory.sort((a,b)=>a.name.localeCompare(b.name));
fs.writeFileSync(path.join(destination,'INVENTORY.json'),JSON.stringify({obsDepsRelease:'2026-07-15',recipeCommit:commit,recipeArchiveSha256:sha256(path.join(destination,'obs-deps-build-recipes.zip')),note:'Original source archives; apply the Windows patches and configuration from each pinned recipe. Sources for static dependencies are included as well. Qt runtime contains QtCore only.',packages:inventory},null,2));
console.log(JSON.stringify({destination,packages:inventory.length,submoduleReview:inventory.filter(x=>x.submodules?.length).map(x=>x.name)}));
