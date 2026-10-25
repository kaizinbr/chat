import type {
    FrAgent,
    FrAuth,
    FrQueueEntry,
} from "@/lib/bridge/protocol";
import {
    sendCommand,
    type FromExtension,
    type ToExtension,
} from "@/lib/bridge/protocol";
import { getFrame } from "@/lib/bridge/frames";
import {
    MSG_SOURCE_PARENT,
    ROCKET_ORIGIN,
    STORAGE_KEYS,
    TIMING,
} from "@/lib/config";
import { readString, removeKey, writeString } from "@/lib/storage";

// ================================================================
// Regras copiadas de original/FR/INDEX.html
// ================================================================

export const FR_N2_DEPT = "AgPki67wjCZpN5X2W";
/** Agente/bot que recebe os CRs em fila. */
export const FR_QUEUE_AGENT_ID = "2p7YLxPWbNHSkurQ9";
/** Só entra no dashboard quem participa de mais de 10 filas. */
export const FR_MIN_DEPARTMENTS = 10;
/** Usado apenas no card "Total de Agentes" (inclui deslogados). */
export const FR_TOTAL_MIN_DEPARTMENTS = 12;
export const FR_EXCLUDED_USERNAME = "fila.chat";

const AGENT_PALETTE = [
    "#7c4dff",
    "#3d8bff",
    "#26a69a",
    "#ec407a",
    "#ab47bc",
    "#5c6bc0",
    "#42a5f5",
    "#26c6da",
    "#66bb6a",
    "#ffa726",
] as const;

const STATUS_LABELS: Record<string, string> = {
    online: "Disponível",
    away: "Ausente",
    away_almoco: "Pausa Almoço",
    away_feedback: "Pausa Feedback",
    busy: "Ocupado",
    offline: "Deslogado",
};

export type FrSortMode = "default" | "chats" | "unavailable" | "alpha";

export type FrBridgeResult = Extract<
    FromExtension,
    { type: "ROCKETCHAT_FR_RESULT" }
>;

export interface FrCredentials {
    apiUrl: string;
    username: string;
    digest: string;
}

// ================================================================
// Credenciais (mesmas chaves do FR original)
// ================================================================

export function readFrAuth(): FrAuth | null {
    const token = readString(STORAGE_KEYS.frToken);
    const userId = readString(STORAGE_KEYS.frUserId);
    return token && userId ? { token, userId } : null;
}

export function saveFrSession(token: string, userId: string, apiUrl: string) {
    writeString(STORAGE_KEYS.frToken, token);
    writeString(STORAGE_KEYS.frUserId, userId);
    writeString(STORAGE_KEYS.frApiUrl, apiUrl);
}

export function clearFrSession() {
    removeKey(STORAGE_KEYS.frToken);
    removeKey(STORAGE_KEYS.frUserId);
    removeKey(STORAGE_KEYS.frApiUrl);
}

export function readFrCredentials(): FrCredentials {
    return {
        apiUrl:
            readString(STORAGE_KEYS.frApiUrl)?.trim() || ROCKET_ORIGIN,
        username: readString(STORAGE_KEYS.frUsername)?.trim() || "",
        digest: readString(STORAGE_KEYS.frPasswordDigest)?.trim() || "",
    };
}

export function saveFrCredentials(
    username: string,
    digest: string,
    apiUrl: string,
) {
    writeString(STORAGE_KEYS.frUsername, username);
    writeString(STORAGE_KEYS.frPasswordDigest, digest);
    writeString(STORAGE_KEYS.frApiUrl, apiUrl);
}

export function clearFrCredentials() {
    clearFrSession();
    removeKey(STORAGE_KEYS.frUsername);
    removeKey(STORAGE_KEYS.frPasswordDigest);
}

/** O FR original guardava o digest SHA-256, nunca a senha em texto puro. */
export async function hashFrPassword(password: string) {
    const buffer = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(password),
    );
    return Array.from(new Uint8Array(buffer))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

// ================================================================
// Bridge (a extensão faz as chamadas na origem do Rocket)
// ================================================================

function requestId() {
    return `fr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function frRequest(
    payload: Omit<
        Extract<ToExtension, { type: "FR_REQUEST" }>,
        "source" | "type"
    >,
): Promise<FrBridgeResult> {
    const frame = getFrame("rocket");
    if (!frame?.contentWindow) {
        return {
            type: "ROCKETCHAT_FR_RESULT",
            source: "firewall-extension",
            requestId: payload.requestId,
            ok: false,
            error: "O painel do Rocket.Chat ainda não está disponível.",
        };
    }

    try {
        return await sendCommand(
            frame,
            {
                source: MSG_SOURCE_PARENT,
                type: "FR_REQUEST",
                ...payload,
            },
            {
                rocketOrigin: ROCKET_ORIGIN,
                timeoutMs: TIMING.FR_REQUEST_TIMEOUT_MS,
                filter: (message) =>
                    message.type === "ROCKETCHAT_FR_RESULT" &&
                    message.requestId === payload.requestId,
            },
        );
    } catch (error) {
        return {
            type: "ROCKETCHAT_FR_RESULT",
            source: "firewall-extension",
            requestId: payload.requestId,
            ok: false,
            error:
                (error as Error).message ||
                "Tempo esgotado ao consultar a fila. Verifique a extensão e o login no Rocket.Chat.",
        };
    }
}

export function requestFrDashboard(auth: FrAuth | null) {
    return frRequest({
        requestId: requestId(),
        action: "dashboard",
        auth: auth ?? undefined,
    });
}

export function requestFrLogin(username: string, digest: string) {
    return frRequest({
        requestId: requestId(),
        action: "login",
        username,
        digest,
    });
}

// ================================================================
// Normalização / regras de exibição
// ================================================================

export function frAgentName(agent: FrAgent) {
    return (agent.name || agent.username || "?").trim();
}

export function frInitials(name: string) {
    return name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase();
}

export function frColor(username: string) {
    let hash = 0;
    for (let index = 0; index < username.length; index++) {
        hash = (hash << 5) - hash + username.charCodeAt(index);
        hash |= 0;
    }
    return AGENT_PALETTE[Math.abs(hash) % AGENT_PALETTE.length];
}

export function frDepartmentIds(agent: FrAgent) {
    if (!Array.isArray(agent.departments)) return [];
    return agent.departments.map((department) =>
        typeof department === "string" ? department : department?._id ?? "",
    );
}

export function isFrN2(agent: FrAgent) {
    return frDepartmentIds(agent).some(
        (departmentId) => departmentId === FR_N2_DEPT,
    );
}

export function frStatusLabel(status?: string) {
    return STATUS_LABELS[status ?? ""] ?? status ?? "Deslogado";
}

export function frStatusDotClass(status?: string) {
    if (status === "online" || status === "available") return "online";
    if (
        status === "away" ||
        status === "away_almoco" ||
        status === "away_feedback"
    ) {
        return "away";
    }
    if (status === "busy") return "busy";
    return "offline";
}

/** O ponto do card reflete se o operador aceita novos chats. */
export function frLivechatDotClass(agent: FrAgent) {
    return agent.statusLivechat === "available" ? "online" : "busy";
}

export function frAgentRank(agent: FrAgent) {
    const available = agent.statusLivechat === "available";
    const online = agent.status === "online";
    const n2 = isFrN2(agent);
    if (agent.status === "offline" && !available) return 6;
    if (n2 && available && online) return 0;
    if (available && online) return 1;
    if (n2 && available) return 2;
    if (available) return 3;
    if (n2) return 4;
    return 5;
}

export function filterFrAgents(agents: FrAgent[]) {
    return agents.filter(
        (agent) =>
            Array.isArray(agent.departments) &&
            agent.departments.length > FR_MIN_DEPARTMENTS &&
            !(
                agent.status === "offline" &&
                agent.statusLivechat !== "available"
            ) &&
            agent.username !== FR_EXCLUDED_USERNAME,
    );
}

export function countFrQualifiedAgents(agents: FrAgent[]) {
    return agents.filter(
        (agent) =>
            Array.isArray(agent.departments) &&
            agent.departments.length > FR_TOTAL_MIN_DEPARTMENTS &&
            agent.username !== FR_EXCLUDED_USERNAME,
    ).length;
}

export function aggregateFrRooms(entries: FrQueueEntry[]) {
    const counts: Record<string, number> = {};
    for (const entry of entries) {
        const agentId = entry.user?._id;
        if (!agentId) continue;
        counts[agentId] = (counts[agentId] ?? 0) + (entry.chats ?? 0);
    }
    return counts;
}

export function sortFrAgents(
    agents: FrAgent[],
    roomsByAgent: Record<string, number>,
    mode: FrSortMode,
    chatsDir: "asc" | "desc",
    alphaDir: "asc" | "desc",
) {
    const list = [...agents];
    if (mode === "chats") {
        const direction = chatsDir === "asc" ? 1 : -1;
        list.sort(
            (a, b) =>
                ((roomsByAgent[a._id] ?? 0) - (roomsByAgent[b._id] ?? 0)) *
                direction,
        );
        return list;
    }
    if (mode === "unavailable") {
        list.sort((a, b) => {
            const aAvailable = a.statusLivechat === "available" ? 1 : 0;
            const bAvailable = b.statusLivechat === "available" ? 1 : 0;
            if (aAvailable !== bAvailable) return aAvailable - bAvailable;
            return frAgentName(a).localeCompare(frAgentName(b), "pt-BR");
        });
        return list;
    }
    if (mode === "alpha") {
        const direction = alphaDir === "asc" ? 1 : -1;
        list.sort(
            (a, b) =>
                frAgentName(a).localeCompare(frAgentName(b), "pt-BR") *
                direction,
        );
        return list;
    }
    list.sort((a, b) => frAgentRank(a) - frAgentRank(b));
    return list;
}
