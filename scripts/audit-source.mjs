import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const roots=new Set(['main','renderer','shared','engine','installer','scripts','tests','docs','.github']);
const documents=new Set(['.gitignore','package.json','package-lock.json','vite.config.mjs','README.md','LICENSE','NOTICE.md','PRIVACY.md','SECURITY.md','CONTRIBUTING.md','CODE_SIGNING_POLICY.md','BUILD.md','SOURCE-SCOPE.json']);
const generated=new Set(['.git','node_modules','build','ui','deps','test-results','oss-build-draft']);
const allowedExtensions=new Set(['.js','.jsx','.cjs','.mjs','.cpp','.h','.cs','.ps1','.txt','.md','.json','.html','.css','.ico','.pem','.yml','.yaml','.in','.rc','.iss']);
const secretPatterns=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\bcf[au]t_[A-Za-z0-9]{25,}/,/\bgh[pousr]_[A-Za-z0-9]{25,}/,/\bgithub_pat_[A-Za-z0-9_]{30,}/];
export function auditSource(root){
 root=path.resolve(root);const files=[];
 function visit(directory,prefix=''){
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
   if(!prefix&&generated.has(entry.name))continue;
   const relative=prefix+entry.name,absolute=path.join(directory,entry.name),stat=fs.lstatSync(absolute);
   if(stat.isSymbolicLink())throw Error('Source symlink rejected: '+relative);
   if(!prefix&&!roots.has(entry.name)&&!documents.has(entry.name))throw Error('Unapproved source root: '+relative);
   if(/(?:^|\/)(?:\.env[^/]*|\.git|app|database|storage|vendor|admin|config|routes)(?:\/|$)/i.test(relative)||/\.(?:pfx|p12|key|dpapi|sql|sqlite|db|log|dmp|exe|dll|zip|pdb)$/i.test(relative))throw Error('Private/generated source rejected: '+relative);
   if(stat.isDirectory()){visit(absolute,relative+'/');continue;}
   if(!stat.isFile()||stat.size>2000000)throw Error('Invalid source file: '+relative);
   if(!documents.has(relative)&&entry.name!=='CMakeLists.txt'&&!allowedExtensions.has(path.extname(relative)))throw Error('Unexpected source type: '+relative);
   if(relative.endsWith('.pem')&&relative!=='main/update-public-key.pem')throw Error('Unexpected key file');
   if(!relative.endsWith('.ico')){
    const text=fs.readFileSync(absolute,'utf8');
    if(secretPatterns.some(pattern=>pattern.test(text)))throw Error('Potential credential in '+relative);
    if(/C:[/\\](?:px(?:-staging)?|privex-runtime)(?:[/\\]|\b)/i.test(text))throw Error('Private workspace dependency in '+relative);
   }
   files.push(relative);
  }
 }
 visit(root);return files.sort();
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=path.resolve(process.argv[2]||path.join(path.dirname(fileURLToPath(import.meta.url)),'..'));
 try{console.log(JSON.stringify({passed:true,files:auditSource(root).length}));}catch(error){console.error(error.message);process.exitCode=1;}
}
