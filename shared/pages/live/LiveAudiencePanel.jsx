import { useState } from 'react';
import useLivePolling from "../../hooks/useLivePolling.js";
import { Button } from "../../../renderer/shared-ui.js";

export default function LiveAudiencePanel({ sessionId }) {
  const [page, setPage] = useState(1);
  const { data, loading, error, refresh } = useLivePolling(`/lives/${sessionId}/audience?page=${page}`, 15000);
  const viewers = data?.viewers;
  return <div className="space-y-4">
    <p className="text-sm text-px-muted">{data ? `${data.viewer_count} pessoas na live.` : 'Carregando público…'} Cada conta é contada uma vez. A lista pode levar até 90 segundos para refletir saídas.</p>
    {error && <div role="alert" className="text-sm text-red-400">{error}<Button onClick={refresh} variant="secondary" className="mt-2">Tentar novamente</Button></div>}
    {loading && <p role="status">Carregando…</p>}
    <ul className="max-h-[50dvh] space-y-2 overflow-y-auto">{viewers?.data?.map(user => <li key={user.id} className="min-w-0 rounded-xl border border-px-border p-3"><span className="block break-words font-medium">{user.name}</span><span className="block break-words text-sm text-px-muted">@{user.username}</span></li>)}</ul>
    {viewers?.total === 0 && <p className="text-sm text-px-muted">Ainda não há espectadores na sala.</p>}
    {viewers && viewers.last_page > 1 && <div className="flex flex-wrap items-center justify-between gap-2"><Button variant="secondary" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>Anterior</Button><span className="text-xs">Página {page} de {viewers.last_page}</span><Button variant="secondary" disabled={page >= viewers.last_page || loading} onClick={() => setPage(value => value + 1)}>Próxima</Button></div>}
  </div>;
}
