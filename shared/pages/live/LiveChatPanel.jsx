import { useEffect, useRef, useState } from 'react';
import { Flag, MoreVertical, Send, Shield, Pin, Reply } from 'lucide-react';
import api from "../../../renderer/adapter.js";
import useAuthStore from "../../../renderer/auth.js";
import useLivePolling from "../../hooks/useLivePolling.js";
import useLiveRoomEvents from "../../hooks/useLiveRoomEvents.js";
import LiveModerationPanel from "./LiveModerationPanel.jsx";
import { Button, Modal } from "../../../renderer/shared-ui.js";

export default function LiveChatPanel({ sessionId, overlay = false }) {
  const [realtime, setRealtime] = useState(false);
  const { data, error, loading, refresh } = useLivePolling(sessionId ? `/lives/${sessionId}/chat` : null, realtime ? 15000 : 3000);
  const connected = useLiveRoomEvents(sessionId, refresh);
  useEffect(() => setRealtime(connected), [connected]);
  const userId = useAuthStore(state => state.user?.id);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState('');
  const [seconds, setSeconds] = useState(600);
  const [restrictions, setRestrictions] = useState(null);
  const [notice, setNotice] = useState('');
  const [unread, setUnread] = useState(false);
  const [reply, setReply] = useState(null);
  const [rulesEdit, setRulesEdit] = useState(null);
  const list = useRef(null);
  const bottom = useRef(true);
  const latest = useRef(null);
  const attempt = useRef(null);
  const scope = useRef(sessionId);
  scope.current = sessionId;
  const messages = (data?.messages || []).map(message => ({ ...message, reply_to: message.reply_to_id ? (data?.messages || []).find(original => original.id === message.reply_to_id) || { user: { username: 'mensagem anterior' }, body: 'Fora do histórico recente' } : null }));
  const canModerate = data?.moderation?.can_moderate;
  useEffect(() => {
    setBody(''); setReply(null); setRulesEdit(null); setFailure(''); setSelected(null); setRestrictions(null); setNotice(''); setBusy(false);
    attempt.current = null; bottom.current = true; latest.current = null;
  }, [sessionId]);
  useEffect(() => {
    if (bottom.current && list.current) { list.current.scrollTop = list.current.scrollHeight; setUnread(false); }
    else if (latest.current && data?.messages?.at(-1)?.id > latest.current) setUnread(true);
    latest.current = data?.messages?.at(-1)?.id || latest.current;
  }, [data]);
  const send = async event => {
    event.preventDefault();
    if (busy || !data?.can_send || !body.trim()) return;
    const text = body.trim();
    const id = sessionId;
    if (!attempt.current || attempt.current.body !== text || attempt.current.reply_to_id !== reply?.id) attempt.current = { body: text, reply_to_id: reply?.id, client_id: crypto.randomUUID() };
    setBusy(true); setFailure('');
    try {
      await api.post(`/lives/${id}/chat`, attempt.current, { timeout: 15000 });
      if (scope.current !== id) return;
      setBody(''); setReply(null); attempt.current = null; bottom.current = true; refresh();
    } catch (e) {
      if (scope.current === id) { setFailure(e.response?.data?.message || 'Envio não confirmado. Tente novamente; a mesma mensagem não será duplicada.'); refresh(); }
    } finally { if (scope.current === id) setBusy(false); }
  };
  const moderate = async (kind, target) => {
    if (busy) return;
    if (['report', 'timeout', 'chat_ban', 'expel', 'creator_ban'].includes(kind) && !reason.trim()) { setFailure('Informe o motivo.'); return; }
    const id = sessionId;
    setBusy(true); setFailure(''); setNotice('');
    try {
      if (kind === 'pin') await api.put(`/lives/${id}/chat/pin`, { message_id: target?.id || null });
      else if (kind === 'rules') await api.put(`/lives/${id}/chat/rules`, { rules: rulesEdit });
      else if (['expel', 'creator_ban'].includes(kind)) await api.post(`/lives/${id}/moderation`, { user_id: target.user.id, kind, reason });
      else if (kind === 'delete') await api.delete(`/lives/${sessionId}/chat/${target.id}`, { timeout: 15000 });
      else if (kind === 'revoke') await api.delete(`/lives/${sessionId}/restrictions/${target.id}`, { timeout: 15000 });
      else if (kind === 'report') await api.post(`/lives/${sessionId}/reports`, { message_id: target?.id, reason }, { timeout: 15000 });
      else await api.post(`/lives/${sessionId}/restrictions`, { user_id: target.user.id, kind, seconds: Number(seconds), reason }, { timeout: 15000 });
      if (scope.current !== id) return;
      setSelected(null); setRulesEdit(null); setReason(''); setRestrictions(null); setNotice(kind === 'report' ? 'Denúncia recebida pela administração.' : 'Moderação aplicada.'); refresh();
    } catch (e) { if (scope.current === id) setFailure(e.response?.data?.message || 'Não foi possível concluir. Tente novamente.'); }
    finally { if (scope.current === id) setBusy(false); }
  };
  const loadRestrictions = async () => {
    if (busy) return;
    const id = sessionId;
    setBusy(true); setFailure('');
    try { const response = await api.get(`/lives/${id}/restrictions`, { timeout: 15000 }); if (scope.current === id) setRestrictions(response.data.items); }
    catch (e) { if (scope.current === id) setFailure(e.response?.data?.message || 'Não foi possível carregar as restrições.'); }
    finally { if (scope.current === id) setBusy(false); }
  };
  return <section aria-label="Chat da live" className={`flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl ${overlay ? 'bg-black/65 text-white backdrop-blur-sm' : 'border border-px-border bg-px-card'} p-3`}>
    <div className="flex shrink-0 items-center justify-between gap-2"><h2 className="text-sm font-semibold">Chat da live</h2><div className="flex gap-1"><button type="button" title="Denunciar live" aria-label="Denunciar live" onClick={() => { setSelected({ reportLive: true }); setReason(''); setFailure(''); }} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-white/10"><Flag size={16} /></button>{canModerate && <button type="button" aria-label="Gerenciar restrições do chat" disabled={busy} onClick={loadRestrictions} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-white/10"><Shield size={16} /></button>}</div></div>
    {data?.rules && <details className="mb-2 shrink-0 text-xs"><summary className="cursor-pointer py-2 font-medium">Regras da sala</summary><p className="whitespace-pre-wrap break-words p-2 opacity-75">{data.rules}</p></details>}
    {data?.pinned_message && <div className="mb-2 flex shrink-0 items-start gap-2 rounded-lg bg-purple-500/15 p-2 text-xs"><Pin size={14} className="shrink-0" /><p className="min-w-0 break-words">@{data.pinned_message.user?.username}: {data.pinned_message.body}</p>{canModerate && <button type="button" className="ml-auto min-h-9 shrink-0 px-1" disabled={busy} onClick={() => moderate('pin', null)}>Soltar</button>}</div>}
    {data?.moderation?.can_manage_rules && <button type="button" onClick={() => setRulesEdit(data?.rules || '')} className="mb-1 self-start text-xs text-purple-300">Editar regras</button>}
    <div ref={list} onScroll={() => { const el = list.current; bottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 35; if (bottom.current) setUnread(false); }} className={`min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain ${overlay ? 'max-h-[26dvh]' : 'max-h-[42dvh] min-h-24'}`} aria-label="Mensagens recentes">
      {loading ? <p className="p-2 text-xs">Carregando chat…</p> : !data?.enabled ? <p className="p-2 text-xs">O chat está em preparação ou foi pausado pela administração.</p> : !messages.length ? <p className="p-2 text-xs opacity-75">Seja a primeira pessoa a conversar.</p> : messages.map(message => <div key={message.id} className="flex items-start gap-1 text-sm"><p className="min-w-0 flex-1 break-words py-1 [overflow-wrap:anywhere]"><span className="mr-2 font-semibold text-purple-300">{message.user.username}</span>{message.reply_to && <span className="mb-1 block border-l-2 border-purple-400 pl-2 text-xs opacity-60">Respondendo a @{message.reply_to.user?.username}: {message.reply_to.body || 'Mensagem removida'}</span>}{message.deleted_at ? <span className="italic opacity-60">Mensagem removida</span> : message.body}</p>{!message.deleted_at && <button type="button" aria-label={`Opções da mensagem de ${message.user.username}`} onClick={() => { setSelected(message); setReason(''); setFailure(''); }} className="flex h-10 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-white/10"><MoreVertical size={15} /></button>}</div>)}
    </div>
    {unread && <button type="button" className="my-1 min-h-9 rounded-lg bg-purple-600 text-xs text-white" onClick={() => { bottom.current = true; if (list.current) list.current.scrollTop = list.current.scrollHeight; setUnread(false); }}>Novas mensagens ↓</button>}
    {data?.restriction && <p role="status" className="mt-2 text-xs">{data.restriction.kind === 'timeout' ? 'Você está em timeout' : 'Você foi impedido de escrever nas lives deste perfil'}. {data.restriction.reason}{data.restriction.expires_at && ` Até ${new Date(data.restriction.expires_at).toLocaleTimeString('pt-BR')}.`}</p>}
    {(failure || error) && <p role="alert" className="mt-2 text-xs text-red-300">{failure || error}</p>}
    {notice && <p role="status" className="mt-2 text-xs text-emerald-300">{notice}</p>}
    {reply && <div className="mt-2 flex shrink-0 items-center justify-between gap-2 text-xs"><span className="truncate">Respondendo a @{reply.user?.username}</span><button type="button" onClick={() => setReply(null)} className="min-h-9 px-2">Cancelar</button></div>}
    <form onSubmit={send} className="mt-2 flex shrink-0 items-end gap-2"><label className="min-w-0 flex-1"><span className="sr-only">Escrever no chat da live</span><textarea value={body} onChange={e => setBody(e.target.value)} maxLength={500} rows={body.length > 70 ? 3 : 1} disabled={busy || !data?.can_send} placeholder={data?.can_send ? 'Escreva uma mensagem…' : 'Chat indisponível para envio'} className="max-h-28 min-h-11 w-full resize-none rounded-xl border border-white/20 bg-black/30 px-3 py-2 text-base text-white placeholder:text-white/65 disabled:opacity-60" /></label><Button type="submit" aria-label="Enviar mensagem" loading={busy} disabled={!data?.can_send || !body.trim()} className="min-h-11 min-w-11 px-2"><Send size={18} /></Button></form>
    <Modal isOpen={!!selected} onClose={() => { if (!busy) { setSelected(null); setFailure(''); } }} title={selected?.reportLive ? 'Denunciar esta live' : 'Mensagem e moderação'}>
      {selected && <div className="space-y-4">{!selected.reportLive && <p className="break-words text-sm">@{selected.user?.username}: {selected.body}</p>}<label className="block space-y-2 text-sm"><span>Motivo</span><textarea maxLength={300} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} className="min-h-20 w-full rounded-xl border border-px-border bg-px-bg p-3" /></label>{failure && <p role="alert" className="text-sm text-red-400">{failure}</p>}<Button disabled={busy} onClick={() => moderate('report', selected.reportLive ? null : selected)}>Enviar denúncia</Button>{!selected.reportLive && data?.can_send && <Button variant="secondary" disabled={busy} onClick={() => { setReply(selected); setSelected(null); }}><Reply size={16} />Responder</Button>}{canModerate && !selected.reportLive && <div className="space-y-3 border-t border-px-border pt-3"><Button variant="secondary" disabled={busy} onClick={() => moderate('delete', selected)}>Apagar mensagem</Button><Button variant="secondary" disabled={busy} onClick={() => moderate('pin', selected)}><Pin size={15} />Fixar mensagem</Button>{selected.user?.id !== userId && <><label className="block text-sm">Duração do timeout<select value={seconds} onChange={e => setSeconds(e.target.value)} className="ml-2 rounded border border-px-border bg-px-bg p-2"><option value={60}>1 minuto</option><option value={600}>10 minutos</option><option value={3600}>1 hora</option><option value={86400}>24 horas</option></select></label><div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={() => moderate('timeout', selected)}>Aplicar timeout</Button><Button variant="danger" disabled={busy} onClick={() => moderate('chat_ban', selected)}>Banir do chat deste perfil</Button></div><div className="flex flex-wrap gap-2"><Button variant="danger" disabled={busy} onClick={() => moderate('expel', selected)}>Expulsar desta live</Button><Button variant="danger" disabled={busy} onClick={() => moderate('creator_ban', selected)}>Banir das lives deste perfil</Button></div><p className="text-xs text-px-muted">Expulsão e banimento bloqueiam novos acessos ao vídeo. Conteúdo já carregado pode continuar por alguns segundos.</p></>}</div>}</div>}
    </Modal>
    <Modal isOpen={restrictions !== null} onClose={() => !busy && setRestrictions(null)} title="Moderação da sala"><div className="space-y-3">{restrictions?.length === 0 && <p className="text-sm">Nenhuma restrição ativa.</p>}{restrictions?.map(item => <div key={item.id} className="rounded-xl border border-px-border p-3 text-sm"><p className="font-semibold">@{item.username}</p><p>{item.kind === 'timeout' ? 'Timeout' : 'Banimento do chat'} · {item.reason}</p><Button variant="secondary" size="sm" className="mt-2" disabled={busy} onClick={() => moderate('revoke', item)}>Revogar restrição</Button></div>)}{failure && <p role="alert" className="text-sm text-red-400">{failure}</p>}<LiveModerationPanel sessionId={sessionId} /></div></Modal>
    <Modal isOpen={rulesEdit !== null} onClose={() => !busy && setRulesEdit(null)} title="Regras da sala"><div className="space-y-3"><textarea value={rulesEdit || ''} onChange={e => setRulesEdit(e.target.value)} maxLength={500} rows={5} className="w-full rounded-xl border border-px-border bg-px-bg p-3" aria-label="Regras da sala" /><Button loading={busy} onClick={() => moderate('rules')}>Salvar regras</Button>{failure && <p role="alert" className="text-sm text-red-400">{failure}</p>}</div></Modal>
  </section>;
}
