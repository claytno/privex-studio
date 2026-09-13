export const liveMoney = cents => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((Number(cents) || 0) / 100);
export const liveKinds = { tip: 'Gorjeta', gift: 'Presente', action: 'Ação paga', wheel: 'Roleta' };
export function liveVisibleKinds(data) {
  return Object.entries({ tip: 'tips_enabled', gift: 'gifts_enabled', action: 'actions_enabled', wheel: 'wheel_enabled' })
    .filter(([kind, flag]) => data?.controls?.[flag] && (kind === 'tip' || data?.items?.some(item => item.kind === kind && item.active)))
    .map(([kind]) => kind);
}
export function parseLiveCents(value) {
  const text = String(value).trim();
  if (!/^\d{1,7}(?:[,.]\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.replace(',', '.').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}
export const liveDate = value => value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
export function liveOutcome(value) {
  for (const item of [value?.outcome, value?.result_label, value?.result?.label, value?.result]) {
    if (typeof item === 'string' && item.trim()) return item;
  }
  return '';
}
export const liveField = 'min-h-11 w-full rounded-xl border border-px-border bg-px-bg px-3 py-2 text-base outline-none focus:border-px-purple-400 disabled:opacity-60';
