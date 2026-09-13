// One native composition at a time. Edits made while IPC is pending replace the
// queued target; they never use source indexes from an older scene.
export function createSceneSync({prepare,onState=()=>{},setTimer=setTimeout,clearTimer=clearTimeout,now=Date.now,debounce=250,retryLimit=3}) {
  let desired=null,running=false,timer=null,generation=0,disposed=false,suspended=false,manual=false,appliedKey='',appliedPayload=null,failedKey='',failure='',retryKey='',retries=0,notBefore=0;
  const status=()=>({applying:running,appliedKey,appliedPayload,failedKey,error:failure,retrying:!!notBefore});
  const publish=()=>{if(!disposed)onState(status());};
  const eligible=()=>!suspended&&desired?.valid&&!desired.blocked&&(desired.enabled||manual)&&desired.key!==appliedKey&&desired.key!==failedKey;
  function schedule(delay=debounce){
    if(timer!==null){clearTimer(timer);timer=null;}
    if(disposed||running||!eligible())return;
    timer=setTimer(()=>{timer=null;void send();},Math.max(delay,notBefore-now(),0));
  }
  async function send(){
    if(disposed||running||!eligible())return;
    const target=desired,scope=generation;running=true;publish();
    try{
      await prepare(target.payload);
      if(scope!==generation||disposed)return;
      appliedKey=target.key;appliedPayload=target.payload;failedKey='';failure='';notBefore=0;retries=0;retryKey='';
      if(desired.key===target.key)manual=false;
    }catch(error){
      if(scope!==generation||disposed)return;
      // A failure for a superseded edit must not suppress the current scene.
      if(desired.key===target.key){
        if(retryKey!==target.key){retryKey=target.key;retries=0;}
        if(error?.response?.status===423&&retries<retryLimit){
          retries++;notBefore=now()+Math.min(3000,500*2**(retries-1));failure='';
        }else{failedKey=target.key;failure=error?.message||'Não foi possível aplicar a cena.';notBefore=0;manual=false;}
      }
    }finally{
      running=false;publish();schedule();
    }
  }
  return {
    update(next){
      if(disposed)return;
      const scopeChanged=desired&&desired.scope!==next.scope,keyChanged=desired?.key!==next.key;
      if(scopeChanged){generation++;suspended=false;manual=false;appliedKey='';appliedPayload=null;failedKey='';failure='';retryKey='';retries=0;notBefore=0;}
      else if(desired?.enabled&&!next.enabled){appliedKey='';}
      if(desired?.key!==next.key){failedKey='';failure='';retryKey='';retries=0;notBefore=0;}
      desired=next;
      // Avoid resetting the edit debounce on unrelated heartbeat snapshots.
      if(keyChanged||timer===null||!eligible())schedule();
      if(scopeChanged||keyChanged)publish();
    },
    request(){if(disposed||!desired?.valid)return;suspended=false;manual=true;failedKey='';failure='';retries=0;retryKey='';notBefore=0;publish();schedule(0);},
    suspend(){generation++;suspended=true;manual=false;appliedKey='';failedKey='';failure='';notBefore=0;if(timer!==null)clearTimer(timer);timer=null;publish();},
    dispose(){disposed=true;generation++;if(timer!==null)clearTimer(timer);timer=null;},
    status,
  };
}

export function shouldSuggestInitialCamera({fresh,initialSceneId,scene,alreadySuggested,camera}) {
  return !!(fresh&&camera&&scene&&scene.id===initialSceneId&&!scene.layers.length&&!alreadySuggested);
}
