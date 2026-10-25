import { TIMING } from './config';

export function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

export function dateKey(ts: number | Date = Date.now()) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Paleta do timer do slot (verde → âmbar → vermelho). Igual ao getSlotTimerPalette original. */
export function timerPalette(elapsed: number) {
  const danger = elapsed >= TIMING.SLOT_TIMER_DANGER_MS;
  const warn = elapsed >= TIMING.SLOT_TIMER_WARNING_MS;
  const rgb = danger ? '239, 68, 68' : warn ? '245, 158, 11' : '34, 197, 94';
  const hex = danger ? '#ef4444' : warn ? '#f59e0b' : '#22c55e';
  return {
    text: hex,
    bg: `rgba(${rgb}, 0.08)`,
    border: `rgba(${rgb}, 0.35)`,
    glow: `rgba(${rgb}, 0.2)`,
    windowBorder: `rgba(${rgb}, 0.38)`,
    windowTop: hex,
  };
}
