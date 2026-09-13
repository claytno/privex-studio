'use strict';
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
class Engine extends EventEmitter {
  constructor(executable) { super(); this.executable=executable; this.pending=new Map(); this.serial=0; this.child=null; this.closing=false; }
  open() {
    if (this.child) return;
    this.closing=false;const child=spawn(this.executable, [], { cwd:require('node:path').dirname(this.executable), windowsHide:true, stdio:['pipe','pipe','ignore'], env:{SystemRoot:process.env.SystemRoot,PATH:require('node:path').dirname(this.executable),TEMP:process.env.TEMP,APPDATA:process.env.APPDATA,LOCALAPPDATA:process.env.LOCALAPPDATA} });
    this.child=child; let buffer='';
    const fail=()=>{ if(this.child!==child)return; this.child=null; for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(new Error('O motor de vídeo foi interrompido. Prepare a câmera novamente.'));}this.pending.clear();if(!this.closing)this.emit('lost'); };
    child.on('error',fail);child.on('exit',fail);
    child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
      buffer+=chunk; if(buffer.length>1048576){child.kill();return;}
      let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);try{
        const msg=JSON.parse(line);if(msg.event){this.emit('status',msg);continue;}
        const item=this.pending.get(msg.id);if(!item)continue;clearTimeout(item.timer);this.pending.delete(msg.id);
        if(msg.ok)item.resolve(msg.result);else item.reject(new Error(typeof msg.error==='string'?msg.error:'Falha no equipamento.'));
      }catch{child.kill();return;}}
    });
  }
  request(command,data={}) {
    this.open(); if(this.pending.size>32)return Promise.reject(new Error('Aguarde o equipamento.'));
    return new Promise((resolve,reject)=>{const id=++this.serial;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('O equipamento não respondeu.'));this.child?.kill();},20000);this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({id,command,...data})+'\n',err=>{if(err){clearTimeout(timer);this.pending.delete(id);reject(new Error('Motor indisponível.'));}});});
  }
  async close(){if(!this.child)return;this.closing=true;try{await this.request('shutdown');}catch{}this.child?.kill();}
}
module.exports={Engine};
