const test=require('node:test');
const assert=require('node:assert/strict');
const load=()=>import('../renderer/scene-sync.mjs');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
async function fixture(prepare,retryLimit=3){
 const {createSceneSync}=await load();let time=0,id=0;const timers=new Map(),states=[];
 const sync=createSceneSync({prepare,onState:s=>states.push(s),retryLimit,now:()=>time,setTimer:(fn,delay)=>{const key=++id;timers.set(key,{fn,at:time+delay});return key},clearTimer:key=>timers.delete(key)});
 const advance=async(ms=250)=>{const target=time+ms;let safety=0;while(true){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>target)break;if(++safety>50)throw Error('Unbounded timer loop');time=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}time=target;await flush();};
 const update=(key,extra={})=>sync.update({scope:1,key,payload:{layers:key==='empty'?[]:[{kind:'text',text:key}]},valid:true,enabled:true,blocked:false,...extra});
 return{sync,advance,update,states,timers};
}
test('serialized latest-wins edits never mark a superseded scene as current',async()=>{
 const one=deferred(),three=deferred(),calls=[];const f=await fixture(payload=>{calls.push(payload);return calls.length===1?one.promise:three.promise});
 f.update('A');await f.advance();f.update('B');f.update('C');await f.advance();assert.equal(calls.length,1);
 one.resolve({});await flush();assert.equal(f.sync.status().appliedKey,'A');await f.advance();assert.deepEqual(calls.map(x=>x.layers[0].text),['A','C']);
 assert.equal(f.sync.status().appliedKey,'A');three.resolve({});await flush();assert.equal(f.sync.status().appliedKey,'C');f.sync.dispose();
});
test('temporary heartbeat lock retries the same composition, with a bounded stop and manual retry',async()=>{
 let failures=9,calls=0;const f=await fixture(async()=>{calls++;if(failures-->0)throw Object.assign(new Error('Ocupado'),{response:{status:423}})},2);
 f.update('A');await f.advance(10000);assert.equal(calls,3);assert.equal(f.sync.status().failedKey,'A');assert.equal(f.timers.size,0);
 f.update('A');await f.advance(10000);assert.equal(calls,3,'Polling cannot create an endless retry');failures=0;f.sync.request();await f.advance(0);assert.equal(calls,4);assert.equal(f.sync.status().appliedKey,'A');f.sync.dispose();
});
test('failed source replacement never blocks removing all sources to a black frame',async()=>{
 const calls=[];const f=await fixture(async payload=>{calls.push(payload);if(payload.layers.length)throw new Error('Fonte indisponível')});
 f.update('missing-camera');await f.advance();assert.equal(f.sync.status().failedKey,'missing-camera');f.update('empty');await f.advance();assert.deepEqual(calls.at(-1).layers,[]);assert.equal(f.sync.status().appliedKey,'empty');f.sync.dispose();
});
test('closing preview invalidates in-flight completion and prevents queued edits restarting capture',async()=>{
 const pending=deferred();let calls=0;const f=await fixture(()=>{calls++;return pending.promise});f.update('A');await f.advance();f.update('B');f.sync.suspend();pending.resolve({});await flush();await f.advance(5000);assert.equal(calls,1);assert.equal(f.sync.status().appliedKey,'');
 f.update('B',{enabled:false});f.sync.request();await f.advance(0);assert.equal(calls,2);f.sync.dispose();
});
test('account scope change discards old applied state and stale success',async()=>{
 const old=deferred(),calls=[];const f=await fixture(payload=>{calls.push(payload);return calls.length===1?old.promise:Promise.resolve({})});f.update('A');await f.advance();f.update('B',{scope:2,enabled:false});old.resolve({});await flush();await f.advance(5000);assert.equal(calls.length,1);assert.equal(f.sync.status().appliedKey,'');assert.equal(f.sync.status().appliedPayload,null);f.sync.request();await f.advance(0);assert.equal(f.sync.status().appliedKey,'B');f.sync.dispose();
});
test('an empty scene can be explicitly previewed but blocked state delays its IPC',async()=>{
 const calls=[];const f=await fixture(async x=>calls.push(x));f.update('empty',{enabled:false,blocked:true});f.sync.request();await f.advance(1000);assert.equal(calls.length,0);f.update('empty',{enabled:false,blocked:false});await f.advance();assert.deepEqual(calls,[{layers:[]}]);f.sync.dispose();
});
test('saved empty scenes, new scenes and a removed initial camera are never repopulated by discovery',async()=>{
 const {shouldSuggestInitialCamera:suggest}=await load();const initial={fresh:true,initialSceneId:'main',scene:{id:'main',layers:[]},alreadySuggested:false,camera:{id:'camera'}};
 assert.equal(suggest(initial),true);assert.equal(suggest({...initial,fresh:false}),false);assert.equal(suggest({...initial,alreadySuggested:true}),false);assert.equal(suggest({...initial,scene:{id:'new',layers:[]}}),false);assert.equal(suggest({...initial,camera:null}),false);
});
