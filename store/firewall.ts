"use client";

import { useSyncExternalStore } from "react";
import type {
    AgentStatus,
    SidebarChat,
    VisitorDetails,
} from "@/lib/bridge/protocol";
import {
    DEFAULT_PENDING_AUTO_REPLY_MESSAGES,
    STORAGE_KEYS,
    TIMING,
    ROCKET_HOME_URL,
} from "@/lib/config";
import { audio } from "@/lib/audio";
import { CACHE_CLEARED_EVENT } from "@/lib/events";
import { getToday } from "@/lib/format";
import {
    makeHistoryLog,
    parseHistory,
    totalAttendance,
    type FinalStatus,
    type HistoryMap,
} from "@/lib/history";
import {
    clearOpenedAtCache,
    getCachedOpenedAt,
    loadAttentionMuted,
    loadPendingMessages,
    readJSON,
    removeCachedOpenedAt,
    removeKey,
    saveAttentionMuted,
    savePendingMessages,
    setCachedOpenedAt,
    writeJSON,
    writeString,
} from "@/lib/storage";
import {
    extractRoomId,
    findSlotByName,
    normalizeChatName,
    reconcileSidebar,
    targetFrameSrc,
    type MetaMap,
    type Slot,
    type Slots,
    type Suppressed,
} from "@/lib/slots/reconcile";

export type { FinalStatus, HistoryLog, HistoryMap } from "@/lib/history";

export interface SlotSignal {
    hasUnreadDivider: boolean;
    lastMessageFromVisitor: boolean;
    chatName: string;
    updatedAt: number;
}

export interface SlotRuntime {
    attention: boolean;
    unreadSince: number | null;
    snoozedUntil: number;
    autoReplyAt: number;
    desktopNotifiedAt: number;
}

export interface SlotPrompt {
    text: string;
    at: number;
}

export interface SlotPersistence {
    maxSlots: number;
    [key: number]: Omit<Slot, "id" | "frameSrc"> | null;
}

export interface FirewallState {
    hydrated: boolean;
    bootComplete: boolean;

    maxSlots: number;
    slots: Slots;
    meta: MetaMap;
    suppressed: Suppressed;
    windowOpen: Record<number, boolean>;
    signals: Record<number, SlotSignal>;
    runtime: Record<number, SlotRuntime>;
    prompts: Record<number, SlotPrompt>;
    history: HistoryMap;
    totalAtendimentos: number;

    bridgeActive: boolean;
    mainSidebarReady: boolean;
    agentStatus: AgentStatus;
    omniActive: boolean | null;
    avatarUrl: string | null;
    rocketOpen: boolean;

    pendingMessages: string[];
    attentionMuted: boolean;

    hydrate: () => {
        id: number;
        nome: string;
        chatUrl: string | null;
    }[];
    setBootComplete: (value: boolean) => void;
    setBridgeActive: () => void;
    setBridgeConnected: (value: boolean) => void;
    setMainSidebarReady: () => void;
    setAgent: (payload: {
        agentStatus?: AgentStatus;
        omniActive?: boolean | null;
    }) => void;
    setAvatarUrl: (url: string) => void;
    setRocketOpen: (open: boolean) => void;

    applySidebar: (chats: SidebarChat[]) => {
        reopen: { id: number; nome: string; chatUrl: string | null }[];
        assigned: number[];
        restarted: number[];
    };
    applyDetails: (details: VisitorDetails) => void;
    applySignal: (
        slotId: number,
        signal: Omit<SlotSignal, "updatedAt">,
    ) => void;
    releaseByName: (nome: string) => void;
    patchSlot: (id: number, patch: Partial<Slot>) => void;
    setFinalizeRequested: (id: number, on: boolean) => void;
    setWindowOpen: (id: number, open: boolean) => void;
    addSlot: () => void;
    saveHistory: (
        id: number,
        status: FinalStatus,
        options?: { motivo?: string; includeTma?: boolean },
    ) => void;

    runUnreadAutomation: () => void;
    snoozeUnread: (id: number) => void;
    setPrompt: (id: number, text: string) => void;
    clearPrompt: (id: number) => void;

    setPendingMessages: (messages: string[]) => void;
    setAttentionMuted: (muted: boolean) => void;
    clearHistoryData: () => void;
    clearAllCache: () => void;
}

const EMPTY_RUNTIME: SlotRuntime = {
    attention: false,
    unreadSince: null,
    snoozedUntil: 0,
    autoReplyAt: 0,
    desktopNotifiedAt: 0,
};

/** Mesma referência usada pela janela de graça do primeiro sync da sidebar. */
const APP_STARTED_AT = Date.now();

function runtimeFor(id: number, runtime: Record<number, SlotRuntime>) {
    return runtime[id] ?? EMPTY_RUNTIME;
}

function runtimeChanged(a: SlotRuntime, b: SlotRuntime) {
    return (
        a.attention !== b.attention ||
        a.unreadSince !== b.unreadSince ||
        a.snoozedUntil !== b.snoozedUntil ||
        a.autoReplyAt !== b.autoReplyAt ||
        a.desktopNotifiedAt !== b.desktopNotifiedAt
    );
}

function serializeSlots(state: FirewallState): SlotPersistence {
    const output: SlotPersistence = { maxSlots: state.maxSlots };
    for (let id = 1; id <= state.maxSlots; id++) {
        const slot = state.slots[id];
        if (!slot) {
            output[id] = null;
            continue;
        }
        const copy = { ...slot } as Partial<Slot>;
        delete copy.id;
        delete copy.frameSrc;
        output[id] = copy as Omit<Slot, "id" | "frameSrc">;
        setCachedOpenedAt(slot.nome, slot.openedAt || Date.now());
    }
    return output;
}

function persistSlots(state: FirewallState) {
    writeJSON(STORAGE_KEYS.slots, serializeSlots(state));
}

function activeSignal(
    signal: SlotSignal | undefined,
    slot: Slot | null | undefined,
) {
    if (!signal) return false;
    const unread =
        !!signal.hasUnreadDivider || !!signal.lastMessageFromVisitor;
    if (!unread) return false;
    const slotName = normalizeChatName(slot?.nome ?? "");
    const signalName = normalizeChatName(signal.chatName ?? "");
    if (!slotName || !signalName) return unread;
    return slotName === signalName;
}

function notifyDesktop(
    slotId: number,
    slot: Slot,
    runtime: SlotRuntime,
    now: number,
) {
    if (typeof window === "undefined" || !("Notification" in window)) {
        return false;
    }
    if (Notification.permission !== "granted") return false;
    if (
        runtime.desktopNotifiedAt &&
        now - runtime.desktopNotifiedAt < TIMING.SLOT_AUTO_REPLY_DELAY_MS
    ) {
        return false;
    }
    try {
        const notification = new Notification(
            "Firewall: mensagem aguardando",
            {
                body: `${slot.nome} está aguardando há mais de 1 minuto. Clique para abrir.`,
            },
        );
        notification.onclick = () => {
            window.focus();
            firewall.getState().setWindowOpen(slotId, true);
            try {
                notification.close();
            } catch {
                // ignore
            }
        };
        return true;
    } catch {
        return false;
    }
}

function requestNotificationPermission() {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "default") return;
    try {
        void Notification.requestPermission().catch(() => undefined);
    } catch {
        // ignore
    }
}

let requestPermissionDone = false;
function requestNotificationPermissionOnce() {
    if (requestPermissionDone) return;
    requestPermissionDone = true;
    requestNotificationPermission();
}

let state: FirewallState;

function setState(patch: Partial<FirewallState>) {
    state = { ...state, ...patch };
    emit();
}

const listeners = new Set<() => void>();

function emit() {
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function getState() {
    return state;
}

function releaseSlotState(
    current: FirewallState,
    id: number,
): Partial<FirewallState> {
    const slot = current.slots[id];
    const suppressed = { ...current.suppressed };
    const slots = { ...current.slots };
    const meta = { ...current.meta };
    const signals = { ...current.signals };
    const runtime = { ...current.runtime };
    const prompts = { ...current.prompts };
    const windowOpen = { ...current.windowOpen };

    if (slot) {
        const roomId = extractRoomId(slot.chatUrl);
        if (roomId) suppressed[`rid:${roomId}`] = true;
        removeCachedOpenedAt(slot.nome);
    }
    slots[id] = null;
    delete meta[id];
    delete signals[id];
    delete runtime[id];
    delete prompts[id];
    windowOpen[id] = false;

    return {
        slots,
        meta,
        suppressed,
        signals,
        runtime,
        prompts,
        windowOpen,
    };
}

export const firewall = {
    getState,
    subscribe,
    setState,
};

export const useFirewall = <T,>(
    selector: (current: FirewallState) => T,
): T => {
    const snapshot = () => selector(firewall.getState());
    return useSyncExternalStore(subscribe, snapshot, snapshot);
};

state = {
    hydrated: false,
    bootComplete: false,

    maxSlots: 3,
    slots: {},
    meta: {},
    suppressed: {},
    windowOpen: {},
    signals: {},
    runtime: {},
    prompts: {},
    // O primeiro render (SSR e hidratação) usa sempre valores vazios. O cache
    // real é carregado em hydrate(), evitando hydration mismatch com o servidor.
    history: {},
    totalAtendimentos: 0,

    bridgeActive: false,
    mainSidebarReady: false,
    agentStatus: "offline",
    omniActive: null,
    avatarUrl: null,
    rocketOpen: false,

    pendingMessages: [...DEFAULT_PENDING_AUTO_REPLY_MESSAGES],
    attentionMuted: false,

    hydrate: () => {
        const current = getState();
        if (current.hydrated) return [];

        const saved = readJSON<Record<string, unknown>>(
            STORAGE_KEYS.slots,
            {},
        );
        const savedMax = Number(saved.maxSlots);
        const maxSlots =
            Number.isFinite(savedMax) && savedMax > 3
                ? Math.floor(savedMax)
                : 3;

        const slots: Slots = {};
        const meta: MetaMap = {};
        const windowOpen: Record<number, boolean> = {};
        const restored: {
            id: number;
            nome: string;
            chatUrl: string | null;
        }[] = [];
        const today = getToday();

        for (let id = 1; id <= maxSlots; id++) {
            const raw = saved[id] as Partial<Slot> | null | undefined;
            if (!raw || typeof raw !== "object" || !raw.nome) continue;

            const chatUrl = raw.chatUrl ?? null;
            const savedOpenedAt =
                typeof raw.openedAt === "number"
                    ? raw.openedAt
                    : Date.now();
            const openedAt =
                getToday(savedOpenedAt) === today
                    ? savedOpenedAt
                    : Date.now();

            const slot: Slot = {
                id,
                nome: String(raw.nome),
                matricula: raw.matricula ?? null,
                protocolo: raw.protocolo ?? null,
                tipoCliente: raw.tipoCliente ?? null,
                motivoAtual: raw.motivoAtual ?? null,
                quantidadeAbandono: raw.quantidadeAbandono ?? null,
                quantidadeChats: raw.quantidadeChats ?? null,
                tags: Array.isArray(raw.tags) ? raw.tags : [],
                availableTags: Array.isArray(raw.availableTags)
                    ? raw.availableTags
                    : [],
                badgeCount: Number(raw.badgeCount) || 0,
                chatUrl,
                openedAt,
                frameSrc: targetFrameSrc(chatUrl),
                site: raw.site || "CG",
                motivo: raw.motivo || "",
            };

            slots[id] = slot;
            meta[id] = { restoredFromCacheAt: Date.now() };
            windowOpen[id] = true;
            setCachedOpenedAt(slot.nome, openedAt);
            restored.push({ id, nome: slot.nome, chatUrl });
        }

        const history = parseHistory(
            readJSON<unknown>(STORAGE_KEYS.history, {}),
        );
        const total = totalAttendance(history);
        writeString(STORAGE_KEYS.totalAtendimentos, String(total));

        setState({
            hydrated: true,
            maxSlots,
            slots,
            meta,
            windowOpen,
            history,
            totalAtendimentos: total,
            pendingMessages: loadPendingMessages(),
            attentionMuted: loadAttentionMuted(),
        });
        requestNotificationPermissionOnce();
        return restored;
    },

    setBootComplete: (value) => {
        audio.setReady(value);
        setState({ bootComplete: value });
    },

    setBridgeActive: () => {
        if (getState().bridgeActive) return;
        setState({ bridgeActive: true });
    },

    setBridgeConnected: (value) => setState({ bridgeActive: value }),

    setMainSidebarReady: () => {
        if (getState().mainSidebarReady) return;
        setState({ mainSidebarReady: true });
    },

    setAgent: ({ agentStatus, omniActive }) => {
        const current = getState();
        const patch: Partial<FirewallState> = {};
        if (agentStatus) patch.agentStatus = agentStatus;
        if (omniActive !== null && omniActive !== undefined) {
            patch.omniActive = omniActive;
        }
        if (Object.keys(patch).length === 0) return;
        if (
            (patch.agentStatus === undefined ||
                patch.agentStatus === current.agentStatus) &&
            (patch.omniActive === undefined ||
                patch.omniActive === current.omniActive)
        ) {
            return;
        }
        setState(patch);
    },

    setAvatarUrl: (avatarUrl) => {
        if (!avatarUrl || getState().avatarUrl === avatarUrl) return;
        setState({ avatarUrl });
    },

    setRocketOpen: (rocketOpen) => {
        if (getState().rocketOpen === rocketOpen) return;
        setState({ rocketOpen });
    },

    applySidebar: (chats) => {
        if (!Array.isArray(chats)) {
            return { reopen: [], assigned: [], restarted: [] };
        }
        const current = getState();
        const result = reconcileSidebar(
            {
                slots: current.slots,
                meta: current.meta,
                suppressed: current.suppressed,
                maxSlots: current.maxSlots,
                mainSidebarReady: current.mainSidebarReady,
                appStartedAt: APP_STARTED_AT,
                now: Date.now(),
                getCachedOpenedAt,
            },
            chats,
        );

        const windowOpen = { ...current.windowOpen };
        const signals = { ...current.signals };
        const runtime = { ...current.runtime };
        const prompts = { ...current.prompts };

        for (const released of result.released) {
            removeCachedOpenedAt(released.nome);
            windowOpen[released.slotId] = false;
            delete signals[released.slotId];
            delete runtime[released.slotId];
            delete prompts[released.slotId];
        }

        for (const id of result.assigned) {
            windowOpen[id] = true;
            delete signals[id];
            delete runtime[id];
            delete prompts[id];
        }

        for (const id of result.restarted) {
            delete signals[id];
            delete runtime[id];
            delete prompts[id];
        }

        // O original só abre a janela quando um slot novo é atribuído. Um
        // chat que reaparece depois de uma ausência curta tem o iframe
        // reaberto, mas não força a janela a aparecer.
        for (const id of result.assigned) {
            windowOpen[id] = true;
        }

        setState({
            slots: result.slots,
            meta: result.meta,
            suppressed: result.suppressed,
            windowOpen,
            signals,
            runtime,
            prompts,
        });
        persistSlots(getState());

        return {
            reopen: result.reopen.flatMap((id) => {
                const slot = result.slots[id];
                return slot
                    ? [
                          {
                              id,
                              nome: slot.nome,
                              chatUrl: slot.chatUrl,
                          },
                      ]
                    : [];
            }),
            assigned: result.assigned,
            restarted: result.restarted,
        };
    },

    applyDetails: (details) => {
        if (!details?.nome) return;
        const current = getState();
        const id = findSlotByName(
            current.slots,
            current.maxSlots,
            details.nome,
        );
        const slot = id ? current.slots[id] : null;
        if (!id || !slot) return;

        const next: Slot = {
            ...slot,
            matricula: details.matricula ?? slot.matricula,
            protocolo: details.protocolo ?? slot.protocolo,
            tipoCliente: details.tipoCliente ?? slot.tipoCliente,
            motivoAtual: details.motivoAtual ?? slot.motivoAtual,
            quantidadeAbandono:
                details.quantidadeAbandono ?? slot.quantidadeAbandono,
            quantidadeChats:
                details.quantidadeChats ?? slot.quantidadeChats,
            tags: Array.isArray(details.tags)
                ? details.tags
                : slot.tags,
            availableTags:
                Array.isArray(details.availableTags) &&
                details.availableTags.length
                    ? details.availableTags
                    : slot.availableTags,
        };

        setState({ slots: { ...current.slots, [id]: next } });
        persistSlots(getState());
    },

    applySignal: (slotId, signal) => {
        const current = getState();
        if (!current.slots[slotId]) return;
        setState({
            signals: {
                ...current.signals,
                [slotId]: { ...signal, updatedAt: Date.now() },
            },
        });
        getState().runUnreadAutomation();
    },

    releaseByName: (nome) => {
        const current = getState();
        const id = findSlotByName(current.slots, current.maxSlots, nome);
        if (!id) return;
        setState(releaseSlotState(current, id));
        persistSlots(getState());
    },

    patchSlot: (id, patch) => {
        const current = getState();
        const slot = current.slots[id];
        if (!slot) return;
        const next = { ...slot, ...patch };
        const changed = (Object.keys(patch) as (keyof Slot)[]).some(
            (key) => slot[key] !== next[key],
        );
        if (!changed) return;
        setState({ slots: { ...current.slots, [id]: next } });
        persistSlots(getState());
    },

    setFinalizeRequested: (id, on) => {
        const current = getState();
        const meta = { ...(current.meta[id] ?? {}) };
        if (on) meta.finalizeRequestedAt = Date.now();
        else delete meta.finalizeRequestedAt;
        setState({ meta: { ...current.meta, [id]: meta } });
    },

    setWindowOpen: (id, open) => {
        const current = getState();
        if (!!current.windowOpen[id] === open) return;
        setState({ windowOpen: { ...current.windowOpen, [id]: open } });
    },

    addSlot: () => {
        const current = getState();
        setState({ maxSlots: current.maxSlots + 1 });
        persistSlots(getState());
    },

    saveHistory: (id, status, options = {}) => {
        const current = getState();
        const slot = current.slots[id];
        if (!slot) return;

        const endTs = Date.now();
        const today = getToday();
        const day = current.history[today] ?? { count: 0, logs: [] };
        const log = makeHistoryLog(slot, status, {
            motivo: options.motivo,
            includeTma: !!options.includeTma,
            endTs,
            horario: new Date(endTs).toLocaleTimeString(),
        });
        const history: HistoryMap = {
            ...current.history,
            [today]: { count: day.count + 1, logs: [log, ...day.logs] },
        };
        const total = totalAttendance(history);

        removeCachedOpenedAt(slot.nome);
        setState({
            history,
            totalAtendimentos: total,
            slots: {
                ...current.slots,
                [id]: { ...slot, motivo: "" },
            },
        });
        writeJSON(STORAGE_KEYS.history, history);
        writeString(STORAGE_KEYS.totalAtendimentos, String(total));
        persistSlots(getState());
    },

    runUnreadAutomation: () => {
        const current = getState();
        const now = Date.now();
        const runtime = { ...current.runtime };
        const prompts = { ...current.prompts };
        const notifications: { id: number; slot: Slot; runtime: SlotRuntime }[] =
            [];
        let changed = false;

        for (let id = 1; id <= current.maxSlots; id++) {
            const slot = current.slots[id];
            const previous = runtimeFor(id, current.runtime);

            if (!slot || !slot.nome) {
                if (!runtime[id]) continue;
                const blank = { ...EMPTY_RUNTIME };
                if (runtimeChanged(previous, blank)) {
                    runtime[id] = blank;
                    changed = true;
                }
                continue;
            }

            const unread =
                Number(slot.badgeCount || 0) > 0 ||
                activeSignal(current.signals[id], slot);

            if (!unread) {
                if (!runtime[id]) continue;
                const blank = { ...EMPTY_RUNTIME };
                if (runtimeChanged(previous, blank)) {
                    runtime[id] = blank;
                    changed = true;
                }
                continue;
            }

            const next: SlotRuntime = { ...previous };
            if (!next.unreadSince) next.unreadSince = now;
            if (next.snoozedUntil && next.snoozedUntil <= now) {
                next.snoozedUntil = 0;
            }

            const elapsed = now - (next.unreadSince ?? now);
            const snoozedRemaining = Math.max(
                0,
                next.snoozedUntil - now,
            );
            const shouldShowAttention =
                elapsed >= TIMING.SLOT_AUTO_REPLY_DELAY_MS &&
                snoozedRemaining === 0;
            next.attention = shouldShowAttention;

            // Enquanto a notificação está pausada o original não dispara
            // prompt, som nem notificação do sistema.
            if (snoozedRemaining > 0) {
                if (runtimeChanged(previous, next)) {
                    runtime[id] = next;
                    changed = true;
                }
                continue;
            }

            if (
                elapsed >= TIMING.SLOT_AUTO_REPLY_DELAY_MS &&
                !next.autoReplyAt
            ) {
                next.autoReplyAt = now;
                prompts[id] = {
                    text: "mensagem pendente há mais de 1 minuto.",
                    at: now,
                };
                notifications.push({ id, slot, runtime: next });
            } else if (elapsed >= TIMING.SLOT_AUTO_REPLY_DELAY_MS) {
                notifications.push({ id, slot, runtime: next });
            }

            if (runtimeChanged(previous, next)) {
                runtime[id] = next;
                changed = true;
            }
        }

        if (changed) setState({ runtime, prompts });
        else if (Object.keys(prompts).length !== Object.keys(current.prompts).length) {
            setState({ prompts });
        }

        for (const item of notifications) {
            if (notifyDesktop(item.id, item.slot, item.runtime, now)) {
                const live = getState();
                const rt = runtimeFor(item.id, live.runtime);
                setState({
                    runtime: {
                        ...live.runtime,
                        [item.id]: {
                            ...rt,
                            desktopNotifiedAt: Date.now(),
                        },
                    },
                });
            }
        }
    },

    snoozeUnread: (id) => {
        const current = getState();
        const slot = current.slots[id];
        const runtime = runtimeFor(id, current.runtime);
        if (!slot?.nome || !runtime.unreadSince) return;

        const now = Date.now();
        setState({
            runtime: {
                ...current.runtime,
                [id]: {
                    ...runtime,
                    attention: false,
                    snoozedUntil: now + TIMING.SLOT_NOTIFICATION_SNOOZE_MS,
                    desktopNotifiedAt: now,
                },
            },
            prompts: {
                ...current.prompts,
                [id]: {
                    text: "notificação pausada por 2 minutos.",
                    at: now,
                },
            },
        });
        audio.syncAttention(false);
    },

    setPrompt: (id, text) => {
        setState({
            prompts: {
                ...getState().prompts,
                [id]: { text, at: Date.now() },
            },
        });
    },

    clearPrompt: (id) => {
        const current = getState();
        if (!current.prompts[id]) return;
        const prompts = { ...current.prompts };
        delete prompts[id];
        setState({ prompts });
    },

    setPendingMessages: (messages) => {
        const value = savePendingMessages(messages);
        setState({ pendingMessages: value });
    },

    setAttentionMuted: (muted) => {
        saveAttentionMuted(muted);
        audio.setMuted(muted);
        setState({ attentionMuted: muted });
    },

    clearHistoryData: () => {
        removeKey(STORAGE_KEYS.history);
        writeString(STORAGE_KEYS.totalAtendimentos, "0");
        setState({ history: {}, totalAtendimentos: 0 });
    },

    clearAllCache: () => {
        removeKey(STORAGE_KEYS.history);
        removeKey(STORAGE_KEYS.totalAtendimentos);
        removeKey(STORAGE_KEYS.slots);
        removeKey(STORAGE_KEYS.openedAt);
        removeKey(STORAGE_KEYS.forponto);
        removeKey(STORAGE_KEYS.notepad);
        clearOpenedAtCache();

        const current = getState();
        const slots: Slots = {};
        const windowOpen: Record<number, boolean> = {};
        for (let id = 1; id <= current.maxSlots; id++) {
            slots[id] = null;
            windowOpen[id] = false;
        }

        setState({
            slots,
            meta: {},
            suppressed: {},
            signals: {},
            runtime: {},
            prompts: {},
            windowOpen,
            history: {},
            totalAtendimentos: 0,
        });
        audio.syncAttention(false);
        if (typeof window !== "undefined") {
            window.dispatchEvent(new Event(CACHE_CLEARED_EVENT));
        }
    },
};

/** Garante que o painel Rocket esteja carregado quando o usuário abrir. */
export function ensureRocketFrameOnline(forceReload = false) {
    console.trace("[RocketFrame] ensureRocketFrameOnline", {
        forceReload,
        src: document.getElementById("frame_rocket")
            ?.getAttribute("src"),
    });
    
    if (typeof document === "undefined") return;
    const frame = document.getElementById(
        "frame_rocket",
    ) as HTMLIFrameElement | null;
    if (!frame) return;
    const src = (frame.getAttribute("src") || "").trim();
    const needsLoad = !src || src === "about:blank" || src.endsWith("about:blank");
    if (needsLoad || forceReload) {
        frame.src = ROCKET_HOME_URL;
    }
}
