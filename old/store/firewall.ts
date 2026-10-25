'use client';

import { create } from 'zustand';
import type { AgentStatus, SidebarChat, VisitorDetails } from '@/lib/bridge/protocol';
import { STORAGE_KEYS, TIMING } from '@/lib/config';
import { dateKey, formatDuration } from '@/lib/format';
import {
  findSlotByName,
  normalizeChatName,
  reconcileSidebar,
  releaseInPlace,
  type MetaMap,
  type Slot,
  type Slots,
  type Suppressed,
} from '@/lib/slots/reconcile';

const APP_STARTED_AT = Date.now();

// ───────── cache do "aberto em" por nome (mesmo formato do original) ─────────
type OpenedAtCache = Record<string, { openedAt: number; touchedAt: number }>;
const readJSON = <T,>(key: string, fallback: T): T => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null');
    return v ?? fallback;
  } catch {
    return fallback;
  }
};
const writeJSON = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

function getCachedOpenedAt(nome: string): number | null {
  const key = normalizeChatName(nome);
  if (!key) return null;
  const cache = readJSON<OpenedAtCache>(STORAGE_KEYS.openedAt, {});
  const item = cache[key];
  if (!item?.openedAt) return null;
  const expired = !item.touchedAt || Date.now() - item.touchedAt > TIMING.OPENED_AT_CACHE_TTL_MS;
  if (expired || dateKey(item.openedAt) !== dateKey()) {
    delete cache[key];
    writeJSON(STORAGE_KEYS.openedAt, cache);
    return null;
  }
  return item.openedAt;
}
function touchOpenedAt(nome: string, openedAt: number) {
  const key = normalizeChatName(nome);
  if (!key || !openedAt) return;
  const cache = readJSON<OpenedAtCache>(STORAGE_KEYS.openedAt, {});
  cache[key] = { openedAt, touchedAt: Date.now() };
  writeJSON(STORAGE_KEYS.openedAt, cache);
}
function removeOpenedAt(nome: string) {
  const key = normalizeChatName(nome);
  if (!key) return;
  const cache = readJSON<OpenedAtCache>(STORAGE_KEYS.openedAt, {});
  if (cache[key]) {
    delete cache[key];
    writeJSON(STORAGE_KEYS.openedAt, cache);
  }
}

// ───────── histórico (mesmo formato do fwall_history original) ─────────
export type FinalStatus = 'resolvido' | 'fila' | 'abandono' | 'transfer_n2' | 'falta_interacao';
export interface HistoryLog {
  id: string;
  protocolo: string;
  nome: string;
  matricula: string;
  tipoCliente: string;
  motivoAtual: string;
  tags: string[];
  motivo: string;
  horario: string;
  duracao: string;
  durationMs: number;
  startTs: number | null;
  endTs: number | null;
  tmaEligible: boolean;
  status: FinalStatus;
}
export type HistoryMap = Record<string, { count: number; logs: HistoryLog[] }>;

export interface SlotSignal {
  hasUnreadDivider: boolean;
  lastMessageFromVisitor: boolean;
  chatName: string;
  updatedAt: number;
}

// ───────── store ─────────
interface FirewallState {
  hydrated: boolean;
  maxSlots: number;
  slots: Slots;
  meta: MetaMap;
  suppressed: Suppressed;
  windowOpen: Record<number, boolean>;
  signals: Record<number, SlotSignal>;
  history: HistoryMap;

  bridgeActive: boolean;
  mainSidebarReady: boolean;
  agentStatus: AgentStatus;
  omniActive: boolean | null;
  avatarUrl: string | null;
  rocketOpen: boolean;

  hydrate: () => { id: number; nome: string; chatUrl: string | null }[];
  setBridgeActive: () => void;
  setMainSidebarReady: () => void;
  setAgent: (p: { agentStatus?: AgentStatus; omniActive?: boolean | null }) => void;
  setAvatarUrl: (url: string) => void;
  setRocketOpen: (open: boolean) => void;

  applySidebar: (chats: SidebarChat[]) => { id: number; nome: string; chatUrl: string | null }[];
  applyDetails: (d: VisitorDetails & { nome: string | null; availableTags?: string[] }) => void;
  applySignal: (slotId: number, s: Omit<SlotSignal, 'updatedAt'>) => void;
  releaseByName: (nome: string) => void;
  patchSlot: (id: number, patch: Partial<Slot>) => void;
  setFinalizeRequested: (id: number, on: boolean) => void;
  setWindowOpen: (id: number, open: boolean) => void;
  addSlot: () => void;
  saveHistory: (id: number, status: FinalStatus, opts?: { motivo?: string; includeTma?: boolean }) => void;
}

export const useFirewall = create<FirewallState>((set, get) => ({
  hydrated: false,
  maxSlots: 3,
  slots: {},
  meta: {},
  suppressed: {},
  windowOpen: {},
  signals: {},
  history: {},

  bridgeActive: false,
  mainSidebarReady: false,
  agentStatus: 'offline',
  omniActive: null,
  avatarUrl: null,
  rocketOpen: false,

  hydrate: () => {
    if (get().hydrated) return [];
    const saved = readJSON<{ maxSlots?: number; slots?: Slots }>(STORAGE_KEYS.slots, {});
    const maxSlots = Math.max(3, saved.maxSlots ?? 3);
    const slots: Slots = {};
    const meta: MetaMap = {};
    const windowOpen: Record<number, boolean> = {};
    const restored: { id: number; nome: string; chatUrl: string | null }[] = [];

    for (let id = 1; id <= maxSlots; id++) {
      const s = saved.slots?.[id];
      if (!s) continue;
      // só reaproveita o "aberto em" se for de hoje (igual ao original)
      const openedAt = dateKey(s.openedAt) === dateKey() ? s.openedAt : Date.now();
      slots[id] = { ...s, id, openedAt };
      meta[id] = { restoredFromCacheAt: Date.now() };
      windowOpen[id] = true;
      touchOpenedAt(s.nome, openedAt);
      restored.push({ id, nome: s.nome, chatUrl: s.chatUrl });
    }

    set({ hydrated: true, maxSlots, slots, meta, windowOpen, history: readJSON<HistoryMap>(STORAGE_KEYS.history, {}) });

    // persistência automática
    useFirewall.subscribe((s, prev) => {
      if (s.slots !== prev.slots || s.maxSlots !== prev.maxSlots) {
        writeJSON(STORAGE_KEYS.slots, { maxSlots: s.maxSlots, slots: s.slots });
      }
      if (s.history !== prev.history) writeJSON(STORAGE_KEYS.history, s.history);
    });
    return restored;
  },

  setBridgeActive: () => !get().bridgeActive && set({ bridgeActive: true }),
  setMainSidebarReady: () => !get().mainSidebarReady && set({ mainSidebarReady: true }),
  setAgent: ({ agentStatus, omniActive }) =>
    set((s) => ({
      agentStatus: agentStatus ?? s.agentStatus,
      omniActive: omniActive === undefined || omniActive === null ? s.omniActive : omniActive,
    })),
  setAvatarUrl: (avatarUrl) => set({ avatarUrl }),
  setRocketOpen: (rocketOpen) => set({ rocketOpen }),

  applySidebar: (chats) => {
    const s = get();
    const out = reconcileSidebar(
      {
        slots: s.slots,
        meta: s.meta,
        suppressed: s.suppressed,
        maxSlots: s.maxSlots,
        mainSidebarReady: s.mainSidebarReady,
        appStartedAt: APP_STARTED_AT,
        now: Date.now(),
        getCachedOpenedAt,
      },
      chats,
    );

    out.released.forEach((r) => removeOpenedAt(r.nome));
    Object.values(out.slots).forEach((sl) => sl && touchOpenedAt(sl.nome, sl.openedAt));

    const windowOpen = { ...s.windowOpen };
    out.assigned.forEach((id) => (windowOpen[id] = true));
    out.released.forEach((r) => (windowOpen[r.slotId] = false));

    set({ slots: out.slots, meta: out.meta, suppressed: out.suppressed, windowOpen });
    return out.reopen.flatMap((id) => {
      const sl = out.slots[id];
      return sl ? [{ id, nome: sl.nome, chatUrl: sl.chatUrl }] : [];
    });
  },

  applyDetails: (d) => {
    if (!d.nome) return;
    const s = get();
    const id = findSlotByName(s.slots, s.maxSlots, d.nome);
    if (!id || !s.slots[id]) return;
    const cur = s.slots[id]!;
    set({
      slots: {
        ...s.slots,
        [id]: {
          ...cur,
          matricula: d.matricula ?? cur.matricula,
          protocolo: d.protocolo ?? cur.protocolo,
          tipoCliente: d.tipoCliente ?? cur.tipoCliente,
          motivoAtual: d.motivoAtual ?? cur.motivoAtual,
          quantidadeAbandono: d.quantidadeAbandono ?? cur.quantidadeAbandono,
          quantidadeChats: d.quantidadeChats ?? cur.quantidadeChats,
          tags: Array.isArray(d.tags) ? d.tags : cur.tags,
          availableTags: d.availableTags?.length ? d.availableTags : cur.availableTags,
        },
      },
    });
  },

  applySignal: (slotId, sig) => set((s) => ({ signals: { ...s.signals, [slotId]: { ...sig, updatedAt: Date.now() } } })),

  releaseByName: (nome) => {
    const s = get();
    const id = findSlotByName(s.slots, s.maxSlots, nome);
    if (!id) return;
    const slots = { ...s.slots };
    const meta = { ...s.meta };
    const suppressed = { ...s.suppressed };
    removeOpenedAt(releaseInPlace(slots, meta, suppressed, id));
    set({ slots, meta, suppressed, windowOpen: { ...s.windowOpen, [id]: false } });
  },

  patchSlot: (id, patch) =>
    set((s) => (s.slots[id] ? { slots: { ...s.slots, [id]: { ...s.slots[id]!, ...patch } } } : s)),

  setFinalizeRequested: (id, on) =>
    set((s) => {
      const m = { ...(s.meta[id] ?? {}) };
      if (on) m.finalizeRequestedAt = Date.now();
      else delete m.finalizeRequestedAt;
      return { meta: { ...s.meta, [id]: m } };
    }),

  setWindowOpen: (id, open) => set((s) => ({ windowOpen: { ...s.windowOpen, [id]: open } })),
  addSlot: () => set((s) => ({ maxSlots: s.maxSlots + 1 })),

  /** Porte de salvarHistorico(): agora lê do estado, não do DOM. */
  saveHistory: (id, status, opts = {}) => {
    const s = get();
    const slot = s.slots[id];
    if (!slot) return;
    const includeTma = !!opts.includeTma;
    const endTs = Date.now();
    const startTs = slot.openedAt || endTs;
    const duration = endTs - startTs;
    const today = dateKey();
    const day = s.history[today] ?? { count: 0, logs: [] };

    const log: HistoryLog = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      protocolo: slot.protocolo || 'SEM PROTOCOLO',
      nome: slot.nome || 'ANÔNIMO',
      matricula: slot.matricula || 'N/A',
      tipoCliente: slot.tipoCliente || 'N/A',
      motivoAtual: slot.motivoAtual || 'N/A',
      tags: slot.tags,
      motivo: opts.motivo !== undefined ? opts.motivo : slot.motivo || 'Sem relato',
      horario: new Date().toLocaleTimeString(),
      duracao: includeTma ? formatDuration(duration) : '-',
      durationMs: includeTma ? duration : 0,
      startTs: includeTma ? startTs : null,
      endTs: includeTma ? endTs : null,
      tmaEligible: includeTma,
      status,
    };
    removeOpenedAt(slot.nome);
    set({
      history: { ...s.history, [today]: { count: day.count + 1, logs: [log, ...day.logs] } },
      slots: { ...s.slots, [id]: { ...slot, motivo: '' } },
    });
  },
}));
