export const ROCKET_ORIGIN =
    process.env.NEXT_PUBLIC_ROCKET_ORIGIN ??
    "https://helptechho.digitalaec.com.br";

export const ROCKET_HOME_URL = `${ROCKET_ORIGIN}/home`;

export const DEFAULT_AVATAR_URL = `${ROCKET_ORIGIN}/avatar/kaio.nunes`;

/** Protocolo combinado com a extensão (original/bridge/content.js). */
export const MSG_SOURCE_EXTENSION = "firewall-extension";
export const MSG_SOURCE_PARENT = "firewall-parent";

export const MAIN_FRAME_NAME = "frame_rocket";
export const slotFrameName = (slotId: number) => `frame_slot_${slotId}`;
export const slotFrameId = (slotId: number) => `frame_${slotId}`;

/** Tempos copiados de original/script.js. Não altere sem conferir a extensão. */
export const TIMING = {
    BRIDGE_WAIT_MS: 4_500,
    BRIDGE_WAIT_POLL_MS: 220,
    BRIDGE_WARMUP_INTERVAL_MS: 3_000,
    BRIDGE_WARMUP_MAX_ATTEMPTS: 40,
    SIDEBAR_REQUEST_INTERVAL_MS: 2_000,
    KEEP_ALIVE_INTERVAL_MS: 5_000,
    UNREAD_AUTOMATION_INTERVAL_MS: 1_000,
    REPEAT_ALERT_INTERVAL_MS: 3_000,

    BRIDGE_MAIN_STALE_VISIBLE_MS: 20_000,
    BRIDGE_MAIN_STALE_HIDDEN_MS: 3 * 60_000,
    BRIDGE_FORCE_RELOAD_MIN_STALE_HITS: 3,
    ROCKET_FORCE_RELOAD_BACKOFF_MS: 45_000,

    SLOT_AUTO_RELEASE_GRACE_MS: 1_000,
    SLOT_AUTO_RELEASE_MIN_HITS: 1,
    INITIAL_SIDEBAR_SYNC_GRACE_MS: 30_000,
    SLOT_FINALIZE_WAIT_GRACE_MS: 1_000,
    SLOT_CACHE_VERIFY_GRACE_MS: 15_000,

    SLOT_TIMER_WARNING_MS: 10 * 60_000,
    SLOT_TIMER_DANGER_MS: 20 * 60_000,
    SLOT_TIMER_LIMIT_MS: 25 * 60_000,

    SLOT_BRIDGE_SIGNAL_STALE_MS: 15_000,
    SLOT_AUTO_REPLY_DELAY_MS: 60_000,
    SLOT_NOTIFICATION_SNOOZE_MS: 2 * 60_000,
    ATTENTION_AUDIO_INTERVAL_MS: 20_000,
    AUTO_PROMPT_VISIBLE_MS: 5_000,

    OPENED_AT_CACHE_TTL_MS: 30 * 60_000,

    COMMAND_TIMEOUT_MS: 15_000,
    FR_REQUEST_TIMEOUT_MS: 25_000,
    FR_REFRESH_INTERVAL_MS: 10_000,
    TABULATION_TIMEOUT_MS: 10_000,
    TAG_OPTIONS_TIMEOUT_MS: 25_000,
    TAG_APPLY_TIMEOUT_MS: 25_000,

    RESTORED_SLOT_OPEN_DELAY_MS: 800,
    OPEN_CHAT_RETRY_MS: [200, 900, 1_800] as const,
} as const;

/** Chaves de localStorage — mesmos nomes usados pelo painel original. */
export const STORAGE_KEYS = {
    slots: "chat_slots",
    history: "fwall_history",
    totalAtendimentos: "total_atend",
    openedAt: "chat_opened_at_cache_v1",
    lastBootDay: "last_boot_day",
    fluxos: "guia_fluxos",
    pendingMessages: "pending_auto_reply_messages_v1",
    terminalCommands: "terminal_commands",
    forponto: "forponto_data",
    notepad: "fw_notepad_cache_v1",
    fontScale: "fw_font_scale_v1",
    appScale: "fw_app_scale_v1",
    attentionMuted: "fw_attention_sound_muted_v1",
    slotLayouts: "chat_slot_layouts",
    notepadLayouts: "fw_notepad_layouts_v1",
    frToken: "rc_token",
    frUserId: "rc_userId",
    frApiUrl: "rc_apiUrl",
    frUsername: "rc_username",
    frPasswordDigest: "rc_pwdigest",
} as const;

export const APP_SCALE = {
    default: 0.82,
    min: 0.7,
    max: 1.5,
} as const;

export const FONT_SCALE = {
    default: 1,
    min: 0.85,
    max: 2.2,
} as const;

export const SLOT_LAYOUT = {
    defaultWidth: 460,
    defaultHeight: 620,
    minWidth: 300,
    minHeight: 400,
    topSafeMargin: 2,
    sideSafeMargin: 2,
} as const;

export const DEFAULT_PENDING_AUTO_REPLY_MESSAGES = [
    "Só mais um momento.",
    "Estou validando algumas correções, só um momento.",
    "Ok, um momento, por favor.",
] as const;

export const TOOL_DEFAULTS = {
    notepad: { top: 150, left: 420, width: 460, height: 360 },
    fluxos: { top: 100, left: 250, width: 600, height: 550 },
    config: { top: 96, left: 360, width: 520, height: 430 },
    messages: { top: 100, left: 250, width: 560, height: 440 },
    forponto: { top: 96, left: 56, width: 500, height: 580 },
    history: { top: 70, left: 190, width: 720, height: 620 },
    fila: { top: 56, left: 150, width: 820, height: 680 },
    rocket: { top: 80, left: 120, width: 520, height: 600 },
} as const;
