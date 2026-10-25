import type { SidebarChat } from '../bridge/protocol';
import { ROCKET_HOME_URL, TIMING } from '../config';

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
  /** URL do iframe: definida UMA vez na atribuição (mudar re-carrega o iframe). */
  frameSrc: string;
  // campos editáveis pelo atendente
  site: string;
  motivo: string;
}

/** Estado volátil por slot (não persiste, exceto restoredFromCacheAt, criado no hydrate). */
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
  return (name ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractRoomId(url: string | null | undefined) {
  if (!url) return '';
  try {
    const u = new URL(url, 'https://x.invalid');
    let m = u.pathname.match(/\/omnichannel\/current\/([^/?#]+)/i);
    if (m && m[1] !== 'current') return m[1];
    m = u.pathname.match(/\/(?:channel|group|direct|room)\/([^/?#]+)/i);
    if (m) return m[1];
    return u.searchParams.get('rid') || u.searchParams.get('roomId') || '';
  } catch {
    return '';
  }
}

export function findSlotByName(slots: Slots, maxSlots: number, nome: string) {
  for (let id = 1; id <= maxSlots; id++) if (slots[id]?.nome === nome) return id;
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

const isHttp = (u: string | null | undefined): u is string => !!u && /^https?:\/\//i.test(u);

export function newSlot(id: number, chat: Pick<SidebarChat, 'nome' | 'badgeCount' | 'chatUrl'>, openedAt: number): Slot {
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
    frameSrc: isHttp(chat.chatUrl) ? chat.chatUrl : ROCKET_HOME_URL,
    site: 'CG',
    motivo: '',
  };
}

/** Libera o slot e marca a sala como "finalizada" para não reabrir se piscar na fila (autoReleaseSlot/releaseSlot). */
export function releaseInPlace(slots: Slots, meta: MetaMap, suppressed: Suppressed, id: number) {
  const s = slots[id];
  if (s) {
    const rid = extractRoomId(s.chatUrl);
    if (rid) suppressed[`rid:${rid}`] = true;
  }
  slots[id] = null;
  delete meta[id];
  return s?.nome ?? '';
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
  assigned: number[]; // slots recém-ocupados (abrir janela)
  reopen: number[]; // slots que precisam de OPEN_CHAT_BY_NAME
}

/**
 * Porte puro de processSidebarUpdate(): recebe a fila vista pelo frame principal
 * e devolve o novo estado + efeitos. Sem DOM, sem timers → testável.
 */
export function reconcileSidebar(input: ReconcileInput, sidebarChats: SidebarChat[]): ReconcileOutput {
  const { maxSlots, now } = input;
  const slots: Slots = { ...input.slots };
  const meta: MetaMap = Object.fromEntries(Object.entries(input.meta).map(([k, v]) => [k, { ...v }]));
  const suppressed: Suppressed = { ...input.suppressed };
  const released: ReconcileOutput['released'] = [];
  const assigned: number[] = [];
  const reopen = new Set<number>();

  const hasActiveSlots = Array.from({ length: maxSlots }, (_, i) => i + 1).some((id) => !!slots[id]?.nome);
  const skipMissingCleanup = !input.mainSidebarReady && hasActiveSlots;
  const inInitialSyncGrace = now - input.appStartedAt < TIMING.INITIAL_SIDEBAR_SYNC_GRACE_MS;

  const visible = sidebarChats.filter((c) => {
    const rid = extractRoomId(c.chatUrl);
    return !(rid && suppressed[`rid:${rid}`]);
  });
  const visibleNames = visible.map((c) => c.nome);
  const visibleNorm = visibleNames.map(normalizeChatName).filter(Boolean);
  const returned = new Set<number>();

  // 1) slots cujo chat sumiu da fila
  for (let id = 1; id <= maxSlots; id++) {
    const slot = slots[id];
    if (!slot || skipMissingCleanup) continue;

    const norm = normalizeChatName(slot.nome);
    const exists = visibleNames.includes(slot.nome) || (norm ? visibleNorm.includes(norm) : false);
    const m = (meta[id] ??= {});

    if (exists) {
      if (m.missingSince) {
        returned.add(id);
        delete m.missingSince;
        delete m.missingHits;
      }
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
      released.push({ slotId: id, nome: releaseInPlace(slots, meta, suppressed, id) });
    };

    if (m.finalizeRequestedAt && missingFor >= TIMING.SLOT_FINALIZE_WAIT_GRACE_MS && hits >= 1) {
      doRelease(); // finalização pedida: fecha rápido
    } else if (
      m.restoredFromCacheAt &&
      input.mainSidebarReady &&
      missingFor >= TIMING.SLOT_CACHE_VERIFY_GRACE_MS &&
      hits >= 2
    ) {
      doRelease(); // slot "fantasma" vindo do cache pós-F5
    } else if (
      !inInitialSyncGrace &&
      missingFor >= TIMING.SLOT_AUTO_RELEASE_GRACE_MS &&
      hits >= TIMING.SLOT_AUTO_RELEASE_MIN_HITS
    ) {
      doRelease();
    }
  }

  // 2) chats da fila → slot existente ou slot livre
  for (const chat of visible) {
    const existingId = findSlotByName(slots, maxSlots, chat.nome);

    if (existingId) {
      let cur = slots[existingId]!;
      const prevRid = extractRoomId(cur.chatUrl);
      const nextRid = extractRoomId(chat.chatUrl);

      if (prevRid && nextRid && prevRid !== nextRid) {
        // mesmo nome, nova sala = novo atendimento → zera dados (clearSlotAttendanceFields)
        cur = {
          ...cur,
          matricula: null,
          protocolo: null,
          tipoCliente: null,
          motivoAtual: null,
          quantidadeAbandono: null,
          quantidadeChats: null,
          tags: [],
          availableTags: [],
          motivo: '',
          openedAt: now,
        };
      }

      slots[existingId] = {
        ...cur,
        nome: chat.nome,
        badgeCount: chat.badgeCount,
        chatUrl: chat.chatUrl ?? cur.chatUrl,
      };
      // só reabre quando o chat voltou depois de uma ausência temporária
      if (returned.has(existingId)) reopen.add(existingId);
    } else {
      const free = findFreeSlot(slots, maxSlots);
      if (!free) continue;
      delete meta[free];
      slots[free] = newSlot(free, chat, input.getCachedOpenedAt(chat.nome) ?? now);
      assigned.push(free);
      reopen.add(free);
    }
  }

  return { slots, meta, suppressed, released, assigned, reopen: [...reopen] };
}
