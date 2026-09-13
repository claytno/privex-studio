'use strict';
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {spawnSync,execFile} = require('node:child_process');
const root = path.resolve(__dirname,'..');
const geometryOnly=process.env.PRIVEX_TEST_GEOMETRY_ONLY==='1';
const output = path.join(root,'build','native-preview-smoke');
fs.mkdirSync(output,{recursive:true});
const helper = path.join(output,'WindowProbe.exe');

if(!process.versions.electron) {
 const compile = spawnSync('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',['/nologo','/target:exe',`/out:${helper}`,'/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll',path.join(root,'engine','test-window-probe.cs')],{encoding:'utf8',windowsHide:true});
 assert.equal(compile.status,0,compile.stdout+compile.stderr);
 const env={...process.env}; delete env.ELECTRON_RUN_AS_NODE;
 const run=spawnSync(require('electron'),[__filename],{encoding:'utf8',windowsHide:true,timeout:65000,env});
 if(run.stdout)process.stdout.write(run.stdout);if(run.stderr)process.stderr.write(run.stderr); process.exit(run.status??1);
}

const {app,BrowserWindow} = require('electron');
const {Engine} = require('../main/engine.cjs');
app.setPath('userData',path.join(output,'profile'));
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const title=`Privex synthetic capture ${process.pid}`;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let engine,host,source;
// Keep the Electron UI message loop alive while PrintWindow asks the child to draw.
const probe=(hwnd,name)=>new Promise((resolve,reject)=>execFile(helper,[hwnd,...(name?[path.join(output,name)]:[])],{encoding:'utf8',windowsHide:true,timeout:10000},(error,stdout,stderr)=>error?reject(new Error(stderr||error.message)):resolve(JSON.parse(stdout))));
app.whenReady().then(async()=> {
 try {
  host=new BrowserWindow({width:860,height:640,x:520,y:30,show:false,title:'Privex native preview test',webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});
  source=new BrowserWindow({width:420,height:300,x:30,y:30,show:false,title,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});
  host.setMenu(null); source.setMenu(null);
  await host.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<title>Privex native preview test</title><body style="background:#171320;color:white;font:22px sans-serif">TESTE SINTÉTICO PRIVEX — nenhuma câmera ou microfone</body>'));
  await source.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(`<title>${title}</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#00ff00}div{position:absolute;inset:20px;background:#ff0000}i{position:absolute;left:50%;right:20px;top:20px;bottom:20px;background:#0000ff}</style><div></div><i></i>`));
  source.showInactive();host.showInactive();await delay(1000);
  const hwnd=host.getNativeWindowHandle().readBigUInt64LE().toString();
  engine=new Engine(path.join(root,'build','engine','PrivexStudioEngine.exe'));
  const devices=await engine.request('enumerate');
  const selected=devices.windows.find(item=>item.name.includes(title));
  assert.ok(selected,'Synthetic window must appear; never fall back to screen or another window');
  const prepared=await engine.request('prepare',{sourceType:'window',sourceId:selected.id,microphoneId:'',muted:true,width:1280,height:720,fps:30,parentHwnd:hwnd});
  assert.equal(prepared.prepared,true);let status=prepared;
  const unattached=await probe(hwnd);assert.equal(unattached.exists,true);assert.equal(unattached.visible,false,'Preview must never flash at the temporary origin');
  await assert.rejects(engine.request('preview',{visible:true}),/Position the preview/);
  await engine.request('resize',{bounds:{x:20,y:80,width:640,height:360}});
  assert.equal((await probe(hwnd)).visible,false,'Positioning must not implicitly reveal the native child');
  await engine.request('preview',{visible:true});
  for(let attempt=0;attempt<20 && (!status.sourceWidth||!status.sourceHeight);attempt++){await delay(250);status=await engine.request('status');}
  if(!geometryOnly)assert.ok(status.sourceWidth>0&&status.sourceHeight>0,'Window source must produce real dimensions');
  await delay(1200);const initial=await probe(hwnd,'native-child-printwindow.png');
  assert.equal(initial.exists,true);assert.equal(initial.visible,true);assert.equal(initial.processId,engine.child.pid);assert.equal(initial.width,640);assert.equal(initial.height,360);
  await engine.request('preview',{visible:false});assert.equal((await probe(hwnd)).visible,false);
  await engine.request('preview',{visible:true});assert.equal((await probe(hwnd)).visible,true);
  await engine.request('resize',{bounds:{x:30,y:90,width:560,height:315}});const resized=await probe(hwnd);assert.equal(resized.width,560);assert.equal(resized.height,315);
  await assert.rejects(engine.request('resize',{bounds:{x:850,y:90,width:560,height:315}}),/fit the Studio window/);
  assert.equal((await probe(hwnd)).visible,false,'Out-of-window rectangle must fail closed');
  await assert.rejects(engine.request('preview',{visible:true}),/Position the preview/);
  await engine.request('resize',{bounds:{x:30,y:90,width:560,height:315}});await engine.request('preview',{visible:true});
  const paused=await engine.request('scene',{mode:'pause'});assert.equal(paused.sceneMode,'pause');assert.equal(paused.muted,true);
  const resumed=await engine.request('scene',{mode:'live'});assert.equal(resumed.sceneMode,'live');assert.equal(resumed.muted,true);
  const stopped=await engine.request('stop');assert.equal(stopped.prepared,false);assert.equal(stopped.sourceWidth,0);assert.equal(stopped.sourceHeight,0);assert.equal((await probe(hwnd)).exists,false);
  await engine.close();
  const report={ok:true,geometryOnly,captureValidated:!geometryOnly,fixture:'own-synthetic-window-only',camera:false,microphone:false,screenCapture:false,networkPublish:false,realSourceDimensions:{width:status.sourceWidth,height:status.sourceHeight},nativeChild:{exists:initial.exists,ownedByEngine:true,width:initial.width,height:initial.height},hiddenUntilPositioned:true,outOfWindowFailsClosed:true,hideRestore:true,resize:true,pauseResume:true,stopReleased:true,printWindowColors:{red:initial.redSamples,green:initial.greenSamples,blue:initial.blueSamples},printWindowCapturedGpuContent:initial.redSamples>10&&initial.greenSamples>10&&initial.blueSamples>10};
  if(geometryOnly)report.captureLimit='Explicit geometry-only run: a disconnected Windows desktop cannot provide live window-capture frames. Capture pixels and source dimensions are not counted as validated.';
  if(!report.printWindowCapturedGpuContent&&!geometryOnly)report.limit='PrintWindow does not reliably include the native Direct3D swapchain. HWND ownership/bounds/visibility and actual source dimensions verified; GPU pixels are separately verified by engine self-test.';
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(0);
 }catch(error){console.error(error.stack);if(engine)await engine.close();app.exit(1);}
});
app.on('window-all-closed',()=>{});
