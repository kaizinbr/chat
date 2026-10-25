export const ROCKET_ORIGIN =
  process.env.NEXT_PUBLIC_ROCKET_ORIGIN ?? 'https://helptechho.digitalaec.com.br';
export const ROCKET_HOME_URL = `${ROCKET_ORIGIN}/home`;

/** Valores copiados do script.js original. */
export const TIMING = {
  SLOT_AUTO_RELEASE_GRACE_MS: 1_000,
  SLOT_AUTO_RELEASE_MIN_HITS: 1,
  INITIAL_SIDEBAR_SYNC_GRACE_MS: 30_000,
  SLOT_FINALIZE_WAIT_GRACE_MS: 1_000,
  SLOT_CACHE_VERIFY_GRACE_MS: 15_000,
  SLOT_TIMER_WARNING_MS: 10 * 60_000,
  SLOT_TIMER_DANGER_MS: 20 * 60_000,
  SLOT_TIMER_LIMIT_MS: 25 * 60_000,
  OPENED_AT_CACHE_TTL_MS: 30 * 60_000,
  COMMAND_TIMEOUT_MS: 15_000,
} as const;

export const STORAGE_KEYS = {
  slots: 'fw_slots_v2',
  history: 'fwall_history', // mesmo formato do original
  openedAt: 'chat_opened_at_cache_v1', // mesmo formato do original
} as const;
