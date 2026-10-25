import { APP_SCALE, FONT_SCALE, STORAGE_KEYS } from "@/lib/config";
import { readAppScale, readFontScale, writeString } from "@/lib/storage";
import { clamp } from "@/lib/format";

export const SCALE_CHANGED_EVENT = "fw-scale-change";

export function clampAppScale(value: number) {
    if (!Number.isFinite(value)) return APP_SCALE.default;
    return clamp(value, APP_SCALE.min, APP_SCALE.max);
}

export function clampFontScale(value: number) {
    if (!Number.isFinite(value)) return FONT_SCALE.default;
    return clamp(value, FONT_SCALE.min, FONT_SCALE.max);
}

export function applyAppScale(value: number, persist = true) {
    const safe = clampAppScale(value);
    if (typeof document === "undefined") return safe;
    document.documentElement.style.setProperty(
        "--app-scale",
        safe.toFixed(2),
    );
    if (persist) writeString(STORAGE_KEYS.appScale, String(safe));
    window.dispatchEvent(
        new CustomEvent(SCALE_CHANGED_EVENT, { detail: { scale: safe } }),
    );
    return safe;
}

export function applyFontScale(value: number, persist = true) {
    const safe = clampFontScale(value);
    if (typeof document === "undefined") return safe;
    document.documentElement.style.setProperty(
        "--font-scale",
        safe.toFixed(2),
    );
    if (persist) writeString(STORAGE_KEYS.fontScale, String(safe));
    return safe;
}

export function loadScaleSettings() {
    return {
        app: applyAppScale(readAppScale(), false),
        font: applyFontScale(readFontScale(), false),
    };
}
