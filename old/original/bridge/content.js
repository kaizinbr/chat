(function() {
    'use strict';

    const SCAN_INTERVAL = 1500;
    let lastSentJSON = '';
    let lastDetailsSent = '';
    let alreadyClickedEdit = false;
    let alreadyExtracted = false;
    let lastAvatarLetter = '';
    let lastAvatarUrl = '';
    let previousChatList = [];
    let sidebarEmptyReadStreak = 0;
    const MAX_EMPTY_READ_STREAK = 4;
    const CHAT_REMOVAL_GRACE_MS = 0;
    const missingChatsSince = {};
    const collectedDetailsByChat = {};
    let manualTabulationInProgress = false;
    let lastSlotSignalJSON = '';
    // cache do ultimo estado conhecido do omnichannel (ligado/desligado).
    // necessario porque em telas/janelas estreitas o Rocket.Chat esconde o botao
    // #omnichannel-status-toggle dentro de um menu "kebab" (⋮) que so existe no DOM
    // quando aberto - nao devemos abrir esse menu so para ler o estado (ficaria piscando).
    let lastKnownOmniActive = null;

    function normalizeText(v) {
        return (v || '')
            .toString()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }

    function isInfoPanelTitle(title) {
        const t = normalizeText(title);
        return t.includes('informacoes da sala') ||
               t.includes('informacao da sala') ||
               t.includes('room information') ||
               t.includes('room info');
    }

    function isEditPanelTitle(title) {
        const t = normalizeText(title);
        return t.includes('editar sala') ||
               t.includes('edit room');
    }

    function extractRoomKeyFromUrl(rawUrl) {
        if (!rawUrl) return '';
        try {
            const url = new URL(rawUrl, window.location.origin);
            const path = (url.pathname || '').toLowerCase();

            let m = path.match(/\/omnichannel\/current\/([^\/?#]+)/i);
            if (m && m[1] && m[1] !== 'current') return `rid:${m[1]}`;

            m = path.match(/\/(?:channel|group|direct|room)\/([^\/?#]+)/i);
            if (m && m[1]) return `rid:${m[1]}`;

            const rid = url.searchParams.get('rid') || url.searchParams.get('roomid') || url.searchParams.get('roomId');
            if (rid) return `rid:${rid}`;
        } catch (_) {}
        return '';
    }

    // seletores compativeis com sidebar antiga (data-qa) e nova v2 (sem data-qa)
    const SIDEBAR_ITEM_TITLE_SELECTOR = '[data-qa="sidebar-item-title"], .rcx-sidebar-v2-item__title, .rcx-sidebar-item__title';
    const SIDEBAR_ITEM_SELECTOR = '.rcx-sidebar-item, .rcx-sidebar-v2-item, [data-qa="sidebar-item"]';
    const SIDEBAR_ITEM_SELECTED_SELECTOR = '.rcx-sidebar-item--selected, .rcx-sidebar-v2-item--selected, [aria-selected="true"]';

    function getCurrentRoomKeyFromDom() {
        const selectedLink =
            document.querySelector(SIDEBAR_ITEM_SELECTED_SELECTOR + ' a[href]') ||
            document.querySelector(SIDEBAR_ITEM_SELECTED_SELECTOR + '[href]');
        const href = selectedLink ? (selectedLink.href || selectedLink.getAttribute('href')) : '';
        const domKey = extractRoomKeyFromUrl(href);
        if (domKey) return domKey;
        return extractRoomKeyFromUrl(window.location.href);
    }

    function getChatKeyCandidates(name) {
        const keys = [];
        const roomKey = getCurrentRoomKeyFromDom();
        if (roomKey) keys.push(roomKey);

        const normalized = normalizeText(name || '');
        if (normalized) {
            keys.push(`name:${normalized}`);
            keys.push(normalized);
        }
        return keys;
    }

    function getChatKey(name) {
        const normalized = normalizeText(name || '');
        return normalized || '';
    }

    function hasCollectedDataForChat(name) {
        const keys = getChatKeyCandidates(name);
        if (!keys.length) return false;
        return keys.some(k => !!collectedDetailsByChat[k]);
    }

    function markCollectedDataForChat(name, details) {
        if (details && (details.matricula || details.protocolo || details.tipoCliente)) {
            const keys = getChatKeyCandidates(name);
            if (!keys.length) return;
            keys.forEach(k => { collectedDetailsByChat[k] = true; });
        }
    }

    // frame tipo
    const isMainFrame = (window.name === 'frame_rocket');
    const isSlotFrame = (window.name || '').startsWith('frame_slot_');

    // oculta menu
    if (isSlotFrame) {
        const injectHideSidebar = () => {
            if (document.getElementById('fw-hide-sidebar')) return;
            const s = document.createElement('style');
            s.id = 'fw-hide-sidebar';
            s.textContent = [
                'aside:has(.rcx-sidebar-item),aside:has(.rcx-sidebar-v2-item){display:none!important;width:0!important;min-width:0!important;}',
                '.rcx-sidebar{display:none!important;width:0!important;min-width:0!important;}',
                '[data-qa="sidebar"]{display:none!important;width:0!important;min-width:0!important;}',
                '.main-content,.rcx-page-loading,.room-skeleton__content{flex:1 1 auto!important;width:100%!important;}',
            ].join('\n');
            (document.head || document.documentElement).appendChild(s);
        };
        injectHideSidebar();
        document.addEventListener('DOMContentLoaded', injectHideSidebar);
        setTimeout(injectHideSidebar, 500);
        setTimeout(injectHideSidebar, 1500);
        setTimeout(injectHideSidebar, 3500);
    }

    // bloqueia audio
    const originalAudioPlay = HTMLAudioElement.prototype.play;
    HTMLAudioElement.prototype.play = function() {
        if (this.src && (this.src.includes('notification') || this.src.includes('sound') || this.src.includes('audio'))) {
            return Promise.resolve();
        }
        return originalAudioPlay.apply(this, arguments);
    };

    // avatar

    function extractAvatarLetter() {
        if (!isMainFrame) return null;
        // v1: avatar ficava em .rcx-sidebar-topbar; v2: ficou no botao "User menu" da navbar
        const avatarImg =
            document.querySelector('.rcx-sidebar-topbar .rcx-avatar img, .rcx-avatar img[data-username]') ||
            document.querySelector('button[aria-label="User menu"] .rcx-avatar img, button[title="User menu"] .rcx-avatar img') ||
            document.querySelector('.rcx-navbar .rcx-avatar img[data-username]');
        if (avatarImg) {
            const username = avatarImg.getAttribute('data-username') || avatarImg.alt;
            if (username) {
                const letter = username.charAt(0).toUpperCase();
                let avatarUrl = avatarImg.getAttribute('src') || '';
                if (avatarUrl && !avatarUrl.startsWith('http')) avatarUrl = window.location.origin + avatarUrl;
                if (letter !== lastAvatarLetter || avatarUrl !== lastAvatarUrl) {
                    lastAvatarLetter = letter;
                    lastAvatarUrl = avatarUrl;
                    window.parent.postMessage({
                        type: 'ROCKETCHAT_AVATAR_LETTER',
                        source: 'firewall-extension',
                        data: { letter, username, avatarUrl }
                    }, '*');
                }
                return letter;
            }
        }
        return null;
    }

    // sidebar

    function extractSidebarChats() {
        const chats = [];
        const titleElements = document.querySelectorAll(SIDEBAR_ITEM_TITLE_SELECTOR);
        const currentPath = (window.location.pathname || '').replace(/\/+$/, '');
        titleElements.forEach(titleEl => {
            let nome = (titleEl.textContent || '').trim();
            const sidebarItem = titleEl.closest('.rcx-sidebar-item') ||
                                titleEl.closest('.rcx-sidebar-v2-item') ||
                                titleEl.closest('[class*="sidebar-item"]') ||
                                titleEl.parentElement?.parentElement?.parentElement;
            // sidebar v2: o nome tambem fica no atributo title/aria-label do <a>
            if (!nome && sidebarItem) {
                nome = (sidebarItem.getAttribute('title') || sidebarItem.getAttribute('aria-label') || '').trim();
            }
            if (!nome) return;
            let badgeCount = 0;
            if (sidebarItem) {
                const badge = sidebarItem.querySelector('.rcx-badge--danger, .rcx-badge');
                if (badge) {
                    const badgeNum = badge.querySelector('span[aria-hidden]') || badge;
                    badgeCount = parseInt(badgeNum.textContent.trim()) || 0;
                }
            }
            let chatUrl = null;
            const linkEl = titleEl.closest('a[href]') || sidebarItem?.closest('a[href]') || sidebarItem?.querySelector('a[href]');
            if (linkEl) {
                chatUrl = linkEl.href || linkEl.getAttribute('href');
                if (chatUrl && !chatUrl.startsWith('http')) chatUrl = window.location.origin + chatUrl;
            }
            // sidebar v2: sem numero de badge, usa data-unread="true" no <a> como sinal de nao lida
            if (badgeCount === 0) {
                const unreadFlag = (sidebarItem && sidebarItem.getAttribute('data-unread')) ||
                                    (linkEl && linkEl.getAttribute('data-unread'));
                if (unreadFlag === 'true') badgeCount = 1;
            }
            let isSelected = sidebarItem ?
                (sidebarItem.classList.contains('rcx-sidebar-item--selected') ||
                 sidebarItem.classList.contains('rcx-sidebar-v2-item--selected') ||
                 sidebarItem.getAttribute('aria-selected') === 'true' ||
                 sidebarItem.getAttribute('aria-current') === 'true') : false;
            // fallback sidebar v2: sem classe --selected, compara o path do href com a rota atual
            if (!isSelected && linkEl) {
                try {
                    const linkPath = new URL(chatUrl || linkEl.getAttribute('href'), window.location.origin).pathname.replace(/\/+$/, '');
                    if (linkPath && currentPath && linkPath === currentPath) isSelected = true;
                } catch (_) {}
            }
            chats.push({ nome, badgeCount, isSelected, chatUrl });
        });
        return chats;
    }

    // visitante

    function extractSelectedTags() {
        const labels = Array.from(document.querySelectorAll('label, span, div'));
        const tagsLabel = labels.find(el => normalizeText(el.textContent || '') === 'tags');

        let scope = null;
        if (tagsLabel) {
            scope = tagsLabel.closest('.rcx-field') || tagsLabel.closest('.rcx-field-group') || tagsLabel.parentElement;
        }

        const root = scope || document;
        const possibleTagNodes = root.querySelectorAll(
            '[class*="tag" i], [class*="chip" i], [class*="badge" i], [data-qa*="tag" i], [aria-label*="tag" i]'
        );

        const tags = [];
        possibleTagNodes.forEach(node => {
            const txt = (node.textContent || '').replace(/\s+/g, ' ').trim();
            if (!txt) return;
            const norm = normalizeText(txt);
            if (!norm || norm === 'tags') return;
            if (!tags.some(t => normalizeText(t) === norm)) tags.push(txt);
        });

        return tags;
    }

    function extractVisitorDetails() {
        const data = { matricula: null, protocolo: null, tipoCliente: null, motivoAtual: null, quantidadeAbandono: null, quantidadeChats: null, tags: [] };

        const matInput = document.querySelector('input[name="livechatData.matricula"], input[name="livechatData.MATRICULA"]');
        if (matInput && matInput.value) data.matricula = matInput.value.trim();

        const protInput = document.querySelector('input[name="livechatData.protocolo"], input[name="livechatData.PROTOCOLO"]');
        if (protInput && protInput.value) data.protocolo = protInput.value.trim();

        const tipoInput = document.querySelector('input[name="livechatData.operacao"], input[name="livechatData.OPERACAO"], input[name="livechatData.Operacao"], input[name="livechatData.Operação"], select[name="livechatData.operacao"], select[name="livechatData.OPERACAO"]');
        if (tipoInput && tipoInput.value) data.tipoCliente = tipoInput.value.trim();

        const motivoInput = document.querySelector('input[name="livechatData.motivoatual"], input[name="livechatData.MOTIVOATUAL"], input[name="livechatData.MotivoAtual"]');
        if (motivoInput && motivoInput.value) data.motivoAtual = motivoInput.value.trim();

        const abandonoInput = document.querySelector('input[name="livechatData.quantidadeabandono"]');
        if (abandonoInput && abandonoInput.value) data.quantidadeAbandono = abandonoInput.value.trim();

        const chatsInput = document.querySelector('input[name="livechatData.quantidadechats"]');
        if (chatsInput && chatsInput.value) data.quantidadeChats = chatsInput.value.trim();

        if (!data.matricula || !data.protocolo || !data.tipoCliente) {
            const labels = document.querySelectorAll('label');
            labels.forEach(label => {
                const text = label.textContent.trim().toUpperCase().replace(/[\s_]+/g, ' ').trim();
                const container = label.closest('.rcx-field') || label.closest('.rcx-field-group') || label.parentElement;
                const field = container?.querySelector('input, textarea, select');
                if ((text === 'MATRICULA' || text === 'MATRÍCULA') && field && field.value && !data.matricula) data.matricula = field.value.trim();
                if (text === 'PROTOCOLO' && field && field.value && !data.protocolo) data.protocolo = field.value.trim();
                if ((text === 'OPERACAO' || text === 'OPERAÇÃO' || text === 'TIPO DE CLIENTE' || text === 'TIPO CLIENTE') && field && field.value && !data.tipoCliente) data.tipoCliente = field.value.trim();
                if ((text === 'MOTIVO ATUAL' || text === 'MOTIVOATUAL') && field && field.value && !data.motivoAtual) data.motivoAtual = field.value.trim();
            });
        }

        if (!data.tipoCliente) {
            const allFields = document.querySelectorAll('input, select, textarea');
            allFields.forEach(f => {
                const name = (f.name || '').toLowerCase();
                if (name.includes('operacao') && f.value && !data.tipoCliente) data.tipoCliente = f.value.trim();
            });
        }

        data.tags = extractSelectedTags();

        return data;
    }

    function getActiveChatName() {
        const selected = document.querySelector(SIDEBAR_ITEM_SELECTED_SELECTOR + ' ' + SIDEBAR_ITEM_TITLE_SELECTOR);
        if (selected && selected.textContent.trim()) return selected.textContent.trim();
        // fallback sidebar v2 (sem classe --selected): compara href do item com a rota atual
        const currentPath = (window.location.pathname || '').replace(/\/+$/, '');
        if (currentPath) {
            const links = document.querySelectorAll('a[href]');
            for (const link of links) {
                const titleEl = link.querySelector(SIDEBAR_ITEM_TITLE_SELECTOR);
                if (!titleEl) continue;
                try {
                    const linkPath = new URL(link.getAttribute('href'), window.location.origin).pathname.replace(/\/+$/, '');
                    if (linkPath && linkPath === currentPath) {
                        const nome = (titleEl.textContent || '').trim() || (link.getAttribute('title') || link.getAttribute('aria-label') || '').trim();
                        if (nome) return nome;
                    }
                } catch (_) {}
            }
        }
        const h1 = document.querySelector('h1.rcx-box');
        if (h1 && h1.textContent.trim().length > 0) return h1.textContent.trim();
        return null;
    }

    function namesMatchLoose(a, b) {
        const na = normalizeText(a || '');
        const nb = normalizeText(b || '');
        if (!na || !nb) return false;
        if (na === nb) return true;
        const af = na.split(' ')[0] || '';
        const bf = nb.split(' ')[0] || '';
        if (af && bf && af === bf) return true;
        return na.includes(nb) || nb.includes(na);
    }

    function extractSlotUnreadSignal() {
        const hasUnreadDivider = !!document.querySelector('.rcx-message-divider__wrapper--unread');

        const wrappers = document.querySelectorAll('.rcx-box.rcx-box--full.rcx-message-header__wrapper');
        const lastWrapper = wrappers.length ? wrappers[wrappers.length - 1] : null;

        let lastSenderName = '';
        if (lastWrapper) {
            const senderEl =
                lastWrapper.querySelector('.rcx-message-header__name') ||
                lastWrapper.querySelector('[data-qa="message-header-name"]') ||
                lastWrapper.querySelector('a') ||
                lastWrapper;
            lastSenderName = (senderEl && senderEl.textContent ? senderEl.textContent : '').trim();
        }

        const chatName = (getActiveChatName() || '').trim();
        const lastMessageFromVisitor = !!lastSenderName && !!chatName && namesMatchLoose(lastSenderName, chatName);

        return {
            hasUnreadDivider,
            lastMessageFromVisitor,
            lastSenderName,
            chatName
        };
    }

    function sendSlotSignal() {
        if (!isSlotFrame) return;
        const data = extractSlotUnreadSignal();
        const json = JSON.stringify({
            hasUnreadDivider: !!data.hasUnreadDivider,
            lastMessageFromVisitor: !!data.lastMessageFromVisitor,
            chatName: data.chatName || ''
        });
        if (json === lastSlotSignalJSON) return;
        lastSlotSignalJSON = json;

        window.parent.postMessage({
            type: 'ROCKETCHAT_SLOT_SIGNAL',
            source: 'firewall-extension',
            frameUrl: window.location.href,
            timestamp: Date.now(),
            data
        }, '*');
    }

    // auto extracao

    // pega o titulo da barra contextual (painel lateral direito), com fallback
    // generico para quando data-qa/id sao removidos em atualizacoes do Rocket.Chat
    function findContextualBarTitle() {
        const byId =
            document.getElementById('contextualbarTitle') ||
            document.querySelector('[data-qa="ContextualbarTitle"]') ||
            document.querySelector('[data-qa-id="contextualbar-title"]');
        if (byId) return byId;

        const bar = document.querySelector('.rcx-vertical-bar, [data-qa="Contextualbar"], aside[role="dialog"], [role="complementary"]');
        if (!bar) return null;

        const heading = bar.querySelector('h1, h2, h3, [class*="Title" i], [class*="title" i]');
        return heading || null;
    }

    function autoDetectAndExtract() {
        if (manualTabulationInProgress) return;

        const contextTitle = findContextualBarTitle();
        const activeName = getActiveChatName();

        if (!contextTitle) {
            alreadyClickedEdit = false;
            alreadyExtracted = false;
            return;
        }

        const titleText = (contextTitle.textContent || '').trim();

        if (isInfoPanelTitle(titleText) && !alreadyClickedEdit) {
            if (hasCollectedDataForChat(activeName)) {
                return;
            }
            const editBtn = findRoomEditButton();
            if (editBtn) {
                editBtn.click();
                alreadyClickedEdit = true;
                alreadyExtracted = false;
            }
            return;
        }

        if (isEditPanelTitle(titleText) && !alreadyExtracted) {
            if (hasCollectedDataForChat(activeName)) {
                return;
            }
            alreadyExtracted = true;

            setTimeout(async () => {
                const details = extractVisitorDetails();
                const activeName = getActiveChatName();

                // captura automatica das opcoes de tags disponiveis, junto com matricula/protocolo
                try {
                    const tagsInputEl = findTagsInput();
                    if (tagsInputEl) {
                        const availableTags = await harvestAllTagOptions(tagsInputEl, { maxScrolls: 14 });
                        if (availableTags && availableTags.length) details.availableTags = availableTags;
                    }
                } catch (_) {}

                if (details.matricula || details.protocolo || details.tipoCliente) {
                    markCollectedDataForChat(activeName, details);
                    const detailsKey = JSON.stringify({ ...details, nome: activeName });
                    if (detailsKey !== lastDetailsSent) {
                        lastDetailsSent = detailsKey;
                        window.parent.postMessage({
                            type: 'ROCKETCHAT_BRIDGE_DETAILS',
                            source: 'firewall-extension',
                            frameUrl: window.location.href,
                            data: { ...details, nome: activeName },
                            timestamp: Date.now()
                        }, '*');
                    }
                } else {
                    setTimeout(async () => {
                        const retry = extractVisitorDetails();
                        const retryName = getActiveChatName();

                        try {
                            const tagsInputEl = findTagsInput();
                            if (tagsInputEl) {
                                const availableTags = await harvestAllTagOptions(tagsInputEl, { maxScrolls: 14 });
                                if (availableTags && availableTags.length) retry.availableTags = availableTags;
                            }
                        } catch (_) {}

                        if (retry.matricula || retry.protocolo || retry.tipoCliente) {
                            markCollectedDataForChat(retryName, retry);
                            const retryKey = JSON.stringify({ ...retry, nome: retryName });
                            if (retryKey !== lastDetailsSent) {
                                lastDetailsSent = retryKey;
                                window.parent.postMessage({
                                    type: 'ROCKETCHAT_BRIDGE_DETAILS',
                                    source: 'firewall-extension',
                                    frameUrl: window.location.href,
                                    data: { ...retry, nome: retryName },
                                    timestamp: Date.now()
                                }, '*');
                            }
                        }
                    }, 800);
                }

                setTimeout(() => {
                    alreadyClickedEdit = false;
                    alreadyExtracted = false;
                }, 300);
            }, 600);
        }
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function findButtonByText(words) {
        const tokens = (words || []).map(w => normalizeText(w));
        const buttons = Array.from(document.querySelectorAll('button'));
        for (const btn of buttons) {
            const txt = normalizeText(btn.textContent || btn.getAttribute('aria-label') || btn.title || '');
            if (tokens.some(t => t && txt.includes(t))) return btn;
        }
        return null;
    }

    // encontra um botao por icone interno, tentando varios nomes de icone (rcx-icon--name-XXX)
    // usado como fallback quando data-qa/data-qa-id sao removidos em atualizacoes do Rocket.Chat
    function findButtonByIconNames(iconNames) {
        for (const name of iconNames) {
            try {
                const btn = document.querySelector(`button:has(i[class*="icon--name-${name}"])`);
                if (btn) return btn;
            } catch (_) {}
        }
        // fallback sem :has (navegadores antigos): procura o icone e sobe ate o botao
        for (const name of iconNames) {
            const icon = document.querySelector(`i[class*="icon--name-${name}"]`);
            if (icon) {
                const btn = icon.closest('button');
                if (btn) return btn;
            }
        }
        return null;
    }

    // botao "Forward chat" (encaminhar) no toolbox da conversa
    function findForwardChatButton() {
        return document.getElementById('rocket-chat-forward') ||
               document.querySelector('[data-qa-id="ToolBoxAction-balloon-arrow-top-right"]') ||
               document.querySelector('button[title="Encaminhar conversa"]') ||
               document.querySelector('button[title*="Forward chat" i]') ||
               document.querySelector('button[aria-label*="Forward chat" i]') ||
               document.querySelector('button[title*="Encaminhar" i]') ||
               document.querySelector('button[aria-label*="Encaminhar" i]') ||
               findButtonByIconNames(['balloon-arrow-top-right', 'forward', 'arrow-forward', 'share-forward']) ||
               findButtonByText(['Forward chat', 'Forward', 'Encaminhar conversa', 'Encaminhar bate-papo', 'Encaminhar']);
    }

    // botao "Encerrar a conversa" (finalizar chat) no toolbox da conversa
    function findCloseChatButton() {
        return document.getElementById('rocket-close-chat') ||
               document.querySelector('[data-qa-id="ToolBoxAction-balloon-close-top-right"]') ||
               document.querySelector('button[title="Encerrar a conversa"]') ||
               document.querySelector('button[title*="Close chat" i]') ||
               document.querySelector('button[aria-label*="Close chat" i]') ||
               document.querySelector('button[title*="Encerrar" i]') ||
               document.querySelector('button[aria-label*="Encerrar" i]') ||
               findButtonByIconNames(['balloon-close-top-right', 'close']) ||
               findButtonByText(['Close chat', 'Encerrar a conversa', 'Encerrar']);
    }

    // botao "kebab" (⋮) de overflow da navbar - aparece quando a janela fica estreita
    // e alguns botoes (como o toggle de omnichannel) somem do lugar normal e vao
    // parar dentro desse menu suspenso.
    function findNavbarKebabButton() {
        const navbarScope = document.querySelector('.rcx-navbar, header, [class*="navbar" i]') || document;
        const iconBtn = navbarScope.querySelector('i[class*="icon--name-kebab" i]');
        if (iconBtn) {
            const btn = iconBtn.closest('button, [role="button"]');
            if (btn) return btn;
        }
        // fallback: procura em qualquer lugar da pagina (caso o scope acima nao bata)
        const anyIconBtn = document.querySelector('i[class*="icon--name-kebab" i]');
        if (anyIconBtn) {
            const btn = anyIconBtn.closest('button, [role="button"]');
            if (btn) return btn;
        }
        return null;
    }

    // procura, dentro de um menu/dropdown ja aberto (ex: o kebab da navbar), uma opcao
    // cujo texto bata com algum dos termos informados (compara em minusculas, sem acento).
    function findOpenMenuOptionByText(texts) {
        const normalizedTargets = texts.map(t => normalizeText(t));
        const candidates = document.querySelectorAll('.rcx-option__content, [role="menuitem"], [role="option"]');
        for (const el of candidates) {
            const txt = normalizeText(el.textContent || '');
            if (!txt) continue;
            for (const target of normalizedTargets) {
                if (txt.includes(target)) {
                    return el.closest('[role="menuitem"], [role="option"], li, button') || el;
                }
            }
        }
        return null;
    }

    // Le o estado atual do toggle de omnichannel (ligado/desligado) de forma resiliente:
    // - Se o botao estiver diretamente visivel na navbar (janela larga), le o estado dele
    //   normalmente e atualiza o cache lastKnownOmniActive.
    // - Se o botao NAO estiver no DOM (colapsado dentro do menu kebab por causa da janela
    //   estreita), NAO abre o menu para checar (isso causaria um "flash" visual toda hora
    //   que o polling roda) - em vez disso retorna o ultimo estado conhecido (cache).
    function getOmnichannelStateResilient() {
        const omniBtn = document.getElementById('omnichannel-status-toggle');
        if (omniBtn) {
            const icon = omniBtn.querySelector('i');
            const title = (omniBtn.getAttribute('title') || '').toLowerCase();
            const btnClass = omniBtn.className || '';
            let omniActive = null;
            if (title.includes('turn off') || title.includes('desativar') || title.includes('desligar') || title.includes('desabilitar')) {
                omniActive = true;
            } else if (title.includes('turn on') || title.includes('ativar') || title.includes('ligar') || title.includes('habilitar')) {
                omniActive = false;
            } else if (btnClass.includes('icon-success')) {
                omniActive = true;
            } else if (btnClass.includes('icon-danger')) {
                omniActive = false;
            } else if (icon) {
                omniActive = !icon.className.includes('message-disabled');
            }
            if (omniActive !== null) {
                lastKnownOmniActive = omniActive;
            }
            return omniActive;
        }
        // botao colapsado no kebab - nao abrir visualmente, usa o cache
        return lastKnownOmniActive;
    }

    // Executa o toggle do omnichannel de forma resiliente:
    // - Se o botao estiver direto na tela (janela larga), clica nele normalmente.
    // - Se estiver colapsado no kebab (janela estreita), abre o kebab, clica na opcao
    //   certa (bilingue PT/EN) e deixa o menu fechar sozinho (comportamento padrao de
    //   dropdown ao clicar numa opcao). So abre o menu aqui porque essa e uma acao
    //   explicita do usuario (ele ja espera ver uma mudanca na tela), diferente do
    //   polling passivo que nunca deve abrir esse menu.
    function toggleOmnichannelResilient(callback) {
        const directBtn = document.getElementById('omnichannel-status-toggle');
        if (directBtn) {
            directBtn.click();
            if (typeof callback === 'function') setTimeout(callback, 1000);
            return true;
        }

        const kebabBtn = findNavbarKebabButton();
        if (!kebabBtn) {
            if (typeof callback === 'function') callback();
            return false;
        }

        kebabBtn.click();
        setTimeout(() => {
            const option = findOpenMenuOptionByText([
                'desabilitar receber chats', 'habilitar receber chats',
                'turn off answer chats', 'turn on answer chats',
                'desabilitar', 'habilitar', 'answer chats'
            ]);
            if (option) {
                option.click();
            } else {
                // nao achou a opcao - fecha o menu para nao deixar aberto sem querer
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            }
            if (typeof callback === 'function') setTimeout(callback, 1000);
        }, 300);
        return true;
    }

    // botao final de confirmacao do dialogo "Encaminhar bate-papo" (Forward Chat)
    // v2 nao tem mais data-qa-id; o texto do botao tambem pode estar em PT-BR ("Encaminhar")
    // em vez de EN ("Forward"). Procura dentro do dialog/modal aberto para nao pegar
    // o botao errado da tela de fundo.
    function findForwardConfirmButton() {
        const dialog = document.querySelector('[role="dialog"]:not(.rcx-vertical-bar)') ||
                       document.querySelector('.rcx-modal, [class*="modal" i]');
        const scope = dialog || document;

        const byAttr =
            scope.querySelector('button[data-qa-id*="forward" i][type="button"]') ||
            scope.querySelector('button[title="Encaminhar"]') ||
            scope.querySelector('button[title*="Forward" i]:not([title*="chat" i])') ||
            scope.querySelector('button[aria-label*="Forward" i]:not([aria-label*="chat" i])');
        if (byAttr) return byAttr;

        // procura por texto exato/contendo em PT-BR e EN, evitando o botao "Encaminhar bate-papo"
        // (que reabriria o dialogo) e o botao "Cancelar"
        const buttons = Array.from(scope.querySelectorAll('button'));
        const tokens = ['encaminhar', 'forward', 'transferir', 'transfer', 'confirmar', 'confirm'];
        for (const btn of buttons) {
            const txt = normalizeText(btn.textContent || btn.getAttribute('aria-label') || btn.title || '');
            if (!txt) continue;
            if (txt.includes('encaminhar bate-papo') || txt.includes('encaminhar bate papo') || txt.includes('forward chat')) continue;
            if (txt.includes('cancelar') || txt.includes('cancel')) continue;
            if (tokens.some(t => txt.includes(t))) return btn;
        }
        return null;
    }

    function findToolboxOptionsButton() {
        return document.querySelector('button[aria-label*="Opções" i]') ||
               document.querySelector('button[title*="Opções" i]') ||
               document.querySelector('button[aria-label*="Options" i]') ||
               document.querySelector('button[title*="Options" i]') ||
               findButtonByIconNames(['kebab', 'menu']) ||
               findButtonByText(['Opções', 'Options']);
    }

    // botao "Informações da Sala" / "Room Information"
    // v2: aparece direto na toolbar principal da conversa (sem precisar abrir menu "Opções")
    // v1: ficava dentro do menu "Opções" (kebab)
    function findRoomInfoMenuOption() {
        return document.querySelector('button[title="Informações da Sala"]') ||
               document.querySelector('button[title="Room Information"]') ||
               document.querySelector('[data-qa-id="ToolBoxAction-info-circled"]') ||
               document.querySelector('button[title*="Informações da Sala" i]') ||
               document.querySelector('button[aria-label*="Informações da Sala" i]') ||
               document.querySelector('button[title*="Room Information" i]') ||
               document.querySelector('[data-qa-id*="info"][data-qa-id*="circled"]') ||
               findButtonByIconNames(['info-circled']) ||
               findMenuOptionByText(['Informações da Sala', 'Room Information', 'info']) ||
               findButtonByText(['Informações da Sala', 'Room Information']);
    }

    // botao "Editar" / "Edit" dentro do painel de informacoes da sala
    function findRoomEditButton() {
        return document.querySelector('[data-qa-id="room-info-edit"]') ||
               document.querySelector('[data-qa="room-info-edit"]') ||
               document.querySelector('button[aria-label*="Editar" i]') ||
               document.querySelector('button[title*="Editar" i]') ||
               document.querySelector('button[aria-label*="Edit" i]') ||
               document.querySelector('button[title*="Edit" i]') ||
               findButtonByIconNames(['edit', 'pencil']) ||
               findButtonByText(['Editar', 'Edit']);
    }

    // menu opcao
    function findMenuOptionByText(words) {
        const tokens = (words || []).map(w => normalizeText(w));
        const optContents = document.querySelectorAll('.rcx-option__content');
        for (const opt of optContents) {
            const txt = normalizeText(opt.textContent);
            if (tokens.some(t => t && txt.includes(t))) {
                return opt.closest('li') ||
                       opt.closest('[role="option"]') ||
                       opt.closest('[role="menuitem"]') ||
                       opt.closest('.rcx-option') ||
                       opt.parentElement?.parentElement ||
                       opt.parentElement;
            }
        }
        return null;
    }

    async function clickWithRetries(findFn, maxTries = 12, delay = 250) {
        for (let i = 0; i < maxTries; i++) {
            const el = findFn();
            if (el) {
                el.click();
                return true;
            }
            await sleep(delay);
        }
        return false;
    }

    function findTagsLabel() {
        const labels = Array.from(document.querySelectorAll('label'));
        return labels.find(l => normalizeText(l.textContent) === 'tags') || null;
    }

    function findTagsSelectRoot() {
        const tagsLabel = findTagsLabel();
        if (tagsLabel) {
            const scope = tagsLabel.closest('.rcx-field') || tagsLabel.closest('.rcx-field-group') || tagsLabel.parentElement;
            const rootByLabel = scope?.querySelector('.rcx-select, [class*="rcx-select "], [class*="rcx-select"]');
            if (rootByLabel) return rootByLabel;
        }

        const allSelects = Array.from(document.querySelectorAll('.rcx-select, [class*="rcx-select "], [class*="rcx-select"]'));
        if (!allSelects.length) return null;

        // No painel de edição, tags costuma ser o último seletor visível.
        return allSelects[allSelects.length - 1];
    }

    function findTagsInput() {
        const root = findTagsSelectRoot();
        if (root) {
            const inputInsideRoot = root.querySelector('input[placeholder*="Selecione uma opção" i], input[placeholder*="Select an option" i], input');
            if (inputInsideRoot) return inputInsideRoot;
        }

        return document.querySelector('input[aria-autocomplete="list"]') ||
               document.querySelector('input[placeholder*="Selecione uma opção" i]') ||
               document.querySelector('input[placeholder*="Select an option" i]') ||
               document.querySelector('.rcx-select__addon input') ||
               document.querySelector('.rcx-select__control input') ||
               document.querySelector('[data-qa*="tag" i] input') ||
               document.querySelector('.rcx-select__control input');
    }

    function findTagsAddonToggle() {
        const root = findTagsSelectRoot();
        if (root) {
            const addonInRoot = root.querySelector('.rcx-select__addon, [class*="rcx-select__addon"], .rcx-select__control');
            if (addonInRoot) return addonInRoot;

            if (root.classList && root.classList.contains('rcx-select')) return root;
        }

        return document.querySelector('.rcx-select__addon') ||
               document.querySelector('[class*="rcx-select__addon"]') ||
               document.querySelector('.rcx-select__control');
    }

    function isElementVisible(el) {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        if (!rect || rect.width < 4 || rect.height < 4) return false;
        const style = window.getComputedStyle(el);
        if (!style) return true;
        return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
    }

    function getLikelyOpenDropdownContainers(anchorInput) {
        const containers = [];
        const pushUnique = (el) => {
            if (!el || !isElementVisible(el)) return;
            if (!containers.includes(el)) containers.push(el);
        };

        const listboxId = anchorInput?.getAttribute('aria-controls') || anchorInput?.getAttribute('aria-owns');
        if (listboxId) {
            const controlled = document.getElementById(listboxId);
            if (controlled) pushUnique(controlled);
        }

        if (anchorInput) {
            const inputRect = anchorInput.getBoundingClientRect();
            const aroundInput = Array.from(document.querySelectorAll('[role="listbox"], [role="menu"], [role="dialog"], [data-radix-popper-content-wrapper], [class*="popover" i]')).filter(el => {
                if (!isElementVisible(el)) return false;
                const r = el.getBoundingClientRect();
                if (r.width < 120 || r.height < 24) return false;
                const isNearX = !(r.right < inputRect.left - 80 || r.left > inputRect.right + 80);
                const isBelow = r.top >= (inputRect.bottom - 20) && r.top <= (inputRect.bottom + 320);
                const hasRealOptions = !!el.querySelector('[role="option"], .rcx-option, .rcx-option__wrapper, .rcx-option__content, [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]');
                return isNearX && isBelow && hasRealOptions;
            });
            aroundInput.forEach(pushUnique);
        }

        return containers;
    }

    function extractTagTextFromOptionElement(el) {
        if (!el) return '';
        const txt = (el.textContent || '')
            .replace(/[\uE000-\uF8FF]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        const normalized = normalizeText(txt);
        if (!txt || !normalized) return '';
        if (normalized === 'tags') return '';
        if (normalized.includes('selecione uma opcao') || normalized.includes('select an option')) return '';
        if (normalized.includes('editar') || normalized.includes('fechar') || normalized.includes('close')) return '';
        if (normalized.includes('salvar') || normalized.includes('save') || normalized.includes('cancelar') || normalized.includes('cancel')) return '';
        if (normalized.includes('voltar ao menu') || normalized.includes('adicionar contato') || normalized.includes('bloquear')) return '';
        if (txt.length < 2 || txt.length > 120) return '';
        return txt;
    }

    function isTagOptionNode(node) {
        if (!node || node.nodeType !== 1) return false;
        const role = node.getAttribute ? node.getAttribute('role') : null;
        const cls = node.className && typeof node.className === 'string' ? node.className : '';
        return role === 'option' ||
               cls.includes('rcx-option__content') ||
               cls.includes('rcx-option__wrapper') ||
               /(^|\s)rcx-option(\s|$)/.test(cls) ||
               cls.endsWith('rcx-option');
    }

    function findScrollableAncestor(el) {
        let p = el ? el.parentElement : null;
        let hops = 0;
        while (p && hops < 8) {
            const style = window.getComputedStyle(p);
            if (p.scrollHeight > p.clientHeight + 4 && /(auto|scroll)/.test(style.overflowY)) {
                return p;
            }
            p = p.parentElement;
            hops++;
        }
        return null;
    }

    // Captura TODAS as opcoes do dropdown de tags, inclusive listas virtualizadas
    // (rola o container ate o fim, coletando via MutationObserver a cada passo).
    function harvestAllTagOptions(input, opts = {}) {
        const maxScrolls = opts.maxScrolls || 26;

        return new Promise((resolve) => {
            const found = [];
            let scrollContainer = null;

            const addFromEl = (el) => {
                const txt = extractTagTextFromOptionElement(el);
                if (!txt) return;
                const norm = normalizeText(txt);
                if (found.some(v => normalizeText(v) === norm)) return;
                found.push(txt);
                if (!scrollContainer) {
                    scrollContainer = findScrollableAncestor(el);
                }
            };

            const scanNode = (node) => {
                if (!node || node.nodeType !== 1) return;
                if (isTagOptionNode(node)) addFromEl(node);
                try {
                    node.querySelectorAll('[role="option"], .rcx-option__content, .rcx-option__wrapper, .rcx-option, [class*="rcx-option"]')
                        .forEach(addFromEl);
                } catch (_) {}
            };

            const observer = new MutationObserver((mutations) => {
                for (const mut of mutations) {
                    for (const node of mut.addedNodes) scanNode(node);
                }
            });

            observer.observe(document.documentElement, { childList: true, subtree: true });
            openTagsDropdown();

            (async () => {
                await sleep(420);

                // captura o que ja estiver visivel de imediato (caso o observer perca o burst inicial)
                extractVisibleTagOptions(input).forEach(txt => {
                    const norm = normalizeText(txt);
                    if (!found.some(v => normalizeText(v) === norm)) found.push(txt);
                });

                if (!scrollContainer) {
                    const containers = getLikelyOpenDropdownContainers(input);
                    scrollContainer = containers.find(c => c.scrollHeight > c.clientHeight + 4) || null;
                }

                let stagnantRounds = 0;

                for (let i = 0; i < maxScrolls; i++) {
                    const beforeCount = found.length;

                    if (scrollContainer) {
                        const beforeTop = scrollContainer.scrollTop;
                        const step = Math.max(scrollContainer.clientHeight * 0.85, 60);
                        scrollContainer.scrollTop = Math.min(scrollContainer.scrollTop + step, scrollContainer.scrollHeight);
                        await sleep(150);

                        const scrolled = scrollContainer.scrollTop !== beforeTop;
                        const atBottom = (scrollContainer.scrollTop + scrollContainer.clientHeight) >= (scrollContainer.scrollHeight - 4);
                        const gotNew = found.length > beforeCount;

                        stagnantRounds = gotNew ? 0 : stagnantRounds + 1;

                        if ((!scrolled || atBottom) && stagnantRounds >= 2) break;
                        if (stagnantRounds >= 5) break;
                    } else {
                        try {
                            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
                            input.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', bubbles: true }));
                        } catch (_) {}
                        await sleep(100);

                        const gotNew = found.length > beforeCount;
                        stagnantRounds = gotNew ? 0 : stagnantRounds + 1;
                        if (stagnantRounds >= 4) break;

                        if (!scrollContainer) {
                            const containers = getLikelyOpenDropdownContainers(input);
                            scrollContainer = containers.find(c => c.scrollHeight > c.clientHeight + 4) || null;
                        }
                    }
                }

                observer.disconnect();

                try {
                    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
                } catch (_) {}

                resolve(found);
            })();
        });
    }

    function openTagsDropdown() {
        const addon = findTagsAddonToggle();
        if (addon) {
            try { addon.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); } catch (_) {}
            try { addon.dispatchEvent(new MouseEvent('mouseup',  { bubbles: true, cancelable: true })); } catch (_) {}
            try { addon.click(); } catch (_) {}
        }

        const input = findTagsInput();
        if (!input) return null;

        try { input.click(); } catch (_) {}
        input.focus();

        return input;
    }

    function extractVisibleTagOptions(anchorInput = null) {
        const scopedContainers = getLikelyOpenDropdownContainers(anchorInput);
        const scopedCandidates = scopedContainers.flatMap(container =>
            Array.from(container.querySelectorAll('[role="option"], .rcx-option, .rcx-option__wrapper, .rcx-option__content, [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]'))
        );
        const options = [];

        scopedCandidates.forEach(el => {
            if (!isElementVisible(el)) return;
            const txt = extractTagTextFromOptionElement(el);
            const norm = normalizeText(txt);
            if (!txt || !norm) return;
            if (!options.some(v => normalizeText(v) === norm)) options.push(txt);
        });

        return options;
    }

    function extractTagOptionsFromAria(anchorInput) {
        if (!anchorInput) return [];
        const options = [];
        const add = (value) => {
            const txt = (value || '').toString().trim();
            const norm = normalizeText(txt);
            if (!txt || !norm) return;
            if (norm === 'tags') return;
            if (norm.includes('selecione uma opcao') || norm.includes('select an option')) return;
            if (!options.some(v => normalizeText(v) === norm)) options.push(txt);
        };

        const activeId = anchorInput.getAttribute('aria-activedescendant');
        if (activeId) {
            const activeEl = document.getElementById(activeId);
            if (activeEl) add(extractTagTextFromOptionElement(activeEl));
        }

        const listIds = [
            anchorInput.getAttribute('aria-controls'),
            anchorInput.getAttribute('aria-owns')
        ].filter(Boolean);

        listIds.forEach(id => {
            const list = document.getElementById(id);
            if (!list) return;
            const candidates = list.querySelectorAll('[role="option"], .rcx-option, .rcx-option__wrapper, .rcx-option__content, [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]');
            candidates.forEach(el => add(extractTagTextFromOptionElement(el)));
        });

        return options;
    }

    async function collectTagOptionsByKeyboardProbe(input, maxSteps = 30) {
        const options = [];
        const addUnique = (value) => {
            const txt = (value || '').toString().trim();
            const norm = normalizeText(txt);
            if (!txt || !norm) return;
            if (!options.some(v => normalizeText(v) === norm)) options.push(txt);
        };

        if (!input) return options;

        for (let i = 0; i < maxSteps; i++) {
            try {
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', bubbles: true }));
            } catch (_) {}

            await sleep(70);

            const byAria = extractTagOptionsFromAria(input);
            byAria.forEach(addUnique);
        }

        try {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
        } catch (_) {}

        return options;
    }

    function setNativeInputValue(input, value) {
        if (!input) return;
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
        if (descriptor && descriptor.set) descriptor.set.call(input, value);
        else input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function findComposerInput() {
        return document.querySelector('textarea[name="msg"]') ||
               document.querySelector('textarea[data-qa="message-box-input"]') ||
               document.querySelector('.rcx-message-box textarea') ||
               document.querySelector('[contenteditable="true"][role="textbox"]');
    }

    function findSendButton() {
        const direct = document.querySelector('button[data-qa="message-box-send"]') ||
                       document.querySelector('button[aria-label*="Send" i]') ||
                       document.querySelector('button[title*="Send" i]') ||
                       document.querySelector('.rcx-button-group__item .rcx-icon--name-send')?.closest('button') ||
                       findButtonByText(['Send', 'Enviar']);
        if (direct && !direct.disabled) return direct;

        const allButtons = Array.from(document.querySelectorAll('button'));
        for (const btn of allButtons) {
            if (btn.disabled) continue;
            const icon = btn.querySelector('i[class*="rcx-icon--name-send"]');
            if (icon) return btn;
        }

        return null;
    }

    async function sendAutoReplyMessage(message) {
        try {
            const msg = (message || '').trim();
            if (!msg) return { ok: false, message: 'mensagem automatica vazia.' };

            const input = await (async () => {
                for (let i = 0; i < 16; i++) {
                    const el = findComposerInput();
                    if (el) return el;
                    await sleep(160);
                }
                return null;
            })();

            if (!input) {
                return { ok: false, message: 'campo de mensagem nao encontrado.' };
            }

            input.focus();

            if (input.matches('textarea, input')) {
                setNativeInputValue(input, msg);
            } else {
                input.textContent = msg;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }

            await sleep(180);

            let sendBtn = null;
            for (let i = 0; i < 10; i++) {
                sendBtn = findSendButton();
                if (sendBtn && !sendBtn.disabled) break;
                await sleep(120);
            }

            if (sendBtn) {
                clickElementRobust(sendBtn);
                return { ok: true, message: 'mensagem automatica enviada.' };
            }

            try {
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
                return { ok: true, message: 'mensagem automatica enviada via enter.' };
            } catch (_) {
                return { ok: false, message: 'falha ao enviar mensagem automatica.' };
            }
        } catch (_) {
            return { ok: false, message: 'erro inesperado no auto reply.' };
        }
    }

    function findDepartmentInput() {
        // v1 (data-qa antigo)
        const legacy =
            document.querySelector('[data-qa-id="forward-to-department"] input') ||
            document.querySelector('[data-qa="autocomplete-department"] input');
        if (legacy) return legacy;

        // v2: campo e um .rcx-select generico, sem data-qa, com placeholder em PT-BR ou EN
        const byPlaceholder =
            document.querySelector('input[placeholder*="Selecione uma opção" i]') ||
            document.querySelector('input[placeholder*="Select an option" i]');
        if (byPlaceholder) return byPlaceholder;

        // fallback: dentro do modal/dialog de encaminhamento atualmente aberto,
        // procura o input de select por label proxima (Departamento/Department/Para/Forward to)
        const dialog = document.querySelector('[role="dialog"]:not(.rcx-vertical-bar)') ||
                       document.querySelector('.rcx-modal, [class*="modal" i]') ||
                       document.querySelector('form');
        if (dialog) {
            const labels = Array.from(dialog.querySelectorAll('label'));
            const deptLabel = labels.find(l => {
                const t = normalizeText(l.textContent || '');
                return t.includes('departamento') || t.includes('department') || t.includes('para') || t.includes('to');
            });
            if (deptLabel) {
                const scope = deptLabel.closest('.rcx-field') || deptLabel.closest('.rcx-field-group') || deptLabel.parentElement;
                const input = scope?.querySelector('.rcx-select input, input[aria-haspopup="listbox"], input');
                if (input) return input;
            }
            // fallback final: primeiro .rcx-select do dialog (formulario de encaminhar so tem 1 campo de selecao)
            const anySelect = dialog.querySelector('.rcx-select input, [role="listbox"] input, input[aria-haspopup="listbox"]');
            if (anySelect) return anySelect;
        }

        return document.querySelector('.rcx-select input[aria-haspopup="listbox"]') ||
               document.querySelector('input[aria-haspopup="listbox"]');
    }

    function findOptionByText(words) {
        const tokens = (words || []).map(w => normalizeText(w));
        const candidates = Array.from(document.querySelectorAll('[role="option"], [role="listbox"] [id], .rcx-option, .rcx-option__wrapper, .rcx-option__content, [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]'));
        for (const el of candidates) {
            const txt = normalizeText(el.textContent || '');
            if (tokens.some(t => t && txt === t)) return el;
        }
        for (const el of candidates) {
            const txt = normalizeText(el.textContent || '');
            if (tokens.some(t => t && txt.includes(t))) return el;
        }
        return null;
    }

    function getClickableOptionNode(el) {
        if (!el) return null;
        return el.closest('[role="option"], [role="menuitemcheckbox"], [role="menuitemradio"], .rcx-option, .rcx-option__wrapper') || el;
    }

    function hasSelectedTag(tag) {
        const target = normalizeText(tag || '');
        if (!target) return false;
        return extractSelectedTags().some((value) => normalizeText(value) === target);
    }

    function clickElementRobust(el) {
        if (!el) return;
        try { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); } catch (_) {}
        try { el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); } catch (_) {}
        try { el.click(); } catch (_) {}
    }

    async function openNpsForwardFlow() {
        try {
            const clickedForward = await clickWithRetries(findForwardChatButton, 14, 250);

            if (!clickedForward) {
                return { ok: false, message: 'botao forward chat nao encontrado.' };
            }

            await sleep(450);

            const deptInputReady = await clickWithRetries(() => {
                const input = findDepartmentInput();
                if (!input) return null;
                return input;
            }, 16, 250);

            if (!deptInputReady) {
                return { ok: false, message: 'seletor de departamento nao encontrado.' };
            }

            const deptInput = findDepartmentInput();
            if (!deptInput) {
                return { ok: false, message: 'campo de departamento nao encontrado.' };
            }

            deptInput.click();
            deptInput.focus();
            setNativeInputValue(deptInput, 'nps');

            try {
                deptInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
                deptInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', bubbles: true }));
            } catch (_) {}

            await sleep(500);

            const selectedNps = await (async () => {
                for (let i = 0; i < 24; i++) {
                    const option = findOptionByText(['nps']) || findMenuOptionByText(['nps']);
                    if (option) clickElementRobust(option);

                    const currentInput = findDepartmentInput();
                    const currentValue = normalizeText(currentInput ? currentInput.value : '');
                    const selectRoot = currentInput ? (currentInput.closest('.rcx-select') || currentInput.closest('[class*="select" i]')) : null;
                    const hasSelectedBadge = !!(selectRoot && selectRoot.querySelector('[class*="tag" i], [class*="selected" i], [class*="chip" i]'));
                    if (currentValue.includes('nps') || hasSelectedBadge) return true;

                    if (currentInput) {
                        currentInput.focus();
                        try {
                            currentInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                            currentInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
                        } catch (_) {}
                    }

                    await sleep(180);
                }
                return false;
            })();

            if (!selectedNps) {
                return { ok: false, message: 'opcao nps nao encontrada.' };
            }

            await sleep(350);

            const finalButton = findForwardConfirmButton();

            if (finalButton) {
                clickElementRobust(finalButton);
                await sleep(300);
            }

            return { ok: true, message: 'encaminhamento para nps executado.' };
        } catch (_) {
            return { ok: false, message: 'falha inesperada ao encaminhar para nps.' };
        }
    }

    async function openFilaForwardFlow() {
        try {
            const clickedForward = await clickWithRetries(findForwardChatButton, 14, 250);

            if (!clickedForward) {
                return { ok: false, message: 'botao forward chat nao encontrado.' };
            }

            await sleep(450);

            const deptInputReady = await clickWithRetries(() => {
                const input = findDepartmentInput();
                if (!input) return null;
                return input;
            }, 16, 250);

            if (!deptInputReady) {
                return { ok: false, message: 'seletor de departamento nao encontrado.' };
            }

            const deptInput = findDepartmentInput();
            if (!deptInput) {
                return { ok: false, message: 'campo de departamento nao encontrado.' };
            }

            deptInput.click();
            deptInput.focus();
            setNativeInputValue(deptInput, 'fila de espera');

            try {
                deptInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
                deptInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', bubbles: true }));
            } catch (_) {}

            await sleep(500);

            const selectedFila = await (async () => {
                const terms = ['fila de espera', 'fila espera', 'fila'];
                for (let i = 0; i < 24; i++) {
                    const option = findOptionByText(terms) || findMenuOptionByText(terms);
                    if (option) clickElementRobust(option);

                    const currentInput = findDepartmentInput();
                    const currentValue = normalizeText(currentInput ? currentInput.value : '');
                    const selectRoot = currentInput ? (currentInput.closest('.rcx-select') || currentInput.closest('[class*="select" i]')) : null;
                    const hasSelectedBadge = !!(selectRoot && selectRoot.querySelector('[class*="tag" i], [class*="selected" i], [class*="chip" i]'));
                    if (currentValue.includes('fila') || hasSelectedBadge) return true;

                    if (currentInput) {
                        currentInput.focus();
                        try {
                            currentInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                            currentInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
                        } catch (_) {}
                    }

                    await sleep(180);
                }
                return false;
            })();

            if (!selectedFila) {
                return { ok: false, message: 'opcao fila de espera nao encontrada.' };
            }

            await sleep(350);

            const finalButton = findForwardConfirmButton();

            if (finalButton) {
                clickElementRobust(finalButton);
                await sleep(300);
            }

            return { ok: true, message: 'encaminhamento para fila de espera executado.' };
        } catch (_) {
            return { ok: false, message: 'falha inesperada ao encaminhar para fila de espera.' };
        }
    }

    async function openAbandonoFlow() {
        try {
            const clickedForward = await clickWithRetries(findForwardChatButton, 14, 250);

            if (!clickedForward) {
                return { ok: false, message: 'botao forward chat nao encontrado.' };
            }

            await sleep(450);

            const deptInputReady = await clickWithRetries(() => {
                const input = findDepartmentInput();
                if (!input) return null;
                return input;
            }, 16, 250);

            if (!deptInputReady) {
                return { ok: false, message: 'seletor de departamento nao encontrado.' };
            }

            const deptInput = findDepartmentInput();
            if (!deptInput) {
                return { ok: false, message: 'campo de departamento nao encontrado.' };
            }

            deptInput.click();
            deptInput.focus();
            setNativeInputValue(deptInput, 'fila de abandono - atendimento humano');

            try {
                deptInput.dispatchEvent(new Event('input', { bubbles: true }));
                deptInput.dispatchEvent(new Event('change', { bubbles: true }));
            } catch (_) {}

            return { ok: true, message: 'campo de abandono preenchido. confirmacao manual pendente.' };
        } catch (_) {
            return { ok: false, message: 'falha inesperada ao preencher abandono.' };
        }
    }

    async function openManualTabulationArea() {
        try {
            // se o painel contextual ja estiver mostrando Informacoes da Sala ou Editar Sala,
            // nao clica de novo no botao "Informações da Sala" (ele funciona como toggle e fecharia o painel)
            const existingTitle = normalizeText(findContextualBarTitle()?.textContent || '');
            const alreadyOnInfoOrEdit = isInfoPanelTitle(existingTitle) || isEditPanelTitle(existingTitle);

            let clickedInfo = alreadyOnInfoOrEdit;

            if (!clickedInfo) {
                // v2: "Informações da Sala" fica direto na toolbar principal da conversa,
                // sem precisar abrir o menu "Opções" (kebab) antes. Tenta direto primeiro.
                clickedInfo = await clickWithRetries(findRoomInfoMenuOption, 4, 200);
            }

            if (!clickedInfo) {
                // v1: fallback - abre o menu "Opções" (kebab) e entao clica em "Informações da Sala"
                const clickedOptions = await clickWithRetries(findToolboxOptionsButton);
                if (!clickedOptions) {
                    return { ok: false, message: 'botao opcoes/informacoes da sala nao encontrado.' };
                }

                await sleep(250);

                clickedInfo = await clickWithRetries(findRoomInfoMenuOption);
                if (!clickedInfo) {
                    return { ok: false, message: 'botao informacoes da sala nao encontrado.' };
                }
            }

            await sleep(350);

            // se ja estiver no painel de Editar Sala, nao precisa clicar em Editar de novo
            const titleAfterInfo = normalizeText(findContextualBarTitle()?.textContent || '');
            const clickedEdit = isEditPanelTitle(titleAfterInfo)
                ? true
                : await clickWithRetries(findRoomEditButton);

            if (!clickedEdit) {
                return { ok: false, message: 'botao editar nao encontrado.' };
            }

            await sleep(450);

            const foundTags = await (async () => {
                for (let i = 0; i < 16; i++) {
                    const tagsLabel = findTagsLabel();
                    const tagsAddon = findTagsAddonToggle();
                    if (tagsLabel || tagsAddon) {
                        (tagsLabel || tagsAddon).scrollIntoView({ behavior: 'smooth', block: 'center' });
                        return true;
                    }
                    const contextual = document.querySelector('.rcx-vertical-bar, [data-qa="Contextualbar"], [role="complementary"]');
                    if (contextual) contextual.scrollTop += 220;
                    else window.scrollBy(0, 220);
                    await sleep(180);
                }
                return false;
            })();

            if (!foundTags) {
                return { ok: false, message: 'campo tags nao encontrado apos abrir editar.' };
            }

            return { ok: true, message: 'area de tabulacao aberta em tags.' };
        } catch (_) {
            return { ok: false, message: 'erro inesperado ao abrir area de tabulacao.' };
        }
    }

    function isManualTabulationAreaVisible() {
        const contextualBar = document.querySelector('.rcx-vertical-bar, [data-qa="Contextualbar"], [role="dialog"], [role="complementary"]');
        if (!contextualBar || !isElementVisible(contextualBar)) return false;

        const tagsInput = findTagsInput();
        const tagsLabel = findTagsLabel();
        if (tagsInput && isElementVisible(tagsInput)) return true;
        if (tagsLabel && isElementVisible(tagsLabel)) return true;

        const title = normalizeText(contextualBar.textContent || '');
        return title.includes('editar sala') || title.includes('edit room');
    }

    async function applyTagsFromParent(tagsList) {
        manualTabulationInProgress = true;
        try {
            const tags = Array.isArray(tagsList)
                ? tagsList.map(v => (v || '').toString().trim()).filter(Boolean)
                : [];

            if (!tags.length) {
                return { ok: false, message: 'nenhuma tag informada.' };
            }

            const openArea = await openManualTabulationArea();
            if (!openArea.ok) return openArea;

            const applied = [];

            for (const tag of tags) {
                const inputReady = await clickWithRetries(() => {
                    const input = findTagsInput();
                    if (!input) return null;
                    return input;
                }, 16, 180);

                if (!inputReady) continue;

                const input = findTagsInput();
                if (!input) continue;

                openTagsDropdown();
                setNativeInputValue(input, tag);
                await sleep(220);

                let selected = false;
                for (let i = 0; i < 18; i++) {
                    const opt = findOptionByText([tag]) || findMenuOptionByText([tag]);
                    if (opt) {
                        clickElementRobust(getClickableOptionNode(opt));
                        await sleep(180);
                        if (hasSelectedTag(tag)) {
                            selected = true;
                            break;
                        }
                    }

                    try {
                        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
                    } catch (_) {}

                    await sleep(140);

                    if (hasSelectedTag(tag)) {
                        selected = true;
                        break;
                    }

                    if (i < 17) {
                        openTagsDropdown();
                        setNativeInputValue(input, tag);
                    }
                }

                if (selected) applied.push(tag);

                await sleep(120);
            }

            if (!applied.length) {
                return { ok: false, message: 'nao foi possivel selecionar as tags.' };
            }

            await sleep(450);

            const findSaveButton = () => {
                const contextualBar = document.querySelector('.rcx-vertical-bar, [data-qa="Contextualbar"], [role="dialog"], [role="complementary"]');
                const buttons = Array.from((contextualBar || document).querySelectorAll('button'));
                return buttons.find((btn) => {
                    const text = normalizeText(btn.textContent || '');
                    return text === 'salvar' || text === 'save' || text.includes('salvar') || text.includes('save');
                }) || null;
            };

            let saveBtn = null;
            for (let i = 0; i < 20; i++) {
                saveBtn = findSaveButton();
                if (saveBtn) break;
                await sleep(180);
            }

            if (!saveBtn) {
                return { ok: false, message: 'botao salvar nao encontrado.' };
            }

            if (saveBtn.disabled || saveBtn.getAttribute('aria-disabled') === 'true') {
                try { saveBtn.disabled = false; } catch (_) {}
                try { saveBtn.removeAttribute('disabled'); } catch (_) {}
                try { saveBtn.setAttribute('aria-disabled', 'false'); } catch (_) {}
            }

            clickElementRobust(saveBtn);
            await sleep(700);

            // O Rocket pode fechar/trocar o painel sozinho apos salvar.
            // Monitora por alguns segundos e reabre a area de tags sempre que necessario,
            // ate garantir que ela fique visivel e estavel.
            for (let i = 0; i < 6; i++) {
                if (isManualTabulationAreaVisible()) break;
                await openManualTabulationArea();
                await sleep(400);
            }

            return { ok: true, message: 'tags marcadas e salvar acionado.', tags: applied };
        } catch (_) {
            return { ok: false, message: 'erro inesperado ao aplicar tags.' };
        } finally {
            setTimeout(() => { manualTabulationInProgress = false; }, 1200);
        }
    }

    async function fetchTagOptionsFromParent() {
        manualTabulationInProgress = true;
        try {
            const openArea = await openManualTabulationArea();
            if (!openArea.ok) return openArea;

            const inputReady = await clickWithRetries(() => {
                const input = findTagsInput();
                if (!input) return null;
                return input;
            }, 16, 180);

            if (!inputReady) {
                return { ok: false, message: 'campo de tags nao encontrado.' };
            }

            const input = findTagsInput();
            if (!input) {
                return { ok: false, message: 'campo de tags nao encontrado.' };
            }

            // captura completa (com rolagem) — pega todas as opções, mesmo em lista virtualizada
            let options = await harvestAllTagOptions(input, { maxScrolls: 26 });

            // fallback ARIA se nada foi capturado
            if (!options.length) {
                await sleep(200);
                openTagsDropdown();
                await sleep(400);
                const ariaOpts = extractTagOptionsFromAria(input);
                ariaOpts.forEach(t => {
                    if (!options.some(v => normalizeText(v) === normalizeText(t))) options.push(t);
                });
            }

            // fechar o dropdown antes de retornar
            try {
                if (input) {
                    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                    input.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Escape', bubbles: true }));
                }
            } catch (_) {}

            const selectedTags = extractSelectedTags();

            return {
                ok: true,
                message: options.length ? 'opcoes de tags carregadas.' : 'nenhuma opcao visivel encontrada.',
                options,
                tags: selectedTags
            };
        } catch (_) {
            return { ok: false, message: 'erro inesperado ao buscar opcoes de tags.' };
        } finally {
            setTimeout(() => { manualTabulationInProgress = false; }, 1200);
        }
    }

    // chat removido

    function detectRemovedChats() {
        const currentChats = extractSidebarChats();
        const now = Date.now();

        if (currentChats.length === 0 && previousChatList.length > 0) {
            sidebarEmptyReadStreak++;
            if (sidebarEmptyReadStreak < MAX_EMPTY_READ_STREAK) return previousChatList;
        } else {
            sidebarEmptyReadStreak = 0;
        }

        const currentNames = currentChats.map(c => c.nome);

        previousChatList.forEach(prev => {
            if (!currentNames.includes(prev.nome)) {
                if (!missingChatsSince[prev.nome]) {
                    missingChatsSince[prev.nome] = now;
                    return;
                }
                if ((now - missingChatsSince[prev.nome]) >= CHAT_REMOVAL_GRACE_MS) {
                    window.parent.postMessage({
                        type: 'ROCKETCHAT_CHAT_REMOVED',
                        source: 'firewall-extension',
                        data: { nome: prev.nome }
                    }, '*');
                    delete missingChatsSince[prev.nome];
                }
            } else {
                delete missingChatsSince[prev.nome];
            }
        });

        currentNames.forEach(name => { delete missingChatsSince[name]; });

        previousChatList = currentChats;
        return currentChats;
    }

    // envia dados

    function getAgentStatusFromDom() {
        // v1: <svg role="status" aria-label="online">
        const scoped = document.querySelector('.rcx-sidebar-header svg[role="status"][aria-label]');
        if (scoped) {
            const label = (scoped.getAttribute('aria-label') || '').toLowerCase();
            if (label) return label;
        }
        const anyLabeled = document.querySelectorAll('svg[role="status"][aria-label]');
        for (const svg of anyLabeled) {
            const label = (svg.getAttribute('aria-label') || '').toLowerCase();
            if (label === 'online' || label === 'away' || label === 'busy' || label === 'offline') return label;
        }

        // v2: role="status" fica na div externa, e o status vira classe do svg interno
        // ex: <div role="status"><svg class="rcx-status-bullet rcx-status-bullet--online ..."></svg></div>
        const statusBullets = document.querySelectorAll('.rcx-status-bullet, [class*="rcx-status-bullet--"]');
        for (const el of statusBullets) {
            const cls = el.className || '';
            const m = /rcx-status-bullet--(online|away|busy|offline)/.exec(cls);
            if (m) return m[1];
        }

        return 'offline';
    }

    function sendUpdate() {
        const sidebarChats = isMainFrame ? detectRemovedChats() : extractSidebarChats();
        const activeChatName = getActiveChatName();
        if (isMainFrame) extractAvatarLetter();

        const agentStatus = getAgentStatusFromDom();

        // le o toggle de omnichannel de forma resiliente (janela larga ou estreita/kebab),
        // sem nunca abrir o menu kebab visualmente durante o polling passivo.
        const omniActive = getOmnichannelStateResilient();


        const payload = {
            type: 'ROCKETCHAT_BRIDGE_UPDATE',
            source: 'firewall-extension',
            frameUrl: window.location.href,
            timestamp: Date.now(),
            data: { sidebarChats, activeChatName, agentStatus, omniActive }
        };

        const json = JSON.stringify(payload.data);
        if (json === lastSentJSON) return;
        lastSentJSON = json;

        window.parent.postMessage(payload, '*');

        if (sidebarChats.length > 0) {
        }
    }

    // listener

    window.addEventListener('message', async (event) => {
        if (!event.data || event.data.source !== 'firewall-parent') return;

        if (event.data.type === 'DATA_REQUEST') {
            lastSentJSON = '';
            sendUpdate();
        }

        if (event.data.type === 'OPEN_MANUAL_TABULATION') {
            manualTabulationInProgress = true;
            let result;
            try {
                result = await openManualTabulationArea();
            } finally {
                setTimeout(() => { manualTabulationInProgress = false; }, 1200);
            }
            window.parent.postMessage({
                type: 'ROCKETCHAT_TAB_OPEN_RESULT',
                source: 'firewall-extension',
                ok: !!result.ok,
                message: result.message || ''
            }, '*');
            return;
        }

        if (event.data.type === 'SEND_AUTO_REPLY') {
            const result = await sendAutoReplyMessage(event.data.message || '');
            window.parent.postMessage({
                type: 'ROCKETCHAT_AUTO_REPLY_RESULT',
                source: 'firewall-extension',
                ok: !!result.ok,
                message: result.message || ''
            }, '*');
            return;
        }

        if (event.data.type === 'OPEN_NPS_FORWARD') {
            const result = await openNpsForwardFlow();
            window.parent.postMessage({
                type: 'ROCKETCHAT_NPS_RESULT',
                source: 'firewall-extension',
                ok: !!result.ok,
                message: result.message || ''
            }, '*');
            return;
        }

        if (event.data.type === 'OPEN_FILA_FORWARD') {
            const result = await openFilaForwardFlow();
            window.parent.postMessage({
                type: 'ROCKETCHAT_FILA_RESULT',
                source: 'firewall-extension',
                ok: !!result.ok,
                message: result.message || ''
            }, '*');
            return;
        }

        if (event.data.type === 'OPEN_ABANDONO_FLOW') {
            const result = await openAbandonoFlow();
            window.parent.postMessage({
                type: 'ROCKETCHAT_ABANDONO_RESULT',
                source: 'firewall-extension',
                ok: !!result.ok,
                message: result.message || ''
            }, '*');
            return;
        }

        if (event.data.type === 'OPEN_APPLY_TAGS') {
            const result = await applyTagsFromParent(event.data.tags || []);
            window.parent.postMessage({
                type: 'ROCKETCHAT_APPLY_TAGS_RESULT',
                source: 'firewall-extension',
                ok: !!result.ok,
                message: result.message || '',
                tags: result.tags || []
            }, '*');
            return;
        }

        if (event.data.type === 'OPEN_FETCH_TAG_OPTIONS') {
            const result = await fetchTagOptionsFromParent();
            window.parent.postMessage({
                type: 'ROCKETCHAT_FETCH_TAG_OPTIONS_RESULT',
                source: 'firewall-extension',
                requestId: event.data.requestId || null,
                ok: !!result.ok,
                message: result.message || '',
                options: result.options || [],
                tags: result.tags || []
            }, '*');
            return;
        }

        if (event.data.type === 'OPEN_CHAT_BY_NAME') {
            const chatName = (event.data.chatName || '').trim();
            const chatUrl = (event.data.chatUrl || '').trim();
            if (!chatName) return;
            let tries = 0;
            let navigatedByUrl = false;
            const targetNorm = normalizeText(chatName);
            const tryOpen = setInterval(() => {
                tries++;
                const titleElements = document.querySelectorAll(SIDEBAR_ITEM_TITLE_SELECTOR);
                for (let titleEl of titleElements) {
                    const currentName = (titleEl.textContent || '').trim();
                    const exact = currentName === chatName;
                    const tolerant = normalizeText(currentName) === targetNorm;
                    if (exact || tolerant) {
                        const linkEl = titleEl.closest('a[href]');
                        if (linkEl) {
                            linkEl.click();
                            clearInterval(tryOpen);
                            setTimeout(() => { lastSentJSON = ''; sendUpdate(); }, 400);
                            setTimeout(() => {
                                const closeBtn = document.querySelector('[data-qa="SidebarHeaderActionClose"]') || 
                                               document.querySelector('[data-qa="ContextualbarActionClose"]') ||
                                               document.querySelector('button[aria-label*="Close" i]');
                                if (closeBtn) {
                                    closeBtn.click();
                                }
                            }, 600);
                            return;
                        }
                    }
                }

                if (!navigatedByUrl && chatUrl && tries >= 8) {
                    navigatedByUrl = true;
                    try {
                        const abs = new URL(chatUrl, window.location.origin).href;
                        if (window.location.href !== abs) {
                            window.location.href = abs;
                        }
                    } catch (_) {}
                }

                if (tries >= 40) {
                    clearInterval(tryOpen);
                }
            }, 300);
        }

        if (event.data.type === 'TOGGLE_OMNICHANNEL') {
            // acao explicita do usuario: pode abrir o kebab se precisar (nao e polling passivo)
            toggleOmnichannelResilient(() => { lastSentJSON = ''; sendUpdate(); });
        }
    });

    // inicializacao

    window.parent.postMessage({
        type: 'ROCKETCHAT_BRIDGE_READY',
        source: 'firewall-extension',
        frameUrl: window.location.href,
        timestamp: Date.now()
    }, '*');

    // envio periodico
    setInterval(() => { lastSentJSON = ''; }, 30000);

    if (isMainFrame) {
        // frame main
        setInterval(() => {
            sendUpdate();
            autoDetectAndExtract();
        }, SCAN_INTERVAL);

        setTimeout(sendUpdate, 2000);

    } else if (isSlotFrame) {
        // frame slot
        setInterval(() => {
            autoDetectAndExtract();
            sendSlotSignal();
        }, SCAN_INTERVAL);

        setTimeout(sendSlotSignal, 900);

    } else {
        // frame outro
        setInterval(() => {
            sendUpdate();
            autoDetectAndExtract();
        }, SCAN_INTERVAL);

        setTimeout(sendUpdate, 2000);
    }

})();
