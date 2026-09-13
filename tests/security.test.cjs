'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {managerRoute,verificationURL,prepareInput}=require('../main/security.cjs');
const id='11111111-1111-4111-8111-111111111111';
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
