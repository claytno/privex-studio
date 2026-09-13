// Sons do Studio gerados via Web Audio, com o mesmo timbre do site: senos puros,
// envelope suave e passa-baixa. Sem arquivos de áudio e sem rede.
// A preferência fica neste computador (localStorage px_sound), padrão ligado.

let ctx = null;
let lastPlay = 0;
const SOUND_PREF_KEY = 'px_sound';

export function isSoundEnabled() {
  try { return localStorage.getItem(SOUND_PREF_KEY) !== '0'; } catch { return true; }
}

export function setSoundEnabled(enabled) {
  try { localStorage.setItem(SOUND_PREF_KEY, enabled ? '1' : '0'); } catch {}
}

function getCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function note(audioCtx, freq, startAt, duration, peak) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const filter = audioCtx.createBiquadFilter();
  osc.type = 'sine';
  osc.frequency.value = freq;
  filter.type = 'lowpass';
  filter.frequency.value = 1800;
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(filter).connect(gain).connect(audioCtx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.05);
}

/**
 * Interação recebida durante a live: três notas ascendentes curtas (C5 → E5 → G5).
 * Toca no alto-falante deste computador. Se o microfone estiver aberto perto da
 * caixa de som, o público pode ouvir; por isso existe o botão de silenciar o aviso.
 */
export function playInteractionSound() {
  if (!isSoundEnabled()) return;
  const now = Date.now();
  if (now - lastPlay < 2000) return; // Uma sequência de compras não vira barulho contínuo.
  const audioCtx = getCtx();
  if (!audioCtx || audioCtx.state !== 'running') return;
  lastPlay = now;
  try {
    const t = audioCtx.currentTime;
    note(audioCtx, 523.25, t, 0.22, 0.07);
    note(audioCtx, 659.25, t + 0.10, 0.24, 0.07);
    note(audioCtx, 783.99, t + 0.20, 0.5, 0.075);
  } catch { /* áudio indisponível neste computador */ }
}
