import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Camera,Mic,Monitor,Radio,LogOut,MessageSquare,Gift,ArrowRight,ShieldCheck,RefreshCw,Square,Video,VolumeX,Image,Type,Eye,EyeOff,ChevronUp,ChevronDown,Trash2,Plus,Layers,AppWindow,Film,Pause,Play,Pencil,X,Check,Gamepad2,Copy} from 'lucide-react';
import LiveChatPanel from "../shared/pages/live/LiveChatPanel.jsx";
import LiveCommerceStudio from "../shared/pages/live/LiveCommerceStudio.jsx";
import {playInteractionSound,isSoundEnabled,setSoundEnabled} from './sound.js';
import {invoke} from "./bridge.js";import {setUser} from "./auth.js";import {setSession} from "./adapter.js";
import "./style.css";
import useLivePolling from "../shared/hooks/useLivePolling.js";
import {createSceneSync,shouldSuggestInitialCamera} from './scene-sync.mjs';
import useLayoutSave from './useLayoutSave.js';
const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((value||0)/100);
const CAPTURE=['camera','window','display','game'];
const KIND_LABELS={camera:'Câmera',window:'Janela / Jogo',display:'Tela inteira',game:'Jogo (captura antiga)',image:'Imagem',text:'Texto'};
// Deixe o jogo em janela (ou janela sem bordas em tela cheia) e escolha a janela dele aqui.
const GAME_HINT='Para transmitir um jogo, deixe o jogo em modo janela — ou janela sem bordas em tela cheia — e escolha a janela dele nesta lista. Em tela cheia exclusiva a imagem pode ficar preta.';
const KIND_ICONS={camera:Camera,window:AppWindow,display:Monitor,game:Gamepad2,image:Image,text:Type};
const DEFAULT_TRANSITION={style:'slide',durationMs:350};
const DEFAULT_LAYOUT={version:1,scenes:[{id:'principal',name:'Principal',layers:[]}],activeScene:'principal',microphoneId:'',desktopId:'',portrait:false,transition:DEFAULT_TRANSITION,fresh:true};
const TRANSITION_LABELS={slide:'Deslizar',fade:'Esmaecer',cut:'Corte'};
let uidCounter=0;const uid=()=>'l'+(++uidCounter)+'-'+Date.now().toString(36);
const withUid=layer=>({...layer,uid:uid(),fileName:layer.file?layer.file.split(/[\\/]/).pop():''});
const toSpec=layer=>({kind:layer.kind,id:layer.id,file:layer.file,text:layer.text,fit:layer.fit,corner:layer.corner,size:layer.size,visible:layer.visible!==false,name:layer.name||''});
const persistLayer=layer=>{const spec=toSpec(layer);for(const key of ['id','file','text'])if(spec[key]===undefined)delete spec[key];return spec;};
const toEngine=layer=>{const spec=persistLayer(layer);delete spec.name;return spec;};

function AudioSignalMeter({name,level,prepared}){
  const configured=prepared&&level?.configured,receiving=configured&&level?.receiving,muted=configured&&level?.muted;
  const input=receiving?Math.max(-60,Math.min(0,level.inputDb??-60)):-60,output=receiving&&!muted?Math.max(-60,Math.min(0,level.outputDb??-60)):-60;
  const label=!prepared?'Abra a prévia para testar':!configured?'Não selecionado':level.state==='waiting'?'Aguardando dispositivo':!receiving?'Sem dados — confira o dispositivo':muted?'Saída silenciada':input<=-60?'Silêncio':'Recebendo áudio';
  const clipping=receiving&&(level.inputClipping||(!muted&&level.outputClipping));
  const bar=(title,db)=> <div className="meter-row"><span>{title}</span><div className="meter-track" role="meter" aria-label={name+' · '+title} aria-valuemin={-60} aria-valuemax={0} aria-valuenow={db} aria-valuetext={db<=-60?'Abaixo de −60 dBFS':Math.round(db)+' dBFS'}><i className={db>=-3?'meter-red':db>=-12?'meter-yellow':'meter-green'} style={{transform:'scaleX('+((db+60)/60)+')'}}/></div><output>{db<=-60?'−∞':Math.round(db)}</output></div>;
  return <div className={'audio-signal'+(clipping?' is-clipping':'')} aria-label={'Medidor de '+name}><span className="meter-status">{label}</span>{bar('Entrada',input)}{bar('Saída',output)}{clipping&&<p className="meter-clip" role="status">{level.inputClipping?'Entrada no limite: reduza o ganho no dispositivo.':'Saída no limite: reduza o volume.'}</p>}</div>;
}
const ChannelMeter=React.memo(function ChannelMeter({name,channel,prepared}){
  const [levels,setLevels]=useState({});
  useEffect(()=>window.privex.onAudioMeters?.(setLevels),[]);
  useEffect(()=>{setLevels({});},[prepared]);
  return <AudioSignalMeter name={name} level={levels[channel]} prepared={prepared}/>;
});
function Revenue({sessionId}){const {data,error}=useLivePolling('/lives/'+sessionId+'/accounting',15000);return <section className="revenue-panel"><h3>Receita desta live</h3>{error?<p role="alert">{error}</p>:data?<><strong>{money(data.received?.net_cents)}</strong><p>{money(data.received?.gross_cents)} recebidos · {money(data.received?.refunded_cents)} devolvidos</p><p className="fine">Resumo da sessão. A comissão continua no saque; este valor não é uma carteira adicional.</p></>:<p>Consultando registros…</p>}</section>}

const statusNames={waiting:'Na fila',reserved:'Vaga disponível',starting:'Conectando',live:'Ao vivo',reconnecting:'Reconectando',ending:'Encerrando'};
const hiddenBounds={x:0,y:0,width:0,height:0};
function previewBounds(element){
  if(!element||document.hidden)return hiddenBounds;
  const rect=element.getBoundingClientRect();
  const covers=node=>{const box=node.getBoundingClientRect();return box.width>0&&box.height>0&&box.left<rect.right-.5&&box.right>rect.left+.5&&box.top<rect.bottom-.5&&box.bottom>rect.top+.5;};
  const obscured=[...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], dialog[open], [data-radix-popper-content-wrapper]')].some(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden'&&node.getAttribute('aria-hidden')!=='true'&&covers(node));
  if(obscured)return hiddenBounds;
  if(rect.width<1||rect.height<1||rect.left<0||rect.top<0||rect.right>innerWidth+.5||rect.bottom>innerHeight+.5)return hiddenBounds;
  for(let node=element.parentElement;node&&node!==document.body;node=node.parentElement){
    const style=getComputedStyle(node),clip=node.getBoundingClientRect();
    if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)return hiddenBounds;
    if(/auto|scroll|hidden|clip/.test(style.overflowY)&& (rect.top<clip.top-.5||rect.bottom>clip.bottom+.5))return hiddenBounds;
    if(/auto|scroll|hidden|clip/.test(style.overflowX)&& (rect.left<clip.left-.5||rect.right>clip.right+.5))return hiddenBounds;
  }
  const style=getComputedStyle(element),number=value=>Number.parseFloat(value)||0;
  const left=number(style.borderLeftWidth)+number(style.paddingLeft),right=number(style.borderRightWidth)+number(style.paddingRight),top=number(style.borderTopWidth)+number(style.paddingTop),bottom=number(style.borderBottomWidth)+number(style.paddingBottom);
  // The ratio the page itself was laid out with converts these to native pixels. Reading it here
  // keeps the preview in place when the window moves to a screen with different scaling.
  return{x:rect.x+left,y:rect.y+top,width:Math.max(0,rect.width-left-right),height:Math.max(0,rect.height-top-bottom),ratio:devicePixelRatio};
}
function UpdateBanner({info,blocked,run}){
  if(!info?.available&&info?.status!=='error')return null;
  const working=['downloading','installing'].includes(info.status);
  return <section className="update-banner" aria-label="Atualização do aplicativo"><div><strong>{info.status==='installing'?'Preparando instalação':info.status==='downloading'?'Baixando atualização':info.status==='error'?'Não foi possível atualizar':'Atualização disponível'}</strong><span>{info.status==='downloading'?`${Math.round(info.progress||0)}% baixado`:blocked?'Encerre sua live para atualizar com segurança.':`Privex Studio ${info.latestVersion||''}`}</span>{working&&<progress aria-label="Progresso da atualização" max="100" value={info.progress||0}/>}</div><button className="secondary" disabled={blocked||working} onClick={()=>run('updates.install')}>{working?'Aguarde…':info.status==='error'?'Tentar novamente':'Atualizar app'}</button></section>;
}
function UpdatePreferences({state,busy,run}){
  return <details className="update-preferences"><summary>Privacidade e atualizações</summary><label className="mt-3 flex min-h-11 items-center gap-3"><input type="checkbox" className="h-4 w-4 shrink-0 accent-purple-500" checked={state.automaticUpdateChecks!==false} disabled={busy||typeof state.automaticUpdateChecks!=='boolean'} onChange={event=>run('updates.automatic',{enabled:event.target.checked})}/><span>Consultar atualizações automaticamente</span></label><p className="mt-2 leading-relaxed">Consulta privex.site ao abrir e a cada 6 horas. O servidor recebe seu IP e dados técnicos da conexão. Esta consulta não envia sua conta nem a versão instalada. A instalação depende da sua confirmação.</p><p className="mt-2 leading-relaxed">Ao desativar, novas consultas só acontecem quando você verifica ou instala uma atualização manualmente.</p></details>;
}
/**
 * Avisa com som quem está no ar que chegou uma interação. O gatilho é o maior id de
 * interação da sessão, que já vem no estado do estúdio: nenhuma consulta extra.
 * O primeiro valor vira apenas o marco inicial, para não tocar ao abrir o gerenciador.
 */
function useInteractionAlert(sessionId,interactionSeq,enabled){
  const seen=useRef({sessionId:null,seq:0});
  useEffect(()=>{
    const seq=Number.isSafeInteger(interactionSeq)&&interactionSeq>0?interactionSeq:0;
    if(!sessionId||!enabled){seen.current={sessionId:null,seq:0};return;}
    if(seen.current.sessionId!==sessionId){seen.current={sessionId,seq};return;}
    if(seq>seen.current.seq){seen.current={sessionId,seq};playInteractionSound();}
  },[sessionId,interactionSeq,enabled]);
}
function App(){
  const [state,setState]=useState({}),[error,setError]=useState(''),[title,setTitle]=useState(''),[mic,setMic]=useState(''),[desktop,setDesktop]=useState(''),[micLevel,setMicLevel]=useState(100),[desktopLevel,setDesktopLevel]=useState(100),[deviceError,setDeviceError]=useState(''),[portrait,setPortrait]=useState(false),[devices,setDevices]=useState(null),[tab,setTab]=useState('chat'),[muted,setMuted]=useState(false),[localBusy,setLocalBusy]=useState(false),[alertSound,setAlertSound]=useState(isSoundEnabled),[titleEdit,setTitleEdit]=useState(false),[transition,setTransition]=useState(DEFAULT_TRANSITION),[sceneEdit,setSceneEdit]=useState(false);
  const [scenes,setScenes]=useState([]),[activeScene,setActiveScene]=useState(''),[selected,setSelected]=useState(null),[adding,setAdding]=useState(false),[syncState,setSyncState]=useState({applying:false,appliedKey:'',failedKey:'',error:'',retrying:false}),[previewError,setPreviewError]=useState('');
  const [sourceNotice,setSourceNotice]=useState('');
  const preview=useRef(null),deviceScan=useRef(false),initialDevices=useRef({camera:false,microphone:false}),volumeCommit=useRef(false),audioState=useRef({microphone:100,desktop:100}),layoutLoaded=useRef(false),layoutFresh=useRef(false),initialScene=useRef(''),autoOpened=useRef(false),suggestedScenes=useRef(new Set()),editScope=useRef({}),accountScope=useRef(null),rate=useRef({bytes:0,at:0,kbps:0});
  const synchronizer=useMemo(()=>createSceneSync({prepare:payload=>invoke('prepare',payload),onState:setSyncState}),[]);
  useEffect(()=>()=>synchronizer.dispose(),[synchronizer]);
  const applying=syncState.applying;
  const session=state.studio?.session;const owned=session?.managed_by_device;const displayStatus=session?.status==='live'&&!session.media_ready?'starting':session?.status;const busy=localBusy||state.busy||applying;const sessionActive=!!session&&['waiting','reserved','starting','live','reconnecting','ending'].includes(session.status);const active=owned&&sessionActive;const displayPortrait=state.prepared?(state.canvasPortrait??portrait):portrait;
  useInteractionAlert(owned?session.id:null,session?.interaction_seq,active);
  // Enquanto não há live, o campo é o título da próxima; durante a live ele mostra o título atual.
  useEffect(()=>{if(active&&session?.title&&!titleEdit)setTitle(session.title);},[active,session?.title,titleEdit]);
  const update=value=>{audioState.current={microphone:value.microphoneVolume??100,desktop:value.desktopVolume??100};setUser(value.user);setSession(value.studio?.session?.managed_by_device?value.studio.session.id:null);setMuted(!!value.muted);setState(value);};
  useEffect(()=>{invoke('snapshot').then(update);const cleanup=window.privex.onState(update);const timer=setInterval(()=>invoke('snapshot').then(update).catch(()=>{}),5000);return()=>{cleanup();clearInterval(timer);};},[]);
  useLayoutEffect(()=>{
    if(!state.prepared||!preview.current)return;
    let timer,disposed=false,pending=Promise.resolve(),revision=0,lastGeometry='';
    const send=bounds=>{const version=++revision;pending=pending.catch(()=>{}).then(()=>{if(disposed||version!==revision)return;return invoke('bounds',bounds);}).then(()=>{if(!disposed&&bounds.width)setPreviewError('');}).catch(e=>{if(!disposed&&bounds.width)setPreviewError('A prévia não pôde ser posicionada: '+(e?.message||'erro desconhecido'));});};
    const resize=()=>{const bounds=previewBounds(preview.current),geometry=JSON.stringify(bounds);if(geometry===lastGeometry)return;lastGeometry=geometry;clearTimeout(timer);send(hiddenBounds);if(bounds.width)timer=setTimeout(()=>{if(!disposed)send(previewBounds(preview.current));},70);};
    const observer=new ResizeObserver(resize);observer.observe(preview.current);observer.observe(document.documentElement);
    const mutation=new MutationObserver(resize);mutation.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['role','aria-hidden','open','data-state','class','style']});
    window.addEventListener('resize',resize);document.addEventListener('scroll',resize,true);document.addEventListener('visibilitychange',resize);window.visualViewport?.addEventListener('resize',resize);resize();
    return()=>{disposed=true;revision++;clearTimeout(timer);observer.disconnect();mutation.disconnect();window.removeEventListener('resize',resize);document.removeEventListener('scroll',resize,true);document.removeEventListener('visibilitychange',resize);window.visualViewport?.removeEventListener('resize',resize);void invoke('bounds',hiddenBounds).catch(()=>{});};
  },[state.prepared,displayPortrait]);
  async function run(name,data){setError('');setLocalBusy(true);try{return await invoke(name,data);}catch(e){setError(e.message);}finally{setLocalBusy(false);}}
  // Saved scenes arrive with the first snapshot; a missing layout (older host) behaves like a fresh installation.
  useEffect(()=>{
    if(accountScope.current!==state.user?.id){accountScope.current=state.user?.id;layoutLoaded.current=false;autoOpened.current=false;initialDevices.current={camera:false,microphone:false};suggestedScenes.current=new Set();setScenes([]);setActiveScene('');setMic('');setDesktop('');setPortrait(false);setSelected(null);setAdding(false);setSceneEdit(false);setDevices(null);setError('');setSourceNotice('');}
    if(layoutLoaded.current||!state.user)return;const layout=state.layout||DEFAULT_LAYOUT;layoutLoaded.current=true;layoutFresh.current=layout.fresh===true||!state.layout;initialScene.current=layout.activeScene;
    setScenes(layout.scenes.map(scene=>({...scene,layers:scene.layers.map(withUid)})));setActiveScene(layout.activeScene);setMic(layout.microphoneId||'');setDesktop(layout.desktopId||'');setPortrait(!!layout.portrait);setTransition(TRANSITION_LABELS[layout.transition?.style]?{style:layout.transition.style,durationMs:layout.transition.durationMs}:DEFAULT_TRANSITION);
    if(layout.microphoneId)initialDevices.current.microphone=true;
  },[state.user?.id,state.layout]);
  const scene=scenes.find(item=>item.id===activeScene)||scenes[0];const layers=scene?.layers||[];
  editScope.current={userId:state.user?.id,sceneId:scene?.id,selected};
  const patchScene=(id,change)=>setScenes(current=>current.map(item=>item.id===id?{...item,...change(item)}:item));
  const setLayers=updater=>{if(scene)patchScene(scene.id,item=>({layers:updater(item.layers)}));};
  const patchLayer=(layerUid,change)=>setLayers(list=>list.map(layer=>layer.uid===layerUid?{...layer,...change}:layer));
  async function enumerate(){
    if(deviceScan.current)return;deviceScan.current=true;
    const userId=state.user?.id;
    try{const data=await invoke('enumerate');if(editScope.current.userId!==userId)return;setDevices(data);setDeviceError('');const firstMic=data.microphones?.find(item=>item.id==='default')?.id??data.microphones?.[0]?.id;if(layoutFresh.current&&!initialDevices.current.microphone&&firstMic!=null){initialDevices.current.microphone=true;setMic(String(firstMic));}}
    catch(e){if(e?.response?.status!==423)setDeviceError(e.message);}finally{deviceScan.current=false;}
  }
  useEffect(()=>{if(!state.user)return;void enumerate();const timer=setInterval(()=>{if(!document.hidden)void enumerate();},15000);const refresh=()=>void enumerate();window.addEventListener('focus',refresh);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};},[state.user?.id]);
  // First run: suggest the first camera as the only source. The capture only starts when the user opens the preview.
  useEffect(()=>{
    const firstCamera=devices?.cameras?.[0];
    if(!shouldSuggestInitialCamera({fresh:layoutFresh.current,initialSceneId:initialScene.current,scene,alreadySuggested:suggestedScenes.current.has(scene?.id),camera:firstCamera}))return;
    suggestedScenes.current.add(scene.id);initialDevices.current.camera=true;setLayers(()=>[withUid({kind:'camera',id:String(firstCamera.id),fit:'fit',corner:'br',size:.3,visible:true,name:''})]);
  },[devices,scene?.id]);
  useEffect(()=>{setMicLevel(state.microphoneVolume??100);setDesktopLevel(state.desktopVolume??100);},[state.microphoneVolume,state.desktopVolume]);
  const listFor=kind=>kind==='camera'?devices?.cameras:kind==='window'?devices?.windows:kind==='display'?devices?.displays:kind==='game'?devices?.games:null;
  const available=(items,id)=>!id||(items||[]).some(item=>String(item.id??item.value)===id);
  const deviceName=(kind,id)=>{const item=(listFor(kind)||[]).find(entry=>String(entry.id??entry.value)===id);return item?item.name??item.label:'';};
  const layerMissing=layer=>CAPTURE.includes(layer.kind)&&(!layer.id||!!devices&&!available(listFor(layer.kind),layer.id));
  const layerLabel=layer=>layer.name||(CAPTURE.includes(layer.kind)?deviceName(layer.kind,layer.id):layer.kind==='image'?layer.fileName:layer.text)||KIND_LABELS[layer.kind];
  const missingMic=!!devices&&!available(devices.microphones,mic),missingDesktop=!!devices&&!available(devices.desktops,desktop);
  const missingLayers=layers.filter(layerMissing);
  // The scene identity is part of the composition: changing scene applies the new canvas even when
 // the two scenes hold the same sources, and that is what the engine animates.
  const composition=useMemo(()=>JSON.stringify({scene:scene?.id||'',layers:layers.map(toEngine),mic,desktop,portrait,transition}),[scene?.id,layers,mic,desktop,portrait,transition]);
  const canApply=!!state.user&&accountScope.current===state.user.id&&layoutLoaded.current&&!!scene&&!missingLayers.length&&(!layers.length||!missingMic&&!missingDesktop);
  useLayoutEffect(()=>{
    synchronizer.update({scope:state.user?.id,key:composition,payload:{sceneId:scene?.id,transition,layers:layers.map(toEngine),microphoneId:mic,desktopId:desktop,portrait},valid:canApply,enabled:!!state.prepared,blocked:!!(localBusy||state.busy)});
  },[composition,canApply,scene?.id,state.user?.id,state.prepared,localBusy,state.busy,synchronizer]);
  const apply=()=>{setError('');synchronizer.request();};
  // Once a person has used the preview on this computer it opens by itself on the next launches, before any live.
  useEffect(()=>{
    if(autoOpened.current||state.prepared||!layoutLoaded.current||layoutFresh.current||!devices||!canApply||busy||applying||state.transmitting||sessionActive)return;
    autoOpened.current=true;void apply();
  },[devices,canApply,busy,applying,state.prepared,state.transmitting,sessionActive]);
  async function closePreview(){autoOpened.current=true;synchronizer.suspend();await run('preview.close');}
  const layoutPayload=state.user&&accountScope.current===state.user.id&&layoutLoaded.current&&scenes.length?{scenes:scenes.map(item=>({id:item.id,name:item.name,layers:item.layers.map(persistLayer)})),activeScene:scene?.id||scenes[0].id,microphoneId:mic,desktopId:desktop,portrait,transition}:null;
  const layoutSave=useLayoutSave(layoutPayload,state.user?.id);
  useEffect(()=>{
    const bytes=state.mediaStatus?.totalBytes;if(!state.transmitting||typeof bytes!=='number'){rate.current={bytes:0,at:0,kbps:0};return;}
    const now=Date.now();if(rate.current.at&&now>rate.current.at){rate.current.kbps=Math.max(0,Math.round((bytes-rate.current.bytes)*8/(now-rate.current.at)));}
    rate.current.bytes=bytes;rate.current.at=now;
  },[state.mediaStatus?.totalBytes,state.transmitting]);
  const restoreVolume=()=>{if(!volumeCommit.current){setMicLevel(audioState.current.microphone);setDesktopLevel(audioState.current.desktop);}};
  async function saveVolume(channel,volume){
    if(volumeCommit.current)return;volumeCommit.current=true;
    try{const result=await run('volume',{channel,volume});if(result===undefined){setMicLevel(audioState.current.microphone);setDesktopLevel(audioState.current.desktop);}}
    finally{volumeCommit.current=false;}
  }
  const options=(items)=>(items||[]).map(item=><option key={item.id??item.value} value={item.id??item.value}>{item.name??item.label}</option>);
  async function addLayer(kind){
    const scope={...editScope.current};
    suggestedScenes.current.add(scope.sceneId);
    setAdding(false);if(layers.length>=6){setError('A cena aceita até 6 fontes.');return;}
    const overlayDefault=layers.length>0&&(kind==='camera'||kind==='image'||kind==='text');
    let layer={kind,fit:overlayDefault?'corner':'fit',corner:kind==='text'?'bl':kind==='image'?'tr':'br',size:kind==='text'?.4:.3,visible:true,name:''};
    if(CAPTURE.includes(kind)){const first=listFor(kind)?.[0];layer.id=first!=null?String(first.id):'';}
    else if(kind==='image'){const picked=await run('image.pick');if(!picked)return;layer.file=picked.file;}
    else layer.text='Sua mensagem';
    if(editScope.current.userId!==scope.userId||editScope.current.sceneId!==scope.sceneId)return;
    const created=withUid(layer);patchScene(scope.sceneId,item=>({layers:item.layers.length<6?[created,...item.layers]:item.layers}));setSelected(created.uid);if(kind==='camera')initialDevices.current.camera=true;
  }
  async function replaceImage(layer){
    const scope={...editScope.current},picked=await run('image.pick');
    if(!picked||editScope.current.userId!==scope.userId||editScope.current.sceneId!==scope.sceneId||editScope.current.selected!==scope.selected)return;
    patchScene(scope.sceneId,item=>({layers:item.layers.map(current=>current.uid===layer.uid?{...current,file:picked.file,fileName:picked.name}:current)}));
  }
  const toggleLayer=layer=>setLayers(list=>list.map(item=>item.uid===layer.uid?{...item,visible:item.visible===false}:item));
  const moveLayer=(layer,delta)=>setLayers(list=>{const index=list.findIndex(item=>item.uid===layer.uid),target=index+delta;if(target<0||target>=list.length)return list;const copy=[...list];[copy[index],copy[target]]=[copy[target],copy[index]];return copy;});
  const removeLayer=layer=>{
    suggestedScenes.current.add(scene?.id);
    if(layers.length===1&&(missingMic||missingDesktop)&&syncState.appliedPayload){setMic(syncState.appliedPayload.microphoneId);setDesktop(syncState.appliedPayload.desktopId);setSourceNotice('Removendo a última fonte. A seleção de áudio anterior foi mantida para aplicar o quadro preto; confira os medidores.');}
    else setSourceNotice('');
    setLayers(list=>list.filter(item=>item.uid!==layer.uid));if(selected===layer.uid)setSelected(null);
  };
  // A new scene starts empty: two scenes never share what the other shows unless you duplicate it.
  const openScene=()=>{setSelected(null);setAdding(false);setSceneEdit(true);};
  const addScene=(copyFrom=null)=>{const id='cena-'+uid();suggestedScenes.current.add(id);setSceneEdit(false);setScenes(list=>[...list,{id,name:copyFrom?'Cópia de '+copyFrom.name:'Cena '+(list.length+1),layers:(copyFrom?.layers||[]).map(layer=>withUid(persistLayer(layer)))}]);setActiveScene(id);setSelected(null);setAdding(false);};
  const removeScene=item=>{if(scenes.length<2)return;setScenes(list=>list.filter(entry=>entry.id!==item.id));if(activeScene===item.id){setActiveScene(scenes.find(entry=>entry.id!==item.id).id);setSelected(null);setAdding(false);setSceneEdit(false);}};
  const selectedLayer=layers.find(layer=>layer.uid===selected)||null;
  const layerReady=index=>state.prepared&&state.mediaStatus?.layers?.[index]?.ready;
  // The capture stopped delivering (alt-tab, minimized window, game closed) and the last frame is held.
  const layerHolding=index=>!!state.prepared&&state.mediaStatus?.layers?.[index]?.holding===true;
  const inSync=syncState.appliedKey===composition;
  if(!state.user)return <main className="welcome">
    <header className="brand"><span className="brand-mark">p<span>×</span></span> Privex <b>Studio</b><small>BETA</small></header>
    <UpdateBanner info={state.updateInfo} blocked={!!(busy||state.transmitting||sessionActive)} run={run}/>
    <div className="welcome-grid"><section><p className="eyebrow">SEU ESPAÇO PARA TRANSMITIR</p><h1>Sua live.<br/>Do seu jeito.</h1><p className="welcome-copy">Câmera, tela, imagens e texto na mesma cena. Chat e interações ao lado. Entre na sua conta Privex para preparar sua transmissão.</p><div className="feature-row"><span><Camera size={18}/> Câmera e tela</span><span><Layers size={18}/> Cenas com várias fontes</span><span><MessageSquare size={18}/> Chat integrado</span><span><Gift size={18}/> Metas e presentes</span></div></section>
    <section className="login-card"><div className="login-icon"><Radio size={32}/></div><h2>{state.pendingAccount?'Confirme sua conta':'Entrar com Privex'}</h2>
      {state.pendingAccount?<><p>Confira qual conta foi autorizada neste computador. Confirme a conta que você quer usar.</p><div className="pending-account"><strong>{state.pendingAccount.name||state.pendingAccount.username}</strong><span>@{state.pendingAccount.username}</span></div><button className="primary" disabled={busy} onClick={()=>run('account.confirm')}>Continuar como @{state.pendingAccount.username} <ArrowRight size={18}/></button><button className="secondary account-switch" disabled={busy} onClick={()=>run('account.switch')}>Usar outra conta</button></>:<><p>Você confirma a conexão no site oficial. Sua senha fica no Privex.</p>{state.authorization?<><p className="code">{state.authorization.code}</p><p role="status">Confira este código no navegador e autorize este computador.</p><button className="secondary" disabled={busy} onClick={()=>run('login.cancel')}>Cancelar conexão</button></>:<button className="primary" disabled={busy} onClick={()=>run('login')}>Conectar minha conta <ArrowRight size={18}/></button>}</>}
      <p className="fine"><ShieldCheck size={15}/> Para contas ativas e verificadas. Câmera e microfone só são ligados após sua escolha.</p>{(error||state.error)&&<p className="error" role="alert">{error||state.error}</p>}<button className="text-button" onClick={()=>run('terms')}>Termos e condições</button>
      <UpdatePreferences state={state} busy={busy} run={run}/>
    </section></div><footer>Privex Studio {state.version} · Windows · Beta <button className="text-button" disabled={busy} onClick={()=>run('updates.check')}>Verificar atualização</button>{state.notice&&<p role="status">{state.notice}</p>}</footer>
  </main>;
  const previewMessage=!state.prepared?(layers.length?'Clique em Abrir prévia para ligar a captura. A prévia aparece aqui antes de você entrar ao vivo.':'Adicione fontes ou abra a prévia com um quadro preto. O áudio usa os dispositivos selecionados.'):'';
  return <main className="studio"><header className="topbar"><div className="brand"><span className="brand-mark">p<span>×</span></span> Privex <b>Studio</b><small>BETA</small></div><span className={`signal ${displayStatus==='live'?'is-live':''}`}><i/>{statusNames[displayStatus]||'Fora do ar'}</span><div className="account"><button className="text-button" disabled={busy||sessionActive||state.transmitting} onClick={()=>run('updates.check')}>Atualizações</button><span>@{state.user.username}</span><button title="Sair da conta" aria-label="Sair da conta" disabled={busy||active} onClick={()=>run('logout')}><LogOut size={18}/></button></div></header>
    <UpdateBanner info={state.updateInfo} blocked={!!(sessionActive||state.transmitting||busy)} run={run}/>
    <div className="workspace"><section className="production">
      <div className="preview-shell"><div className="preview-stage"><div ref={preview} className={displayPortrait?'preview is-portrait':'preview'}>{!state.prepared&&<div className="preview-empty"><Video size={34}/><h2>{layers.length?'Prévia desligada':'Monte sua cena'}</h2><p>{previewMessage}</p></div>}</div></div>
        <div className="preview-caption"><span>{state.transmitting?'AO VIVO · este é exatamente o vídeo enviado':state.prepared?'PRÉVIA LOCAL · ninguém está assistindo ainda':'PRÉVIA DESLIGADA · nenhuma captura ativa'}</span><span className="format-badge">{displayPortrait?'9:16 vertical':'16:9 horizontal'}</span></div></div>
      <div className="toolbar">
        {state.prepared&&!sessionActive&&<button className="secondary" disabled={busy} onClick={closePreview}><Square size={14}/> Fechar prévia</button>}
        {state.prepared?<span className={'apply-state'+(applying?' is-working':'')} role="status">{applying?'Aplicando…':syncState.retrying?'Aguardando o motor de vídeo…':syncState.failedKey===composition?'Cena não aplicada':inSync?(layers.length?'Cena aplicada':'Quadro preto aplicado'):missingLayers.length||missingMic||missingDesktop?'Equipamento desconectado':'Aplicando alterações…'}</span>:<button className="primary" disabled={busy||!canApply} onClick={apply}><Play size={16}/> Abrir prévia</button>}
        <label className="inline-field">Formato<select aria-label="Formato" disabled={busy||state.transmitting} value={portrait?'portrait':'landscape'} onChange={e=>setPortrait(e.target.value==='portrait')}><option value="landscape">16:9 horizontal</option><option value="portrait">9:16 vertical</option></select></label>
        <button className={state.sceneMode==='pause'?'muted-button':'secondary'} disabled={!state.prepared||busy} onClick={()=>run('scene',{mode:state.sceneMode==='pause'?'live':'pause'})}>{state.sceneMode==='pause'?<><Play size={15}/> Voltar da pausa</>:<><Pause size={15}/> Pausa</>}</button>
        <button className={muted?'muted-button':'secondary'} disabled={!state.prepared||busy} onClick={async()=>{const result=await run('mute',{muted:!muted});if(result!==undefined)setMuted(!muted);}}>{muted?<VolumeX size={15}/>:<Mic size={15}/>} {muted?'Mic silenciado':'Silenciar mic'}</button>
        <label className="fine check"><input type="checkbox" checked={!!state.overlayEnabled} disabled={!owned||busy} onChange={e=>run('overlay',{enabled:e.target.checked})}/> Meta no vídeo</label>
      </div>
      {(error||syncState.error||state.error)&&<p role="alert" className="error">{error||syncState.error||state.error}</p>}{state.prepared&&previewError&&<p role="alert" className="error">{previewError}</p>}{syncState.failedKey===composition&&<button className="secondary" disabled={busy||!canApply} onClick={apply}><RefreshCw size={14}/> Tentar aplicar cena novamente</button>}{state.notice&&!error&&!syncState.error&&<p role="status" className="notice">{state.notice}</p>}
      {sourceNotice&&<p role="status" className="notice">{sourceNotice}</p>}
      {deviceError&&<p className="warning" role="status">Não foi possível atualizar os equipamentos: {deviceError}</p>}{(missingLayers.length>0||missingMic||missingDesktop)&&<p className="warning" role="status">Um equipamento selecionado foi desconectado. Reconecte ou escolha outro. A captura não troca para outro dispositivo automaticamente.</p>}
      {session&&!owned&&<p className="warning">Há uma live em outro dispositivo. Gerencie pelo site antes de iniciar aqui.</p>}
      <div className="docks">
        <section className="dock dock-scenes" aria-label="Cenas"><header><h3><Film size={14}/> Cenas</h3><button className="icon-button" aria-label="Nova cena" title="Nova cena, sem fontes" disabled={scenes.length>=12} onClick={()=>addScene()}><Plus size={15}/></button></header>
          <ul className="scene-list">{scenes.map(item=><li key={item.id} className={item.id===scene?.id?'is-active':''}><button className="scene-button" onClick={()=>{setActiveScene(item.id);setSelected(null);}} onDoubleClick={()=>{setActiveScene(item.id);openScene();}}>{item.name}</button>{item.id===scene?.id&&<button className="icon-button" aria-label="Editar cena" title="Nome, troca de cena, duplicar e remover" onClick={openScene}><Pencil size={13}/></button>}</li>)}</ul>
          <p className="dock-hint">Clique para trocar, inclusive ao vivo. Cada cena tem suas próprias fontes. O lápis abre o nome, a troca de cena e as cópias.</p>{layoutSave.error?<div className="dock-hint" role="alert">Não foi possível salvar as cenas: {layoutSave.error}<button className="text-button" onClick={layoutSave.retry}>Tentar salvar novamente</button></div>:layoutSave.pending&&<p role="status" className="dock-hint">Salvando alterações…</p>}
        </section>
        <section className="dock dock-sources" aria-label="Fontes"><header><h3><Layers size={14}/> Fontes</h3><div className="dock-actions"><button className="icon-button" aria-label={devices?'Atualizar equipamentos':'Buscar equipamentos'} title={devices?'Atualizar lista de equipamentos':'Buscar equipamentos'} disabled={busy} onClick={enumerate}><RefreshCw size={14}/></button><button className="icon-button" aria-label="Adicionar fonte" aria-expanded={adding} disabled={busy||layers.length>=6} onClick={()=>setAdding(value=>!value)}><Plus size={15}/></button></div></header>
          {adding&&<p className="dock-hint">{GAME_HINT}</p>}
          {adding&&<div className="add-panel">{['camera','window','display','image','text'].map(kind=>{const Icon=KIND_ICONS[kind];return <button key={kind} className="secondary" onClick={()=>addLayer(kind)}><Icon size={14}/> {KIND_LABELS[kind]}</button>;})}</div>}
          {layers.length?<ul className="layer-list">{layers.map((layer,index)=>{const Icon=KIND_ICONS[layer.kind],missing=layerMissing(layer);return <li key={layer.uid} className={(layer.uid===selected?'is-selected':'')+(layer.visible===false?' is-hidden':'')}>
            <button className="layer-main" onClick={()=>setSelected(layer.uid===selected?null:layer.uid)}><Icon size={14}/><span className="layer-name">{layerLabel(layer)}</span>{missing?<span className="layer-flag is-missing">desconectado</span>:state.prepared&&inSync&&layer.visible!==false&&layerHolding(index)?<span className="layer-flag" title="A captura parou de enviar imagem; o último quadro continua no ar.">quadro congelado</span>:state.prepared&&inSync&&layer.visible!==false&&layerReady(index)===false?<span className="layer-flag">{layer.kind==='game'?'aguardando o jogo':'sem sinal'}</span>:null}</button>
            <button className="icon-button" aria-label={layer.visible===false?'Mostrar fonte':'Ocultar fonte'} aria-pressed={layer.visible!==false} onClick={()=>toggleLayer(layer)}>{layer.visible===false?<EyeOff size={14}/>:<Eye size={14}/>}</button>
            <button className="icon-button" aria-label="Trazer para frente" disabled={index===0} onClick={()=>moveLayer(layer,-1)}><ChevronUp size={14}/></button>
            <button className="icon-button" aria-label="Enviar para trás" disabled={index===layers.length-1} onClick={()=>moveLayer(layer,1)}><ChevronDown size={14}/></button>
            <button className="icon-button" aria-label="Remover fonte" onClick={()=>removeLayer(layer)}><Trash2 size={14}/></button></li>;})}</ul>:<div className="dock-empty"><p>Nenhuma fonte ainda. O que vai aparecer no vídeo?</p><div className="quick-add">{['camera','game','display','window'].map(kind=>{const Icon=KIND_ICONS[kind];return <button key={kind} className="secondary" disabled={busy} onClick={()=>addLayer(kind)}><Plus size={13}/><Icon size={14}/> {KIND_LABELS[kind]}</button>;})}</div>{devices&&!devices.cameras?.length&&<p className="fine">Nenhuma câmera encontrada. Feche outros programas que usam a câmera e clique em Atualizar equipamentos.</p>}</div>}
        </section>
        <section className="dock dock-audio" aria-label="Áudio">
          <header><h3><Mic size={14}/> Áudio</h3><label className="fine check" title="Toca um aviso curto neste computador quando alguém compra uma interação. Com o microfone aberto perto da caixa de som, o público pode ouvir."><input type="checkbox" checked={alertSound} onChange={e=>{setSoundEnabled(e.target.checked);setAlertSound(e.target.checked);if(e.target.checked)playInteractionSound();}}/> Aviso de interação</label></header>
          <div className="audio-channels">
            <div className="audio-channel"><label>Microfone<select aria-label="Microfone" disabled={busy||!devices} value={mic} onChange={e=>{initialDevices.current.microphone=true;setMic(e.target.value);}}><option value="">Sem microfone</option>{missingMic&&<option value={mic}>Microfone desconectado</option>}{options(devices?.microphones)}</select></label>
              <ChannelMeter name="Microfone" channel="microphone" prepared={!!state.prepared}/>
              <label className="volume"><span>Volume <strong>{micLevel}%</strong></span><input aria-label="Volume do microfone" type="range" min="0" max="100" step="1" value={micLevel} disabled={!state.prepared||busy} onBlur={restoreVolume} onPointerCancel={restoreVolume} onChange={e=>setMicLevel(Number(e.target.value))} onPointerUp={e=>saveVolume('microphone',Number(e.currentTarget.value))} onKeyUp={e=>saveVolume('microphone',Number(e.currentTarget.value))}/></label></div>
            <div className="audio-channel"><label>Computador<select aria-label="Áudio do computador" disabled={busy||!devices} value={desktop} onChange={e=>setDesktop(e.target.value)}><option value="">Não compartilhar</option>{missingDesktop&&<option value={desktop}>Saída desconectada</option>}{options(devices?.desktops)}</select></label>
              <ChannelMeter name="Computador" channel="desktop" prepared={!!state.prepared}/>
              <label className="volume"><span>Volume <strong>{desktopLevel}%</strong></span><input aria-label="Volume do computador" type="range" min="0" max="100" step="1" value={desktopLevel} disabled={!state.prepared||busy} onBlur={restoreVolume} onPointerCancel={restoreVolume} onChange={e=>setDesktopLevel(Number(e.target.value))} onPointerUp={e=>saveVolume('desktop',Number(e.currentTarget.value))} onKeyUp={e=>saveVolume('desktop',Number(e.currentTarget.value))}/></label></div>
          </div>
          {desktop&&<p className="dock-hint">O áudio do computador inclui outros apps e notificações. Use fones e silencie o player da sua própria live para evitar eco.</p>}
        </section>
      {sceneEdit&&scene&&<><div className="sheet-backdrop" onClick={()=>setSceneEdit(false)}/><div className="layer-dialog" role="dialog" aria-modal="true" aria-label="Ajustes da cena" onKeyDown={e=>{if(e.key==='Escape')setSceneEdit(false);}}>
        <header><h3><Film size={15}/> {scene.name}</h3><span className="dock-hint">as mudanças valem na hora</span><button className="icon-button" aria-label="Fechar ajustes da cena" onClick={()=>setSceneEdit(false)}><X size={16}/></button></header>
        <div className="layer-props">
          <label>Nome<input autoFocus aria-label="Nome da cena" maxLength={40} value={scene.name} onChange={e=>patchScene(scene.id,()=>({name:e.target.value}))} onBlur={e=>{if(!e.target.value.trim())patchScene(scene.id,item=>({name:'Cena '+(scenes.indexOf(item)+1)}));}}/></label>
          <label>Troca de cena<select aria-label="Transição entre cenas" value={transition.style} onChange={e=>setTransition(current=>({...current,style:e.target.value}))}>{Object.entries(TRANSITION_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
          {transition.style!=='cut'&&<label>Tempo da troca<select aria-label="Duração da transição" value={transition.durationMs} onChange={e=>setTransition(current=>({...current,durationMs:Number(e.target.value)}))}><option value={200}>Rápida</option><option value={350}>Média</option><option value={600}>Suave</option></select></label>}
          <p className="fine">A animação vale para a entrada de qualquer cena. Durante a pausa a troca acontece atrás do aviso, sem aparecer.</p>
        </div>
        <footer><button className="secondary" disabled={scenes.length>=12} onClick={()=>addScene(scene)}><Copy size={14}/> Duplicar</button><button className="secondary" disabled={scenes.length<2} onClick={()=>{removeScene(scene);setSceneEdit(false);}}><Trash2 size={14}/> Remover cena</button><button className="primary" onClick={()=>setSceneEdit(false)}><Check size={15}/> Concluir</button></footer>
      </div></>}
      {selectedLayer&&(()=>{const Icon=KIND_ICONS[selectedLayer.kind];return <><div className="sheet-backdrop" onClick={()=>setSelected(null)}/><div className="layer-dialog" role="dialog" aria-modal="true" aria-label="Ajustes da fonte" onKeyDown={e=>{if(e.key==='Escape')setSelected(null);}}>
        <header><h3><Icon size={15}/> {layerLabel(selectedLayer)}</h3><span className="dock-hint">{KIND_LABELS[selectedLayer.kind]} · as mudanças valem na hora</span><button className="icon-button" aria-label="Fechar ajustes" onClick={()=>setSelected(null)}><X size={16}/></button></header>
        <div className="layer-props">
            {CAPTURE.includes(selectedLayer.kind)&&<label>{KIND_LABELS[selectedLayer.kind]}<select aria-label={'Equipamento da fonte'} disabled={!devices} value={selectedLayer.id||''} onChange={e=>patchLayer(selectedLayer.uid,{id:e.target.value})}><option value="">Escolha um equipamento</option>{layerMissing(selectedLayer)&&<option value={selectedLayer.id}>Equipamento desconectado</option>}{options(listFor(selectedLayer.kind))}</select>{devices&&!(listFor(selectedLayer.kind)||[]).length&&<span className="fine">{selectedLayer.kind==='camera'?'Nenhuma câmera encontrada. Conecte a câmera, feche outros programas que a usam e clique em Atualizar equipamentos.':'Nada encontrado. Clique em Atualizar equipamentos.'}</span>}</label>}
            {selectedLayer.kind==='text'&&<label>Texto<input maxLength={120} value={selectedLayer.text||''} onChange={e=>patchLayer(selectedLayer.uid,{text:e.target.value})}/></label>}
            {selectedLayer.kind==='image'&&<div className="image-row"><span title={selectedLayer.file}>{selectedLayer.fileName}</span><button className="text-button" disabled={busy} onClick={()=>replaceImage(selectedLayer)}>Trocar imagem</button></div>}
            <label>Nome<input maxLength={40} placeholder={layerLabel(selectedLayer)} value={selectedLayer.name||''} onChange={e=>patchLayer(selectedLayer.uid,{name:e.target.value})}/></label>
            <label>Posição<select aria-label="Posição da fonte" value={selectedLayer.fit||'fit'} onChange={e=>patchLayer(selectedLayer.uid,{fit:e.target.value})}><option value="fit">Tela inteira, imagem completa</option><option value="fill">Preencher, cortando as bordas</option><option value="corner">Em um canto (sobre as outras)</option></select></label>
            {selectedLayer.fit==='corner'&&<div className="corner-row"><div className="corner-grid" role="group" aria-label="Canto">{[['tl','Canto superior esquerdo'],['tr','Canto superior direito'],['bl','Canto inferior esquerdo'],['br','Canto inferior direito']].map(([corner,label])=><button key={corner} aria-label={label} aria-pressed={selectedLayer.corner===corner} className={selectedLayer.corner===corner?'is-active':''} onClick={()=>patchLayer(selectedLayer.uid,{corner})}/>)}</div><label className="size-field">Tamanho <strong>{Math.round((selectedLayer.size||.3)*100)}%</strong><input aria-label="Tamanho da fonte no canto" type="range" min="15" max="60" step="5" value={Math.round((selectedLayer.size||.3)*100)} onChange={e=>patchLayer(selectedLayer.uid,{size:Number(e.target.value)/100})}/></label></div>}
            {selectedLayer.kind==='display'&&<p className="fine">Tudo nessa tela pode aparecer, inclusive este gerenciador. Prefira compartilhar uma janela.</p>}
            {selectedLayer.kind==='game'&&<p className="fine">Fonte antiga de captura por dentro do jogo, mantida para as cenas que já a usavam. Para uma cena nova use Janela / Jogo.</p>}
            {selectedLayer.kind==='window'&&<p className="fine">{GAME_HINT} Se a janela do jogo parar de enviar imagem, o último quadro fica no ar.</p>}
        </div>
        <footer><button className="secondary" onClick={()=>{removeLayer(selectedLayer);}}><Trash2 size={14}/> Remover fonte</button><button className="primary" autoFocus onClick={()=>setSelected(null)}><Check size={15}/> Concluir</button></footer>
      </div></>;})()}
      </div>
    </section><aside className="manager"><div className="manager-heading"><h2>Seu gerenciador</h2><p>{active?'Conectado à mesma live do site':'Configure antes da live; aplicado à próxima transmissão'}</p></div><div className="tabbar" role="tablist" aria-label="Gerenciador"><button role="tab" aria-selected={tab==='chat'} onClick={()=>setTab('chat')}><MessageSquare size={17}/> Chat</button><button role="tab" aria-selected={tab==='commerce'} onClick={()=>setTab('commerce')}><Gift size={17}/> Interações</button></div><div className="manager-content" role="tabpanel">{tab==='commerce'?<React.Fragment key={active?session.id:'preset-'+state.user.id}>{active&&<Revenue sessionId={session.id}/>}<LiveCommerceStudio sessionId={active?session.id:null}/></React.Fragment>:active?<LiveChatPanel key={session.id} sessionId={session.id}/>:<div className="manager-empty"><MessageSquare size={30}/><h3>Todo mundo por perto</h3><p>Ao abrir uma sessão, seu chat estará aqui. Prepare metas, roleta e presentes em Interações antes de começar.</p><p className="fine">As interações usam as mesmas regras e registros do site.</p></div>}</div><UpdatePreferences state={state} busy={busy} run={run}/></aside></div>
    <footer className="controlbar"><div className="control-status"><span className="signal"><i/>{statusNames[displayStatus]||'Pronta para preparar'}</span><p>{session?.status==='waiting'?`Posição na fila: ${session.queue_position||'consultando'}`:state.transmitting?`${rate.current.kbps} kbps · ${state.mediaStatus?.droppedFrames||0} quadros perdidos`:'Privex Studio '+state.version+' · 720p · 30 fps'}</p></div>
      <label className="title-field"><span className="sr-only">Título da live</span><input aria-label="Título da live" value={title} onChange={e=>{setTitle(e.target.value);if(active)setTitleEdit(true);}} maxLength={100} disabled={busy} placeholder="Título da live · o que vamos fazer hoje?"/></label>
      {active&&titleEdit&&<div className="title-actions"><button className="primary" disabled={busy||!title.trim()||title.trim()===session.title} onClick={async()=>{const result=await run('title',{title});if(result!==undefined)setTitleEdit(false);}}><Check size={15}/> Salvar título</button><button className="secondary" disabled={busy} onClick={()=>{setTitle(session.title||'');setTitleEdit(false);}}>Cancelar</button></div>}
      <div className="main-actions"><button className="secondary" onClick={()=>run('site')}><Monitor size={17}/> Abrir site</button>{active?<><button className="danger" disabled={busy} onClick={()=>{if(window.confirm('Encerrar a sessão e interromper o envio de vídeo?'))run('end');}}><Square size={16}/> {session.status==='waiting'?'Sair da fila':'Encerrar live'}</button>{['reserved','reconnecting'].includes(session.status)&&!state.transmitting&&<button className="primary" disabled={busy||!state.prepared||!inSync||!canApply} onClick={()=>run('resume')}>Estou pronta · transmitir</button>}</>:<button className="primary" disabled={busy||!state.prepared||!layers.length||!inSync||!canApply||!title.trim()||session&&!owned} onClick={()=>run('start',{title})}><Radio size={19}/> Iniciar live</button>}</div></footer>
  </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
