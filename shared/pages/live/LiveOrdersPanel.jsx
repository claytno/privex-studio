import { useState } from 'react';
import api from "../../../renderer/adapter.js";
import useLivePolling from "../../hooks/useLivePolling.js";
import { Button, Modal } from "../../../renderer/shared-ui.js";
import { liveDate, liveField, liveKinds, liveMoney, liveOutcome } from "./liveCommerceUtils.js";

const states = { requested: 'Na fila de interações', accepted: 'Em atendimento', in_progress: 'Em execução', delivered: 'Realizado', completed: 'Pagamento confirmado', refunded: 'Devolvido', rejected: 'Recusado', cancelled: 'Cancelado' };
const actions = { accept: 'Iniciar interação', deliver: 'Marcar como realizada', complete: 'Marcar como realizada', refund: 'Devolver valor' };

export default function LiveOrdersPanel({ sessionId, admin = false, allSessions = false, creator = false }) {
  const [page, setPage] = useState(1);
  const path = admin ? `/admin/lives/orders?page=${page}` : allSessions ? `/lives/orders?page=${page}` : sessionId ? `/lives/${sessionId}/orders?page=${page}` : null;
  const { data, error, loading, refresh } = useLivePolling(path, 15000);
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const items = data?.data || data?.items || [];
  const perform = async () => {
    if (busy || !selected) return;
    setBusy(true); setFailure('');
    try {
      await api.post(`/lives/${selected.order.live_session_id || sessionId}/orders/${selected.order.id}/transition`, { action: selected.action, reason: reason.trim() || undefined }, { timeout: 20000 });
      setSelected(null); refresh();
    } catch (e) { setFailure(e.response?.data?.message || 'Resultado não confirmado. Atualize o pedido antes de repetir.'); refresh(); }
    finally { setBusy(false); }
  };
  return <section aria-label={admin ? 'Interações de Lives para revisão' : creator ? 'Recebimentos desta live' : 'Interações desta live'} className="min-w-0 space-y-4 [overflow-wrap:anywhere]">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{admin ? 'Revisar interações e devoluções' : creator ? 'Recebimentos' : 'Minhas interações'}</h3><Button variant="ghost" size="sm" onClick={refresh}>Atualizar</Button></div>
    <p className="text-xs text-px-muted">Valores são creditados na hora, sem retenção. Não há devolução automática. A criadora pode devolver por escolha própria, inclusive após encerrar a live.</p>
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    {loading ? <p role="status" className="text-sm text-px-muted">Consultando interações…</p> : items.length === 0 ? <p className="rounded-xl border border-dashed border-px-border p-4 text-sm text-px-muted">Nenhuma interação neste período.</p> : items.map(order => <article key={order.id} className="space-y-3 rounded-xl border border-px-border p-4">
      <div className="flex flex-wrap justify-between gap-2"><h4 className="min-w-0 break-words font-semibold">{order.title || order.snapshot?.title || liveKinds[order.kind]}</h4><strong className="tabular-nums">{liveMoney(order.amount_cents)}</strong></div>
      <p className="text-xs text-px-purple-400">{states[order.status] || order.status} · #{String(order.id).slice(0, 8)}</p>
      {liveOutcome(order) && <p className="rounded-lg bg-px-purple-500/10 p-3 text-sm">Resultado da roleta: <strong>{liveOutcome(order)}</strong></p>}
      <dl className="space-y-1 text-xs text-px-muted"><div>Registrado: {liveDate(order.created_at)}</div>{order.accept_deadline && <div>Aceitar até: {liveDate(order.accept_deadline)}</div>}{order.delivery_deadline && <div>Entregar até: {liveDate(order.delivery_deadline)}</div>}{order.confirmation_deadline && <div>Confirmar ou contestar até: {liveDate(order.confirmation_deadline)}</div>}</dl>
      {order.dispute_reason && <p className="break-words text-sm">Contestação: {order.dispute_reason}</p>}
      <div className="flex flex-wrap gap-2">{(order.allowed_actions || []).filter(action => actions[action]).map(action => <Button key={action} variant={['reject', 'refund', 'dispute'].includes(action) ? 'secondary' : 'primary'} size="sm" onClick={() => { setSelected({ order, action }); setReason(''); setFailure(''); }}>{actions[action]}</Button>)}</div>
    </article>)}
    {(data?.last_page > 1) && <div className="flex items-center justify-between gap-2"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Anterior</Button><span className="text-xs">{page} / {data.last_page}</span><Button variant="secondary" disabled={page >= data.last_page} onClick={() => setPage(p => p + 1)}>Próxima</Button></div>}
    <Modal isOpen={!!selected} onClose={() => !busy && setSelected(null)} title={actions[selected?.action]}>
      {selected && <form onSubmit={e => { e.preventDefault(); perform(); }} className="min-w-0 space-y-4 [overflow-wrap:anywhere]"><p className="text-sm">{selected.order.title || liveKinds[selected.order.kind]} · {liveMoney(selected.order.amount_cents)}</p>
        <p className="text-sm text-px-muted">{selected.action === 'refund' ? 'O valor integral sairá do saldo disponível de quem recebeu e voltará ao comprador. A devolução será registrada nos dois extratos e exige saldo suficiente.' : ['deliver', 'complete'].includes(selected.action) ? 'Marque a interação como realizada para organizar sua fila. O pagamento já foi recebido e não depende desta etapa.' : 'Esta etapa organiza sua fila de interações. O valor já foi creditado, sem retenção.'}</p>
        <label className="block space-y-2 text-sm"><span>Motivo ou observação (opcional)</span><textarea className={liveField} maxLength={500} rows={3} value={reason} onChange={e => setReason(e.target.value)} disabled={busy} /></label>
        {failure && <p role="alert" className="text-sm text-red-400">{failure}</p>}<Button type="submit" loading={busy} className="min-h-11 w-full">{actions[selected.action]}</Button>
      </form>}
    </Modal>
  </section>;
}
