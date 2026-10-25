let totalAtendimentos = parseInt(localStorage.getItem('total_atend')) || 0;
let terminalCommands = JSON.parse(localStorage.getItem('terminal_commands') || '[]');

let guiaFluxos = (() => { try { return JSON.parse(localStorage.getItem('guia_fluxos') || '[]'); } catch(e) { return []; } })();
const IS_FILE_PROTOCOL = window.location.protocol === 'file:';
const ROCKET_HOME_URL = 'https://helptechho.digitalaec.com.br/home';

function canEmbedInIframe(url) {
    if (!url) return false;
    try {
        const parsed = new URL(url, window.location.href);
        return ['http:', 'https:'].includes(parsed.protocol);
    } catch (_) {
        return false;
    }
}

// Extrai ID do room a partir de uma URL do Rocket.Chat (para detectar troca de sessão)
function extractRoomIdFromUrl(url) {
    if (!url) return '';
    try {
        const u = new URL(url, window.location.origin);
        const path = u.pathname;
        let m = path.match(/\/omnichannel\/current\/([^\/?#]+)/i);
        if (m && m[1] && m[1] !== 'current') return m[1];
        m = path.match(/\/(?:channel|group|direct|room)\/([^\/?#]+)/i);
        if (m && m[1]) return m[1];
        return u.searchParams.get('rid') || u.searchParams.get('roomId') || '';
    } catch (_) {
        return '';
    }
}

function frameCanReceiveBridgeMessage(frameEl) {
    if (!frameEl || !frameEl.contentWindow) return false;
    const src = (frameEl.getAttribute('src') || '').trim();
    if (!src || src === 'about:blank') return false;
    return canEmbedInIframe(src);
}

// Carrega fluxos do arquivo JSON sempre (não só se vazio)
async function carregarFluxosJSON() {
    if (IS_FILE_PROTOCOL) {
        
        return;
    }
    try {
        const response = await fetch('fluxos.json');
        if (response.ok) {
            guiaFluxos = await response.json();
            localStorage.setItem('guia_fluxos', JSON.stringify(guiaFluxos));
        }
    } catch (e) {
    }
}

// Executa carregamento imediatamente
carregarFluxosJSON();

const chatSlots = {};
let maxSlots = 3;
let bridgeActive = false;
let agentOnline = false;
let omniOpen = false;
let lastMainBridgeUpdateAt = 0;
let mainBridgeStaleHits = 0;
let bridgeWarmupTimer = null;
let mainSidebarReadyForAutoRelease = false;
let lastRocketForceReloadAt = 0;
let chatTimers = {};
let currentTerminalText = '';
let typingInterval = null;
let previousBadgeCounts = {};
let audioNotification = null;
let audioBooting = null;
let audioAttention = null;
let attentionSoundMuted = false;
let statusTerminalResizeTimer = null;
let bootComplete = false;
let slotMissingSince = {};
let slotMissingHits = {};
let slotUnreadSince = {};
let slotAutoReplySent = {};
let slotDesktopNotified = {};
let slotBridgeSignals = {};
let slotAttentionState = {};
let slotNotificationSnoozedUntil = {};
let finalizedChatSuppressUntil = {};
let slotFinalizeRequestedAt = {};
let slotRestoredFromCacheAt = {};
let attentionLoopTimer = null;
let autoReplyRoundRobin = 0;
let notificationPermissionAsked = false;
let systemBootInProgress = false;
const CHAT_OPENED_AT_CACHE_KEY = 'chat_opened_at_cache_v1';
const CHAT_OPENED_AT_CACHE_TTL_MS = 30 * 60 * 1000;
let chatOpenedAtCache = {};
const SLOT_AUTO_RELEASE_GRACE_MS = 1000;   // 1s ausente da fila = libera
const SLOT_AUTO_RELEASE_MIN_HITS = 1;      // 1 update confirmando ausência
const INITIAL_SIDEBAR_SYNC_GRACE_MS = 30000;
const APP_STARTED_AT = Date.now();
const SLOT_TIMER_WARNING_MS = 10 * 60 * 1000;
const SLOT_TIMER_DANGER_MS = 20 * 60 * 1000;
const SLOT_TIMER_LIMIT_MS = 25 * 60 * 1000;
const BRIDGE_MAIN_STALE_VISIBLE_MS = 20000;
const BRIDGE_MAIN_STALE_HIDDEN_MS = 3 * 60 * 1000;
const BRIDGE_FORCE_RELOAD_MIN_STALE_HITS = 3;
const ROCKET_FORCE_RELOAD_BACKOFF_MS = 45000;
const SLOT_BRIDGE_SIGNAL_STALE_MS = 15000;
const SLOT_AUTO_REPLY_DELAY_MS = 60 * 1000;
const SLOT_NOTIFICATION_SNOOZE_MS = 2 * 60 * 1000;
const SLOT_FINALIZE_WAIT_GRACE_MS = 1000;
const SLOT_CACHE_VERIFY_GRACE_MS = 15000;
const ATTENTION_AUDIO_INTERVAL_MS = 20000;
const PENDING_AUTO_REPLY_CACHE_KEY = 'pending_auto_reply_messages_v1';
const HIDE_GX_EDITOR_SAVE_BUTTON = true;
const FONT_SCALE_CACHE_KEY = 'fw_font_scale_v1';
const FONT_SCALE_DEFAULT = 1;
const FONT_SCALE_MIN = 0.85;
const FONT_SCALE_MAX = 2.2;
const APP_SCALE_CACHE_KEY = 'fw_app_scale_v1';
const ATTENTION_SOUND_MUTED_CACHE_KEY = 'fw_attention_sound_muted_v1';
const APP_SCALE_DEFAULT = 0.82;
const APP_SCALE_MIN = 0.70;
const APP_SCALE_MAX = 1.50;
const DEFAULT_PENDING_AUTO_REPLY_MESSAGES = [
    'Só mais um momento.',
    'Estou validando algumas correções, só um momento.',
    'Ok, um momento, por favor.'
];
let slotAutoReplyMessages = [];

function loadPendingAutoReplyMessages() {
    try {
        const raw = JSON.parse(localStorage.getItem(PENDING_AUTO_REPLY_CACHE_KEY) || '[]');
        const cleaned = Array.isArray(raw)
            ? raw.map(v => (v || '').toString().trim()).filter(Boolean)
            : [];
        slotAutoReplyMessages = cleaned.length ? cleaned : [...DEFAULT_PENDING_AUTO_REPLY_MESSAGES];
    } catch (_) {
        slotAutoReplyMessages = [...DEFAULT_PENDING_AUTO_REPLY_MESSAGES];
    }
}

function persistPendingAutoReplyMessages() {
    const cleaned = (slotAutoReplyMessages || [])
        .map(v => (v || '').toString().trim())
        .filter(Boolean);
    slotAutoReplyMessages = cleaned.length ? cleaned : [...DEFAULT_PENDING_AUTO_REPLY_MESSAGES];
    localStorage.setItem(PENDING_AUTO_REPLY_CACHE_KEY, JSON.stringify(slotAutoReplyMessages));
}

loadPendingAutoReplyMessages();

async function waitForBridgeActivation(timeoutMs = 4500) {
    const startedAt = Date.now();

    ensureRocketBackgroundOnline(false);
    requestSidebarUpdate();

    while ((Date.now() - startedAt) < timeoutMs) {
        if (bridgeActive) return true;
        await new Promise(resolve => setTimeout(resolve, 220));
        requestSidebarUpdate();
    }

    return !!bridgeActive;
}

function loadOpenedAtCache() {
    try {
        const parsed = JSON.parse(localStorage.getItem(CHAT_OPENED_AT_CACHE_KEY) || '{}');
        chatOpenedAtCache = parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
        chatOpenedAtCache = {};
    }
}

function saveOpenedAtCache() {
    try {
        localStorage.setItem(CHAT_OPENED_AT_CACHE_KEY, JSON.stringify(chatOpenedAtCache));
    } catch (_) {}
}

function setOpenedAtCache(chatName, openedAt) {
    const key = normalizeChatName(chatName || '');
    if (!key || !openedAt) return;
    chatOpenedAtCache[key] = {
        openedAt,
        touchedAt: Date.now()
    };
    saveOpenedAtCache();
}

function getDateKeyFromTimestamp(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getOpenedAtCache(chatName) {
    const key = normalizeChatName(chatName || '');
    if (!key) return null;
    const item = chatOpenedAtCache[key];
    if (!item || !item.openedAt) return null;
    if (!item.touchedAt || (Date.now() - item.touchedAt) > CHAT_OPENED_AT_CACHE_TTL_MS) {
        delete chatOpenedAtCache[key];
        saveOpenedAtCache();
        return null;
    }
    if (getDateKeyFromTimestamp(item.openedAt) !== getToday()) {
        delete chatOpenedAtCache[key];
        saveOpenedAtCache();
        return null;
    }
    return item.openedAt;
}

function removeOpenedAtCache(chatName) {
    const key = normalizeChatName(chatName || '');
    if (!key) return;
    if (chatOpenedAtCache[key]) {
        delete chatOpenedAtCache[key];
        saveOpenedAtCache();
    }
}

function updateAgentStatus(status) {
    const dot = document.getElementById('agent-status-dot');
    if (!dot) return;
    
    const isOnline = (status === 'online');
    agentOnline = isOnline;
    dot.className = 'agent-status-dot ' + (isOnline ? 'online' : 'offline');
}

function updateOmniToggle(isOpen) {
    omniOpen = isOpen;
    const btn = document.getElementById('omni-toggle');
    const icon = document.getElementById('omni-icon');
    const label = document.getElementById('omni-label');
    if (!btn) return;
    btn.className = 'omni-toggle ' + (isOpen ? 'open' : 'closed');
    btn.title = isOpen ? 'CHATS: ATIVO — clique para desativar' : 'CHATS: INATIVO — clique para ativar';
    if (icon) icon.textContent = isOpen ? '◉' : '⊘';
    if (label) label.textContent = isOpen ? 'ON' : 'OFF';
}

let omniCooldown = false;
async function toggleOmnichannel() {
    if (omniCooldown) return;
    const action = omniOpen ? 'DESATIVAR' : 'ATIVAR';
    const ok = await fwConfirm(`${action} recebimento de chats?`);
    if (!ok) return;
    omniCooldown = true;
    setTimeout(() => { omniCooldown = false; }, 3000);

    const rocketFrame = document.getElementById('frame_rocket');
    if (frameCanReceiveBridgeMessage(rocketFrame)) {
        rocketFrame.contentWindow.postMessage({ type: 'TOGGLE_OMNICHANNEL', source: 'firewall-parent' }, '*');
        return;
    }
    for (let i = 1; i <= maxSlots; i++) {
        const frame = document.getElementById(`frame_${i}`);
        if (frameCanReceiveBridgeMessage(frame)) {
            frame.contentWindow.postMessage({ type: 'TOGGLE_OMNICHANNEL', source: 'firewall-parent' }, '*');
            return;
        }
    }

    fwAlert('Rocket não disponível no iframe ainda. Abra o painel do agente primeiro.');
}

function openRocketPanel() {
    const panel = document.getElementById('rocket-panel');
    const rocketFrame = document.getElementById('frame_rocket');
    if (rocketFrame && (rocketFrame.getAttribute('src') || '') === 'about:blank') {
        rocketFrame.src = ROCKET_HOME_URL;
    }
    panel.style.display = 'flex';
    panel.style.visibility = 'visible';
    panel.style.opacity = '1';
    panel.style.pointerEvents = 'auto';
    panel.style.transform = 'translateY(0)';
    focusWindow(panel);
}
function closeRocketPanel() {
    const panel = document.getElementById('rocket-panel');
    if (!panel) return;
    panel.style.display = 'flex';
    panel.style.visibility = 'hidden';
    panel.style.opacity = '0';
    panel.style.pointerEvents = 'none';
    panel.style.transform = 'translateY(-8px)';
}

function updateBridgeStatus() {
    const history = JSON.parse(localStorage.getItem('fwall_history') || '{}');
    const today = getToday();
    const todayData = history[today];
    const todayCount = todayData && todayData.logs ? todayData.logs.length : 0;
    
    updateTerminalText(todayCount);
}

function normalizeChatName(name) {
    return (name || '')
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getHistoryAttendanceStatsByName(name) {
    const target = normalizeChatName(name || '');
    if (!target) return { total: 0, today: 0 };

    let history = {};
    try {
        history = JSON.parse(localStorage.getItem('fwall_history') || '{}') || {};
    } catch (_) {
        history = {};
    }

    const todayKey = getToday();
    let total = 0;
    let today = 0;

    Object.entries(history).forEach(([dateKey, data]) => {
        const logs = Array.isArray(data?.logs) ? data.logs : [];
        logs.forEach(log => {
            const logName = normalizeChatName(log?.nome || '');
            if (!logName || logName !== target) return;
            total += 1;
            if (dateKey === todayKey) today += 1;
        });
    });

    return { total, today };
}

function updateSlotRepeatAlert(slotId) {
    const atdEl = document.getElementById(`atd_alert_${slotId}`);
    const rchEl = document.getElementById(`rch_alert_${slotId}`);
    if (!atdEl || !rchEl) return;

    const slotName = (chatSlots[slotId] && chatSlots[slotId].nome)
        || document.getElementById(`nome_${slotId}`)?.value
        || '';
    const normalized = normalizeChatName(slotName);

    if (!normalized) {
        atdEl.style.display = 'none';
        rchEl.style.display = 'none';
        return;
    }

    const stats = getHistoryAttendanceStatsByName(slotName);
    const rechamadasHoje = Math.max(0, stats.today - 1);

    if (stats.total > 0) {
        atdEl.textContent = `ATD: ${stats.total}`;
        atdEl.style.display = 'inline-block';
    } else {
        atdEl.style.display = 'none';
    }

    if (rechamadasHoje > 0) {
        rchEl.textContent = `RCH: ${rechamadasHoje}`;
        rchEl.style.display = 'inline-block';
    } else {
        rchEl.style.display = 'none';
    }
}

function updateSlotRepeatAlertsAll() {
    for (let id = 1; id <= maxSlots; id++) {
        updateSlotRepeatAlert(id);
    }
}

function attachSlotNameListener(slotId) {
    const input = document.getElementById(`nome_${slotId}`);
    if (!input || input._repeatAlertBound) return;
    input.addEventListener('input', () => updateSlotRepeatAlert(slotId));
    input._repeatAlertBound = true;
}

function attachAllSlotNameListeners() {
    for (let id = 1; id <= maxSlots; id++) {
        attachSlotNameListener(id);
    }
}

function findSlotByName(nome) {
    // 1) Match exato (rápido)
    for (let id = 1; id <= maxSlots; id++) {
        if (chatSlots[id] && chatSlots[id].nome === nome) return id;
    }

    // 2) Match normalizado (estrito)
    const target = normalizeChatName(nome);
    if (!target) return null;
    for (let id = 1; id <= maxSlots; id++) {
        const slotName = chatSlots[id]?.nome;
        if (!slotName) continue;
        const current = normalizeChatName(slotName);
        if (!current) continue;
        if (current === target) {
            return id;
        }
    }

    return null;
}

function findFreeSlot() {
    for (let id = 1; id <= maxSlots; id++) {
        if (!chatSlots[id]) return id;
    }
    return null;
}

function updateBallUI(winId) {
    const ball = document.getElementById(`ball_${winId}`);
    if (!ball) return;

    const slot = chatSlots[winId];
    const nameLabel = ball.querySelector('.ball-name');
    const badgeEl = ball.querySelector('.ball-badge');

    if (slot) {
        if (nameLabel) {
            const firstName = slot.nome.split(' ')[0];
            nameLabel.textContent = firstName;
            nameLabel.style.display = 'block';
        }
        if (badgeEl) {
            if (slot.badgeCount > 0) {
                // Detecta novo badge e toca som
                const previousCount = previousBadgeCounts[winId] || 0;
                if (slot.badgeCount > previousCount && bootComplete) {
                    playNotificationSound();
                }
                previousBadgeCounts[winId] = slot.badgeCount;
                
                badgeEl.textContent = slot.badgeCount;
                badgeEl.style.display = 'flex';
            } else {
                badgeEl.style.display = 'none';
                previousBadgeCounts[winId] = 0;
            }
        }
    } else {
        if (nameLabel) { nameLabel.textContent = ''; nameLabel.style.display = 'none'; }
        if (badgeEl) { badgeEl.style.display = 'none'; }
    }
}

function getNextAutoReplyMessage() {
    const list = (slotAutoReplyMessages && slotAutoReplyMessages.length)
        ? slotAutoReplyMessages
        : DEFAULT_PENDING_AUTO_REPLY_MESSAGES;
    const msg = list[autoReplyRoundRobin % list.length];
    autoReplyRoundRobin++;
    return msg;
}

function showSlotAutoPrompt(slotId, message) {
    const win = document.getElementById(`win${slotId}`);
    if (!win) return;

    let prompt = win.querySelector('.slot-auto-prompt');
    if (!prompt) {
        prompt = document.createElement('div');
        prompt.className = 'slot-auto-prompt';
        win.appendChild(prompt);
    }

    prompt.textContent = message;
    prompt.classList.add('show');

    if (prompt._hideTimer) clearTimeout(prompt._hideTimer);
    prompt._hideTimer = setTimeout(() => {
        prompt.classList.remove('show');
    }, 5000);
}

function requestDesktopNotificationPermission() {
    if (notificationPermissionAsked) return;
    notificationPermissionAsked = true;
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
    }
}

async function enableDesktopNotifications() {
    if (!('Notification' in window)) {
        fwAlert('Notificação do sistema não suportada neste navegador.');
        return;
    }

    try {
        const perm = await Notification.requestPermission();
        notificationPermissionAsked = true;

        if (perm === 'granted') {
            const n = new Notification('Firewall', {
                body: 'Notificações ativadas com sucesso.'
            });
            setTimeout(() => {
                try { n.close(); } catch (_) {}
            }, 2500);
            return;
        }

        if (perm === 'denied') {
            fwAlert('Permissão negada. Ative manualmente no cadeado do navegador.');
            return;
        }

        fwAlert('Permissão de notificação não foi concedida.');
    } catch (_) {
        fwAlert('Falha ao solicitar permissão de notificação.');
    }
}

function notifyUnreadSlot(slotId, slot) {
    if (!slot || !slot.nome) return;
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const lastNotifiedAt = slotDesktopNotified[slotId] || 0;
    if (lastNotifiedAt && (Date.now() - lastNotifiedAt) < SLOT_AUTO_REPLY_DELAY_MS) return;

    const n = new Notification('Firewall: mensagem aguardando', {
        body: `${slot.nome} está aguardando há mais de 1 minuto. Clique para abrir.`
    });

    n.onclick = () => {
        window.focus();
        openChat(`win${slotId}`);
        try { n.close(); } catch (_) {}
    };

    slotDesktopNotified[slotId] = Date.now();
}

function sendAutoReplyToSlot(slotId, message) {
    const frame = document.getElementById(`frame_${slotId}`);
    if (!frame || !frame.contentWindow) return;
    try {
        frame.contentWindow.postMessage({
            source: 'firewall-parent',
            type: 'SEND_AUTO_REPLY',
            message
        }, '*');
    } catch (_) {}
}

function syncAttentionAudioLoop() {
    const hasActiveAttention = Object.values(slotAttentionState).some(Boolean);

    if (!hasActiveAttention) {
        if (attentionLoopTimer) {
            clearInterval(attentionLoopTimer);
            attentionLoopTimer = null;
        }
        if (audioAttention) {
            try {
                audioAttention.pause();
                audioAttention.currentTime = 0;
            } catch (_) {}
        }
        return;
    }

    if (!attentionLoopTimer) {
        playAttentionSound();
        attentionLoopTimer = setInterval(() => {
            playAttentionSound();
        }, ATTENTION_AUDIO_INTERVAL_MS);
    }
}

function setSlotAttentionUI(slotId, active) {
    const outer = document.getElementById(`win${slotId}`);
    const inner = outer ? outer.querySelector('.chat-window') : null;
    const quick = document.getElementById(`quick_reply_${slotId}`);

    if (outer) outer.classList.toggle('slot-attention-flash', !!active);
    if (inner) inner.classList.toggle('slot-attention-flash', !!active);

    if (quick) {
        quick.classList.toggle('show', !!active);
    }

    slotAttentionState[slotId] = !!active;
    syncAttentionAudioLoop();
}

function sendQuickReply(slotId, message) {
    const msg = (message || '').trim();
    if (!msg) return;
    sendAutoReplyToSlot(slotId, msg);
    showSlotAutoPrompt(slotId, `enviado: ${msg}`);
}

function sendTypedReply(slotId) {
    const input = document.getElementById(`quick_reply_input_${slotId}`);
    if (!input) return;
    const msg = (input.value || '').trim();
    if (!msg) return;
    sendAutoReplyToSlot(slotId, msg);
    showSlotAutoPrompt(slotId, `enviado: ${msg}`);
    input.value = '';
}

function formatCountdown(ms) {
    const safe = Math.max(0, ms || 0);
    const totalSecs = Math.ceil(safe / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function updateQuickReplyStatus(slotId, elapsedUnreadMs = 0, snoozedRemainingMs = 0) {
    const titleEl = document.getElementById(`quick_title_${slotId}`);
    const elapsedEl = document.getElementById(`quick_elapsed_${slotId}`);
    const snoozeBtn = document.getElementById(`quick_snooze_${slotId}`);

    const elapsedText = formatDuration(Math.max(0, elapsedUnreadMs || 0));
    const isSnoozed = (snoozedRemainingMs || 0) > 0;

    if (titleEl) {
        titleEl.textContent = isSnoozed ? 'notificação pausada' : 'mensagem pendente';
    }

    if (elapsedEl) {
        elapsedEl.textContent = isSnoozed
            ? `sem resposta: ${elapsedText} · pausa: ${formatCountdown(snoozedRemainingMs)}`
            : `sem resposta: ${elapsedText}`;
    }

    if (snoozeBtn) {
        snoozeBtn.disabled = isSnoozed;
        snoozeBtn.textContent = isSnoozed
            ? `NÃO RESPONDER AGORA (${formatCountdown(snoozedRemainingMs)})`
            : 'NÃO RESPONDER AGORA (2m)';
    }
}

function snoozeUnreadNotifications(slotId) {
    if (!chatSlots[slotId] || !chatSlots[slotId].nome || !slotUnreadSince[slotId]) return;

    slotNotificationSnoozedUntil[slotId] = Date.now() + SLOT_NOTIFICATION_SNOOZE_MS;
    slotDesktopNotified[slotId] = Date.now();

    const elapsedUnread = Date.now() - slotUnreadSince[slotId];
    updateQuickReplyStatus(slotId, elapsedUnread, SLOT_NOTIFICATION_SNOOZE_MS);
    setSlotAttentionUI(slotId, false);
    showSlotAutoPrompt(slotId, 'notificação pausada por 2 minutos.');
}

function getSlotIdByFrameWindow(frameWindow) {
    if (!frameWindow) return null;
    for (let id = 1; id <= maxSlots; id++) {
        const frame = document.getElementById(`frame_${id}`);
        if (frame && frame.contentWindow === frameWindow) return id;
    }
    return null;
}

function hasActiveSlotSignal(slotId, slot) {
    const signal = slotBridgeSignals[slotId];
    if (!signal) return false;

    const signalUnread = !!signal.hasUnreadDivider || !!signal.lastMessageFromVisitor;
    if (!signalUnread) return false;

    const slotName = normalizeChatName(slot?.nome || '');
    const signalName = normalizeChatName(signal.chatName || '');
    if (!slotName || !signalName) return signalUnread;
    return slotName === signalName;
}

function runUnreadAutomation() {
    const now = Date.now();

    for (let id = 1; id <= maxSlots; id++) {
        const slot = chatSlots[id];
        if (!slot || !slot.nome) {
            setSlotAttentionUI(id, false);
            delete slotUnreadSince[id];
            delete slotAutoReplySent[id];
            delete slotDesktopNotified[id];
            delete slotNotificationSnoozedUntil[id];
            updateQuickReplyStatus(id, 0, 0);
            continue;
        }

        const unreadByBadge = Number(slot.badgeCount || 0) > 0;
        const unreadBySignal = hasActiveSlotSignal(id, slot);
        const hasUnread = unreadByBadge || unreadBySignal;

        if (!hasUnread) {
            setSlotAttentionUI(id, false);
            delete slotUnreadSince[id];
            delete slotAutoReplySent[id];
            delete slotDesktopNotified[id];
            delete slotNotificationSnoozedUntil[id];
            updateQuickReplyStatus(id, 0, 0);
            continue;
        }

        if (!slotUnreadSince[id]) slotUnreadSince[id] = now;

        const elapsedUnread = now - slotUnreadSince[id];
        const snoozedRemaining = Math.max(0, (slotNotificationSnoozedUntil[id] || 0) - now);
        if (!snoozedRemaining) {
            delete slotNotificationSnoozedUntil[id];
        }

        updateQuickReplyStatus(id, elapsedUnread, snoozedRemaining);

        if (snoozedRemaining > 0) {
            setSlotAttentionUI(id, false);
            continue;
        }

        const shouldShowAttention = elapsedUnread >= SLOT_AUTO_REPLY_DELAY_MS;
        setSlotAttentionUI(id, shouldShowAttention);

        if (elapsedUnread >= SLOT_AUTO_REPLY_DELAY_MS && !slotAutoReplySent[id]) {
            showSlotAutoPrompt(id, 'mensagem pendente há mais de 1 minuto.');
            notifyUnreadSlot(id, slot);
            slotAutoReplySent[id] = now;
        } else if (elapsedUnread >= SLOT_AUTO_REPLY_DELAY_MS) {
            notifyUnreadSlot(id, slot);
        }
    }
}

function fillWindowFields(winId, data) {
    if (data.nome) {
        const el = document.getElementById(`nome_${winId}`);
        if (el) el.value = data.nome;
        updateSlotRepeatAlert(winId);
    }
    if (data.matricula) {
        const el = document.getElementById(`mat_${winId}`);
        if (el) el.value = data.matricula;
    }
    if (data.protocolo) {
        const el = document.getElementById(`prot_${winId}`);
        if (el) el.value = data.protocolo;
    }
    if (data.tipoCliente) {
        const el = document.getElementById(`tipo_${winId}`);
        if (el) el.textContent = data.tipoCliente;
    }
    if (data.motivoAtual) {
        const el = document.getElementById(`motivoatual_${winId}`);
        if (el) el.value = data.motivoAtual;
    }
    if (data.quantidadeAbandono) {
        const el = document.getElementById(`qtd_abandono_${winId}`);
        if (el) el.value = data.quantidadeAbandono;
    }
    if (data.quantidadeChats) {
        const el = document.getElementById(`qtd_chats_${winId}`);
        if (el) el.value = data.quantidadeChats;
    }
    if (Array.isArray(data.tags)) {
        const el = document.getElementById(`tags_${winId}`);
        if (el) el.value = data.tags.join(', ');
    }
}

function clearSlotAttendanceFields(slotId) {
    const matEl = document.getElementById(`mat_${slotId}`);
    if (matEl) matEl.value = '';

    const protEl = document.getElementById(`prot_${slotId}`);
    if (protEl) protEl.value = '';

    const motivoEl = document.getElementById(`motivo_${slotId}`);
    if (motivoEl) motivoEl.value = '';

    const motivoAtualEl = document.getElementById(`motivoatual_${slotId}`);
    if (motivoAtualEl) motivoAtualEl.value = '';

    const qtdAbandonoEl = document.getElementById(`qtd_abandono_${slotId}`);
    if (qtdAbandonoEl) qtdAbandonoEl.value = '';

    const qtdChatsEl = document.getElementById(`qtd_chats_${slotId}`);
    if (qtdChatsEl) qtdChatsEl.value = '';

    const tipoEl = document.getElementById(`tipo_${slotId}`);
    if (tipoEl) tipoEl.textContent = '';

    const tagsEl = document.getElementById(`tags_${slotId}`);
    if (tagsEl) tagsEl.value = '';

    const slot = chatSlots[slotId];
    if (slot) {
        slot.tags = [];
        slot.availableTags = [];
    }

    renderTagOptionsForSlot(slotId);
}

function parseTagsInput(raw) {
    return (raw || '')
        .toString()
        .split(/[;,\n]/)
        .map(v => v.trim())
        .filter(Boolean)
        .filter((v, idx, arr) => arr.findIndex(x => normalizeChatName(x) === normalizeChatName(v)) === idx);
}

function syncTagsInputValue(slotId) {
    const tagsEl = document.getElementById(`tags_${slotId}`);
    const currentTags = (chatSlots[slotId] && Array.isArray(chatSlots[slotId].tags)) ? chatSlots[slotId].tags : [];
    if (tagsEl) tagsEl.value = currentTags.join(', ');
}

function setTagBoxOpen(slotId, isOpen) {
    const box = document.getElementById(`tag_box_${slotId}`);
    if (!chatSlots[slotId]) chatSlots[slotId] = {};
    chatSlots[slotId].tagBoxOpen = !!isOpen;
    if (box) box.classList.toggle('is-open', !!isOpen);
}

function toggleTagSelection(slotId, tagName) {
    const tag = (tagName || '').toString().trim();
    if (!tag) return;

    if (!chatSlots[slotId]) chatSlots[slotId] = {};
    const current = Array.isArray(chatSlots[slotId].tags) ? [...chatSlots[slotId].tags] : [];
    const exists = current.some(v => normalizeChatName(v) === normalizeChatName(tag));

    chatSlots[slotId].tags = exists
        ? current.filter(v => normalizeChatName(v) !== normalizeChatName(tag))
        : [...current, tag];

    syncTagsInputValue(slotId);
    renderTagOptionsForSlot(slotId);
    setTagBoxOpen(slotId, true);
    saveChatSlots();
}

function renderTagOptionsForSlot(slotId) {
    const listEl = document.getElementById(`tag_options_${slotId}`);
    if (!listEl) return;

    const available = (chatSlots[slotId] && Array.isArray(chatSlots[slotId].availableTags))
        ? chatSlots[slotId].availableTags
        : [];
    const selected = (chatSlots[slotId] && Array.isArray(chatSlots[slotId].tags))
        ? chatSlots[slotId].tags
        : [];

    const summaryEl = document.getElementById(`tag_summary_${slotId}`);
    if (summaryEl) {
        if (selected.length) {
            summaryEl.textContent = selected.join(', ');
            summaryEl.classList.add('has-value');
        } else {
            summaryEl.textContent = 'Nenhuma selecionada';
            summaryEl.classList.remove('has-value');
        }
    }

    if (!available.length) {
        listEl.innerHTML = '<div class="tag-dropdown-empty">Nenhuma opção carregada ainda. Clique em ↺ para buscar.</div>';
        syncTagsInputValue(slotId);
        return;
    }

    listEl.innerHTML = available.map(tag => {
        const active = selected.some(v => normalizeChatName(v) === normalizeChatName(tag));
        return `<div class="tag-row${active ? ' selected' : ''}" onclick='event.stopPropagation(); toggleTagSelection(${slotId}, ${JSON.stringify(tag)}); return false;'><span>${escapeHtmlText(tag)}</span><span class="tag-row-check">✓</span></div>`;
    }).join('');

    syncTagsInputValue(slotId);
    setTagBoxOpen(slotId, !!(chatSlots[slotId] && chatSlots[slotId].tagBoxOpen));
}

function toggleTagBox(slotId) {
    const box = document.getElementById(`tag_box_${slotId}`);
    if (!box) return;
    const willOpen = !box.classList.contains('is-open');
    document.querySelectorAll('.tag-box.is-open').forEach(b => b.classList.remove('is-open'));
    Object.keys(chatSlots || {}).forEach(key => {
        if (chatSlots[key]) chatSlots[key].tagBoxOpen = false;
    });
    setTagBoxOpen(slotId, willOpen);
}

document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('.tag-box')) return;
    document.querySelectorAll('.tag-box.is-open').forEach(b => b.classList.remove('is-open'));
    Object.keys(chatSlots || {}).forEach(key => {
        if (chatSlots[key]) chatSlots[key].tagBoxOpen = false;
    });
});

function loadTagOptionsForSlot(id) {
    const frame = document.getElementById(`frame_${id}`);
    if (!frame || !frame.contentWindow || !frame.src || frame.src === 'about:blank') {
        fwAlert('❌ Chat do slot não está aberto.');
        return;
    }

    const refreshBtn = document.getElementById(`tag_refresh_${id}`);
    if (refreshBtn) refreshBtn.classList.add('is-loading');

    const requestId = `tagopts_${id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const onResult = (event) => {
        if (!event.data || event.data.source !== 'firewall-extension') return;
        if (event.data.type !== 'ROCKETCHAT_FETCH_TAG_OPTIONS_RESULT') return;
        if (event.data.requestId !== requestId) return;
        window.removeEventListener('message', onResult);
        if (refreshBtn) refreshBtn.classList.remove('is-loading');

        if (!event.data.ok) {
            fwAlert(`❌ ${event.data.message || 'Falha ao carregar opções de tags.'}`);
            return;
        }

        if (!chatSlots[id]) chatSlots[id] = {};
        chatSlots[id].availableTags = Array.isArray(event.data.options) ? event.data.options : [];
        if (Array.isArray(event.data.tags) && event.data.tags.length) {
            chatSlots[id].tags = event.data.tags;
        } else if (!Array.isArray(chatSlots[id].tags)) {
            chatSlots[id].tags = [];
        }

        renderTagOptionsForSlot(id);
        saveChatSlots();
        // auto-abrir o box ao carregar
        setTagBoxOpen(id, true);
    };

    window.addEventListener('message', onResult);
    setTimeout(() => {
        window.removeEventListener('message', onResult);
        if (refreshBtn) refreshBtn.classList.remove('is-loading');
    }, 25000);

    frame.contentWindow.postMessage({
        source: 'firewall-parent',
        type: 'OPEN_FETCH_TAG_OPTIONS',
        requestId
    }, '*');
}

function applyTagsFromSlot(id) {
    const frame = document.getElementById(`frame_${id}`);
    if (!frame || !frame.contentWindow || !frame.src || frame.src === 'about:blank') {
        fwAlert('❌ Chat do slot não está aberto.');
        return;
    }

    const tagsRaw = document.getElementById(`tags_${id}`)?.value || '';
    const tags = parseTagsInput(tagsRaw);
    if (!tags.length) {
        fwAlert('❌ Informe pelo menos uma tag (separe por vírgula).');
        return;
    }

    if (!chatSlots[id]) chatSlots[id] = {};
    chatSlots[id].tags = tags;
    saveChatSlots();

    const onResult = (event) => {
        if (!event.data || event.data.source !== 'firewall-extension') return;
        if (event.data.type !== 'ROCKETCHAT_APPLY_TAGS_RESULT') return;
        window.removeEventListener('message', onResult);

        if (!event.data.ok) {
            fwAlert(`❌ ${event.data.message || 'Falha ao aplicar tags.'}`);
            return;
        }

        const applied = Array.isArray(event.data.tags) ? event.data.tags : tags;
        chatSlots[id].tags = applied;
        const tagsEl = document.getElementById(`tags_${id}`);
        if (tagsEl) tagsEl.value = applied.join(', ');
        saveChatSlots();
    };

    window.addEventListener('message', onResult);
    setTimeout(() => window.removeEventListener('message', onResult), 25000);

    frame.contentWindow.postMessage({
        source: 'firewall-parent',
        type: 'OPEN_APPLY_TAGS',
        tags
    }, '*');
}

function openChatByNameInSlotFrame(slotId, chatName, chatUrl = null) {
    if (!chatName) return;
    const frame = document.getElementById(`frame_${slotId}`);
    if (!frame || !frame.contentWindow) return;

    const payload = { type: 'OPEN_CHAT_BY_NAME', source: 'firewall-parent', chatName, chatUrl };

    // Tenta múltiplas vezes para pegar cenário de carregamento SPA
    setTimeout(() => {
        try { frame.contentWindow.postMessage(payload, '*'); } catch (_) {}
    }, 200);
    setTimeout(() => {
        try { frame.contentWindow.postMessage(payload, '*'); } catch (_) {}
    }, 900);
    setTimeout(() => {
        try { frame.contentWindow.postMessage(payload, '*'); } catch (_) {}
    }, 1800);
}

function markFinalizedChat(slotId) {
    const slot = chatSlots[slotId];
    if (!slot || !slot.nome) return;

    const roomId = extractRoomIdFromUrl(slot.chatUrl);
    if (roomId) {
        finalizedChatSuppressUntil[`rid:${roomId}`] = true;
    }
}

function isChatFinalizedSuppressed(chat) {
    if (!chat) return false;

    const roomId = extractRoomIdFromUrl(chat.chatUrl);
    if (roomId && finalizedChatSuppressUntil[`rid:${roomId}`]) {
        return true;
    }

    return false;
}

function processSidebarUpdate(sidebarChats) {
    if (!Array.isArray(sidebarChats)) return;

    const hasActiveSlots = Array.from({ length: maxSlots }, (_, i) => i + 1)
        .some(id => !!(chatSlots[id] && chatSlots[id].nome));

    const skipMissingCleanup = !mainSidebarReadyForAutoRelease && hasActiveSlots;

    const currentNames = sidebarChats.map(c => c.nome);
    const normalizedCurrentNames = currentNames.map(n => normalizeChatName(n)).filter(Boolean);
    const now = Date.now();
    const slotsThatReturned = new Set();
    const inInitialSyncGrace = (now - APP_STARTED_AT) < INITIAL_SIDEBAR_SYNC_GRACE_MS;
    const visibleSidebarChats = sidebarChats.filter(chat => !isChatFinalizedSuppressed(chat));
    const visibleNames = visibleSidebarChats.map(c => c.nome);
    const visibleNormalizedNames = visibleNames.map(n => normalizeChatName(n)).filter(Boolean);

    for (let id = 1; id <= maxSlots; id++) {
        if (chatSlots[id]) {
            if (skipMissingCleanup) {
                continue;
            }
            const slotName = chatSlots[id].nome;
            const normalizedSlotName = normalizeChatName(slotName);
            const exactExists = visibleNames.includes(slotName);
            const tolerantExists = normalizedSlotName
                ? visibleNormalizedNames.some(n => n === normalizedSlotName)
                : false;
            const missing = !(exactExists || tolerantExists);

            if (missing) {
                if (!slotMissingSince[id]) {
                    slotMissingSince[id] = now;
                    slotMissingHits[id] = 1;
                } else {
                    slotMissingHits[id] = (slotMissingHits[id] || 0) + 1;
                }

                const missingFor = now - slotMissingSince[id];
                const missingHits = slotMissingHits[id] || 0;
                const finalizeRequestedAt = slotFinalizeRequestedAt[id] || 0;
                const waitingFinalizeClose = finalizeRequestedAt > 0;
                const restoredAt = slotRestoredFromCacheAt[id] || 0;
                const waitingCacheValidation = restoredAt > 0;

                // Quando já foi solicitado finalizar (NPS/FILA/ABANDONO/RESOLVIDO),
                // fecha rápido assim que o chat realmente some da fila.
                if (waitingFinalizeClose && missingFor >= SLOT_FINALIZE_WAIT_GRACE_MS && missingHits >= 1) {
                    delete slotMissingSince[id];
                    delete slotMissingHits[id];
                    autoReleaseSlot(id);
                    continue;
                }

                // Slot veio do cache após F5: se não reaparecer na fila em pouco tempo,
                // considera stale e fecha para não ficar "fantasma" com dados antigos.
                if (waitingCacheValidation && mainSidebarReadyForAutoRelease && missingFor >= SLOT_CACHE_VERIFY_GRACE_MS && missingHits >= 2) {
                    delete slotMissingSince[id];
                    delete slotMissingHits[id];
                    autoReleaseSlot(id);
                    continue;
                }

                // Fechamento normal: nome sumiu da fila por tempo suficiente.
                // Não depende de flag de finalização — basta o nome desaparecer de verdade.
                if (!inInitialSyncGrace && missingFor >= SLOT_AUTO_RELEASE_GRACE_MS && missingHits >= SLOT_AUTO_RELEASE_MIN_HITS) {
                    delete slotMissingSince[id];
                    delete slotMissingHits[id];
                    autoReleaseSlot(id);
                }
            } else {
                // Chat voltou para a fila antes do grace period
                if (slotMissingSince[id]) {
                    slotsThatReturned.add(id);
                    delete slotMissingSince[id];
                    delete slotMissingHits[id];
                }
                // NUNCA apaga slotFinalizeRequestedAt aqui: o chat pode voltar
                // brevemente na fila enquanto o Rocket processa NPS/FILA/ABANDONO.
                // O flag só é limpo quando o slot realmente fecha (autoReleaseSlot/releaseSlot).
                delete slotRestoredFromCacheAt[id];
            }
        }
    }

    visibleSidebarChats.forEach(chat => {
        const existingSlot = findSlotByName(chat.nome);
        
        if (existingSlot) {
            const currentSlot = chatSlots[existingSlot] || {};
            const previousRoomId = extractRoomIdFromUrl(currentSlot.chatUrl || '');
            const incomingRoomId = extractRoomIdFromUrl(chat.chatUrl || '');
            const isNewAttendanceSameName = !!previousRoomId && !!incomingRoomId && previousRoomId !== incomingRoomId;

            if (isNewAttendanceSameName) {
                const now = Date.now();
                chatSlots[existingSlot] = {
                    ...currentSlot,
                    nome: chat.nome,
                    matricula: null,
                    protocolo: null,
                    tipoCliente: null,
                    motivoAtual: null,
                    badgeCount: chat.badgeCount,
                    chatUrl: chat.chatUrl || null,
                    openedAt: now
                };

                clearSlotAttendanceFields(existingSlot);
                fillWindowFields(existingSlot, { nome: chat.nome });
                setOpenedAtCache(chat.nome, now);
                startChatTimer(existingSlot);
            }

            const wasInGracePeriod = slotsThatReturned.has(existingSlot);

            // Sincroniza nome atual vindo da fila (evita divergência futura)
            chatSlots[existingSlot].nome = chat.nome;
            chatSlots[existingSlot].badgeCount = chat.badgeCount;
            if (chat.chatUrl) chatSlots[existingSlot].chatUrl = chat.chatUrl;
            if (chatSlots[existingSlot].openedAt) {
                setOpenedAtCache(chat.nome, chatSlots[existingSlot].openedAt);
            }
            fillWindowFields(existingSlot, { nome: chat.nome });

            // Só força reabertura quando estava em período de ausência temporária.
            // Evita atualizar/recarregar chat ao clicar NPS/FILA/ABANDONO.
            if (wasInGracePeriod) {
                delete slotMissingSince[existingSlot];
                delete slotMissingHits[existingSlot];

                // Mantém TMA e dados já coletados; apenas garante reabrir o chat correto
                const frame = document.getElementById(`frame_${existingSlot}`);
                if (frame) {
                    openChatByNameInSlotFrame(existingSlot, chat.nome, chat.chatUrl || chatSlots[existingSlot].chatUrl || null);
                }
            } else {
                // NÃO reenvia OPEN_CHAT_BY_NAME nem redefine frame.src para slots existentes
                // Isso causava re-extração a cada mensagem/badge
            }

            updateBallUI(existingSlot);
        } else {
            const freeSlot = findFreeSlot();
            if (freeSlot) {
                delete slotMissingSince[freeSlot];
                delete slotMissingHits[freeSlot];
                // Verifica se já tinha openedAt salvo ou cria novo
                const existingOpenedAt = chatSlots[freeSlot]?.openedAt;
                const cachedOpenedAt = getOpenedAtCache(chat.nome);
                chatSlots[freeSlot] = {
                    nome: chat.nome,
                    matricula: null,
                    protocolo: null,
                    tipoCliente: null,
                    motivoAtual: null,
                    badgeCount: chat.badgeCount,
                    chatUrl: chat.chatUrl || null,
                    openedAt: existingOpenedAt || cachedOpenedAt || Date.now()
                };
                setOpenedAtCache(chat.nome, chatSlots[freeSlot].openedAt);
                fillWindowFields(freeSlot, { nome: chat.nome });
                updateBallUI(freeSlot);
                openChatSilent(`win${freeSlot}`);
                startChatTimer(freeSlot);
                saveChatSlots();
                
                const frame = document.getElementById(`frame_${freeSlot}`);
                if (frame) {
                    const targetUrl = chat.chatUrl && canEmbedInIframe(chat.chatUrl)
                        ? chat.chatUrl
                        : ROCKET_HOME_URL;

                    if (canEmbedInIframe(targetUrl)) {
                        frame.src = targetUrl;
                    } else {
                        frame.src = 'about:blank';
                    }

                    // Garante abrir o chat correto mesmo quando a URL é genérica (SPA)
                    openChatByNameInSlotFrame(freeSlot, chat.nome, chat.chatUrl || null);
                }
            }
        }
    });
    
    runUnreadAutomation();
    updateAddButton();
}

function requestSidebarUpdate() {
    const rocketFrame = document.getElementById('frame_rocket');
    if (frameCanReceiveBridgeMessage(rocketFrame)) {
        rocketFrame.contentWindow.postMessage({ type: 'DATA_REQUEST', source: 'firewall-parent' }, '*');
    }
}

function startBridgeWarmup() {
    if (bridgeWarmupTimer) return;

    let attempts = 0;
    bridgeWarmupTimer = setInterval(() => {
        attempts++;

        ensureRocketBackgroundOnline(false);
        requestSidebarUpdate();

        if (bridgeActive || attempts >= 40) {
            clearInterval(bridgeWarmupTimer);
            bridgeWarmupTimer = null;
        }
    }, 3000);
}

function stopBridgeWarmup() {
    if (!bridgeWarmupTimer) return;
    clearInterval(bridgeWarmupTimer);
    bridgeWarmupTimer = null;
}

function ensureRocketBackgroundOnline(forceReload = false) {
    const rocketFrame = document.getElementById('frame_rocket');
    if (!rocketFrame) return;

    const src = (rocketFrame.getAttribute('src') || rocketFrame.src || '').trim();
    const needsLoad = !src || src === 'about:blank' || src.endsWith('about:blank');

    if (needsLoad) {
        rocketFrame.src = ROCKET_HOME_URL;
        return;
    }

    if (forceReload) {
        const now = Date.now();
        if ((now - lastRocketForceReloadAt) < ROCKET_FORCE_RELOAD_BACKOFF_MS) return;
        lastRocketForceReloadAt = now;
        rocketFrame.src = ROCKET_HOME_URL;
    }
}

window.addEventListener('message', (event) => {
    if (!event.data || event.data.source !== 'firewall-extension') return;

    switch(event.data.type) {
        case 'ROCKETCHAT_BRIDGE_READY':
            bridgeActive = true;
            mainBridgeStaleHits = 0;
            stopBridgeWarmup();
            {
                const rocketFrameReady = document.getElementById('frame_rocket');
                if (rocketFrameReady && event.source === rocketFrameReady.contentWindow) {
                    lastMainBridgeUpdateAt = Date.now();
                }
            }
            updateBridgeStatus();
            break;

        case 'ROCKETCHAT_BRIDGE_UPDATE':
            bridgeActive = true;
            mainBridgeStaleHits = 0;
            const d = event.data.data;

            if (d.agentStatus) updateAgentStatus(d.agentStatus);
            if (d.omniActive !== null && d.omniActive !== undefined) updateOmniToggle(d.omniActive);

            if (d.sidebarChats) {
                // Evita interferência dos iframes dos slots: processa fila apenas do painel principal
                const rocketFrame = document.getElementById('frame_rocket');
                const isFromMainRocketFrame = !!(rocketFrame && event.source === rocketFrame.contentWindow);
                if (isFromMainRocketFrame) {
                    lastMainBridgeUpdateAt = Date.now();
                    if ((Array.isArray(d.sidebarChats) && d.sidebarChats.length > 0) || !!d.agentStatus) {
                        mainSidebarReadyForAutoRelease = true;
                    }
                    processSidebarUpdate(d.sidebarChats);
                }
            }
            break;

        case 'ROCKETCHAT_AUTO_REPLY_RESULT':
            if (!event.data.ok) {
            }
            break;

        case 'ROCKETCHAT_SLOT_SIGNAL':
            const slotIdBySignal = getSlotIdByFrameWindow(event.source);
            if (slotIdBySignal) {
                const signalData = event.data.data || {};
                slotBridgeSignals[slotIdBySignal] = {
                    hasUnreadDivider: !!signalData.hasUnreadDivider,
                    lastMessageFromVisitor: !!signalData.lastMessageFromVisitor,
                    chatName: signalData.chatName || '',
                    updatedAt: Date.now()
                };
                runUnreadAutomation();
            }
            break;

        case 'ROCKETCHAT_BRIDGE_DETAILS':
            const details = event.data.data;
            if (details.nome) {
                const slot = findSlotByName(details.nome);
                if (slot) {
                    if (details.matricula) chatSlots[slot].matricula = details.matricula;
                    if (details.protocolo) chatSlots[slot].protocolo = details.protocolo;
                    if (details.tipoCliente) chatSlots[slot].tipoCliente = details.tipoCliente;
                    if (details.motivoAtual) chatSlots[slot].motivoAtual = details.motivoAtual;
                    if (Array.isArray(details.tags)) chatSlots[slot].tags = details.tags;
                    if (Array.isArray(details.availableTags) && details.availableTags.length) {
                        chatSlots[slot].availableTags = details.availableTags;
                    }
                    fillWindowFields(slot, details);
                    renderTagOptionsForSlot(slot);
                    saveChatSlots();
                }
            }
            break;
            
        case 'ROCKETCHAT_CHAT_REMOVED':
            // Aceita remoção APENAS do frame principal (evita falsos positivos dos slots)
            const rocketFrameRm = document.getElementById('frame_rocket');
            const isFromMainRm = !!(rocketFrameRm && event.source === rocketFrameRm.contentWindow);
            if (!isFromMainRm) break;

            const removedName = event.data.data.nome;
            const removedSlot = findSlotByName(removedName);
            if (removedSlot) {
                autoReleaseSlot(removedSlot);
            }
            break;
            
        case 'ROCKETCHAT_AVATAR_LETTER':
            const avatarData = event.data.data;
            if (avatarData.avatarUrl) {
                const avatarImg = document.getElementById('agent-avatar');
                if (avatarImg) {
                    avatarImg.src = avatarData.avatarUrl;
                }
            }
            break;
    }
});

function autoReleaseSlot(winId) {
    // Fecha e limpa automaticamente quando chat sai da fila
    if (chatTimers[winId]) {
        clearInterval(chatTimers[winId]);
        chatTimers[winId] = null;
    }

    delete slotMissingSince[winId];
    delete slotMissingHits[winId];
    delete slotUnreadSince[winId];
    delete slotAutoReplySent[winId];
    delete slotDesktopNotified[winId];
    delete slotBridgeSignals[winId];
    delete slotNotificationSnoozedUntil[winId];
    delete slotFinalizeRequestedAt[winId];
    delete slotRestoredFromCacheAt[winId];
    const previousSlotName = chatSlots[winId]?.nome || document.getElementById(`nome_${winId}`)?.value || '';
    removeOpenedAtCache(previousSlotName);
    markFinalizedChat(winId);
    
    chatSlots[winId] = null;
    
    const win = document.getElementById(`win${winId}`);
    if (win) win.style.display = 'none';

    const frame = document.getElementById(`frame_${winId}`);
    if (frame) frame.src = 'about:blank';
    
    const fields = ['nome', 'mat', 'prot', 'motivo', 'site', 'motivoatual'];
    fields.forEach(f => {
        const el = document.getElementById(`${f}_${winId}`);
        if (el) el.value = f === 'site' ? 'CG' : '';
    });
    
    const tipoEl = document.getElementById(`tipo_${winId}`);
    if (tipoEl) tipoEl.textContent = '';

    applySlotTimerState(winId, 0);
    
    updateBallUI(winId);
    updateSlotRepeatAlert(winId);
    updateAddButton();
    saveChatSlots();
}

function getSlotTimerPalette(elapsed) {
    if (elapsed >= SLOT_TIMER_DANGER_MS) {
        return {
            text: '#ef4444',
            bg: 'rgba(239, 68, 68, 0.08)',
            border: 'rgba(239, 68, 68, 0.35)',
            insetGlow: 'rgba(239, 68, 68, 0.12)',
            outerGlow: 'rgba(239, 68, 68, 0.15)',
            windowBorder: 'rgba(239, 68, 68, 0.38)',
            windowTop: '#ef4444',
            windowShadow: 'rgba(239, 68, 68, 0.2)'
        };
    }
    if (elapsed >= SLOT_TIMER_WARNING_MS) {
        return {
            text: '#f59e0b',
            bg: 'rgba(245, 158, 11, 0.08)',
            border: 'rgba(245, 158, 11, 0.35)',
            insetGlow: 'rgba(245, 158, 11, 0.12)',
            outerGlow: 'rgba(245, 158, 11, 0.15)',
            windowBorder: 'rgba(245, 158, 11, 0.38)',
            windowTop: '#f59e0b',
            windowShadow: 'rgba(245, 158, 11, 0.2)'
        };
    }
    return {
        text: '#22c55e',
        bg: 'rgba(34, 197, 94, 0.08)',
        border: 'rgba(34, 197, 94, 0.35)',
        insetGlow: 'rgba(34, 197, 94, 0.12)',
        outerGlow: 'rgba(34, 197, 94, 0.15)',
        windowBorder: 'rgba(34, 197, 94, 0.38)',
        windowTop: '#22c55e',
        windowShadow: 'rgba(34, 197, 94, 0.2)'
    };
}

function applyTimerPalette(timerEl, palette, compact = false) {
    if (!timerEl) return;
    timerEl.style.color = palette.text;
    timerEl.style.background = palette.bg;
    timerEl.style.borderColor = palette.border;
    timerEl.style.boxShadow = compact
        ? 'none'
        : `inset 0 0 8px ${palette.insetGlow}, 0 0 8px ${palette.outerGlow}`;
}

function applySlotTimerState(slotId, elapsed) {
    const safeElapsed = Math.max(0, elapsed || 0);
    const palette = getSlotTimerPalette(safeElapsed);
    const timeText = formatDuration(safeElapsed);
    const timerEl = document.getElementById(`timer_${slotId}`);
    const timerTopEl = document.getElementById(`timer_top_${slotId}`);
    const winInner = document.querySelector(`#win${slotId} .chat-window`);

    if (timerEl) {
        timerEl.textContent = timeText;
        timerEl.title = `Tempo de chat: ${timeText} / limite ${formatDuration(SLOT_TIMER_LIMIT_MS)}`;
        applyTimerPalette(timerEl, palette, false);
    }
    if (timerTopEl) {
        timerTopEl.textContent = timeText;
        timerTopEl.title = `Tempo de chat: ${timeText} / limite ${formatDuration(SLOT_TIMER_LIMIT_MS)}`;
        applyTimerPalette(timerTopEl, palette, true);
    }
    if (winInner) {
        winInner.style.borderColor = palette.windowBorder;
        winInner.style.borderTopColor = palette.windowTop;
        winInner.style.boxShadow = `0 0 20px ${palette.windowShadow}`;
    }
}

function startChatTimer(slotId) {
    if (chatTimers[slotId]) {
        clearInterval(chatTimers[slotId]);
    }

    const currentSlot = chatSlots[slotId];
    applySlotTimerState(slotId, currentSlot && currentSlot.openedAt ? Date.now() - currentSlot.openedAt : 0);
    
    chatTimers[slotId] = setInterval(() => {
        const slot = chatSlots[slotId];
        if (slot && slot.openedAt) {
            const elapsed = Date.now() - slot.openedAt;
            applySlotTimerState(slotId, elapsed);
        }
    }, 1000);
}

function addNewSlot() {
    maxSlots++;
    createDynamicChatWindow(maxSlots);
    createDynamicBall(maxSlots);
    updateAddButton();
}

function createDynamicBall(id) {
    const container = document.querySelector('.fixed.left-6');
    const ballDiv = document.createElement('div');
    ballDiv.id = `ball_${id}`;
    ballDiv.className = 'ball shadow-blue-500/20 relative';
    ballDiv.onclick = () => openChat(`win${id}`);
    ballDiv.innerHTML = `
        ${String(id).padStart(2, '0')}
        <span class="ball-badge" style="display:none"></span>
        <span class="ball-name" style="display:none"></span>
    `;
    
    // Insere antes do botão + se existir, senão no final
    const addBtn = document.getElementById('add-slot-btn');
    if (addBtn) {
        container.insertBefore(ballDiv, addBtn);
    } else {
        container.appendChild(ballDiv);
    }
}

function updateAddButton() {
    let addBtn = document.getElementById('add-slot-btn');
    const allSlotsFilled = Array.from({length: maxSlots}, (_, i) => i + 1).every(id => chatSlots[id]);
    
    if (allSlotsFilled) {
        if (!addBtn) {
            const container = document.querySelector('.fixed.left-6');
            addBtn = document.createElement('div');
            addBtn.id = 'add-slot-btn';
            addBtn.className = 'ball shadow-green-500/20 relative';
            addBtn.style.background = 'rgba(34, 197, 94, 0.1)';
            addBtn.style.borderColor = 'rgba(34, 197, 94, 0.3)';
            addBtn.style.color = '#22c55e';
            addBtn.onclick = addNewSlot;
            addBtn.innerHTML = '+';
            addBtn.style.fontSize = '1.5rem';
            addBtn.title = 'Adicionar novo slot';
            container.appendChild(addBtn);
        }
    } else {
        if (addBtn) {
            addBtn.remove();
        }
    }
}

function releaseSlot(winId) {
    if (chatTimers[winId]) {
        clearInterval(chatTimers[winId]);
        chatTimers[winId] = null;
    }
    delete slotMissingSince[winId];
    delete slotMissingHits[winId];
    delete slotUnreadSince[winId];
    delete slotAutoReplySent[winId];
    delete slotDesktopNotified[winId];
    delete slotBridgeSignals[winId];
    delete slotNotificationSnoozedUntil[winId];
    delete slotFinalizeRequestedAt[winId];
    delete slotRestoredFromCacheAt[winId];
    const previousSlotName = chatSlots[winId]?.nome || document.getElementById(`nome_${winId}`)?.value || '';
    removeOpenedAtCache(previousSlotName);
    markFinalizedChat(winId);
    chatSlots[winId] = null;

    const frame = document.getElementById(`frame_${winId}`);
    if (frame) frame.src = 'about:blank';

    const win = document.getElementById(`win${winId}`);
    if (win) win.style.display = 'none';

    const fields = ['nome', 'mat', 'prot', 'motivo', 'site', 'motivoatual'];
    fields.forEach(f => {
        const el = document.getElementById(`${f}_${winId}`);
        if (el) el.value = f === 'site' ? 'CG' : '';
    });
    const tipoEl = document.getElementById(`tipo_${winId}`);
    if (tipoEl) tipoEl.textContent = '';
    applySlotTimerState(winId, 0);
    updateBallUI(winId);
    updateSlotRepeatAlert(winId);
    saveChatSlots();
}

// --- Layout persistence (posição + tamanho dos slots) ---
let _layoutSaveTimer = null;
const SLOT_DEFAULT_WIDTH = 460;
const SLOT_DEFAULT_HEIGHT = 620;
const SLOT_MIN_WIDTH = 300;
const SLOT_MIN_HEIGHT = 400;
const SLOT_TOP_SAFE_MARGIN = 2;
const SLOT_SIDE_SAFE_MARGIN = 2;
const NOTEPAD_LAYOUT_CACHE_KEY = 'fw_notepad_layouts_v1';

function isPersistentNotepadWindow(element) {
    const id = element?.id || '';
    if (!id) return false;
    if (!element.classList?.contains('notepad-window')) return false;
    if (id.startsWith('win')) return false;
    if (id.startsWith('pending-messages-editor-')) return false;
    if (id.startsWith('terminal-editor-')) return false;
    return true;
}

function isValidLayoutSize(value, min) {
    const num = parseFloat(value);
    return Number.isFinite(num) && num >= min;
}

function parseLayoutPx(value, fallback = 0) {
    const num = parseFloat(value);
    return Number.isFinite(num) ? num : fallback;
}

function getDefaultSlotPosition(slotId) {
    return {
        top: 80 + (slotId * 60),
        left: 300 + (slotId * 80)
    };
}

function clampSlotPosition(slotId, top, left, width, height) {
    const defaults = getDefaultSlotPosition(slotId);
    const safeWidth = Math.max(SLOT_MIN_WIDTH, parseLayoutPx(width, SLOT_DEFAULT_WIDTH));
    const safeHeight = Math.max(SLOT_MIN_HEIGHT, parseLayoutPx(height, SLOT_DEFAULT_HEIGHT));
    
    // Get actual viewport dimensions accounting for CSS zoom
    const appScale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-scale')) || 1;
    const viewportWidth = (window.innerWidth || 0) / appScale;
    const viewportHeight = (window.innerHeight || 0) / appScale;

    let nextTop = parseLayoutPx(top, defaults.top);
    let nextLeft = parseLayoutPx(left, defaults.left);

    if (nextTop < SLOT_TOP_SAFE_MARGIN) nextTop = SLOT_TOP_SAFE_MARGIN;
    const maxTop = viewportHeight - safeHeight;
    if (nextTop > maxTop) nextTop = maxTop;

    if (nextLeft < SLOT_SIDE_SAFE_MARGIN) nextLeft = SLOT_SIDE_SAFE_MARGIN;
    const maxLeft = viewportWidth - safeWidth;
    if (nextLeft > maxLeft) nextLeft = maxLeft;

    return { top: nextTop, left: nextLeft };
}

function applyClampedSlotLayout(slotId) {
    const outer = document.getElementById(`win${slotId}`);
    if (!outer) return;
    const inner = outer.querySelector('.chat-window');
    const width = inner?.style.width || `${inner?.offsetWidth || SLOT_DEFAULT_WIDTH}px`;
    const height = inner?.style.height || `${inner?.offsetHeight || SLOT_DEFAULT_HEIGHT}px`;
    const clamped = clampSlotPosition(slotId, outer.style.top, outer.style.left, width, height);
    outer.style.top = `${clamped.top}px`;
    outer.style.left = `${clamped.left}px`;
}

function saveWindowLayouts() {
    clearTimeout(_layoutSaveTimer);
    _layoutSaveTimer = setTimeout(() => {
        let previousLayouts = {};
        try {
            previousLayouts = JSON.parse(localStorage.getItem('chat_slot_layouts') || '{}') || {};
        } catch (_) {
            previousLayouts = {};
        }

        const layouts = {};
        for (let id = 1; id <= maxSlots; id++) {
            const outer = document.getElementById(`win${id}`);
            if (!outer) continue;
            const inner = outer.querySelector('.chat-window');
            const previous = previousLayouts[id] || {};
            const isVisible = getComputedStyle(outer).display !== 'none';

            let width = inner ? (inner.style.width || '') : '';
            let height = inner ? (inner.style.height || '') : '';

            if (!width && isVisible && inner && inner.offsetWidth >= SLOT_MIN_WIDTH) {
                width = `${inner.offsetWidth}px`;
            }
            if (!height && isVisible && inner && inner.offsetHeight >= SLOT_MIN_HEIGHT) {
                height = `${inner.offsetHeight}px`;
            }

            if (!isValidLayoutSize(width, SLOT_MIN_WIDTH)) {
                width = isValidLayoutSize(previous.width, SLOT_MIN_WIDTH) ? previous.width : `${SLOT_DEFAULT_WIDTH}px`;
            }
            if (!isValidLayoutSize(height, SLOT_MIN_HEIGHT)) {
                height = isValidLayoutSize(previous.height, SLOT_MIN_HEIGHT) ? previous.height : `${SLOT_DEFAULT_HEIGHT}px`;
            }

            const clamped = clampSlotPosition(id, outer.style.top || previous.top, outer.style.left || previous.left, width, height);

            layouts[id] = {
                top: `${clamped.top}px`,
                left: `${clamped.left}px`,
                width,
                height
            };
        }
        localStorage.setItem('chat_slot_layouts', JSON.stringify(layouts));
        saveNotepadWindowLayouts();
    }, 300);
}

function saveWindowLayoutsNow() {
    clearTimeout(_layoutSaveTimer);

    let previousLayouts = {};
    try {
        previousLayouts = JSON.parse(localStorage.getItem('chat_slot_layouts') || '{}') || {};
    } catch (_) {
        previousLayouts = {};
    }

    const layouts = {};
    for (let id = 1; id <= maxSlots; id++) {
        const outer = document.getElementById(`win${id}`);
        if (!outer) continue;
        const inner = outer.querySelector('.chat-window');
        const previous = previousLayouts[id] || {};
        const isVisible = getComputedStyle(outer).display !== 'none';

        let width = inner ? (inner.style.width || '') : '';
        let height = inner ? (inner.style.height || '') : '';

        if (!width && isVisible && inner && inner.offsetWidth >= SLOT_MIN_WIDTH) {
            width = `${inner.offsetWidth}px`;
        }
        if (!height && isVisible && inner && inner.offsetHeight >= SLOT_MIN_HEIGHT) {
            height = `${inner.offsetHeight}px`;
        }

        if (!isValidLayoutSize(width, SLOT_MIN_WIDTH)) {
            width = isValidLayoutSize(previous.width, SLOT_MIN_WIDTH) ? previous.width : `${SLOT_DEFAULT_WIDTH}px`;
        }
        if (!isValidLayoutSize(height, SLOT_MIN_HEIGHT)) {
            height = isValidLayoutSize(previous.height, SLOT_MIN_HEIGHT) ? previous.height : `${SLOT_DEFAULT_HEIGHT}px`;
        }

        const clamped = clampSlotPosition(id, outer.style.top || previous.top, outer.style.left || previous.left, width, height);

        layouts[id] = {
            top: `${clamped.top}px`,
            left: `${clamped.left}px`,
            width,
            height
        };
    }

    localStorage.setItem('chat_slot_layouts', JSON.stringify(layouts));
    saveNotepadWindowLayouts();
}

function loadWindowLayouts() {
    const saved = localStorage.getItem('chat_slot_layouts');
    if (saved) {
        try {
            const layouts = JSON.parse(saved);
            for (let id = 1; id <= maxSlots; id++) {
                const layout = layouts[id];
                if (!layout) continue;
                const outer = document.getElementById(`win${id}`);
                if (!outer) continue;
                const inner = outer.querySelector('.chat-window');
                const safeWidth = isValidLayoutSize(layout.width, SLOT_MIN_WIDTH)
                    ? layout.width
                    : `${SLOT_DEFAULT_WIDTH}px`;
                const safeHeight = isValidLayoutSize(layout.height, SLOT_MIN_HEIGHT)
                    ? layout.height
                    : `${SLOT_DEFAULT_HEIGHT}px`;
                if (inner) {
                    inner.style.width = safeWidth;
                    inner.style.height = safeHeight;
                }
                const clamped = clampSlotPosition(id, layout.top, layout.left, safeWidth, safeHeight);
                outer.style.top = `${clamped.top}px`;
                outer.style.left = `${clamped.left}px`;
                layouts[id] = {
                    ...layout,
                    top: `${clamped.top}px`,
                    left: `${clamped.left}px`,
                    width: safeWidth,
                    height: safeHeight
                };
            }
            localStorage.setItem('chat_slot_layouts', JSON.stringify(layouts));
        } catch(e) {  }
    }

    loadNotepadWindowLayouts();
}

function saveNotepadWindowLayouts() {
    let previousLayouts = {};
    try {
        previousLayouts = JSON.parse(localStorage.getItem(NOTEPAD_LAYOUT_CACHE_KEY) || '{}') || {};
    } catch (_) {
        previousLayouts = {};
    }

    const layouts = {};
    document.querySelectorAll('.notepad-window').forEach(outer => {
        if (!isPersistentNotepadWindow(outer)) return;

        const previous = previousLayouts[outer.id] || {};
        const isVisible = getComputedStyle(outer).display !== 'none';

        let width = outer.style.width || '';
        let height = outer.style.height || '';

        if (!width && isVisible && outer.offsetWidth > 0) {
            width = `${outer.offsetWidth}px`;
        }
        if (!height && isVisible && outer.offsetHeight > 0) {
            height = `${outer.offsetHeight}px`;
        }

        if (!isValidLayoutSize(width, SLOT_MIN_WIDTH)) {
            width = isValidLayoutSize(previous.width, SLOT_MIN_WIDTH) ? previous.width : `${Math.max(SLOT_DEFAULT_WIDTH, outer.offsetWidth || SLOT_DEFAULT_WIDTH)}px`;
        }
        if (!isValidLayoutSize(height, SLOT_MIN_HEIGHT)) {
            height = isValidLayoutSize(previous.height, SLOT_MIN_HEIGHT) ? previous.height : `${Math.max(SLOT_DEFAULT_HEIGHT, outer.offsetHeight || SLOT_DEFAULT_HEIGHT)}px`;
        }

        const clamped = clampSlotPosition(0, outer.style.top || previous.top, outer.style.left || previous.left, width, height);

        layouts[outer.id] = {
            top: `${clamped.top}px`,
            left: `${clamped.left}px`,
            width,
            height
        };
    });

    localStorage.setItem(NOTEPAD_LAYOUT_CACHE_KEY, JSON.stringify(layouts));
}

function loadNotepadWindowLayouts() {
    const saved = localStorage.getItem(NOTEPAD_LAYOUT_CACHE_KEY);
    if (!saved) return;

    try {
        const layouts = JSON.parse(saved);
        document.querySelectorAll('.notepad-window').forEach(outer => {
            if (!isPersistentNotepadWindow(outer)) return;

            const layout = layouts[outer.id];
            if (!layout) return;

            const safeWidth = isValidLayoutSize(layout.width, SLOT_MIN_WIDTH)
                ? layout.width
                : `${Math.max(SLOT_DEFAULT_WIDTH, outer.offsetWidth || SLOT_DEFAULT_WIDTH)}px`;
            const safeHeight = isValidLayoutSize(layout.height, SLOT_MIN_HEIGHT)
                ? layout.height
                : `${Math.max(SLOT_DEFAULT_HEIGHT, outer.offsetHeight || SLOT_DEFAULT_HEIGHT)}px`;

            outer.style.width = safeWidth;
            outer.style.height = safeHeight;

            const clamped = clampSlotPosition(0, layout.top, layout.left, safeWidth, safeHeight);
            outer.style.top = `${clamped.top}px`;
            outer.style.left = `${clamped.left}px`;
        });
    } catch (_) {}
}

function attachResizeObserver(id) {
    const outer = document.getElementById(`win${id}`);
    if (!outer) return;
    const inner = outer.querySelector('.chat-window');
    if (!inner || inner._fwResizeAttached) return;
    const ro = new ResizeObserver(() => saveWindowLayouts());
    ro.observe(inner);
    inner._fwResizeAttached = true;
}

function saveChatSlots() {
    // Salva os slots incluindo o timestamp de quando abriu
    const slotsToSave = { maxSlots: maxSlots };
    for (let id = 1; id <= maxSlots; id++) {
        if (chatSlots[id]) {
            setOpenedAtCache(chatSlots[id].nome, chatSlots[id].openedAt || Date.now());
            slotsToSave[id] = {
                ...chatSlots[id],
                openedAt: chatSlots[id].openedAt || Date.now()
            };
        } else {
            slotsToSave[id] = null;
        }
    }
    localStorage.setItem('chat_slots', JSON.stringify(slotsToSave));
}

function loadChatSlots() {
    const saved = localStorage.getItem('chat_slots');
    if (saved) {
        const loaded = JSON.parse(saved);
        
        // Restaura maxSlots
        if (loaded.maxSlots && loaded.maxSlots > 3) {
            maxSlots = loaded.maxSlots;
            // Cria os slots extras
            for (let id = 4; id <= maxSlots; id++) {
                createDynamicChatWindow(id);
                createDynamicBall(id);
            }
        }
        
        for (let id = 1; id <= maxSlots; id++) {
            if (loaded[id]) {
                const loadedOpenedAt = loaded[id].openedAt || Date.now();
                const shouldReuseOpenedAt = getDateKeyFromTimestamp(loadedOpenedAt) === getToday();
                // Restaura o slot com o openedAt original para continuar contando
                chatSlots[id] = {
                    ...loaded[id],
                    openedAt: shouldReuseOpenedAt ? loadedOpenedAt : Date.now()
                };
                slotRestoredFromCacheAt[id] = Date.now();
                setOpenedAtCache(loaded[id].nome, chatSlots[id].openedAt);
                fillWindowFields(id, loaded[id]);
                updateBallUI(id);
                startChatTimer(id);
                const win = document.getElementById(`win${id}`);
                if (win) win.style.display = 'flex';
                
                // Restaura o chat no frame com fallback para ROCKET_HOME_URL
                const frame = document.getElementById(`frame_${id}`);
                if (frame) {
                    const targetUrl = loaded[id].chatUrl && canEmbedInIframe(loaded[id].chatUrl)
                        ? loaded[id].chatUrl
                        : ROCKET_HOME_URL;
                    
                    if (canEmbedInIframe(targetUrl)) {
                        frame.src = targetUrl;
                        
                        // Abre o chat pelo nome no frame (garante que o chat correto é carregado no SPA)
                        setTimeout(() => {
                            openChatByNameInSlotFrame(id, loaded[id].nome, loaded[id].chatUrl || null);
                        }, 800);
                    } else {
                        frame.src = 'about:blank';
                    }
                }
            }
        }
        
        updateAddButton();
    }
    
    loadWindowLayouts();

    // Força sync imediato com extensão
    requestSidebarUpdate();
}

function updateCounter() {
    const history = JSON.parse(localStorage.getItem('fwall_history') || '{}');
    let total = 0;
    Object.values(history).forEach(day => { total += day.count; });
    totalAtendimentos = total;
    localStorage.setItem('total_atend', total);
    
    // Mostra apenas atendimentos do dia no contador principal
    const today = getToday();
    const todayData = history[today];
    const todayCount = todayData && todayData.logs ? todayData.logs.length : 0;
    
    updateTerminalText(todayCount);
    document.getElementById('total-count-large').innerHTML = `${total} <span class="text-xs text-blue-500 tracking-widest uppercase">Sessões</span>`;
}

function updateTerminalText(count) {
    const statusText = bridgeActive ? 'online' : 'offline';
    
    // Calcula TMA do dia
    const history = JSON.parse(localStorage.getItem('fwall_history') || '{}');
    const today = getToday();
    let tmaText = ' | TMA: 0m 0s';
    
    if (history[today] && history[today].logs && history[today].logs.length > 0) {
        let totalDuration = 0;
        let tmaCount = 0;
        history[today].logs.forEach(log => {
            if (!log) return;
            const tmaEligible = log.tmaEligible === true || (log.tmaEligible === undefined && log.status === 'resolvido');
            if (!tmaEligible) return;
            if (typeof log.durationMs === 'number' && log.durationMs > 0) {
                totalDuration += log.durationMs;
                tmaCount++;
            } else if (log.startTs && log.endTs) {
                totalDuration += (log.endTs - log.startTs);
                tmaCount++;
            }
        });

        if (tmaCount > 0) {
            const avgMs = totalDuration / tmaCount;
            const avgMins = Math.floor(avgMs / 60000);
            const avgSecs = Math.floor((avgMs % 60000) / 1000);
            tmaText = ` | TMA: ${avgMins}m ${avgSecs}s`;
        }
    }
    
    const statusWin = document.getElementById('status-terminal-window');
    const compactMode = !!(statusWin && statusWin.offsetWidth <= 420);
    const compactTmaText = tmaText.replace(' | TMA: ', ' | tma: ');
    const newText = compactMode
        ? `at: ${count}${compactTmaText}`
        : `atendimentos: ${count}${tmaText} | elvis extensão: ${statusText}`;
    
    if (newText === currentTerminalText) return;
    currentTerminalText = newText;
    
    typeText(newText);
}

function initStatusTerminalResizeWatcher() {
    const statusWin = document.getElementById('status-terminal-window');
    if (!statusWin || statusWin._fwResizeObserver) return;

    const ro = new ResizeObserver(() => {
        clearTimeout(statusTerminalResizeTimer);
        statusTerminalResizeTimer = setTimeout(() => {
            updateBridgeStatus();
        }, 120);
    });

    ro.observe(statusWin);
    statusWin._fwResizeObserver = ro;
}


function typeText(text) {
    if (typingInterval) clearInterval(typingInterval);
    
    const element = document.getElementById('terminal-text');
    if (!element) return;
    
    let index = 0;
    element.textContent = '';
    
    typingInterval = setInterval(() => {
        if (index < text.length) {
            element.textContent += text[index];
            index++;
        } else {
            clearInterval(typingInterval);
            typingInterval = null;
        }
    }, 50);
}

function escapeHtmlText(value) {
    return (value || '')
        .toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getQuickReplyButtonsHtml(slotId) {
    const list = (slotAutoReplyMessages && slotAutoReplyMessages.length)
        ? slotAutoReplyMessages
        : DEFAULT_PENDING_AUTO_REPLY_MESSAGES;

    return list
        .map(msg => `<button type="button" class="slot-quick-btn" onclick='sendQuickReply(${slotId}, ${JSON.stringify(msg)})'>${escapeHtmlText(msg)}</button>`)
        .join('');
}

function renderQuickReplyButtonsForSlot(slotId) {
    const win = document.getElementById(`win${slotId}`);
    if (!win) return;
    const actions = win.querySelector('.slot-quick-actions');
    if (!actions) return;
    actions.innerHTML = getQuickReplyButtonsHtml(slotId);
}

function renderQuickReplyButtonsAllSlots() {
    for (let id = 1; id <= maxSlots; id++) {
        renderQuickReplyButtonsForSlot(id);
    }
}

function createChatWindow(id) {
    document.write(`
        <div id="win${id}" class="chat-window-outer">
            <div class="slot-top-meta">
                <span id="tipo_${id}" class="slot-client-type"></span>
                <span id="timer_top_${id}" class="slot-timer-terminal slot-timer-terminal-top">0m 0s</span>
                <span id="atd_alert_${id}" class="slot-history-badge is-green" style="display:none;">ATD: 0</span>
                <span id="rch_alert_${id}" class="slot-history-badge is-danger" style="display:none;">RCH: 0</span>
                <button onclick="closeChat('win${id}')" class="slot-top-close" title="Fechar slot">✕</button>
            </div>
            <div class="chat-window">
            <div class="chat-header">
                <div class="flex items-center gap-3">
                    <span style="color: var(--neon-blue)">[TERMINAL_CR_0${id}]</span>
                    <button onclick="toggleTab(${id})" class="text-[0.6rem] text-gray-500 hover:text-white uppercase">[Dados]</button>
                </div>
                <div class="chat-actions">
                    <button onclick="abrirTabulacaoManual(${id})" title="Tabulação" class="slot-action-btn hover:text-emerald-400">TAB</button>
                    <button onclick="encaminharParaNps(${id})" title="Encaminhar para NPS" class="slot-action-btn hover:text-cyan-400">NPS</button>
                    <button onclick="enviarParaFila(${id})" title="Fila de espera" class="slot-action-btn hover:text-purple-400">FILA</button>
                    <button onclick="encerrarComoAbandono(${id})" title="Encerrar como abandono" class="slot-action-btn hover:text-yellow-400">ABANDONO</button>
                    <button onclick="copiarN2(${id})" title="Transferir N2" class="slot-action-btn hover:text-blue-400">N2</button>
                </div>
            </div>
            <div id="quick_reply_${id}" class="slot-quick-reply">
                <div class="slot-quick-head">
                    <span class="slot-quick-icon">!</span>
                    <div id="quick_title_${id}" class="slot-quick-title">mensagem pendente</div>
                </div>
                <div id="quick_elapsed_${id}" class="slot-quick-elapsed">sem resposta: 0s</div>
                <div class="slot-quick-actions">
                    ${getQuickReplyButtonsHtml(id)}
                </div>
                <div class="slot-quick-footer">
                    <button id="quick_snooze_${id}" type="button" class="slot-quick-snooze" onclick="snoozeUnreadNotifications(${id})">NÃO RESPONDER AGORA (2m)</button>
                </div>
            </div>
            <div id="tab_${id}" class="data-bar">
                <div class="input-group"><label>Colaborador</label><input type="text" id="nome_${id}" placeholder="Nome CR"></div>
                <div class="input-group"><label>Matrícula</label><input type="text" id="mat_${id}" placeholder="000000"></div>
                <div class="input-group"><label>Site</label><input type="text" id="site_${id}" value="CG"></div>
                <div class="input-group col-span-3"><label>Protocolo</label><input type="text" id="prot_${id}" placeholder="0000000000000" class="text-blue-400"></div>
                <div class="input-group col-span-3"><label>Motivo Atual</label><input type="text" id="motivoatual_${id}" placeholder="Headset, VPN, etc..." style="background: rgba(251, 191, 36, 0.05); border-color: rgba(251, 191, 36, 0.3); color: #fbbf24;" readonly></div>
                <div class="input-group"><label>Qtd. Abandono</label><input type="text" id="qtd_abandono_${id}" placeholder="0" readonly style="background: rgba(239, 68, 68, 0.05); border-color: rgba(239, 68, 68, 0.3); color: #ef4444;"></div>
                <div class="input-group col-span-2"><label>Qtd. Chats</label><input type="text" id="qtd_chats_${id}" placeholder="0" readonly style="background: rgba(59, 130, 246, 0.05); border-color: rgba(59, 130, 246, 0.3); color: #3b82f6;"></div>
                <input type="hidden" id="tags_${id}">
                <div class="col-span-3 tag-box" id="tag_box_${id}">
                    <div class="tag-box-header" onclick="toggleTagBox(${id})">
                        <span class="tag-box-label">🏷 Tags</span>
                        <span class="tag-box-summary" id="tag_summary_${id}">Nenhuma selecionada</span>
                        <div class="tag-box-actions">
                            <button type="button" id="tag_refresh_${id}" title="Recarregar opções" onclick="event.stopPropagation(); loadTagOptionsForSlot(${id})" class="tag-refresh-btn">↺</button>
                            <span class="tag-box-arrow">▾</span>
                        </div>
                    </div>
                    <div class="tag-dropdown">
                        <div class="tag-dropdown-list" id="tag_options_${id}"><div class="tag-dropdown-empty">Abra o chat para carregar as tags automaticamente.</div></div>
                        <button type="button" onclick="applyTagsFromSlot(${id})" class="tag-apply-btn">✓ Aplicar na Tabulação</button>
                    </div>
                </div>
                <input type="text" id="motivo_${id}" placeholder="Insira o motivo..." class="col-span-3 p-2 bg-[#050a15] border border-blue-900/50 rounded text-xs outline-none focus:border-blue-500">
            </div>
            <iframe id="frame_${id}" name="frame_slot_${id}" src="about:blank" allow="fullscreen; clipboard-read; clipboard-write" muted></iframe>
            </div>
        </div>
    `);
}

function createDynamicChatWindow(id) {
    const container = document.getElementById('app-shell') || document.body;
    const winDiv = document.createElement('div');
    winDiv.id = `win${id}`;
    winDiv.className = 'chat-window-outer';
    winDiv.style.display = 'none';
    winDiv.innerHTML = `
        <div class="slot-top-meta">
            <span id="tipo_${id}" class="slot-client-type"></span>
            <span id="timer_top_${id}" class="slot-timer-terminal slot-timer-terminal-top">0m 0s</span>
            <span id="atd_alert_${id}" class="slot-history-badge is-green" style="display:none;">ATD: 0</span>
            <span id="rch_alert_${id}" class="slot-history-badge is-danger" style="display:none;">RCH: 0</span>
            <button onclick="closeChat('win${id}')" class="slot-top-close" title="Fechar slot">✕</button>
        </div>
        <div class="chat-window">
        <div class="chat-header">
            <div class="flex items-center gap-3">
                <span style="color: var(--neon-blue)">[TERMINAL_CR_${String(id).padStart(2, '0')}]</span>
                <button onclick="toggleTab(${id})" class="text-[0.6rem] text-gray-500 hover:text-white uppercase">[Dados]</button>
            </div>
            <div class="chat-actions">
                <button onclick="abrirTabulacaoManual(${id})" title="Tabulação" class="slot-action-btn hover:text-emerald-400">TAB</button>
                <button onclick="encaminharParaNps(${id})" title="Encaminhar para NPS" class="slot-action-btn hover:text-cyan-400">NPS</button>
                <button onclick="enviarParaFila(${id})" title="Fila de espera" class="slot-action-btn hover:text-purple-400">FILA</button>
                <button onclick="encerrarComoAbandono(${id})" title="Encerrar como abandono" class="slot-action-btn hover:text-yellow-400">ABANDONO</button>
                <button onclick="copiarN2(${id})" title="Transferir N2" class="slot-action-btn hover:text-blue-400">N2</button>
            </div>
        </div>
        <div id="quick_reply_${id}" class="slot-quick-reply">
            <div class="slot-quick-head">
                <span class="slot-quick-icon">!</span>
                <div id="quick_title_${id}" class="slot-quick-title">mensagem pendente</div>
            </div>
            <div id="quick_elapsed_${id}" class="slot-quick-elapsed">sem resposta: 0s</div>
            <div class="slot-quick-actions">
                ${getQuickReplyButtonsHtml(id)}
            </div>
            <div class="slot-quick-footer">
                <button id="quick_snooze_${id}" type="button" class="slot-quick-snooze" onclick="snoozeUnreadNotifications(${id})">NÃO RESPONDER AGORA (2m)</button>
            </div>
        </div>
        <div id="tab_${id}" class="data-bar">
            <div class="input-group"><label>Colaborador</label><input type="text" id="nome_${id}" placeholder="Nome CR"></div>
            <div class="input-group"><label>Matrícula</label><input type="text" id="mat_${id}" placeholder="000000"></div>
            <div class="input-group"><label>Site</label><input type="text" id="site_${id}" value="CG"></div>
            <div class="input-group col-span-3"><label>Protocolo</label><input type="text" id="prot_${id}" placeholder="0000000000000" class="text-blue-400"></div>
            <div class="input-group col-span-3"><label>Motivo Atual</label><input type="text" id="motivoatual_${id}" placeholder="Headset, VPN, etc..." style="background: rgba(251, 191, 36, 0.05); border-color: rgba(251, 191, 36, 0.3); color: #fbbf24;" readonly></div>
            <div class="input-group"><label>Qtd. Abandono</label><input type="text" id="qtd_abandono_${id}" placeholder="0" readonly style="background: rgba(239, 68, 68, 0.05); border-color: rgba(239, 68, 68, 0.3); color: #ef4444;"></div>
            <div class="input-group col-span-2"><label>Qtd. Chats</label><input type="text" id="qtd_chats_${id}" placeholder="0" readonly style="background: rgba(59, 130, 246, 0.05); border-color: rgba(59, 130, 246, 0.3); color: #3b82f6;"></div>
            <input type="hidden" id="tags_${id}">
            <div class="col-span-3 tag-box" id="tag_box_${id}">
                <div class="tag-box-header" onclick="toggleTagBox(${id})">
                    <span class="tag-box-label">🏷 Tags</span>
                    <span class="tag-box-summary" id="tag_summary_${id}">Nenhuma selecionada</span>
                    <div class="tag-box-actions">
                        <button type="button" id="tag_refresh_${id}" title="Recarregar opções" onclick="event.stopPropagation(); loadTagOptionsForSlot(${id})" class="tag-refresh-btn">↺</button>
                        <span class="tag-box-arrow">▾</span>
                    </div>
                </div>
                <div class="tag-dropdown">
                    <div class="tag-dropdown-list" id="tag_options_${id}"><div class="tag-dropdown-empty">Abra o chat para carregar as tags automaticamente.</div></div>
                    <button type="button" onclick="applyTagsFromSlot(${id})" class="tag-apply-btn">✓ Aplicar na Tabulação</button>
                </div>
            </div>
            <input type="text" id="motivo_${id}" placeholder="Insira o motivo..." class="col-span-3 p-2 bg-[#050a15] border border-blue-900/50 rounded text-xs outline-none focus:border-blue-500">
        </div>
        <iframe id="frame_${id}" name="frame_slot_${id}" src="about:blank" allow="fullscreen; clipboard-read; clipboard-write" muted></iframe>
        </div>
    `;
    container.appendChild(winDiv);
    makeDraggable(winDiv);
    attachResizeObserver(id);
    attachSlotNameListener(id);
    updateSlotRepeatAlert(id);
    renderTagOptionsForSlot(id);
}
for(let i=1; i<=3; i++) createChatWindow(i);
for(let i=1; i<=3; i++) attachResizeObserver(i);
for(let i=1; i<=3; i++) attachSlotNameListener(i);
for(let i=1; i<=3; i++) updateSlotRepeatAlert(i);
for(let i=1; i<=3; i++) renderTagOptionsForSlot(i);

function openChat(id) { 
    const w = document.getElementById(id);
    const num = parseInt(id.replace('win',''));
    if(w.style.display !== 'flex') {
        if (!w.style.top) {
            w.style.top  = (80 + (num * 60)) + "px";
            w.style.left = (300 + (num * 80)) + "px";
        }
    }
    w.style.display = 'flex'; 
    applyClampedSlotLayout(num);
    focusWindow(w);
}

function openChatSilent(id) {
    const w = document.getElementById(id);
    const num = parseInt(id.replace('win',''));
    if(w.style.display !== 'flex') {
        if (!w.style.top) {
            w.style.top  = (80 + (num * 60)) + "px";
            w.style.left = (300 + (num * 80)) + "px";
        }
    }
    w.style.display = 'flex';
    applyClampedSlotLayout(num);
}

function focusWindow(el) {
    document.querySelectorAll('.chat-window-outer, .notepad-window').forEach(win => win.style.zIndex = "10");
    el.style.zIndex = "50";
}

function formatDuration(ms) {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
}

function getToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function registrarResolvido(id) {
    const prot = document.getElementById(`prot_${id}`).value;
    if(!prot) return fwAlert("SISTEMA: Protocolo Ausente.");

    salvarHistorico(id, 'resolvido');
    slotFinalizeRequestedAt[id] = Date.now();
}

function makeDraggable(element) {
    const header = element.querySelector('.chat-header') || element.querySelector('.notepad-header-default');
    if (!header) return;

    header.onmousedown = (e) => {
        if (e.button !== 0) return;
        if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;

        e.preventDefault();
        focusWindow(element);

        const slotId = parseInt((element.id || '').replace('win', ''), 10);
        let p3 = e.clientX;
        let p4 = e.clientY;
        let dragging = true;

        const previousUserSelect = document.body.style.userSelect;
        document.body.style.userSelect = 'none';

        const dragShield = document.createElement('div');
        dragShield.style.position = 'fixed';
        dragShield.style.inset = '0';
        dragShield.style.zIndex = '2147483647';
        dragShield.style.cursor = 'move';
        dragShield.style.background = 'transparent';
        document.body.appendChild(dragShield);

        const onMove = (ev) => {
            if (!dragging) return;
            const inner = element.querySelector('.chat-window');
            const width = inner?.style.width || `${inner?.offsetWidth || SLOT_DEFAULT_WIDTH}px`;
            const height = inner?.style.height || `${inner?.offsetHeight || SLOT_DEFAULT_HEIGHT}px`;
            const nextTop = element.offsetTop - (p4 - ev.clientY);
            const nextLeft = element.offsetLeft - (p3 - ev.clientX);
            const clamped = clampSlotPosition(slotId || 1, nextTop, nextLeft, width, height);
            element.style.top = clamped.top + 'px';
            element.style.left = clamped.left + 'px';
            p3 = ev.clientX;
            p4 = ev.clientY;
        };

        const stopDrag = () => {
            if (!dragging) return;
            dragging = false;
            window.removeEventListener('mousemove', onMove, true);
            window.removeEventListener('mouseup', stopDrag, true);
            window.removeEventListener('blur', stopDrag, true);
            document.removeEventListener('visibilitychange', onVisibilityChange, true);
            if (dragShield && dragShield.parentNode) dragShield.parentNode.removeChild(dragShield);
            document.body.style.userSelect = previousUserSelect;
            saveWindowLayouts();
        };

        const onVisibilityChange = () => {
            if (document.hidden) stopDrag();
        };

        window.addEventListener('mousemove', onMove, true);
        window.addEventListener('mouseup', stopDrag, true);
        window.addEventListener('blur', stopDrag, true);
        document.addEventListener('visibilitychange', onVisibilityChange, true);
    };
}
document.querySelectorAll('.chat-window-outer, .notepad-window').forEach(win => makeDraggable(win));

window.addEventListener('resize', () => {
    for (let id = 1; id <= maxSlots; id++) applyClampedSlotLayout(id);
    saveWindowLayouts();
});

window.addEventListener('pagehide', () => {
    saveWindowLayoutsNow();
    saveChatSlots();
});

window.addEventListener('beforeunload', () => {
    saveWindowLayoutsNow();
    saveChatSlots();
});

function toggleTab(id) { document.getElementById(`tab_${id}`).classList.toggle('minimized'); }
function closeChat(id) { document.getElementById(id).style.display = 'none'; }
function refreshChat(id) {
    const frame = document.getElementById(`frame_${id}`);
    if (!frame) return;
    const current = frame.src;
    if (!current || current === 'about:blank') return;
    if (!canEmbedInIframe(current)) {
        frame.src = 'about:blank';
        return;
    }
    frame.src = current;
}

function abrirTabulacaoManual(id) {
    const frame = document.getElementById(`frame_${id}`);
    if (!frame || !frame.contentWindow || !frame.src || frame.src === 'about:blank') {
        fwAlert('❌ Chat do slot não está aberto.');
        return;
    }

    const onResult = (event) => {
        if (!event.data || event.data.source !== 'firewall-extension') return;
        if (event.data.type !== 'ROCKETCHAT_TAB_OPEN_RESULT') return;
        window.removeEventListener('message', onResult);
        if (!event.data.ok) {
            fwAlert(`❌ ${event.data.message || 'Falha ao abrir tabulação.'}`);
        }
    };

    window.addEventListener('message', onResult);
    setTimeout(() => window.removeEventListener('message', onResult), 10000);

    frame.contentWindow.postMessage({
        source: 'firewall-parent',
        type: 'OPEN_MANUAL_TABULATION'
    }, '*');
}

function hasFinalizeRequestPending(id) {
    return !!slotFinalizeRequestedAt[id];
}

function encaminharParaNps(id) {
    if (hasFinalizeRequestPending(id)) {
        fwAlert('⚠️ Já existe uma finalização pendente para este chat. Aguarde concluir para evitar duplicidade.');
        return;
    }

    const frame = document.getElementById(`frame_${id}`);
    if (!frame || !frame.contentWindow || !frame.src || frame.src === 'about:blank') {
        fwAlert('❌ Chat do slot não está aberto.');
        return;
    }

    slotFinalizeRequestedAt[id] = Date.now();
    let handled = false;

    const onResult = (event) => {
        if (!event.data || event.data.source !== 'firewall-extension') return;
        if (event.data.type !== 'ROCKETCHAT_NPS_RESULT') return;
        handled = true;
        window.removeEventListener('message', onResult);

        if (!event.data.ok) {
            delete slotFinalizeRequestedAt[id];
            fwAlert(`❌ ${event.data.message || 'Falha ao encaminhar para NPS.'}`);
            return;
        }

        salvarHistorico(id, 'resolvido', { motivo: '', includeTma: true });
        slotFinalizeRequestedAt[id] = Date.now();
    };

    window.addEventListener('message', onResult);
    setTimeout(() => {
        window.removeEventListener('message', onResult);
        if (!handled) delete slotFinalizeRequestedAt[id];
    }, 15000);

    frame.contentWindow.postMessage({
        source: 'firewall-parent',
        type: 'OPEN_NPS_FORWARD'
    }, '*');
}

function enviarParaFila(id) {
    if (hasFinalizeRequestPending(id)) {
        fwAlert('⚠️ Já existe uma finalização pendente para este chat. Aguarde concluir para evitar duplicidade.');
        return;
    }

    const frame = document.getElementById(`frame_${id}`);
    if (!frame || !frame.contentWindow || !frame.src || frame.src === 'about:blank') {
        fwAlert('❌ Chat do slot não está aberto.');
        return;
    }

    slotFinalizeRequestedAt[id] = Date.now();
    let handled = false;

    const onResult = (event) => {
        if (!event.data || event.data.source !== 'firewall-extension') return;
        if (event.data.type !== 'ROCKETCHAT_FILA_RESULT') return;
        handled = true;
        window.removeEventListener('message', onResult);

        if (!event.data.ok) {
            delete slotFinalizeRequestedAt[id];
            fwAlert(`❌ ${event.data.message || 'Falha ao enviar para fila.'}`);
            return;
        }

        salvarHistorico(id, 'fila', { motivo: 'fila de espera', includeTma: false });
        slotFinalizeRequestedAt[id] = Date.now();
    };

    window.addEventListener('message', onResult);
    setTimeout(() => {
        window.removeEventListener('message', onResult);
        if (!handled) delete slotFinalizeRequestedAt[id];
    }, 15000);

    frame.contentWindow.postMessage({
        source: 'firewall-parent',
        type: 'OPEN_FILA_FORWARD'
    }, '*');
}

function encerrarComoAbandono(id) {
    const frame = document.getElementById(`frame_${id}`);
    if (!frame || !frame.contentWindow || !frame.src || frame.src === 'about:blank') {
        fwAlert('❌ Chat do slot não está aberto.');
        return;
    }

    const onResult = (event) => {
        if (!event.data || event.data.source !== 'firewall-extension') return;
        if (event.data.type !== 'ROCKETCHAT_ABANDONO_RESULT') return;
        window.removeEventListener('message', onResult);

        if (!event.data.ok) {
            fwAlert(`❌ ${event.data.message || 'Falha ao encerrar como abandono.'}`);
            return;
        }

        salvarHistorico(id, 'abandono', { motivo: 'abandono', includeTma: false });
        slotFinalizeRequestedAt[id] = Date.now();
    };

    window.addEventListener('message', onResult);
    setTimeout(() => window.removeEventListener('message', onResult), 15000);

    frame.contentWindow.postMessage({
        source: 'firewall-parent',
        type: 'OPEN_ABANDONO_FLOW'
    }, '*');
}

function toggleLog(show) { 
    const logWin = document.getElementById('log-window') || document.getElementById('log-drawer');
    if (!logWin) return;

    logWin.style.display = show ? 'flex' : 'none';
    if (show) {
        renderHistory();
        focusWindow(logWin);
    }
}

function renderHistory() {
    const history = JSON.parse(localStorage.getItem('fwall_history') || '{}');
    const dates = Object.keys(history).sort().reverse();
    
    const container = document.getElementById('log-content');
    if (dates.length === 0) {
        container.innerHTML = '<div class="text-gray-600 text-xs text-center py-8">Nenhum atendimento registrado</div>';
        return;
    }

    let html = '';
    dates.forEach(date => {
        const day = history[date];
        const dateObj = new Date(date + 'T00:00:00');
        const dateLabel = dateObj.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
        
        // Calcula TMA do dia - usa durationMs como fonte principal
        let totalDuration = 0;
        let tmaCount = 0;
        const logsArray = day.logs && Array.isArray(day.logs) ? day.logs : [];
        logsArray.forEach(log => {
            if (!log) return;
            const tmaEligible = log.tmaEligible === true || (log.tmaEligible === undefined && log.status === 'resolvido');
            if (!tmaEligible) return;
            if (typeof log.durationMs === 'number' && log.durationMs > 0) {
                totalDuration += log.durationMs;
                tmaCount++;
            } else if (log.startTs && log.endTs) {
                totalDuration += (log.endTs - log.startTs);
                tmaCount++;
            }
        });
        
        let tmaText = '';
        if (tmaCount > 0) {
            const avgMs = totalDuration / tmaCount;
            const avgMins = Math.floor(avgMs / 60000);
            const avgSecs = Math.floor((avgMs % 60000) / 1000);
            tmaText = `<span class="text-emerald-400 text-[10px] ml-3">TMA: ${avgMins}m ${avgSecs}s</span>`;
        }
        
        html += `
            <div class="mb-6">
                <div class="flex items-center justify-between mb-3 pb-2 border-b border-blue-500/20">
                    <div class="flex items-center">
                        <span class="text-blue-400 font-bold text-xs uppercase tracking-widest">${dateLabel}</span>
                    </div>
                    <div class="flex items-center gap-3">
                        <span class="text-blue-500/70 text-[10px]">${day.count} atendimento${day.count > 1 ? 's' : ''}</span>
                        ${tmaText}
                    </div>
                </div>
                <div class="space-y-3">`;
        
        logsArray.forEach((log, logIndex) => {
            const borderColor = log.status === 'falta_interacao' ? 'border-yellow-500' : log.status === 'transfer_n2' ? 'border-yellow-500' : log.status === 'abandono' ? 'border-orange-500' : 'border-blue-500';
            const bgColor = log.status === 'falta_interacao' ? 'bg-yellow-500/5' : log.status === 'transfer_n2' ? 'bg-yellow-500/5' : log.status === 'abandono' ? 'bg-orange-500/5' : 'bg-blue-500/5';
            
            let statusLabel = '';
            if (log.status === 'falta_interacao') {
                statusLabel = '<span class="text-yellow-400 text-[9px] uppercase">FALTA INTERAÇÃO</span>';
            } else if (log.status === 'transfer_n2') {
                statusLabel = '<span class="text-yellow-400 text-[9px] uppercase">TRANSFERÊNCIA N2</span>';
            } else if (log.status === 'abandono') {
                statusLabel = '<span class="text-orange-400 text-[9px] uppercase">ABANDONO</span>';
            } else {
                statusLabel = '<span class="text-green-400 text-[9px] uppercase">RESOLVIDO</span>';
            }
            
            // TMA individual deste log - prioriza durationMs
            let logDur = 0;
            if (typeof log.durationMs === 'number' && log.durationMs > 0) {
                logDur = log.durationMs;
            } else if (log.startTs && log.endTs) {
                logDur = log.endTs - log.startTs;
            }
            let tmaIndividual = log.duracao || '--';
            if (logDur > 0) {
                const m = Math.floor(logDur / 60000);
                const s = Math.floor((logDur % 60000) / 1000);
                tmaIndividual = m > 0 ? `${m}m ${s}s` : `${s}s`;
            }

            html += `
                <div class="p-3 ${bgColor} border-l-2 ${borderColor} rounded-r shadow-lg">
                    <div class="flex justify-between text-[10px] mb-2">
                        <div class="flex gap-2 items-center">
                            <span class="text-blue-400 font-bold tracking-widest">${log.protocolo}</span>
                            ${statusLabel}
                        </div>
                        <div class="flex gap-3 items-center">
                            <span class="text-emerald-400 font-semibold">⏱ ${tmaIndividual}</span>
                            <span class="text-gray-600">${log.horario}</span>
                        </div>
                    </div>
                    <div class="text-[11px] text-white uppercase font-bold">OPERADOR: ${log.nome}</div>
                    ${log.matricula ? `<div class="text-[10px] text-cyan-400 mt-1">ID: ${log.matricula}</div>` : ''}
                    <div class="text-[10px] text-amber-300 mt-1">TIPO CLIENTE: ${log.tipoCliente || 'N/A'}</div>
                    <div class="text-[10px] text-yellow-300 mt-1">MOTIVO ATUAL: ${log.motivoAtual || 'N/A'}</div>
                    <div class="text-[10px] text-violet-300 mt-1">TAGS: ${Array.isArray(log.tags) && log.tags.length ? log.tags.join(', ') : (log.tags || 'N/A')}</div>
                    ${log.motivo ? `<div class="text-[10px] text-gray-500 mt-2 font-light leading-relaxed">MSG: ${log.motivo}</div>` : ''}
                </div>`;
        });
        
        html += `</div></div>`;
    });
    
    container.innerHTML = html;
}

async function clearHistory() {
    const ok = await fwConfirm('Tem certeza que deseja limpar todo o histórico?');
    if (!ok) return;
    localStorage.removeItem('fwall_history');
    totalAtendimentos = 0;
    localStorage.setItem('total_atend', 0);
    updateCounter();
    renderHistory();
}

async function limparTodoCache() {
    const ok = await fwConfirm('⚠️ ATENÇÃO: Isso vai limpar TODOS os dados salvos (histórico, pontos, slots, contador). Deseja continuar?');
    if (!ok) return;
    
    localStorage.removeItem('fwall_history');
    localStorage.removeItem('total_atend');
    localStorage.removeItem('chat_slots');
    localStorage.removeItem(CHAT_OPENED_AT_CACHE_KEY);
    localStorage.removeItem('forponto_data');
    localStorage.removeItem(NOTEPAD_CACHE_KEY);
    
    history = {};
    for (let i = 1; i <= maxSlots; i++) {
        chatSlots[i] = null;
    }
    chatOpenedAtCache = {};
    pontoAtual = { hoje: [], historico: {} };
    totalAtendimentos = 0;
    
    renderHistory();
    updateCounter();
    renderBalls();
    renderPontoToday();
    updatePontoStatus();
    
    await fwAlert('Cache limpo com sucesso!');
}

function openNotepad() { 
    initNotepadCacheTerminal();
    const n = document.getElementById('notepad');
    n.style.display = 'flex';
    focusWindow(n);
}
function closeNotepad() { document.getElementById('notepad').style.display = 'none'; }

function clampAppScale(scale) {
    const num = Number(scale);
    if (!Number.isFinite(num)) return APP_SCALE_DEFAULT;
    return Math.min(APP_SCALE_MAX, Math.max(APP_SCALE_MIN, num));
}

function applyAppScale(scale) {
    const safe = clampAppScale(scale);
    document.documentElement.style.setProperty('--app-scale', safe.toFixed(2));

    const slider = document.getElementById('interface-zoom-slider');
    if (slider) slider.value = String(Math.round(safe * 100));

    const valueLabel = document.getElementById('interface-zoom-value');
    if (valueLabel) valueLabel.textContent = `${Math.round(safe * 100)}%`;

    setTimeout(() => {
        for (let id = 1; id <= maxSlots; id++) {
            applyClampedSlotLayout(id);
        }
        saveWindowLayouts();
    }, 0);

    return safe;
}

function loadAppScaleSetting() {
    let saved = APP_SCALE_DEFAULT;
    try {
        const raw = localStorage.getItem(APP_SCALE_CACHE_KEY);
        if (raw !== null && raw !== '') saved = Number(raw);
    } catch (_) {
        saved = APP_SCALE_DEFAULT;
    }
    return applyAppScale(saved);
}

function saveAppScaleSetting(scale) {
    const safe = applyAppScale(scale);
    try {
        localStorage.setItem(APP_SCALE_CACHE_KEY, String(safe));
    } catch (_) {}
}

function updateAppScaleFromInput(rawValue) {
    const scale = Number(rawValue) / 100;
    saveAppScaleSetting(scale);
}

function clampFontScale(scale) {
    const num = Number(scale);
    if (!Number.isFinite(num)) return FONT_SCALE_DEFAULT;
    return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, num));
}

function applyFontScale(scale) {
    const safe = clampFontScale(scale);
    document.documentElement.style.setProperty('--font-scale', safe.toFixed(2));

    const slider = document.getElementById('font-size-slider');
    if (slider) slider.value = String(Math.round(safe * 100));

    const valueLabel = document.getElementById('font-size-value');
    if (valueLabel) valueLabel.textContent = `${Math.round(safe * 100)}%`;

    return safe;
}

function loadFontScaleSetting() {
    let saved = FONT_SCALE_DEFAULT;
    try {
        const raw = localStorage.getItem(FONT_SCALE_CACHE_KEY);
        if (raw !== null && raw !== '') saved = Number(raw);
    } catch (_) {
        saved = FONT_SCALE_DEFAULT;
    }
    return applyFontScale(saved);
}

function saveFontScaleSetting(scale) {
    const safe = applyFontScale(scale);
    try {
        localStorage.setItem(FONT_SCALE_CACHE_KEY, String(safe));
    } catch (_) {}
}

function updateFontScaleFromInput(rawValue) {
    const scale = Number(rawValue) / 100;
    saveFontScaleSetting(scale);
}

function resetFontScaleSetting() {
    saveFontScaleSetting(FONT_SCALE_DEFAULT);
    saveAppScaleSetting(APP_SCALE_DEFAULT);
}

function openSettingsPanel() {
    const panel = document.getElementById('settings-panel');
    if (!panel) return;
    loadAppScaleSetting();
    loadFontScaleSetting();
    loadAttentionSoundMutedSetting();
    panel.style.display = 'flex';
    focusWindow(panel);
}

function closeSettingsPanel() {
    const panel = document.getElementById('settings-panel');
    if (!panel) return;
    panel.style.display = 'none';
}

const NOTEPAD_CACHE_KEY = 'fw_notepad_cache_v1';
let notepadInitDone = false;
let notepadSaveTimer = null;

function getNotepadCache() {
    try {
        const raw = localStorage.getItem(NOTEPAD_CACHE_KEY);
        if (!raw) return { content: '', updatedAt: null };
        const parsed = JSON.parse(raw);
        return {
            content: typeof parsed.content === 'string' ? parsed.content : '',
            updatedAt: parsed.updatedAt || null
        };
    } catch (_) {
        return { content: '', updatedAt: null };
    }
}

function saveNotepadCache(content) {
    const payload = { content: content || '', updatedAt: Date.now() };
    localStorage.setItem(NOTEPAD_CACHE_KEY, JSON.stringify(payload));
    return payload;
}

function appendNotepadTerminalLine(text, color = '#22c55e') {
    const output = document.getElementById('notepad-terminal-output');
    if (!output) return;
    const line = document.createElement('div');
    line.className = 'notepad-terminal-line';
    line.style.color = color;
    line.textContent = text;
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
}

function getNotepadCacheSize(content) {
    return new Blob([content || '']).size;
}

function setNotepadMode(mode) {
    const area = document.getElementById('notepad-content');
    const terminal = document.getElementById('notepad-terminal');
    const input = document.getElementById('notepad-terminal-input');
    if (!area || !terminal) return;

    if (mode === 'terminal') {
        area.style.display = 'none';
        terminal.style.display = 'flex';
        if (input) {
            setTimeout(() => input.focus(), 0);
        }
        return;
    }

    terminal.style.display = 'none';
    area.style.display = 'block';
    setTimeout(() => area.focus(), 0);
}

async function clearNotepadCache() {
    const ok = await fwConfirm('Limpar as anotações salvas no cache do navegador?');
    if (!ok) return;
    const area = document.getElementById('notepad-content');
    if (area) area.value = '';
    saveNotepadCache('');
    appendNotepadTerminalLine('cache limpo com sucesso.', '#f59e0b');
}

function runNotepadTerminalCommand(rawCmd) {
    const cmd = (rawCmd || '').trim();
    const area = document.getElementById('notepad-content');
    if (!area) return;

    appendNotepadTerminalLine(`notes@cache:~$ ${cmd}`, '#60a5fa');
    if (!cmd) return;

    if (cmd === 'help') {
        appendNotepadTerminalLine('comandos: help, save, load, show, cache, clear, cls, note <texto>', '#94a3b8');
        return;
    }
    if (cmd === 'save') {
        const payload = saveNotepadCache(area.value);
        appendNotepadTerminalLine(`salvo no cache local. ${new Date(payload.updatedAt).toLocaleString('pt-BR')}`, '#22c55e');
        return;
    }
    if (cmd === 'load') {
        const cached = getNotepadCache();
        area.value = cached.content;
        appendNotepadTerminalLine('anotacoes carregadas do cache.', '#22c55e');
        return;
    }
    if (cmd === 'show') {
        if (!area.value.trim()) {
            appendNotepadTerminalLine('(sem conteudo)', '#94a3b8');
            return;
        }
        appendNotepadTerminalLine(area.value, '#e2e8f0');
        return;
    }
    if (cmd === 'cache') {
        const cached = getNotepadCache();
        const size = getNotepadCacheSize(cached.content);
        const when = cached.updatedAt ? new Date(cached.updatedAt).toLocaleString('pt-BR') : 'nunca';
        appendNotepadTerminalLine(`tamanho: ${size} bytes | ultima gravacao: ${when}`, '#94a3b8');
        return;
    }
    if (cmd === 'clear') {
        area.value = '';
        saveNotepadCache('');
        appendNotepadTerminalLine('anotacoes limpas e cache atualizado.', '#f59e0b');
        return;
    }
    if (cmd === 'cls') {
        const output = document.getElementById('notepad-terminal-output');
        if (output) output.innerHTML = '';
        return;
    }
    if (cmd.startsWith('note ')) {
        const text = cmd.slice(5).trim();
        if (!text) {
            appendNotepadTerminalLine('uso: note <texto>', '#ef4444');
            return;
        }
        area.value = `${area.value}${area.value ? '\n' : ''}${text}`;
        saveNotepadCache(area.value);
        appendNotepadTerminalLine('linha adicionada e salva.', '#22c55e');
        return;
    }

    appendNotepadTerminalLine(`comando nao reconhecido: ${cmd}`, '#ef4444');
}

function initNotepadCacheTerminal() {
    if (notepadInitDone) return;

    const area = document.getElementById('notepad-content');
    const terminalInput = document.getElementById('notepad-terminal-input');
    if (!area || !terminalInput) return;

    const cached = getNotepadCache();
    area.value = cached.content;

    area.addEventListener('input', () => {
        if (notepadSaveTimer) clearTimeout(notepadSaveTimer);
        notepadSaveTimer = setTimeout(() => {
            saveNotepadCache(area.value);
        }, 250);
    });

    terminalInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        const cmd = terminalInput.value;
        terminalInput.value = '';
        runNotepadTerminalCommand(cmd);
    });

    appendNotepadTerminalLine('notes terminal pronto. use "help" para listar comandos.', '#22c55e');
    notepadInitDone = true;
}

function copyTextToClipboard(text) {
    if (!text) return Promise.reject(new Error('Texto vazio'));

    if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text);
    }

    return new Promise((resolve, reject) => {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            const ok = document.execCommand('copy');
            ta.remove();
            if (ok) resolve();
            else reject(new Error('execCommand copy falhou'));
        } catch (e) {
            reject(e);
        }
    });
}

async function persistFluxosJSONFile(fluxos) {
    const payload = JSON.stringify(Array.isArray(fluxos) ? fluxos : [], null, 2) + '\n';

    const endpoints = [
        { url: 'fluxos.json', method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: payload },
        { url: '/fluxos.json', method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: payload },
        { url: '/api/fluxos', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload },
        { url: '/api/fluxos/salvar', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload }
    ];

    for (const endpoint of endpoints) {
        try {
            const res = await fetch(endpoint.url, {
                method: endpoint.method,
                headers: endpoint.headers,
                body: endpoint.body,
                cache: 'no-store'
            });

            if (res.ok) {
                return { ok: true, mode: 'server', endpoint: endpoint.url };
            }
        } catch (_) {}
    }

    return { ok: false, mode: 'server-failed' };
}

function openGuiaFluxos() { 
    const g = document.getElementById('guia-fluxos');
    
    // Limpa todo conteúdo anterior (remove divs filhas depois do header)
    const header = g.querySelector('.notepad-header-default');
    while (header.nextElementSibling) {
        header.nextElementSibling.remove();
    }
    
    // Renderiza dinamicamente do JSON
    let html = '<div style="padding: 20px; overflow-y: auto; flex: 1; background: #050a15; display: flex; flex-direction: column; gap: 8px;">';
    
    if (guiaFluxos && guiaFluxos.length > 0) {
        guiaFluxos.forEach((fluxo) => {
            html += `
                <div class="fluxo-item">
                    <div class="fluxo-title">${fluxo.titulo}</div>
                    <div class="fluxo-path">${fluxo.caminho}</div>
                </div>
            `;
        });
    } else {
        html += '<div style="color: #64748b; font-size: 0.75rem; text-align: center; padding: 40px 20px;">Nenhum fluxo carregado</div>';
    }
    
    html += '</div>';
    
    // Insere o conteúdo após o header
    header.insertAdjacentHTML('afterend', html);
    
    g.style.display = 'flex';
    focusWindow(g);
}

function openFluxosEditor() {
  try {
    // Fecha qualquer editor já aberto
    document.querySelectorAll('[id^="fluxos-editor-"]').forEach(el => el.remove());

    const editorId = 'fluxos-editor-' + Date.now();
    const list = Array.isArray(guiaFluxos) ? guiaFluxos : [];

    // --- Container principal ---
    const wrap = document.createElement('div');
    wrap.id = editorId;
    wrap.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:620px;max-height:90vh;display:flex;flex-direction:column;background:#050a15;border:1px solid rgba(239,68,68,0.35);border-top:4px solid #ef4444;border-radius:6px;box-shadow:0 0 50px rgba(0,0,0,0.9);z-index:999999;overflow:hidden;font-family:"Fira Code",monospace;';

    // --- Header ---
    const header = document.createElement('div');
    header.className = '';
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 14px;background:rgba(239,68,68,0.1);border-bottom:1px solid rgba(239,68,68,0.2);cursor:grab;user-select:none;';
    header.innerHTML = '<span style="color:#ef4444;font-size:0.7rem;letter-spacing:2px;">EDITOR DE FLUXOS</span>';
    const btnClose = document.createElement('button');
    btnClose.textContent = '✕';
    btnClose.style.cssText = 'background:none;border:none;color:#475569;cursor:pointer;font-size:14px;';
    btnClose.onclick = () => wrap.remove();
    header.appendChild(btnClose);
    wrap.appendChild(header);

    // --- Lista ---
    const listDiv = document.createElement('div');
    listDiv.id = 'fluxos-editor-list';
    listDiv.style.cssText = 'padding:14px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:10px;font-size:0.7rem;color:#94a3b8;';

    list.forEach((fluxo, idx) => {
        const row = document.createElement('div');
        row.className = 'fluxo-editor-row';
        row.setAttribute('data-row-idx', idx);
        row.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:10px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.15);border-radius:3px;';

        const lblT = document.createElement('label');
        lblT.textContent = 'TÍTULO:';
        lblT.style.cssText = 'color:#ef4444;font-size:0.65rem;opacity:0.8;';
        const inpT = document.createElement('input');
        inpT.type = 'text';
        inpT.setAttribute('data-field', 'titulo');
        inpT.value = fluxo.titulo || '';
        inpT.style.cssText = 'width:100%;padding:6px;background:rgba(0,0,0,0.4);border:1px solid rgba(239,68,68,0.2);color:#e2e8f0;font-family:"Fira Code",monospace;font-size:0.65rem;border-radius:2px;box-sizing:border-box;';

        const lblC = document.createElement('label');
        lblC.textContent = 'CAMINHO:';
        lblC.style.cssText = 'color:#ef4444;font-size:0.65rem;opacity:0.8;';
        const inpC = document.createElement('input');
        inpC.type = 'text';
        inpC.setAttribute('data-field', 'caminho');
        inpC.value = fluxo.caminho || '';
        inpC.style.cssText = 'width:100%;padding:6px;background:rgba(0,0,0,0.4);border:1px solid rgba(239,68,68,0.2);color:#e2e8f0;font-family:"Fira Code",monospace;font-size:0.65rem;border-radius:2px;box-sizing:border-box;';

        const btnRem = document.createElement('button');
        btnRem.textContent = 'REMOVER';
        btnRem.style.cssText = 'padding:4px 8px;background:rgba(239,68,68,0.3);color:#ef4444;border:1px solid rgba(239,68,68,0.5);border-radius:2px;cursor:pointer;font-size:0.6rem;align-self:flex-end;font-family:"Fira Code",monospace;';
        btnRem.onclick = () => row.remove();

        row.appendChild(lblT); row.appendChild(inpT);
        row.appendChild(lblC); row.appendChild(inpC);
        row.appendChild(btnRem);
        listDiv.appendChild(row);
    });

    // --- Novo fluxo ---
    const newRow = document.createElement('div');
    newRow.style.cssText = 'padding:10px;background:rgba(239,68,68,0.05);border:1px solid rgba(239,68,68,0.2);border-radius:3px;display:flex;flex-direction:column;gap:6px;';
    newRow.innerHTML = '<label style="color:#ef4444;font-size:0.65rem;opacity:0.8;">NOVO FLUXO — TÍTULO:</label>';
    const newT = document.createElement('input');
    newT.type = 'text'; newT.id = 'new-fluxo-titulo'; newT.placeholder = 'Ex: NOVO FLUXO';
    newT.style.cssText = 'width:100%;padding:6px;background:rgba(0,0,0,0.3);border:1px solid rgba(239,68,68,0.15);color:#e2e8f0;font-family:"Fira Code",monospace;font-size:0.65rem;border-radius:2px;box-sizing:border-box;';
    const lblNC = document.createElement('label');
    lblNC.textContent = 'CAMINHO:'; lblNC.style.cssText = 'color:#ef4444;font-size:0.65rem;opacity:0.8;';
    const newC = document.createElement('input');
    newC.type = 'text'; newC.id = 'new-fluxo-path'; newC.placeholder = 'Ex: HELP TECH/...';
    newC.style.cssText = 'width:100%;padding:6px;background:rgba(0,0,0,0.3);border:1px solid rgba(239,68,68,0.15);color:#e2e8f0;font-family:"Fira Code",monospace;font-size:0.65rem;border-radius:2px;box-sizing:border-box;';
    newRow.appendChild(newT); newRow.appendChild(lblNC); newRow.appendChild(newC);
    listDiv.appendChild(newRow);
    wrap.appendChild(listDiv);

    // --- Footer ---
    const footer = document.createElement('div');
    footer.style.cssText = 'padding:10px 14px;background:rgba(0,0,0,0.2);border-top:1px solid rgba(239,68,68,0.15);display:flex;gap:8px;justify-content:flex-end;';
    const btnF = document.createElement('button');
    btnF.textContent = 'FECHAR';
    btnF.style.cssText = 'padding:5px 14px;background:rgba(107,114,128,0.1);color:#64748b;border:1px solid rgba(107,114,128,0.2);border-radius:4px;cursor:pointer;font-size:0.65rem;font-family:"Fira Code",monospace;';
    btnF.onclick = () => wrap.remove();
    const btnS = document.createElement('button');
    btnS.textContent = 'SALVAR';
    btnS.style.cssText = 'padding:5px 14px;background:rgba(239,68,68,0.2);color:#ef4444;border:1px solid rgba(239,68,68,0.4);border-radius:4px;cursor:pointer;font-size:0.65rem;font-family:"Fira Code",monospace;font-weight:600;';
    btnS.onclick = () => saveFluxos(editorId);
    if (HIDE_GX_EDITOR_SAVE_BUTTON) {
        btnS.style.display = 'none';
    }
    footer.appendChild(btnF); footer.appendChild(btnS);
    wrap.appendChild(footer);

    document.body.appendChild(wrap);

    // Drag simples — sem depender de makeDraggable/notepad-header
    header.onmousedown = (e) => {
        if (e.button !== 0 || e.target.tagName === 'BUTTON') return;
        e.preventDefault();
        // Converte transform:translate(-50%,-50%) para top/left absolutos na primeira arrasta
        const rect = wrap.getBoundingClientRect();
        wrap.style.transform = 'none';
        wrap.style.top  = rect.top  + 'px';
        wrap.style.left = rect.left + 'px';
        let px = e.clientX, py = e.clientY;
        header.style.cursor = 'grabbing';
        const shield = document.createElement('div');
        shield.style.cssText = 'position:fixed;inset:0;z-index:9999999;cursor:grabbing;';
        document.body.appendChild(shield);
        const move = (ev) => {
            wrap.style.top  = (parseFloat(wrap.style.top)  + ev.clientY - py) + 'px';
            wrap.style.left = (parseFloat(wrap.style.left) + ev.clientX - px) + 'px';
            px = ev.clientX; py = ev.clientY;
        };
        const up = () => {
            header.style.cursor = 'grab';
            shield.remove();
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    };
  } catch(err) { console.error('[openFluxosEditor]', err); alert('Erro ao abrir editor: ' + err.message); }
}

async function saveFluxos(editorId) {
    const newTitulo = document.getElementById('new-fluxo-titulo')?.value.trim();
    const newCaminho = document.getElementById('new-fluxo-path')?.value.trim();

    const updated = [];
    document.querySelectorAll('#fluxos-editor-list .fluxo-editor-row').forEach(row => {
        const tit = row.querySelector('[data-field="titulo"]')?.value.trim().toUpperCase();
        const cam = row.querySelector('[data-field="caminho"]')?.value.trim().toUpperCase();
        if (tit && cam) updated.push({ titulo: tit, caminho: cam });
    });

    if (newTitulo && newCaminho) updated.push({ titulo: newTitulo.toUpperCase(), caminho: newCaminho.toUpperCase() });

    guiaFluxos = updated;
    localStorage.setItem('guia_fluxos', JSON.stringify(guiaFluxos));
    const persistResult = await persistFluxosJSONFile(guiaFluxos);

    document.getElementById(editorId)?.remove();
    openGuiaFluxos();

    if (persistResult.mode === 'server') {
        fwAlert('✓ ' + guiaFluxos.length + ' fluxos salvos com sucesso no fluxos.json do servidor!');
        return;
    }

    fwAlert('⚠️ Fluxos salvos no navegador, mas o servidor não permitiu gravar em fluxos.json. É necessário habilitar endpoint de escrita no servidor.');
}

function closeGuiaFluxos() { document.getElementById('guia-fluxos').style.display = 'none'; }

function openPendingMessagesEditor() {
    const editorDiv = document.createElement('div');
    editorDiv.className = 'notepad-window';
    editorDiv.id = 'pending-messages-editor-' + Date.now();
    editorDiv.style.cssText = 'top: 22%; left: 22%; width: 560px; height: 440px; display: flex; flex-direction: column; border-top: 4px solid #22c55e; z-index: 9999;';

    const list = (slotAutoReplyMessages && slotAutoReplyMessages.length)
        ? slotAutoReplyMessages
        : [...DEFAULT_PENDING_AUTO_REPLY_MESSAGES];

    let html = `
        <div class="notepad-header-default" style="background: rgba(34, 197, 94, 0.1); border-bottom: 1px solid rgba(34, 197, 94, 0.2); padding: 8px 12px;">
            <span style="color: #22c55e; font-family: 'Fira Code', monospace; font-size: 0.7rem; letter-spacing: 2px;">EDITOR DE MENSAGENS PENDENTES</span>
            <button onclick="document.getElementById('${editorDiv.id}').remove()" style="background: none; border: none; color: #475569; cursor: pointer; font-size: 14px;">✕</button>
        </div>
        <div style="padding: 14px; overflow-y: auto; flex: 1; font-family: 'Fira Code', monospace; font-size: 0.7rem; color: #94a3b8; display: flex; flex-direction: column; gap: 10px;">
    `;

    list.forEach((msg, idx) => {
        html += `
            <div style="display: flex; flex-direction: column; gap: 6px; padding: 10px; background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.2); border-radius: 3px;">
                <label style="color: #22c55e; font-size: 0.65rem; opacity: 0.85;">MENSAGEM ${idx + 1}:</label>
                <input type="text" id="pending-msg-${idx}" value="${escapeHtmlText(msg)}" style="width: 100%; padding: 6px; background: rgba(0,0,0,0.4); border: 1px solid rgba(34,197,94,0.2); color: #e2e8f0; font-family: 'Fira Code', monospace; font-size: 0.65rem; border-radius: 2px;" />
                <button onclick="removePendingMessage(${idx})" style="padding: 4px 8px; background: rgba(239,68,68,0.2); color: #ef4444; border: 1px solid rgba(239,68,68,0.4); border-radius: 2px; cursor: pointer; font-size: 0.6rem; font-family: 'Fira Code', monospace; align-self: flex-end;">REMOVER</button>
            </div>
        `;
    });

    html += `
            <div style="padding: 10px; background: rgba(34,197,94,0.05); border: 1px solid rgba(34,197,94,0.2); border-radius: 3px; display: flex; flex-direction: column; gap: 6px;">
                <label style="color: #22c55e; font-size: 0.65rem; opacity: 0.85;">NOVA MENSAGEM:</label>
                <input type="text" id="new-pending-msg" placeholder="Digite a nova mensagem padrão..." style="width: 100%; padding: 6px; background: rgba(0,0,0,0.3); border: 1px solid rgba(34,197,94,0.15); color: #e2e8f0; font-family: 'Fira Code', monospace; font-size: 0.65rem; border-radius: 2px;" />
            </div>
        </div>
        <div style="padding: 10px 14px; background: rgba(0,0,0,0.2); border-top: 1px solid rgba(34,197,94,0.15); display: flex; gap: 8px; justify-content: flex-end;">
            <button onclick="document.getElementById('${editorDiv.id}').remove()" style="padding: 5px 14px; background: rgba(107,114,128,0.1); color: #64748b; border: 1px solid rgba(107,114,128,0.2); border-radius: 4px; cursor: pointer; font-size: 0.65rem; font-family: 'Fira Code', monospace;">FECHAR</button>
            <button onclick="savePendingMessages('${editorDiv.id}')" style="padding: 5px 14px; background: rgba(34,197,94,0.18); color: #22c55e; border: 1px solid rgba(34,197,94,0.4); border-radius: 4px; cursor: pointer; font-size: 0.65rem; font-family: 'Fira Code', monospace; font-weight: 600;">SALVAR</button>
        </div>
    `;

    editorDiv.innerHTML = html;
    document.body.appendChild(editorDiv);
    makeDraggable(editorDiv);
}

function removePendingMessage(idx) {
    slotAutoReplyMessages.splice(idx, 1);
    const input = document.getElementById(`pending-msg-${idx}`);
    if (input) input.closest('div').remove();
}

function savePendingMessages(editorId) {
    const updated = [];
    const inputs = document.querySelectorAll('input[id^="pending-msg-"]');
    inputs.forEach(input => {
        const msg = (input.value || '').trim();
        if (msg) updated.push(msg);
    });

    const newMsg = document.getElementById('new-pending-msg')?.value.trim();
    if (newMsg) updated.push(newMsg);

    slotAutoReplyMessages = updated.length ? updated : [...DEFAULT_PENDING_AUTO_REPLY_MESSAGES];
    persistPendingAutoReplyMessages();
    renderQuickReplyButtonsAllSlots();

    document.getElementById(editorId).remove();
    fwAlert('✓ Mensagens pendentes salvas com sucesso!');
}

function initAudio() {
    audioNotification = document.getElementById('audio-notification');
    audioBooting = document.getElementById('audio-booting');
    audioAttention = document.getElementById('audio-attention');
    
    if (audioNotification) {
        audioNotification.volume = 0.6;
    }
    
    if (audioBooting) {
        audioBooting.volume = 0.5;
        audioBooting.load();
        
        audioBooting.addEventListener('canplay', () => {
            // Pronto para tocar
        });
        
        audioBooting.addEventListener('error', () => {
            // Erro ao carregar
        });
    }

    if (audioAttention) {
        audioAttention.volume = 0.7;
    }
}

function checkAndPlayBomDia() {
    const today = getToday();
    const lastBoot = localStorage.getItem('last_boot_day');
    
    if (lastBoot !== today) {
        localStorage.setItem('last_boot_day', today);
        showBootScreen();
    } else {
        // Já viu o boot hoje - esconde imediatamente
        const bs = document.getElementById('boot-screen');
        if (bs) {
            bs.style.display = 'none';
            bs.style.opacity = '0';
        }
        bootComplete = true;
    }
}

function showBootScreen() {
    const bootScreen = document.getElementById('boot-screen');
    const bootText = document.getElementById('boot-text');
    const bootButton = document.getElementById('boot-button');
    
    // Tela já está visível via HTML
    
    const messages = [
        '[SISTEMA] Firewall da Amizade',
        '[BOOT] Aguardando autorização do operador...',
        '',
        '>>> Pressione INICIAR SISTEMA para continuar <<<'
    ];
    
    let index = 0;
    let text = '';
    
    const interval = setInterval(() => {
        if (index < messages.length) {
            text += messages[index] + '\n';
            bootText.textContent = text;
            index++;
        } else {
            clearInterval(interval);
            setTimeout(() => {
                if (bootButton) bootButton.style.display = 'inline-block';
            }, 300);
        }
    }, 200);
}

async function startSystem() {
    if (systemBootInProgress) return;
    systemBootInProgress = true;

    const bootButton = document.getElementById('boot-button');
    const bootText = document.getElementById('boot-text');

    const bridgeReady = await waitForBridgeActivation(4500);
    if (!bridgeReady) {
        if (bootText) {
            bootText.textContent = '[ERRO] Elvis Extension Bridge offline.\n[AÇÃO] Ative/recarregue a extensão e tente novamente.\n\n>>> Pressione INICIAR SISTEMA após normalizar <<<';
        }
        if (bootButton) bootButton.style.display = 'inline-block';
        systemBootInProgress = false;
        return;
    }

    // Áudio SÓ toca aqui porque o navegador exige clique do usuário
    if (audioBooting) {
        audioBooting.currentTime = 0;
        audioBooting.play().catch(() => {});
    }

    // Esconde o botão e mostra terminal carregando
    if (bootButton) bootButton.style.display = 'none';
    
    const now = new Date();
    const hora = now.toLocaleTimeString('pt-BR');
    const data = now.toLocaleDateString('pt-BR');
    
    const history = JSON.parse(localStorage.getItem('fwall_history') || '{}');
    const today = getToday();
    const todayData = history[today];
    const atendHoje = todayData && todayData.logs ? todayData.logs.length : 0;
    
    const messages = [
        { text: `$ ./firewall_init.sh`, delay: 400 },
        { text: `[SYSTEM] Data: ${data} | Hora: ${hora}`, delay: 600 },
        { text: `[AUTH] Usuário: Pedro Elvis Soreas Nobrega`, delay: 800 },
        { text: `[LOAD] Inicializando Elvis Extension Bridge...`, delay: 1200 },
        { text: `[LOAD] Chat Monitor Service...`, delay: 900 },
        { text: `[LOAD] Multi-Slot Manager (${maxSlots} slots)...`, delay: 1000 },
        { text: `[LOAD] Rocket.Chat Integration...`, delay: 1100 },
        { text: `[LOAD] Notification System...`, delay: 700 },
        { text: `[INFO] Atendimentos hoje: ${atendHoje}`, delay: 500 },
        { text: `[✓] Todos os módulos carregados`, delay: 800 },
        { text: ``, delay: 300 },
        { text: `>>> Sua criação liberou seu acesso <<<`, delay: 500 }
    ];
    
    bootText.textContent = '';
    let text = '';
    let index = 0;
    
    function showNextMessage() {
        if (index < messages.length) {
            text += messages[index].text + '\n';
            bootText.textContent = text;
            const delay = messages[index].delay;
            index++;
            setTimeout(showNextMessage, delay);
        } else {
            setTimeout(() => {
                hideBootScreen();
            }, 1000);
        }
    }
    
    showNextMessage();
    systemBootInProgress = false;
}

function hideBootScreen() {
    const bootScreen = document.getElementById('boot-screen');
    if (bootScreen) {
        bootScreen.style.opacity = '0';
        bootScreen.style.transition = 'opacity 0.5s';
        setTimeout(() => {
            bootScreen.style.display = 'none';
            document.documentElement.classList.remove('boot-active');
            bootComplete = true;
        }, 500);
    }
}

function playNotificationSound() {
    if (audioNotification && bootComplete) {
        audioNotification.currentTime = 0;
        audioNotification.play().catch(() => {});
    }
}

function playAttentionSound() {
    if (attentionSoundMuted) return;
    if (audioAttention && bootComplete) {
        audioAttention.currentTime = 0;
        audioAttention.play().catch(() => {});
    }
}

function loadAttentionSoundMutedSetting() {
    let muted = false;
    try {
        muted = localStorage.getItem(ATTENTION_SOUND_MUTED_CACHE_KEY) === '1';
    } catch (_) {
        muted = false;
    }
    attentionSoundMuted = muted;
    const toggle = document.getElementById('attention-sound-mute-toggle');
    if (toggle) toggle.checked = muted;
    return muted;
}

function saveAttentionSoundMutedSetting(muted) {
    attentionSoundMuted = !!muted;
    try {
        localStorage.setItem(ATTENTION_SOUND_MUTED_CACHE_KEY, attentionSoundMuted ? '1' : '0');
    } catch (_) {}

    if (attentionSoundMuted && audioAttention) {
        try {
            audioAttention.pause();
            audioAttention.currentTime = 0;
        } catch (_) {}
    }
}

function toggleAttentionSoundMuted(checked) {
    saveAttentionSoundMutedSetting(!!checked);
}

function preencherFormularioForms(formsWindow, protocolo, motivo, status) {
    // Tenta preencher o formulário do Microsoft Forms
    // Devido a restrições CORS, tentaremos injetar dados quando a janela estiver pronta
    try {
        setTimeout(() => {
            if (!formsWindow.closed) {
                // Tenta acessar o document da janela
                const formsDoc = formsWindow.document;
                
                // Procura pelo campo de protocolo (nome baseado na estrutura do Forms)
                const inputFields = formsDoc.querySelectorAll('input[type="text"], textarea');
                if (inputFields.length > 0) {
                    // Primeiro campo (Protocolo)
                    inputFields[0].value = protocolo;
                    inputFields[0].dispatchEvent(new Event('input', { bubbles: true }));
                    inputFields[0].dispatchEvent(new Event('change', { bubbles: true }));
                }
                
                if (inputFields.length > 1) {
                    // Segundo campo (Motivo)
                    inputFields[1].value = motivo;
                    inputFields[1].dispatchEvent(new Event('input', { bubbles: true }));
                    inputFields[1].dispatchEvent(new Event('change', { bubbles: true }));
                }
                
                // Tenta selecionar a opção de status (procura por radio buttons ou checkboxes)
                const options = formsDoc.querySelectorAll('input[type="radio"], input[type="checkbox"]');
                let statusMatch = null;
                
                if (status === 'resolvido') {
                    // Procura pela opção "Resolvido"
                    options.forEach(opt => {
                        if (opt.parentElement && opt.parentElement.textContent.includes('Resolvido')) {
                            opt.click();
                        }
                    });
                } else if (status === 'falta_interacao') {
                    options.forEach(opt => {
                        if (opt.parentElement && opt.parentElement.textContent.includes('Falta')) {
                            opt.click();
                        }
                    });
                } else if (status === 'transfer_n2') {
                    options.forEach(opt => {
                        if (opt.parentElement && opt.parentElement.textContent.includes('N2') || opt.parentElement.textContent.includes('Transferência')) {
                            opt.click();
                        }
                    });
                }
            }
        }, 2000);
    } catch (e) {
    }
}

function montarTextoTransferenciaN2(id) {
    const nome = document.getElementById('nome_'+id).value;
    const mat = document.getElementById('mat_'+id).value;
    const site = document.getElementById('site_'+id).value || 'CG';
    const prot = document.getElementById('prot_'+id).value;
    const motivo = document.getElementById('motivo_'+id).value;
    const data = new Date().toLocaleDateString('pt-BR');

    return `Preciso transferir para o N2\nColaborador: ${nome}\nMatricula: ${mat}\nSite: ${site}\nProtocolo: ${prot}\nData: ${data}\nMotivo: ${motivo}`;
}

async function copiarN2(id) {
    const texto = montarTextoTransferenciaN2(id);
    let copied = false;

    try {
        await navigator.clipboard.writeText(texto);
        copied = true;
    } catch (_) {
        copied = false;
    }

    salvarHistorico(id, 'transfer_n2', { includeTma: false });

    if (copied) {
        fwAlert('✓ Texto N2 copiado e atendimento registrado (sem TMA).');
    } else {
        fwAlert('⚠️ Atendimento registrado (sem TMA), mas falhou ao copiar texto N2.');
    }
}

function registrarFaltaInteracao(id) {
    salvarHistorico(id, 'falta_interacao', { includeTma: false });
    slotFinalizeRequestedAt[id] = Date.now();
    fwAlert("✓ Falta de Interação registrada no histórico.");
}

function salvarHistorico(id, status, options = {}) {
    const prot = document.getElementById(`prot_${id}`).value || 'SEM PROTOCOLO';
    const motivoField = document.getElementById(`motivo_${id}`);
    const motivoAtualField = document.getElementById(`motivoatual_${id}`);
    const tipoClienteLabel = document.getElementById(`tipo_${id}`);
    const motivo = Object.prototype.hasOwnProperty.call(options, 'motivo')
        ? options.motivo
        : ((motivoField && motivoField.value) || 'Sem relato');
    const nome = document.getElementById(`nome_${id}`).value || 'ANÔNIMO';
    const mat = document.getElementById(`mat_${id}`).value || 'N/A';
    const tipoCliente = (chatSlots[id] && chatSlots[id].tipoCliente)
        || (tipoClienteLabel && tipoClienteLabel.textContent ? tipoClienteLabel.textContent.trim() : '')
        || 'N/A';
    const motivoAtual = (chatSlots[id] && chatSlots[id].motivoAtual)
        || (motivoAtualField && motivoAtualField.value ? motivoAtualField.value.trim() : '')
        || 'N/A';
    const tags = (chatSlots[id] && Array.isArray(chatSlots[id].tags) && chatSlots[id].tags.length)
        ? chatSlots[id].tags
        : [];

    const slot = chatSlots[id];
    const includeTma = !!options.includeTma;
    const endTs = Date.now();
    const startTs = slot && slot.openedAt ? slot.openedAt : endTs;
    const duration = endTs - startTs;
    const durationStr = formatDuration(duration);

    totalAtendimentos++;
    localStorage.setItem('total_atend', totalAtendimentos);

    const today = getToday();
    let history = JSON.parse(localStorage.getItem('fwall_history') || '{}');
    if (!history[today]) history[today] = { count: 0, logs: [] };

    const logId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    history[today].count++;
    history[today].logs.unshift({
        id: logId,
        protocolo: prot,
        nome: nome,
        matricula: mat,
        tipoCliente,
        motivoAtual,
        tags,
        motivo: motivo,
        horario: new Date().toLocaleTimeString(),
        duracao: includeTma ? durationStr : '-',
        durationMs: includeTma ? duration : 0,
        startTs: includeTma ? startTs : null,
        endTs: includeTma ? endTs : null,
        tmaEligible: includeTma,
        status: status
    });

    localStorage.setItem('fwall_history', JSON.stringify(history));
    removeOpenedAtCache(nome);
    renderHistory();
    updateCounter();
    updateSlotRepeatAlertsAll();
    if (motivoField) motivoField.value = '';

    if (chatTimers[id]) {
        clearInterval(chatTimers[id]);
        chatTimers[id] = null;
    }
}

function addManualHistoryEntry(nome, options = {}) {
    const cleanName = (nome || '').toString().trim();
    if (!cleanName) return null;

    const dateKey = (options.date || getToday()).toString().trim();
    const status = (options.status || 'resolvido').toString().trim() || 'resolvido';
    const includeTma = Object.prototype.hasOwnProperty.call(options, 'includeTma')
        ? !!options.includeTma
        : (status === 'resolvido');

    const now = new Date();
    const prot = (options.protocolo || `MANUAL-${Date.now()}`).toString();
    const motivo = (options.motivo || 'Inclusão manual via console').toString();
    const mat = (options.matricula || 'N/A').toString();
    const tipoCliente = (options.tipoCliente || 'N/A').toString();
    const motivoAtual = (options.motivoAtual || 'N/A').toString();
    const tags = Array.isArray(options.tags) ? options.tags : [];
    const durationMs = includeTma ? Math.max(0, Number(options.durationMs || 0)) : 0;

    let history = {};
    try {
        history = JSON.parse(localStorage.getItem('fwall_history') || '{}') || {};
    } catch (_) {
        history = {};
    }

    if (!history[dateKey]) history[dateKey] = { count: 0, logs: [] };

    const logId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    history[dateKey].count++;
    history[dateKey].logs.unshift({
        id: logId,
        protocolo: prot,
        nome: cleanName,
        matricula: mat,
        tipoCliente,
        motivoAtual,
        tags,
        motivo,
        horario: options.horario || now.toLocaleTimeString('pt-BR'),
        duracao: includeTma ? formatDuration(durationMs) : '-',
        durationMs,
        startTs: includeTma ? now.getTime() - durationMs : null,
        endTs: includeTma ? now.getTime() : null,
        tmaEligible: includeTma,
        status
    });

    localStorage.setItem('fwall_history', JSON.stringify(history));
    totalAtendimentos++;
    localStorage.setItem('total_atend', totalAtendimentos);
    renderHistory();
    updateCounter();
    updateSlotRepeatAlertsAll();

    return history[dateKey].logs[0];
}

window.fwAddHistoryByName = function(nome, date = getToday(), status = 'resolvido') {
    const entry = addManualHistoryEntry(nome, { date, status });
    return entry
        ? `OK: ${entry.nome} adicionado em ${date} com status ${status}.`
        : 'ERRO: informe um nome válido.';
};

window.fwAddCurrentSlotToHistory = function(slotId, date = getToday(), status = 'resolvido') {
    const id = Number(slotId);
    const nome = (chatSlots[id] && chatSlots[id].nome) || document.getElementById(`nome_${id}`)?.value || '';
    const entry = addManualHistoryEntry(nome, { date, status });
    return entry
        ? `OK: slot ${id} (${entry.nome}) adicionado em ${date} com status ${status}.`
        : 'ERRO: slot inválido ou sem nome.';
};

function fwModal(msg, buttons) {
    return new Promise(resolve => {
        const overlay = document.getElementById('fw-modal-overlay');
        const msgEl = document.getElementById('fw-modal-msg');
        const btnsEl = document.getElementById('fw-modal-buttons');
        
        // Formatação estilo terminal
        msgEl.style.whiteSpace = 'pre-line';
        msgEl.style.textAlign = 'left';
        msgEl.style.fontFamily = "'Fira Code', monospace";
        msgEl.style.fontSize = '0.8rem';
        msgEl.style.lineHeight = '1.8';
        msgEl.textContent = msg;
        
        btnsEl.innerHTML = '';
        buttons.forEach(btn => {
            const b = document.createElement('button');
            b.textContent = btn.label;
            b.style.cssText = `padding:12px 32px; border-radius:4px; font-size:0.7rem; font-weight:bold; font-family:'Fira Code',monospace; cursor:pointer; text-transform:uppercase; letter-spacing:2px; border:1px solid; transition:all 0.3s;`;
            if (btn.style === 'danger') {
                b.style.background = 'rgba(234,179,8,0.1)'; b.style.color = '#eab308'; b.style.borderColor = 'rgba(234,179,8,0.4)';
                b.onmouseenter = () => { b.style.background = '#eab308'; b.style.color = '#000'; };
                b.onmouseleave = () => { b.style.background = 'rgba(234,179,8,0.1)'; b.style.color = '#eab308'; };
            } else if (btn.style === 'success') {
                b.style.background = 'rgba(34,197,94,0.1)'; b.style.color = '#22c55e'; b.style.borderColor = 'rgba(34,197,94,0.4)';
                b.onmouseenter = () => { b.style.background = '#22c55e'; b.style.color = '#000'; };
                b.onmouseleave = () => { b.style.background = 'rgba(34,197,94,0.1)'; b.style.color = '#22c55e'; };
            } else {
                b.style.background = 'rgba(234,179,8,0.1)'; b.style.color = '#eab308'; b.style.borderColor = 'rgba(234,179,8,0.4)';
                b.onmouseenter = () => { b.style.background = '#eab308'; b.style.color = '#000'; };
                b.onmouseleave = () => { b.style.background = 'rgba(234,179,8,0.1)'; b.style.color = '#eab308'; };
            }
            b.onclick = () => { overlay.style.display = 'none'; resolve(btn.value); };
            btnsEl.appendChild(b);
        });
        overlay.style.display = 'flex';
    });
}

function fwAlert(msg) {
    const text = (msg || '').toString();
    const lower = text.toLowerCase();
    const isErrorOrWarn = text.includes('❌') || text.includes('⚠️') || lower.includes('falha') || lower.includes('erro') || lower.includes('não foi possível');
    const isPositiveInfo = text.includes('✓') || lower.includes('sucesso') || lower.includes('registrado') || lower.includes('salvo');
    if (!isErrorOrWarn && isPositiveInfo) {
        return Promise.resolve(true);
    }
    return fwModal(msg, [{ label: 'OK', value: true, style: 'default' }]);
}

function fwConfirm(msg) {
    return fwModal(msg, [
        { label: 'Cancelar', value: false, style: 'danger' },
        { label: 'Confirmar', value: true, style: 'success' }
    ]);
}

function openTerminalEditor() {
    const editorDiv = document.createElement('div');
    editorDiv.className = 'notepad-window';
    editorDiv.id = 'terminal-editor-' + Date.now();
    editorDiv.style.cssText = 'top: 15%; left: 20%; width: 500px; display: flex; flex-direction: column; border-top: 4px solid var(--neon-blue);';
    
    let html = `
        <div class="notepad-header-default" style="background: rgba(59, 130, 246, 0.08); border-bottom: 1px solid rgba(59, 130, 246, 0.2); padding: 8px 12px;">
            <span style="color: var(--neon-blue); font-family: 'Fira Code', monospace; font-size: 0.7rem; letter-spacing: 2px;">EDITOR DE COMANDOS</span>
            <button onclick="document.getElementById('${editorDiv.id}').remove()" style="background: none; border: none; color: #475569; cursor: pointer; font-size: 14px;">✕</button>
        </div>
        <div style="padding: 14px; overflow: hidden; flex: 1; font-family: 'Fira Code', monospace; font-size: 0.75rem; color: #94a3b8; display: flex; flex-direction: column; gap: 10px;">
            <div style="flex: 1; overflow-y: auto; border: 1px solid rgba(59,130,246,0.15); padding: 10px; background: rgba(0,0,0,0.3); border-radius: 4px;" id="cmd-list">
    `;
    
    terminalCommands.forEach((cmd, idx) => {
        html += `
            <div style="display: flex; gap: 6px; margin-bottom: 6px; padding: 6px; background: rgba(59,130,246,0.08); border: 1px solid rgba(59,130,246,0.15); border-radius: 3px;">
                <input type="text" id="cmd-${idx}" value="${cmd}" style="flex: 1; background: rgba(0,0,0,0.3); border: none; color: #e2e8f0; padding: 4px 6px; font-family: 'Fira Code', monospace; font-size: 0.7rem; outline: none;" />
                <button onclick="removeCommand(${idx})" style="padding: 2px 8px; background: rgba(239,68,68,0.2); color: #ef4444; border: 1px solid rgba(239,68,68,0.3); border-radius: 3px; cursor: pointer; font-size: 0.6rem; font-family: 'Fira Code', monospace;">DEL</button>
            </div>
        `;
    });
    
    html += `
            </div>
            <div>
                <input type="text" id="new-cmd" placeholder="Digite novo comando..." style="width: 100%; padding: 6px 8px; background: rgba(0,0,0,0.3); color: #e2e8f0; border: 1px solid rgba(59,130,246,0.15); border-radius: 4px; font-family: 'Fira Code', monospace; font-size: 0.7rem; outline: none;" />
            </div>
        </div>
        <div style="padding: 10px 14px; background: rgba(0,0,0,0.2); border-top: 1px solid rgba(59,130,246,0.15); display: flex; gap: 8px; justify-content: flex-end;">
            <button onclick="document.getElementById('${editorDiv.id}').remove()" style="padding: 5px 14px; background: rgba(107,114,128,0.1); color: #64748b; border: 1px solid rgba(107,114,128,0.2); border-radius: 4px; cursor: pointer; font-size: 0.65rem; font-family: 'Fira Code', monospace;">FECHAR</button>
            <button onclick="saveTerminalCommands('${editorDiv.id}')" style="padding: 5px 14px; background: rgba(34,197,94,0.1); color: #22c55e; border: 1px solid rgba(34,197,94,0.3); border-radius: 4px; cursor: pointer; font-size: 0.65rem; font-family: 'Fira Code', monospace; font-weight: 600;">SALVAR</button>
        </div>
    `;
    
    editorDiv.innerHTML = html;
    document.body.appendChild(editorDiv);
    makeDraggable(editorDiv);
}

function removeCommand(idx) {
    terminalCommands.splice(idx, 1);
    const listEl = document.getElementById('cmd-list');
    if (listEl) {
        const cmds = listEl.querySelectorAll('input[id^="cmd-"]');
        cmds[idx]?.closest('div').remove();
    }
}

function saveTerminalCommands(editorId) {
    const newCmd = document.getElementById('new-cmd')?.value.trim();
    if (newCmd && newCmd.length > 0) {
        terminalCommands.push(newCmd);
    }
    
    // Coleta todos os inputs de comando editados
    const inputs = document.querySelectorAll('input[id^="cmd-"]');
    const updated = [];
    inputs.forEach(inp => {
        const val = inp.value.trim();
        if (val.length > 0) updated.push(val);
    });
    
    terminalCommands = updated;
    localStorage.setItem('terminal_commands', JSON.stringify(terminalCommands));
    document.getElementById(editorId).remove();
    fwAlert('✓ Comandos salvos com sucesso em JSON!');
}

window.onload = () => {
    loadAppScaleSetting();
    loadFontScaleSetting();
    loadAttentionSoundMutedSetting();
    loadOpenedAtCache();
    initAudio();
    requestDesktopNotificationPermission();
    checkAndPlayBomDia();
    
    loadChatSlots();
    renderHistory();
    updateCounter();
    updateBridgeStatus();
    initForPonto();
    initStatusTerminalResizeWatcher();
    attachAllSlotNameListeners();
    updateSlotRepeatAlertsAll();

    // Carrega o ROCKET_CONTROL automaticamente em background ao iniciar.
    // Assim a bridge fica ativa mesmo sem abrir o painel manualmente.
    ensureRocketBackgroundOnline();
    startBridgeWarmup();

    const rocketFrame = document.getElementById('frame_rocket');
    if (rocketFrame && !rocketFrame._fwLoadBound) {
        rocketFrame.addEventListener('load', () => {
            bridgeActive = false;
            mainBridgeStaleHits = 0;
            lastMainBridgeUpdateAt = 0;
            requestSidebarUpdate();
            setTimeout(() => requestSidebarUpdate(), 700);
            startBridgeWarmup();
        });
        rocketFrame._fwLoadBound = true;
    }

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        ensureRocketBackgroundOnline(false);
        requestSidebarUpdate();
        setTimeout(() => requestSidebarUpdate(), 800);
        if (!bridgeActive) startBridgeWarmup();
    });
    
    // Sincronização em tempo real: pede atualização a cada 2s se estiver em frame principal
    setInterval(() => {
        requestSidebarUpdate();
    }, 2000);

    // Keep-alive: se o frame principal ficar sem update por muito tempo, religa em background.
    setInterval(() => {
        const isHidden = document.hidden;
        const staleThreshold = isHidden ? BRIDGE_MAIN_STALE_HIDDEN_MS : BRIDGE_MAIN_STALE_VISIBLE_MS;
        const stale = !lastMainBridgeUpdateAt || (Date.now() - lastMainBridgeUpdateAt) > staleThreshold;

        if (stale) {
            mainBridgeStaleHits += 1;

            if (!isHidden && mainBridgeStaleHits >= BRIDGE_FORCE_RELOAD_MIN_STALE_HITS) {
                ensureRocketBackgroundOnline(true);
            } else {
                ensureRocketBackgroundOnline(false);
                requestSidebarUpdate();
            }

            if (!bridgeActive) startBridgeWarmup();
        } else {
            mainBridgeStaleHits = 0;
            ensureRocketBackgroundOnline(false);
        }
    }, 5000);

    // Atualiza contador de pendência em tempo real no centro do slot.
    setInterval(() => {
        runUnreadAutomation();
    }, 1000);

    setInterval(() => {
        updateSlotRepeatAlertsAll();
    }, 3000);

    // Cópia dos fluxos (funciona para conteúdo dinâmico do GX)
    document.addEventListener('click', (event) => {
        const item = event.target.closest('.fluxo-item');
        if (!item) return;

        const path = item.querySelector('.fluxo-path')?.textContent?.trim() || '';
        if (!path) return;

        copyTextToClipboard(path)
            .then(() => {
                const originalBg = item.style.background;
                item.style.background = 'rgba(239, 68, 68, 0.2)';
                setTimeout(() => {
                    item.style.background = originalBg;
                }, 250);
            })
            .catch((e) => {
                fwAlert('Não foi possível copiar o fluxo.');
            });
    });
}

let pontoInterval;
let pontoAtual = null;

function initForPonto() {
    loadPontoData();
    updatePontoClock();
    pontoInterval = setInterval(updatePontoClock, 1000);
}

function updatePontoClock() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const clockEl = document.getElementById('ponto-clock');
    if (clockEl) clockEl.textContent = `${hours}:${minutes}:${seconds}`;
    
    const dateEl = document.getElementById('ponto-date');
    if (dateEl) {
        const dias = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
        dateEl.textContent = `${dias[now.getDay()]}, ${now.toLocaleDateString('pt-BR')}`;
    }
    
    updatePontoStatus();
}

function loadPontoData() {
    const saved = localStorage.getItem('forponto_data');
    if (saved) {
        pontoAtual = JSON.parse(saved);
    } else {
        pontoAtual = { hoje: [], historico: {} };
    }
    renderPontoToday();
    updatePontoStatus();
}

function savePontoData() {
    localStorage.setItem('forponto_data', JSON.stringify(pontoAtual));
}

function getToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function baterPonto() {
    const now = new Date();
    const horario = now.toLocaleTimeString('pt-BR');
    const hoje = getToday();
    
    if (!pontoAtual.hoje) pontoAtual.hoje = [];
    
    const tipo = pontoAtual.hoje.length % 2 === 0 ? 'ENTRADA' : 'SAÍDA';
    
    pontoAtual.hoje.push({ tipo, horario, timestamp: now.getTime() });
    
    if (!pontoAtual.historico[hoje]) {
        pontoAtual.historico[hoje] = [];
    }
    pontoAtual.historico[hoje] = [...pontoAtual.hoje];
    
    savePontoData();
    renderPontoToday();
    updatePontoStatus();
    
    fwAlert(`Ponto registrado: ${tipo} às ${horario}`);
}

function renderPontoToday() {
    const container = document.getElementById('ponto-today-items');
    if (!container) return;
    
    if (!pontoAtual.hoje || pontoAtual.hoje.length === 0) {
        container.innerHTML = '<div style="color: #6b7280; font-size: 0.7rem; text-align: center; padding: 20px;">Nenhum ponto registrado hoje</div>';
        return;
    }
    
    let html = '';
    pontoAtual.hoje.forEach((p, i) => {
        const cor = p.tipo === 'ENTRADA' ? '#22c55e' : '#ef4444';
        html += `
            <div style="background: rgba(59, 130, 246, 0.05); border-left: 3px solid ${cor}; padding: 10px 12px; margin-bottom: 8px; border-radius: 4px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: ${cor}; font-size: 0.65rem; font-weight: bold; text-transform: uppercase;">${p.tipo}</span>
                    <span style="color: #e2e8f0; font-size: 0.75rem; font-family: 'Orbitron', monospace;">${p.horario}</span>
                </div>
            </div>`;
    });
    container.innerHTML = html;
}

function updatePontoStatus() {
    const statusText = document.getElementById('ponto-status-text');
    const tempoEl = document.getElementById('ponto-tempo-trabalhado');
    const btnBater = document.getElementById('btn-bater-ponto');
    
    if (!pontoAtual.hoje || pontoAtual.hoje.length === 0) {
        if (statusText) statusText.textContent = 'FORA DO EXPEDIENTE';
        if (tempoEl) tempoEl.textContent = 'Tempo trabalhado hoje: 0h 0m';
        if (btnBater) btnBater.textContent = 'BATER PONTO - ENTRADA';
        return;
    }
    
    const ultimoPonto = pontoAtual.hoje[pontoAtual.hoje.length - 1];
    
    if (ultimoPonto.tipo === 'ENTRADA') {
        if (statusText) statusText.textContent = 'EM EXPEDIENTE';
        if (btnBater) btnBater.textContent = 'BATER PONTO - SAÍDA';
    } else {
        if (statusText) statusText.textContent = 'FORA DO EXPEDIENTE';
        if (btnBater) btnBater.textContent = 'BATER PONTO - ENTRADA';
    }
    
    let totalMs = 0;
    for (let i = 0; i < pontoAtual.hoje.length; i += 2) {
        if (pontoAtual.hoje[i + 1]) {
            totalMs += pontoAtual.hoje[i + 1].timestamp - pontoAtual.hoje[i].timestamp;
        } else if (ultimoPonto.tipo === 'ENTRADA') {
            totalMs += Date.now() - pontoAtual.hoje[i].timestamp;
        }
    }
    
    const horas = Math.floor(totalMs / 3600000);
    const minutos = Math.floor((totalMs % 3600000) / 60000);
    
    if (tempoEl) tempoEl.textContent = `Tempo trabalhado hoje: ${horas}h ${minutos}m`;
}

function openForPonto() {
    const w = document.getElementById('forponto-window');
    w.style.display = 'flex';
    focusWindow(w);
    togglePontoTab('registro');
    const hoje = getToday();
    if (!pontoAtual.hoje || JSON.stringify(pontoAtual.historico[hoje]) !== JSON.stringify(pontoAtual.hoje)) {
        pontoAtual.hoje = pontoAtual.historico[hoje] || [];
        renderPontoToday();
        updatePontoStatus();
    }
}

function closeForPonto() {
    document.getElementById('forponto-window').style.display = 'none';
}

function togglePontoTab(tab) {
    const registro = document.getElementById('ponto-registro');
    const historico = document.getElementById('ponto-historico');
    const tabRegistro = document.getElementById('tab-registro');
    const tabHistorico = document.getElementById('tab-historico');
    
    if (tab === 'registro') {
        registro.style.display = 'block';
        historico.style.display = 'none';
        tabRegistro.style.color = '#fff';
        tabHistorico.style.color = '#6b7280';
    } else {
        registro.style.display = 'none';
        historico.style.display = 'block';
        tabRegistro.style.color = '#6b7280';
        tabHistorico.style.color = '#fff';
        renderPontoHistorico();
    }
}

function renderPontoHistorico() {
    const container = document.getElementById('ponto-historico-items');
    if (!container) return;
    
    const dates = Object.keys(pontoAtual.historico || {}).sort().reverse();
    
    if (dates.length === 0) {
        container.innerHTML = '<div style="color: #6b7280; font-size: 0.7rem; text-align: center; padding: 20px;">Nenhum histórico disponível</div>';
        return;
    }
    
    let html = '';
    dates.forEach(date => {
        const pontos = pontoAtual.historico[date];
        const dateObj = new Date(date + 'T00:00:00');
        const dateLabel = dateObj.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
        
        let totalMs = 0;
        for (let i = 0; i < pontos.length; i += 2) {
            if (pontos[i + 1]) {
                totalMs += pontos[i + 1].timestamp - pontos[i].timestamp;
            }
        }
        const horas = Math.floor(totalMs / 3600000);
        const minutos = Math.floor((totalMs % 3600000) / 60000);
        
        html += `
            <div style="margin-bottom: 20px; background: rgba(59, 130, 246, 0.05); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: 6px; padding: 15px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid rgba(59, 130, 246, 0.2);">
                    <span style="color: #3b82f6; font-size: 0.7rem; font-weight: bold; text-transform: uppercase;">${dateLabel}</span>
                    <span style="color: #22c55e; font-size: 0.65rem;">${horas}h ${minutos}m trabalhadas</span>
                </div>
                <div style="display: grid; gap: 6px;">`;
        
        pontos.forEach(p => {
            const cor = p.tipo === 'ENTRADA' ? '#22c55e' : '#ef4444';
            html += `
                <div style="display: flex; justify-content: space-between; font-size: 0.7rem;">
                    <span style="color: ${cor}; font-weight: bold;">${p.tipo}</span>
                    <span style="color: #94a3b8; font-family: 'Fira Code', monospace;">${p.horario}</span>
                </div>`;
        });
        
        html += `</div></div>`;
    });
    
    container.innerHTML = html;
}


