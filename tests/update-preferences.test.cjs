'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {loadUpdatePreferences,saveUpdatePreferences}=require('../main/update-preferences.cjs');

test('new install defaults on; explicit opt-out survives restart and stores only one boolean',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'privex-preferences-test-'));
  t.after(async()=>{const resolved=await fs.realpath(root);assert.ok(path.basename(resolved).startsWith('privex-preferences-test-'));assert.equal(path.dirname(resolved).toLowerCase(),(await fs.realpath(os.tmpdir())).toLowerCase());await fs.rm(resolved,{recursive:true,force:true});});
  const file=path.join(root,'update-preferences.json');
  assert.equal(await loadUpdatePreferences(file),true);
  await saveUpdatePreferences(file,false);
  assert.equal(await loadUpdatePreferences(file),false);
  assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),{automaticUpdateChecks:false});
  assert.deepEqual(await fs.readdir(root),['update-preferences.json']);
  await saveUpdatePreferences(file,true);
  assert.equal(await loadUpdatePreferences(file),true);
  for(const bad of ['false',0,null,{},[]])await assert.rejects(saveUpdatePreferences(file,bad),/inválida/);
  assert.equal(await loadUpdatePreferences(file),true);
  for(const content of ['invalid','{}','{"automaticUpdateChecks":"true"}','x'.repeat(1025)]){
    await fs.writeFile(file,content);assert.equal(await loadUpdatePreferences(file),false);
  }
});
