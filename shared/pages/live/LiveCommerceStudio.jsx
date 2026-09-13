import { useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import api from "../../../renderer/adapter.js";
import useLivePolling from "../../hooks/useLivePolling.js";
import { Button } from "../../../renderer/shared-ui.js";
import LiveOrdersPanel from "./LiveOrdersPanel.jsx";
import { liveField, liveKinds, parseLiveCents } from "./liveCommerceUtils.js";

const editable = data => ({ catalog_version: data?.catalog_version, items: (data?.items || []).map(item => ({ ...item, price: (item.amount_cents / 100).toFixed(2).replace('.', ','), outcomesText: (item.outcomes || []).map(o => o.label).join('\n') })), goal: data?.goal ? { ...data.goal, price: (data.goal.target_cents / 100).toFixed(2).replace('.', ',') } : { title: '', price: '', active: false } });

export default function LiveCommerceStudio({ sessionId }) {
  const endpoint = sessionId ? `/lives/${sessionId}/commerce` : '/lives/commerce-preset';
  const { data, setData, error, loading, refresh } = useLivePolling(endpoint, 15000);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');
  const value = draft || editable(data);
  const change = (index, key, next) => setDraft(current => { const copy = current || editable(data); return { ...copy, items: copy.items.map((item, i) => i === index ? { ...item, [key]: next } : item) }; });
  const goalChange = (key, next) => setDraft(current => { const copy = current || editable(data); return { ...copy, goal: { ...copy.goal, [key]: next } }; });
  const save = async event => {
    event.preventDefault();
    if (busy) return;
    const invalid = value.items.some(item => {
      const amount = parseLiveCents(item.price);
      const outcomes = item.outcomesText.split('\n').map(s => s.trim()).filter(Boolean);
      return !item.title.trim() || amount === null || amount < 100 || amount > 100000
        || (item.kind !== 'gift' && (!Number.isInteger(Number(item.delivery_seconds)) || Number(item.delivery_seconds) < 30 || Number(item.delivery_seconds) > 86400))
        || (item.kind === 'wheel' && (outcomes.length < 2 || outcomes.length > 20 || outcomes.some(label => label.length > 120)));
    });
    const goalCents = parseLiveCents(value.goal.price);
    if (invalid || ((value.goal.active || value.goal.title.trim()) && (!value.goal.title.trim() || goalCents === null || goalCents < 100 || goalCents > 100000000))) { setFailure('Confira valores de R$ 1 a R$ 1.000, duração de 30 a 86.400 segundos e roletas de 2 a 20 opções de até 120 caracteres. Metas precisam de título e alvo válido.'); return; }
    setBusy(true); setFailure(''); setNotice('');
    try {
      const response = await api.put(endpoint, { catalog_version: value.catalog_version, items: value.items.map(item => ({ id: item.id, kind: item.kind, title: item.title.trim(), amount_cents: parseLiveCents(item.price), delivery_seconds: Number(item.delivery_seconds) || 300, active: !!item.active, outcomes: item.kind === 'wheel' ? item.outcomesText.split('\n').map(label => ({ label: label.trim() })).filter(o => o.label) : [] })), goal: value.goal.title.trim() ? { title: value.goal.title.trim(), target_cents: parseLiveCents(value.goal.price), active: !!value.goal.active } : null }, { timeout: 20000 });
      setData(response.data); setDraft(null); setNotice(sessionId ? 'Interações atualizadas. Pedidos anteriores mantêm as condições originais.' : 'Configuração salva para sua próxima live. Nenhuma transmissão foi iniciada.'); refresh();
    } catch (e) { setFailure(e.response?.data?.message || 'Não foi possível salvar. Suas alterações continuam no formulário.'); }
    finally { setBusy(false); }
  };
  return <section className="min-w-0 space-y-5 [overflow-wrap:anywhere] rounded-2xl border border-px-border bg-px-card p-4 sm:p-6">
    <header><h2 className="text-lg font-semibold">{sessionId ? 'Interações e ganhos' : 'Prepare suas interações'}</h2>{!sessionId && <p className="mt-2 text-sm text-purple-300">Salve presentes, ações, roleta e meta antes de transmitir. Sua próxima live começa com esta configuração; mudanças aqui não alteram uma live que já existe.</p>}<p className="mt-2 text-sm text-px-muted">Crie presentes, ações e roleta. Todos os valores entram diretamente na sua carteira; a comissão continua apenas no saque.</p></header>
    {loading && <p role="status">Carregando configurações…</p>}{error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    {data?.permissions?.manage && <form onSubmit={save} className="space-y-5"><fieldset disabled={busy} className="space-y-4">
      <div className="flex flex-wrap gap-2">{['gift', 'action', 'wheel'].map(kind => <Button key={kind} type="button" variant="secondary" size="sm" disabled={value.items.length >= 40} onClick={() => setDraft(current => { const copy = current || editable(data); return { ...copy, items: [...copy.items, { key: crypto.randomUUID(), kind, title: '', price: '5,00', active: false, delivery_seconds: 300, outcomesText: '' }] }; })}><Plus size={15} />{liveKinds[kind]}</Button>)}</div>
      {value.items.length === 0 && <p className="rounded-xl border border-dashed border-px-border p-4 text-sm text-px-muted">Seu catálogo está vazio. Adicione uma interação e ative quando estiver pronta.</p>}
      {value.items.map((item, i) => <article key={item.id || item.key} className="space-y-3 rounded-xl border border-px-border p-4"><div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold text-purple-300">{liveKinds[item.kind]}</span><button type="button" aria-label={`Remover ${item.title || liveKinds[item.kind]} do catálogo`} onClick={() => setDraft(current => { const copy = current || editable(data); return { ...copy, items: copy.items.filter((_, at) => at !== i) }; })} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-px-muted hover:bg-px-elevated"><Trash2 size={17} /></button></div>
        <label className="block space-y-1 text-sm"><span>Nome da interação</span><input className={liveField} maxLength={100} required value={item.title} onChange={e => change(i, 'title', e.target.value)} placeholder="Ex.: 💜 Coração ou escolher a próxima música" /></label>
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,12rem),1fr))]"><label className="block space-y-1 text-sm"><span>Preço em reais</span><input className={liveField} inputMode="decimal" maxLength={10} required value={item.price} onChange={e => change(i, 'price', e.target.value)} /></label>{item.kind !== 'gift' && <label className="block space-y-1 text-sm"><span>Duração estimada em segundos</span><input type="number" min={30} max={86400} className={liveField} value={item.delivery_seconds} onChange={e => change(i, 'delivery_seconds', e.target.value)} /><span className="text-xs text-px-muted">Organiza a interação; não retém o pagamento.</span></label>}</div>
        {item.kind === 'wheel' && <label className="block space-y-2 text-sm"><span>Resultados da roleta · um por linha</span><textarea className={liveField} rows={4} value={item.outcomesText} onChange={e => change(i, 'outcomesText', e.target.value)} maxLength={2000} /><span className="text-xs text-px-muted">De 2 a 20 opções, com chances iguais. O servidor define um único resultado por compra.</span></label>}
        <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={item.active} onChange={e => change(i, 'active', e.target.checked)} className="h-4 w-4 accent-purple-500" />Disponível para novas interações</label>
      </article>)}
      <div className="space-y-3 rounded-xl bg-px-elevated p-4"><h3 className="font-semibold">🎯 Meta da live</h3><label className="block space-y-1 text-sm"><span>Objetivo</span><input className={liveField} value={value.goal.title} maxLength={100} onChange={e => goalChange('title', e.target.value)} disabled={(data?.goal?.raised_cents || 0) > 0} /></label><label className="block space-y-1 text-sm"><span>Alvo em reais</span><input className={liveField} inputMode="decimal" value={value.goal.price} onChange={e => goalChange('price', e.target.value)} disabled={(data?.goal?.raised_cents || 0) > 0} /></label><label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={value.goal.active} onChange={e => goalChange('active', e.target.checked)} className="h-4 w-4 accent-purple-500" />Mostrar meta e contabilizar as interações</label><p className="text-xs text-px-muted">Enquanto a meta estiver ativa, gorjetas, presentes, ações e roletas contam automaticamente para ela. Os valores entram na hora. Não há devolução automática; você pode devolver por escolha própria. Uma meta já apoiada preserva o título e o alvo.</p></div>
    </fieldset>{(failure || notice) && <p role={failure ? 'alert' : 'status'} className={`text-sm ${failure ? 'text-red-400' : 'text-emerald-400'}`}>{failure || notice}</p>}<div className="flex flex-wrap gap-2"><Button type="submit" loading={busy}><Save size={16} />Salvar interações</Button>{draft && <Button type="button" variant="ghost" disabled={busy} onClick={() => { setDraft(null); setFailure(''); }}>Descartar alterações</Button>}</div><p className="text-xs text-px-muted">Os controles administrativos podem pausar uma categoria. Remover uma opção pausa novas compras e preserva o histórico.</p></form>}
    {sessionId && <div className="border-t border-px-border pt-5"><LiveOrdersPanel sessionId={sessionId} creator /></div>}
  </section>;
}
