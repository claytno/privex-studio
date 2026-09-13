import {useSyncExternalStore} from 'react';
let state={user:null};const listeners=new Set();
export function setUser(user){if(state.user?.id===user?.id)return;state={user};listeners.forEach(cb=>cb());}
export default function useAuthStore(selector){return useSyncExternalStore(cb=>{listeners.add(cb);return()=>listeners.delete(cb);},()=>selector(state));}
