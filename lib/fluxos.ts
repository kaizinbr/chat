import { STORAGE_KEYS } from "@/lib/config";
import { FLUXOS_UPDATED_EVENT } from "@/lib/events";
import { readJSON, writeJSON } from "@/lib/storage";

export interface Fluxo {
    titulo: string;
    caminho: string;
}

function normalizeFluxos(value: unknown): Fluxo[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => {
            if (!item || typeof item !== "object") return null;
            const fluxo = item as { titulo?: unknown; caminho?: unknown };
            const titulo = String(fluxo.titulo ?? "").trim();
            const caminho = String(fluxo.caminho ?? "").trim();
            return titulo && caminho ? { titulo, caminho } : null;
        })
        .filter((item): item is Fluxo => item !== null);
}

export function readFluxosFromCache(): Fluxo[] {
    return normalizeFluxos(readJSON<unknown>(STORAGE_KEYS.fluxos, []));
}

export function writeFluxosToCache(fluxos: Fluxo[]) {
    writeJSON(STORAGE_KEYS.fluxos, fluxos);
    if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(FLUXOS_UPDATED_EVENT));
    }
}

/**
 * O painel original sempre sobrescreve o cache local com o fluxos.json do
 * servidor ao iniciar.
 */
export async function loadFluxosFromServer(): Promise<Fluxo[] | null> {
    try {
        const response = await fetch("/fluxos.json", { cache: "no-store" });
        if (!response.ok) return null;
        const value = await response.json();
        const fluxos = normalizeFluxos(value);
        writeFluxosToCache(fluxos);
        return fluxos;
    } catch {
        return null;
    }
}

export async function persistFluxos(fluxos: Fluxo[]) {
    const payload = JSON.stringify(fluxos, null, 2) + "\n";
    const endpoints = [
        { url: "/api/fluxos", method: "PUT" },
        { url: "/api/fluxos", method: "POST" },
        { url: "/fluxos.json", method: "PUT" },
    ] as const;

    for (const endpoint of endpoints) {
        try {
            const response = await fetch(endpoint.url, {
                method: endpoint.method,
                headers: { "Content-Type": "application/json" },
                body: payload,
                cache: "no-store",
            });
            if (response.ok) {
                return { ok: true as const, endpoint: endpoint.url };
            }
        } catch {
            // tenta o próximo endpoint
        }
    }
    return { ok: false as const, endpoint: null };
}

export function normalizeFluxoList(value: unknown) {
    return normalizeFluxos(value);
}
