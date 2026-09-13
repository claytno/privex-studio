import {invoke} from "./bridge.js";
let sessionId=null;
export function setSession(id){sessionId=id;}
async function request(method,path,body,options={}){
  if(options.signal?.aborted)throw new DOMException('Cancelado','AbortError');
  if(path==='/search')path=`/lives/${sessionId}/users?q=${encodeURIComponent(options.params?.q||'')}`;
  const data=await invoke('manager',{method,path,body});
  if(options.signal?.aborted)throw new DOMException('Cancelado','AbortError');
  return {data};
}
export default {get:(p,o)=>request('GET',p,undefined,o),post:(p,b,o)=>request('POST',p,b,o),put:(p,b,o)=>request('PUT',p,b,o),delete:(p,o)=>request('DELETE',p,undefined,o)};
