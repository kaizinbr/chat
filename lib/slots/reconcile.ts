import type { SidebarChat } from "@/lib/bridge/protocol";
import { ROCKET_HOME_URL, TIMING } from "@/lib/config";

export interface Slot {
    id: number;
    nome: string;
    matricula: string | null;
    protocolo: string | null;
    tipoCliente: string | null;
    motivoAtual: string | null;
    quantidadeAbandono: string | null;
    quantidadeChats: string | null;
    tags: string[];
    availableTags: string[];
    badgeCount: number;
    chatUrl: string | null;
    openedAt: number;
    /**
     * URL carregada no iframe. Definida apenas quando o slot é ocupado/restaurado.
     * A fila do Rocket atualiza `chatUrl` sem recarregar o iframe (igual ao original).
     */
    frameSrc: string;
    site: string;
    motivo: string;
}

export interface SlotMeta {
    missingSince?: number;
    missingHits?: number;
    finalizeRequestedAt?: number;
    restoredFromCacheAt?: number;
}

export type Slots = Record<number, Slot | null>;
export type MetaMap = Record<number, SlotMeta>;
export type Suppressed = Record<string, true>;

export function normalizeChatName(name: string | null | undefined) {
    return (name ?? "")
        .toString()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export function extractRoomId(url: string | null | undefined) {
    if (!url) return "";
    try {
        const u = new URL(url, "https://x.invalid");
        let m = u.pathname.match(/\/omnichannel\/current\/([^/?#]+)/i);
        if (m && m[1] && m[1] !== "current") return m[1];
        m = u.pathname.match(/\/(?:channel|group|direct|room)\/([^/?#]+)/i);
        if (m && m[1]) return m[1];
        return u.searchParams.get("rid") || u.searchParams.get("roomId") || "";
    } catch {
        return "";
    }
}

export function canEmbedInIframe(url: string | null | undefined) {
    if (!url) return false;
    try {
        const parsed = new URL(url, typeof window === "undefined" ? "https://x.invalid" : window.location.href);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false;
    }
}

export function targetFrameSrc(chatUrl: string | null | undefined) {
    return chatUrl && canEmbedInIframe(chatUrl) ? chatUrl : ROCKET_HOME_URL;
}

export function findSlotByName(slots: Slots, maxSlots: number, nome: string) {
    for (let id = 1; id <= maxSlots; id++) {
        if (slots[id]?.nome === nome) return id;
    }
    const target = normalizeChatName(nome);
    if (!target) return null;
    for (let id = 1; id <= maxSlots; id++) {
        const n = slots[id]?.nome;
        if (n && normalizeChatName(n) === target) return id;
    }
    return null;
}

export function findFreeSlot(slots: Slots, maxSlots: number) {
    for (let id = 1; id <= maxSlots; id++) if (!slots[id]) return id;
    return null;
}

export function newSlot(
    id: number,
    chat: Pick<SidebarChat, "nome" | "badgeCount" | "chatUrl">,
    openedAt: number,
): Slot {
    return {
        id,
        nome: chat.nome,
        matricula: null,
        protocolo: null,
        tipoCliente: null,
        motivoAtual: null,
        quantidadeAbandono: null,
        quantidadeChats: null,
        tags: [],
        availableTags: [],
        badgeCount: chat.badgeCount,
        chatUrl: chat.chatUrl,
        openedAt,
        frameSrc: targetFrameSrc(chat.chatUrl),
        site: "CG",
        motivo: "",
    };
}

export function releaseInPlace(
    slots: Slots,
    meta: MetaMap,
    suppressed: Suppressed,
    id: number,
) {
    const slot = slots[id];
    if (slot) {
        const rid = extractRoomId(slot.chatUrl);
        if (rid) suppressed[`rid:${rid}`] = true;
    }
    slots[id] = null;
    delete meta[id];
    return slot?.nome ?? "";
}

export interface ReconcileInput {
    slots: Slots;
    meta: MetaMap;
    suppressed: Suppressed;
    maxSlots: number;
    mainSidebarReady: boolean;
    appStartedAt: number;
    now: number;
    getCachedOpenedAt: (nome: string) => number | null;
}

export interface ReconcileOutput {
    slots: Slots;
    meta: MetaMap;
    suppressed: Suppressed;
    released: { slotId: number; nome: string }[];
    assigned: number[];
    reopen: number[];
    /** Slots cujo atendimento reiniciou (mesmo nome, sala nova). */
    restarted: number[];
}

/**
 * Porte fiel de processSidebarUpdate() do script original.
 * Recebe a fila vista pelo frame principal e devolve estado + efeitos.
 */
export function reconcileSidebar(
    input: ReconcileInput,
    sidebarChats: SidebarChat[],
): ReconcileOutput {
    const { maxSlots, now } = input;
    const slots: Slots = { ...input.slots };
    const meta: MetaMap = Object.fromEntries(
        Object.entries(input.meta).map(([key, value]) => [key, { ...value }]),
    );
    const suppressed: Suppressed = { ...input.suppressed };
    const released: ReconcileOutput["released"] = [];
    const assigned: number[] = [];
    const restarted: number[] = [];
    const reopen = new Set<number>();

    const hasActiveSlots = Array.from({ length: maxSlots }, (_, i) => i + 1).some(
        (id) => !!slots[id]?.nome,
    );
    const skipMissingCleanup = !input.mainSidebarReady && hasActiveSlots;
    const inInitialSyncGrace =
        now - input.appStartedAt < TIMING.INITIAL_SIDEBAR_SYNC_GRACE_MS;

    const visible = sidebarChats.filter((chat) => {
        const rid = extractRoomId(chat.chatUrl);
        return !(rid && suppressed[`rid:${rid}`]);
    });
    const visibleNames = visible.map((chat) => chat.nome);
    const visibleNorm = visibleNames.map(normalizeChatName).filter(Boolean);
    const returned = new Set<number>();

    // 1) Slots cujo chat sumiu da fila.
    for (let id = 1; id <= maxSlots; id++) {
        const slot = slots[id];
        if (!slot || skipMissingCleanup) continue;

        const norm = normalizeChatName(slot.nome);
        const exists =
            visibleNames.includes(slot.nome) ||
            (norm ? visibleNorm.includes(norm) : false);
        const m = (meta[id] ??= {});

        if (exists) {
            if (m.missingSince) {
                returned.add(id);
                delete m.missingSince;
                delete m.missingHits;
            }
            // Nunca apaga finalizeRequestedAt aqui (igual ao original).
            delete m.restoredFromCacheAt;
            continue;
        }

        if (!m.missingSince) {
            m.missingSince = now;
            m.missingHits = 1;
        } else {
            m.missingHits = (m.missingHits ?? 0) + 1;
        }

        const missingFor = now - m.missingSince;
        const hits = m.missingHits ?? 0;

        const doRelease = () => {
            released.push({
                slotId: id,
                nome: releaseInPlace(slots, meta, suppressed, id),
            });
        };

        if (
            m.finalizeRequestedAt &&
            missingFor >= TIMING.SLOT_FINALIZE_WAIT_GRACE_MS &&
            hits >= 1
        ) {
            doRelease();
            continue;
        }

        if (
            m.restoredFromCacheAt &&
            input.mainSidebarReady &&
            missingFor >= TIMING.SLOT_CACHE_VERIFY_GRACE_MS &&
            hits >= 2
        ) {
            doRelease();
            continue;
        }

        if (
            !inInitialSyncGrace &&
            missingFor >= TIMING.SLOT_AUTO_RELEASE_GRACE_MS &&
            hits >= TIMING.SLOT_AUTO_RELEASE_MIN_HITS
        ) {
            doRelease();
        }
    }

    // 2) Chats da fila -> slot existente ou livre.
    for (const chat of visible) {
        const existingId = findSlotByName(slots, maxSlots, chat.nome);

        if (existingId) {
            let current = slots[existingId]!;
            const previousRoomId = extractRoomId(current.chatUrl);
            const incomingRoomId = extractRoomId(chat.chatUrl);
            const isNewAttendanceSameName =
                !!previousRoomId &&
                !!incomingRoomId &&
                previousRoomId !== incomingRoomId;

            if (isNewAttendanceSameName) {
                current = {
                    ...current,
                    nome: chat.nome,
                    matricula: null,
                    protocolo: null,
                    tipoCliente: null,
                    motivoAtual: null,
                    quantidadeAbandono: null,
                    quantidadeChats: null,
                    tags: [],
                    availableTags: [],
                    motivo: "",
                    openedAt: now,
                };
                restarted.push(existingId);
            }

            slots[existingId] = {
                ...current,
                nome: chat.nome,
                badgeCount: chat.badgeCount,
                chatUrl: chat.chatUrl ?? current.chatUrl,
            };

            if (returned.has(existingId)) reopen.add(existingId);
        } else {
            const free = findFreeSlot(slots, maxSlots);
            if (!free) continue;
            delete meta[free];
            slots[free] = newSlot(
                free,
                chat,
                input.getCachedOpenedAt(chat.nome) ?? now,
            );
            assigned.push(free);
            reopen.add(free);
        }
    }

    return {
        slots,
        meta,
        suppressed,
        released,
        assigned,
        reopen: [...reopen],
        restarted,
    };
}
