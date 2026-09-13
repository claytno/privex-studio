'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {Readable}=require('node:stream');
const {EventEmitter}=require('node:events');
const {createHash}=require('node:crypto');
const {downloadInstaller,verifyInstaller}=require('../main/installer-update.cjs');
const bytes=Buffer.from('MZ synthetic installer fixture, never executable');
const release={available:true,currentVersion:'0.2.0-beta.2',latestVersion:'0.2.0-beta.3',downloadUrl:'https://privex.site/downloads/privex-studio/0.2.0-beta.3/Privex-Studio-0.2.0-beta.3-beta-unsigned-Windows-x64-Setup.exe',sha256:createHash('sha256').update(bytes).digest('hex')};
function transport({status=200,data=bytes,length=String(data.length),encoding,hang=false}={}){
 const calls=[];
 const requestImpl=(url,options,callback)=>{
  calls.push({url,options}); const request=new EventEmitter();let response;
  request.destroy=()=>{response?.destroy();};
  const abort=()=>{request.emit('error',new Error('aborted'));response?.destroy(new Error('aborted'));};
  options.signal?.addEventListener('abort',abort,{once:true});
  process.nextTick(()=>{if(options.signal?.aborted){abort();return;}if(hang)return;response=Readable.from([data]);response.statusCode=status;response.headers={'content-length':length,...(encoding?{'content-encoding':encoding}:{})};callback(response);});
  return request;
 };return {requestImpl,calls};
}
async function folder(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'privex-update-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('downloads exact verified bytes with no credentials and detects later tampering',async t=>{
 const directory=await folder(t),fake=transport(),progress=[];
 const file=await downloadInstaller(release,{directory,requestImpl:fake.requestImpl,onProgress:p=>progress.push(p)});
 assert.deepEqual(await fs.readFile(file),bytes);assert.equal(progress.at(-1),100);
 assert.deepEqual(fake.calls[0].options.headers,{Accept:'application/octet-stream','Accept-Encoding':'identity'});
 assert.equal(fake.calls[0].url,release.downloadUrl);
 await fs.writeFile(file,'MZ tampered');await assert.rejects(verifyInstaller(file,release.sha256),/integridade/);
});
test('rejects foreign hosts, path injection and downgrade before opening a connection',async t=>{
 const directory=await folder(t),fake=transport();
 for(const bad of [{downloadUrl:'https://evil.test/setup.exe'},{latestVersion:'../x'},{currentVersion:'1.0.0'},{available:false}])await assert.rejects(downloadInstaller({...release,...bad},{directory,requestImpl:fake.requestImpl}));
 assert.equal(fake.calls.length,0);
});
test('wrong checksum, redirect, compression, truncated and oversized download leave no installer',async t=>{
 const directory=await folder(t);
 for(const config of [{data:Buffer.from('MZ wrong')},{status:302},{encoding:'gzip'},{length:'900000000'},{length:'999'},{length:undefined,data:Buffer.alloc(200,65)}]){
  await assert.rejects(downloadInstaller(release,{directory,requestImpl:transport(config).requestImpl,maxBytes:100}));
  assert.equal((await fs.readdir(directory)).length,0);
 }
});
test('timeout and cancellation stop the download without leaving a runnable file',async t=>{
 const directory=await folder(t);
 await assert.rejects(downloadInstaller(release,{directory,requestImpl:transport({hang:true}).requestImpl,timeoutMs:15}));
 const controller=new AbortController();controller.abort();
 await assert.rejects(downloadInstaller(release,{directory,signal:controller.signal,requestImpl:transport().requestImpl}));
 assert.equal((await fs.readdir(directory)).length,0);
});
