import { useEffect, useState } from 'react';
import api from "../../../renderer/adapter.js";
import useLivePolling from "../../hooks/useLivePolling.js";
import { Button } from "../../../renderer/shared-ui.js";
import { liveField } from "./liveCommerceUtils.js";

const labels = { expel: 'Expulsão desta live', creator_ban: 'Banimento das lives do perfil', suspend_watch: 'Suspensão para assistir', suspend_broadcast: 'Suspensão para transmitir', suspend_both: 'Suspensão para assistir e transmitir' };
export default function LiveModerationPanel({ sessionId, admin = false }) {
  const path = admin ? '/admin/lives/suspensions' : `/lives/${sessionId}/moderation`;
  const { data, error, refresh } = useLivePolling(path, 30000);
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState([]);
  const [target, setTarget] = useState(null);
  const [reason, setReason] = useState('');
  const [kind, setKind] = useState(admin ? 'watch' : 'expel');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (query.trim().length < 2 || target) return;
    const controller = new AbortController();
    const timer = setTimeout(() => api.get('/search', { params: { q: query.replace(/^@/, '').trim(), type: 'users' }, signal: controller.signal }).then(r => setUsers(r.data.users || [])).catch(() => { if (!controller.signal.aborted) setUsers([]); }), 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, target]);
  const run = async (action, item) => {
    if (busy || (!item && !target)) return;
    setBusy(true); setMessage('');
    try {
      if (action === 'revoke') await api.delete(`${path}/${item.id}`);
      else if (action === 'delegate' || action === 'undelegate') await api.put(`/lives/${sessionId}/moderators/${item?.user_id || target.id}`, { enabled: action === 'delegate' });
      else await api.post(path, { user_id: target.id, ...(admin ? { scope: kind } : { kind }), reason });
      setTarget(null); setQuery(''); setUsers([]); setReason(''); setMessage('Permissão atualizada.'); refresh();
    } catch (e) { setMessage(e.response?.data?.message || 'Não foi possível aplicar a alteração.'); }
    finally { setBusy(false); }
  };
  return <section className="space-y-4 rounded-xl border border-px-border p-4"><h3 className="font-semibold">{admin ? 'Bloqueios de Lives na plataforma' : 'Acesso ao vídeo e moderadores'}</h3><p className="text-xs text-px-muted">{admin ? 'Escolha o alcance do bloqueio. Esta ação não apaga pagamentos nem conversas.' : 'Expulsão vale para esta sessão; banimento vale para as lives atuais e futuras deste perfil. Vídeo já carregado pode continuar por alguns segundos.'}</p>{error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    {data && <><form onSubmit={e => { e.preventDefault(); run('restrict'); }} className="space-y-3"><label className="block space-y-2 text-sm"><span>Buscar perfil pelo nome ou @usuário</span><input value={query} onChange={e => { setQuery(e.target.value); setTarget(null); setUsers([]); }} className={liveField} placeholder="Digite pelo menos 2 caracteres" disabled={busy} /></label>{!target && users.length > 0 && <ul className="max-h-48 overflow-y-auto rounded-xl border border-px-border">{users.map(user => <li key={user.id}><button type="button" className="min-h-11 w-full p-3 text-left text-sm hover:bg-px-elevated" onClick={() => { setTarget(user); setQuery(`@${user.username}`); setUsers([]); }}>{user.name} · @{user.username}</button></li>)}</ul>}{target && <p className="rounded-lg bg-purple-500/10 p-3 text-sm">Perfil selecionado: <strong>@{target.username}</strong></p>}
      <label className="block space-y-2 text-sm"><span>Alcance da medida</span><select className={liveField} value={kind} onChange={e => setKind(e.target.value)} disabled={busy}>{(admin ? [['watch', 'Impedir de assistir'], ['broadcast', 'Impedir de transmitir'], ['both', 'Impedir de assistir e transmitir']] : [['expel', 'Expulsar desta sessão'], ['creator_ban', 'Banir das lives deste perfil']]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="block space-y-2 text-sm"><span>Motivo</span><textarea className={liveField} value={reason} onChange={e => setReason(e.target.value)} maxLength={300} rows={2} required disabled={busy} /></label><Button type="submit" variant="danger" loading={busy} disabled={!target || !reason.trim()}>Aplicar ao perfil selecionado</Button>
      {!admin && data.can_manage_moderators && target && <div className="border-t border-px-border pt-3"><Button type="button" variant="secondary" disabled={busy} onClick={() => run('delegate')}>Conceder moderação a @{target.username}</Button><p className="mt-2 text-xs text-px-muted">Permite moderar chat e acesso ao vídeo deste perfil. Não dá acesso à carteira, às chaves de transmissão ou às conversas privadas.</p></div>}
    </form>{message && <p role="status" className="text-sm">{message}</p>}<div className="space-y-2 border-t border-px-border pt-3"><h4 className="text-sm font-semibold">Restrições ativas</h4>{!data.items?.length && <p className="text-xs text-px-muted">Nenhuma restrição ativa.</p>}{data.items?.map(item => <div key={item.id} className="rounded-lg bg-px-elevated p-3 text-xs"><p className="font-semibold">@{item.username} · {labels[item.kind]}</p><p className="mt-1 break-words text-px-muted">{item.reason}</p><Button type="button" size="sm" variant="ghost" className="mt-2" disabled={busy} onClick={() => run('revoke', item)}>Revogar bloqueio</Button></div>)}</div>{!admin && <div className="space-y-2"><h4 className="text-sm font-semibold">Moderadores deste perfil</h4>{!data.delegates?.length && <p className="text-xs text-px-muted">Nenhum moderador delegado.</p>}{data.delegates?.map(item => <div key={item.user_id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>@{item.username}</span>{data.can_manage_moderators && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => run('undelegate', item)}>Remover permissão</Button>}</div>)}</div>}</>}
  </section>;
}
