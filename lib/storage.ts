import {
    APP_SCALE,
    DEFAULT_PENDING_AUTO_REPLY_MESSAGES,
    FONT_SCALE,
    STORAGE_KEYS,
    TIMING,
} from "@/lib/config";
import { normalizeChatName } from "@/lib/slots/reconcile";

export function readJSON<T>(key: string, fallback: T): T {
    if (typeof window === "undefined") return fallback;
    try {
        const raw = window.localStorage.getItem(key);
        if (raw === null) return fallback;
        const parsed = JSON.parse(raw);
        return parsed === null || parsed === undefined ? fallback : (parsed as T);
    } catch {
        return fallback;
    }
}

export function writeJSON(key: string, value: unknown) {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Persistência é best-effort, como no painel original.
    }
}

export function readString(key: string): string | null {
    if (typeof window === "undefined") return null;
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

export function writeString(key: string, value: string) {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(key, value);
    } catch {
        // ignore
    }
}

export function removeKey(key: string) {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.removeItem(key);
    } catch {
        // ignore
    }
}

// ───────── cache de "aberto em" por nome (mesmo formato do original) ─────────

type OpenedAtCache = Record<string, { openedAt: number; touchedAt: number }>;

function sameLocalDay(timestamp: number) {
    const date = new Date(timestamp);
    const now = new Date();
    return (
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate()
    );
}

export function getCachedOpenedAt(chatName: string): number | null {
    const key = normalizeChatName(chatName);
    if (!key) return null;
    const cache = readJSON<OpenedAtCache>(STORAGE_KEYS.openedAt, {});
    const item = cache[key];
    if (!item?.openedAt) return null;
    const expired =
        !item.touchedAt ||
        Date.now() - item.touchedAt > TIMING.OPENED_AT_CACHE_TTL_MS;
    if (expired || !sameLocalDay(item.openedAt)) {
        delete cache[key];
        writeJSON(STORAGE_KEYS.openedAt, cache);
        return null;
    }
    return item.openedAt;
}

export function setCachedOpenedAt(chatName: string, openedAt: number) {
    const key = normalizeChatName(chatName);
    if (!key || !openedAt) return;
    const cache = readJSON<OpenedAtCache>(STORAGE_KEYS.openedAt, {});
    cache[key] = { openedAt, touchedAt: Date.now() };
    writeJSON(STORAGE_KEYS.openedAt, cache);
}

export function removeCachedOpenedAt(chatName: string) {
    const key = normalizeChatName(chatName);
    if (!key) return;
    const cache = readJSON<OpenedAtCache>(STORAGE_KEYS.openedAt, {});
    if (cache[key]) {
        delete cache[key];
        writeJSON(STORAGE_KEYS.openedAt, cache);
    }
}

export function clearOpenedAtCache() {
    removeKey(STORAGE_KEYS.openedAt);
}

// ───────── preferências simples ─────────

export function loadPendingMessages(): string[] {
    const raw = readJSON<unknown>(STORAGE_KEYS.pendingMessages, []);
    const cleaned = Array.isArray(raw)
        ? raw.map((item) => String(item ?? "").trim()).filter(Boolean)
        : [];
    return cleaned.length
        ? cleaned
        : [...DEFAULT_PENDING_AUTO_REPLY_MESSAGES];
}

export function savePendingMessages(messages: string[]) {
    const cleaned = messages.map((item) => item.trim()).filter(Boolean);
    const value = cleaned.length
        ? cleaned
        : [...DEFAULT_PENDING_AUTO_REPLY_MESSAGES];
    writeJSON(STORAGE_KEYS.pendingMessages, value);
    return value;
}

export function loadAttentionMuted() {
    return readString(STORAGE_KEYS.attentionMuted) === "1";
}

export function saveAttentionMuted(muted: boolean) {
    writeString(STORAGE_KEYS.attentionMuted, muted ? "1" : "0");
}

export function readScale(
    key: string,
    fallback: number,
    min: number,
    max: number,
) {
    const raw = readString(key);
    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
}

export function readAppScale() {
    return readScale(
        STORAGE_KEYS.appScale,
        APP_SCALE.default,
        APP_SCALE.min,
        APP_SCALE.max,
    );
}

export function readFontScale() {
    return readScale(
        STORAGE_KEYS.fontScale,
        FONT_SCALE.default,
        FONT_SCALE.min,
        FONT_SCALE.max,
    );
}
