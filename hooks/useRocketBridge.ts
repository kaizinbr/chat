"use client";

import { useEffect, useRef } from "react";
import {
    frameIsLoaded,
    frameKeyFromSource,
    getFrame,
    openChatInSlotFrame,
    postTo,
} from "@/lib/bridge/frames";
import { isFromExtension } from "@/lib/bridge/protocol";
import {
    MSG_SOURCE_PARENT,
    ROCKET_ORIGIN,
    TIMING,
} from "@/lib/config";
import { audio } from "@/lib/audio";
import { loadFluxosFromServer } from "@/lib/fluxos";
import { ensureRocketFrameOnline, firewall } from "@/store/firewall";

const requestSidebar = () =>
    postTo("rocket", { source: MSG_SOURCE_PARENT, type: "DATA_REQUEST" });

/**
 * Único listener de mensagens da extensão. Também mantém a bridge acordada
 * (warmup + keep-alive), reabre os slots restaurados e roda a automação de
 * mensagens não lidas. Deve ser montado uma única vez em AppShell.
 */
export function useRocketBridge() {
    const badgesRef = useRef<Record<number, number>>({});
    const attentionRef = useRef(false);

    useEffect(() => {
        const store = firewall.getState();

        // 1) Cache local (slots, histórico, mensagens e preferências).
        const restored = store.hydrate();
        const restoredTimer = window.setTimeout(() => {
            for (const item of restored) {
                openChatInSlotFrame(item.id, item.nome, item.chatUrl);
            }
        }, TIMING.RESTORED_SLOT_OPEN_DELAY_MS);

        let warmupTimer: number | null = null;
        let warmupAttempts = 0;
        let lastMainBridgeUpdateAt = 0;
        let mainBridgeStaleHits = 0;
        let lastRocketForceReloadAt = 0;

        function stopWarmup() {
            if (warmupTimer !== null) {
                window.clearInterval(warmupTimer);
                warmupTimer = null;
            }
        }

        function startWarmup() {
            if (warmupTimer !== null) return;
            warmupAttempts = 0;
            warmupTimer = window.setInterval(() => {
                warmupAttempts += 1;
                ensureRocketFrameOnline(false);
                requestSidebar();

                if (
                    firewall.getState().bridgeActive ||
                    warmupAttempts >= TIMING.BRIDGE_WARMUP_MAX_ATTEMPTS
                ) {
                    stopWarmup();
                }
            }, TIMING.BRIDGE_WARMUP_INTERVAL_MS);
        }

        function forceReloadRocket() {
            const now = Date.now();
            if (
                now - lastRocketForceReloadAt <
                TIMING.ROCKET_FORCE_RELOAD_BACKOFF_MS
            ) {
                return;
            }
            lastRocketForceReloadAt = now;
            ensureRocketFrameOnline(true);
        }

        function reopenSlots(
            items: { id: number; nome: string; chatUrl: string | null }[],
        ) {
            if (!items.length) return;
            // Deixa o React aplicar o novo state/frameSrc antes de falar com
            // o content.js dentro do iframe.
            window.setTimeout(() => {
                for (const item of items) {
                    openChatInSlotFrame(item.id, item.nome, item.chatUrl);
                }
            }, 50);
        }

        function onMessage(event: MessageEvent) {
            if (event.origin !== ROCKET_ORIGIN) return;
            if (!isFromExtension(event.data)) return;

            const message = event.data;
            const current = firewall.getState();
            const from = frameKeyFromSource(event.source, current.maxSlots);

            switch (message.type) {
                case "ROCKETCHAT_BRIDGE_READY": {
                    current.setBridgeActive();
                    mainBridgeStaleHits = 0;
                    stopWarmup();
                    if (from === "rocket") {
                        lastMainBridgeUpdateAt = Date.now();
                    }
                    // Se um iframe de slot terminou de carregar, garante que
                    // ele abra o atendimento correto (o SPA pode perder o
                    // primeiro OPEN_CHAT_BY_NAME).
                    // if (
                    //     typeof from === "number" &&
                    //     current.slots[from] &&
                    //     frameIsLoaded(getFrame(from))
                    // ) {
                    //     const slot = current.slots[from]!;
                    //     openChatInSlotFrame(
                    //         from,
                    //         slot.nome,
                    //         slot.chatUrl,
                    //     );
                    // }
                    break;
                }

                case "ROCKETCHAT_BRIDGE_UPDATE": {
                    current.setBridgeActive();
                    mainBridgeStaleHits = 0;
                    const data = message.data;

                    current.setAgent({
                        agentStatus: data.agentStatus,
                        omniActive: data.omniActive,
                    });

                    if (from === "rocket" && data.sidebarChats) {
                        lastMainBridgeUpdateAt = Date.now();
                        if (
                            data.sidebarChats.length > 0 ||
                            !!data.agentStatus
                        ) {
                            current.setMainSidebarReady();
                        }

                        const result = current.applySidebar(
                            data.sidebarChats,
                        );
                        reopenSlots(result.reopen);
                    }
                    break;
                }

                case "ROCKETCHAT_BRIDGE_DETAILS":
                    current.applyDetails(message.data);
                    break;

                case "ROCKETCHAT_SLOT_SIGNAL":
                    if (typeof from === "number") {
                        current.applySignal(from, message.data);
                    }
                    break;

                case "ROCKETCHAT_CHAT_REMOVED":
                    if (from === "rocket") {
                        current.releaseByName(message.data.nome);
                    }
                    break;

                case "ROCKETCHAT_AVATAR_LETTER":
                    if (message.data.avatarUrl) {
                        current.setAvatarUrl(message.data.avatarUrl);
                    }
                    break;

                // Resultados de comandos são resolvidos pelo sendCommand()
                // no componente que disparou a ação.
                default:
                    break;
            }
        }

        // 2) Frame principal: recarregar/reconectar quando o Rocket navega.
        const rocketFrame = getFrame("rocket");
        function onMainFrameLoad() {
            const state = firewall.getState();
            state.setBridgeConnected(false);
            mainBridgeStaleHits = 0;
            lastMainBridgeUpdateAt = 0;
            requestSidebar();
            window.setTimeout(requestSidebar, 700);
            startWarmup();
        }
        rocketFrame?.addEventListener("load", onMainFrameLoad);

        // 3) Sincroniza áudio/badges com o store (uma única assinatura).
        const unsubscribe = firewall.subscribe(() => {
            const state = firewall.getState();
            const previous = badgesRef.current;
            const next: Record<number, number> = {};

            for (let id = 1; id <= state.maxSlots; id++) {
                const slot = state.slots[id];
                const count = Number(slot?.badgeCount || 0);
                next[id] = count;
                if (count > (previous[id] ?? 0) && state.bootComplete) {
                    audio.playNotification();
                }
            }
            badgesRef.current = next;

            const attention = Object.values(state.runtime).some(
                (item) => item?.attention,
            );
            if (attention !== attentionRef.current) {
                attentionRef.current = attention;
            }
            audio.syncAttention(attention);
        });

        // 4) Rotinas de fundo do painel original.
        window.addEventListener("message", onMessage);

        ensureRocketFrameOnline(false);
        requestSidebar();
        startWarmup();
        void loadFluxosFromServer();

        const sidebarTimer = window.setInterval(
            requestSidebar,
            TIMING.SIDEBAR_REQUEST_INTERVAL_MS,
        );

        const keepAliveTimer = window.setInterval(() => {
            const isHidden = document.hidden;
            const staleThreshold = isHidden
                ? TIMING.BRIDGE_MAIN_STALE_HIDDEN_MS
                : TIMING.BRIDGE_MAIN_STALE_VISIBLE_MS;
            const stale =
                !lastMainBridgeUpdateAt ||
                Date.now() - lastMainBridgeUpdateAt > staleThreshold;

            if (stale) {
                mainBridgeStaleHits += 1;
                if (
                    !isHidden &&
                    mainBridgeStaleHits >=
                        TIMING.BRIDGE_FORCE_RELOAD_MIN_STALE_HITS
                ) {
                    forceReloadRocket();
                } else {
                    ensureRocketFrameOnline(false);
                    requestSidebar();
                }
                if (!firewall.getState().bridgeActive) startWarmup();
            } else {
                mainBridgeStaleHits = 0;
                ensureRocketFrameOnline(false);
            }
        }, TIMING.KEEP_ALIVE_INTERVAL_MS);

        const unreadTimer = window.setInterval(
            () => firewall.getState().runUnreadAutomation(),
            TIMING.UNREAD_AUTOMATION_INTERVAL_MS,
        );

        function onVisibilityChange() {
            if (document.hidden) return;
            ensureRocketFrameOnline(false);
            requestSidebar();
            window.setTimeout(requestSidebar, 800);
            if (!firewall.getState().bridgeActive) startWarmup();
        }
        document.addEventListener("visibilitychange", onVisibilityChange);

        return () => {
            window.clearTimeout(restoredTimer);
            stopWarmup();
            window.clearInterval(sidebarTimer);
            window.clearInterval(keepAliveTimer);
            window.clearInterval(unreadTimer);
            window.removeEventListener("message", onMessage);
            document.removeEventListener(
                "visibilitychange",
                onVisibilityChange,
            );
            rocketFrame?.removeEventListener("load", onMainFrameLoad);
            unsubscribe();
        };
    }, []);
}
