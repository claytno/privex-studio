'use strict';
const FLOOR_DB=-60;
function boundedDb(value){return typeof value==='number'&&Number.isFinite(value)?Math.max(FLOOR_DB,Math.min(0,value)):FLOOR_DB;}
function normalizeMeter(value){
 const configured=value?.configured===true;
 const receiving=configured&&value?.receiving===true;
 const muted=configured&&value?.muted===true;
 const state=!configured?'unconfigured':receiving?'receiving':value?.state==='waiting'?'waiting':'unavailable';
 return {configured,receiving,muted,state,inputDb:receiving?boundedDb(value.inputDb):FLOOR_DB,
  outputDb:receiving&&!muted?boundedDb(value.outputDb):FLOOR_DB,
  inputClipping:receiving&&value.inputClipping===true,outputClipping:receiving&&!muted&&value.outputClipping===true};
}
function normalizeAudioMeters(channels){return {microphone:normalizeMeter(channels?.microphone),desktop:normalizeMeter(channels?.desktop)};}
module.exports={FLOOR_DB,boundedDb,normalizeMeter,normalizeAudioMeters};
