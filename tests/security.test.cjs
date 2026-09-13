'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {managerRoute,verificationURL,prepareInput}=require('../main/security.cjs');
const id='11111111-1111-4111-8111-111111111111';
test('preset only exposes the authenticated account GET and PUT without a session',()=>{
 for(const method of ['GET','PUT'])assert.equal(managerRoute(method,'/lives/commerce-preset',null),'/obs/v1/manager/commerce-preset');
 for(const path of ['/lives/commerce-preset?user_id=1','/lives/commerce-preset/1','https://evil.test/lives/commerce-preset'])assert.throws(()=>managerRoute('GET',path,null));
 for(const method of ['POST','DELETE'])assert.throws(()=>managerRoute(method,'/lives/commerce-preset',null));
});
test('empty composition explicitly removes visual sources and keeps audio selection',()=>{
 const result=prepareInput({layers:[],microphoneId:'mic'});assert.deepEqual(result.layers,[]);assert.equal(result.sourceType,'empty');assert.equal(result.microphoneId,'mic');
});
test('preview uses validated CSS viewport for native client conversion at fractional zoom',()=>{
 const {previewInput}=require('../main/security.cjs');
 const rect={x:20.2,y:80.4,width:500.3,height:281.41875,viewport:{width:1152,height:640}};
 assert.deepEqual(previewInput(rect,[1440,800],1.25),rect);
 assert.throws(()=>previewInput({...rect,viewport:{width:1600,height:900}},[1440,800],1.25));
 assert.throws(()=>previewInput({...rect,x:1100},[1440,800],1.25));
 assert.deepEqual(previewInput({x:0,y:0,width:0,height:0},[1440,800],1.25),{x:0,y:0,width:0,height:0});
});
test('permits only bounded session manager routes',()=>{
  assert.equal(managerRoute('PUT',`/lives/${id}/chat/pin`,id),`/obs/v1/manager/live/${id}/chat/pin`);
  assert.equal(managerRoute('GET',`/lives/${id}/users?q=Jo%C3%A3o`,id),`/obs/v1/manager/live/${id}/users?q=Jo%C3%A3o`);
  for(const p of ['/admin/lives','/lives/accounting','/auth/me',`/lives/22222222-1111-4111-8111-111111111111/commerce`,`https://evil.test/lives/${id}/commerce`,`/lives/${id}/%2e%2e/commerce`,`/lives/${id}/orders?admin=1`,`/lives/${id}/orders?redirect=https://evil.test`,`/lives/${id}/chat#secret`])assert.throws(()=>managerRoute('GET',p,id));
  assert.throws(()=>managerRoute('POST',`/lives/${id}/orders`,id));
  assert.throws(()=>managerRoute('DELETE',`/lives/${id}/commerce`,id));
});
test('authorization opens only official exact browser login route',()=>{
  assert.equal(verificationURL('https://privex.site/obs/connect?code=ABCD-EFGH'),'https://privex.site/obs/connect?code=ABCD-EFGH');
  for(const p of ['https://privex.site.evil.test/obs/connect?code=ABCD-EFGH','https://privex.site/obs/connect?code=ABCD-EFGH&redirect=https://evil.test','file:///obs/connect?code=ABCD-EFGH','https://evil@privex.site/obs/connect?code=ABCD-EFGH','https://privex.site/download?code=ABCD-EFGH'])assert.throws(()=>verificationURL(p));
});
test('renderer cannot control native output or engine executable configuration',()=>{
  const config=prepareInput({sourceType:'camera',cameraId:'device:1',portrait:true,server:'rtmp://evil',streamKey:'secret',parentHwnd:'123',fps:500,width:8000});
  assert.equal(config.width,720);assert.equal(config.height,1280);assert.equal(config.fps,30);assert.equal(config.server,undefined);assert.equal(config.parentHwnd,undefined);
  assert.throws(()=>prepareInput({sourceType:'script'}));assert.throws(()=>prepareInput({sourceType:'camera',cameraId:'bad\u0000id'}));
});


test('audience listing stays bound to own live and read-only pagination',()=>{
 const {managerRoute}=require('../main/security.cjs');const id='01234567-89ab-4cde-8fab-0123456789ab';
 assert.equal(managerRoute('GET','/lives/'+id+'/audience?page=2',id),'/obs/v1/manager/live/'+id+'/audience?page=2');
 assert.throws(()=>managerRoute('POST','/lives/'+id+'/audience',id));assert.throws(()=>managerRoute('GET','/lives/'+id+'/audience?q=all',id));
});
