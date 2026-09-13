import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {auditSource} from './audit-source.mjs';
function fixture(run){const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-public-audit-'));try{run(root);}finally{if(!path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unsafe fixture cleanup');fs.rmSync(root,{recursive:true,force:true});}}
test('source allowlist excludes server files even inside approved folders',()=>fixture(root=>{fs.mkdirSync(path.join(root,'shared/admin'),{recursive:true});fs.writeFileSync(path.join(root,'shared/admin/users.js'),'export default []');assert.throws(()=>auditSource(root),/rejected/);}));
test('source scan rejects credentials without printing their value',()=>fixture(root=>{fs.mkdirSync(path.join(root,'main'));fs.writeFileSync(path.join(root,'main/config.js'),'ghp_'+'a'.repeat(40));assert.throws(()=>auditSource(root),/Potential credential in main\/config.js/);}));
test('source archive includes only approved files and ignores local build output',()=>fixture(root=>{fs.mkdirSync(path.join(root,'main'));fs.mkdirSync(path.join(root,'build'));fs.writeFileSync(path.join(root,'main/main.cjs'),'module.exports={}');fs.writeFileSync(path.join(root,'build/debug.log'),'synthetic');assert.deepEqual(auditSource(root),['main/main.cjs']);}));
