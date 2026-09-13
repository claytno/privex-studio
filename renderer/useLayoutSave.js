import {useEffect,useMemo,useState} from 'react';
import {createSceneSync} from './scene-sync.mjs';
import {invoke} from './bridge.js';

// Layout writes share the main command lock with capture. Keep the latest edit
// queued through temporary contention, and expose a failed save for manual retry.
export default function useLayoutSave(payload,accountId){
  const [state,setState]=useState({applying:false,appliedKey:'',error:''});
  const writer=useMemo(()=>createSceneSync({prepare:value=>invoke('layout.save',value),onState:setState,debounce:600}),[]);
  const key=payload?JSON.stringify(payload):'';
  useEffect(()=>{writer.update({scope:accountId||null,key,payload:key?JSON.parse(key):null,valid:!!accountId&&!!key,enabled:true,blocked:false});},[writer,key,accountId]);
  useEffect(()=>()=>writer.dispose(),[writer]);
  return {saving:state.applying,pending:!!key&&key!==state.appliedKey,error:state.error,retry:()=>writer.request()};
}
