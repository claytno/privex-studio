'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {boundedDb,normalizeAudioMeters}=require('../main/audio-meter.cjs');
test('meter dB values remain finite and bounded without exposing raw audio or source details',()=>{
 for(const [input,expected]of[[-Infinity,-60],[Infinity,-60],[NaN,-60],[-120,-60],[-18,-18],[0,0],[20,0],['-6',-60],[null,-60]])assert.equal(boundedDb(input),expected);
 const result=normalizeAudioMeters({microphone:{configured:true,receiving:true,inputDb:-6,outputDb:-12,inputClipping:true,rawAudio:[1,2,3],deviceId:'private'},other:{token:'private'}});
 assert.deepEqual(Object.keys(result),['microphone','desktop']);assert.equal(result.microphone.inputDb,-6);assert.equal(result.microphone.outputDb,-12);
 assert.ok(!JSON.stringify(result).includes('private'));assert.ok(!('rawAudio' in result.microphone));
});
test('input remains visible during mute, output and its clipping indication stay silent',()=>{
 const {microphone}=normalizeAudioMeters({microphone:{configured:true,receiving:true,muted:true,inputDb:0,outputDb:0,inputClipping:true,outputClipping:true}});
 assert.equal(microphone.inputDb,0);assert.equal(microphone.inputClipping,true);assert.equal(microphone.outputDb,-60);assert.equal(microphone.outputClipping,false);
});
test('silence, startup, unavailable callbacks and unconfigured devices are distinct',()=>{
 for(const [input,state,receiving]of[[{},'unconfigured',false],[{configured:true,state:'waiting'},'waiting',false],[{configured:true,receiving:false,state:'receiving',outputDb:0},'unavailable',false],[{configured:true,receiving:true,inputDb:-60,outputDb:-60},'receiving',true]]){
  const result=normalizeAudioMeters({desktop:input}).desktop;assert.equal(result.state,state);assert.equal(result.receiving,receiving);assert.equal(result.outputDb,-60);
 }
});
