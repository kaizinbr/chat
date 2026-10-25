import { TIMING } from "./config";

export function formatDuration(ms: number) {
    const totalSecs = Math.max(0, Math.floor((ms || 0) / 1000));
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

export function formatCountdown(ms: number) {
    const safe = Math.max(0, ms || 0);
    const totalSecs = Math.ceil(safe / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

/** Chave de data local, no formato YYYY-MM-DD (nunca UTC). */
export function getToday(ts: number | Date = Date.now()) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate(),
    ).padStart(2, "0")}`;
}

export const dateKey = getToday;

export function formatClock(ts: number | Date = Date.now()) {
    return new Date(ts).toLocaleTimeString("pt-BR");
}

export function formatLongDate(ts: number | Date = Date.now()) {
    return new Date(ts).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
}

export function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

export function escapeHtmlText(value: unknown) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/** Paleta do timer do slot (verde → âmbar → vermelho). */
export function timerPalette(elapsed: number) {
    const danger = elapsed >= TIMING.SLOT_TIMER_DANGER_MS;
    const warn = elapsed >= TIMING.SLOT_TIMER_WARNING_MS;
    const rgb = danger ? "239, 68, 68" : warn ? "245, 158, 11" : "34, 197, 94";
    const hex = danger ? "#ef4444" : warn ? "#f59e0b" : "#22c55e";
    return {
        text: hex,
        bg: `rgba(${rgb}, 0.08)`,
        border: `rgba(${rgb}, 0.35)`,
        insetGlow: `rgba(${rgb}, 0.12)`,
        outerGlow: `rgba(${rgb}, 0.15)`,
        windowBorder: `rgba(${rgb}, 0.38)`,
        windowTop: hex,
        windowShadow: `rgba(${rgb}, 0.2)`,
        glow: `rgba(${rgb}, 0.2)`,
    };
}
