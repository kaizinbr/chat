"use client";

import { useEffect, useState } from "react";
import { useNow } from "@/hooks/useNow";
import { useWindowLayout } from "@/hooks/useWindowLayout";
import { postTo, getFrame, frameIsLoaded } from "@/lib/bridge/frames";
import { sendCommand } from "@/lib/bridge/protocol";
import { copyText } from "@/lib/clipboard";
import { ROCKET_ORIGIN, TIMING, slotFrameName } from "@/lib/config";
import { formatCountdown, formatDuration, getToday, timerPalette } from "@/lib/format";
import { attendanceStats } from "@/lib/history";
import type { FinalStatus } from "@/lib/history";
import { fwAlert } from "@/lib/modal";
import { useFirewall } from "@/store/firewall";
import { TagPicker } from "./tag-picker";

type FinalizeKind = "nps" | "fila" | "abandono";

const FINALIZE: Record<
    FinalizeKind,
    {
        command: "OPEN_NPS_FORWARD" | "OPEN_FILA_FORWARD" | "OPEN_ABANDONO_FLOW";
        status: FinalStatus;
        motivo: string;
        includeTma: boolean;
        label: string;
    }
> = {
    nps: {
        command: "OPEN_NPS_FORWARD",
        status: "resolvido",
        motivo: "",
        includeTma: true,
        label: "NPS",
    },
    fila: {
        command: "OPEN_FILA_FORWARD",
        status: "fila",
        motivo: "fila de espera",
        includeTma: false,
        label: "fila",
    },
    abandono: {
        command: "OPEN_ABANDONO_FLOW",
        status: "abandono",
        motivo: "abandono",
        includeTma: false,
        label: "abandono",
    },
};

export function SlotWindow({ id }: { id: number }) {
    const slot = useFirewall((state) => state.slots[id]);
    const open = useFirewall((state) => !!state.windowOpen[id]);
    const pendingFinalize = useFirewall(
        (state) => !!state.meta[id]?.finalizeRequestedAt,
    );
    const runtime = useFirewall((state) => state.runtime[id]);
    const prompt = useFirewall((state) => state.prompts[id]);
    const history = useFirewall((state) => state.history);

    const patchSlot = useFirewall((state) => state.patchSlot);
    const setWindowOpen = useFirewall((state) => state.setWindowOpen);
    const setFinalizeRequested = useFirewall(
        (state) => state.setFinalizeRequested,
    );
    const saveHistory = useFirewall((state) => state.saveHistory);
    const clearPrompt = useFirewall((state) => state.clearPrompt);
    const snoozeUnread = useFirewall((state) => state.snoozeUnread);
    const setPrompt = useFirewall((state) => state.setPrompt);
    const pendingMessages = useFirewall((state) => state.pendingMessages);

    const [dataOpen, setDataOpen] = useState(true);
    const now = useNow(1000);
    const {
        layout,
        windowRef,
        onHeaderMouseDown,
        bringToFront,
        zIndex,
    } = useWindowLayout({
        storageKey: "chat_slot_layouts",
        layoutId: String(id),
        defaultPosition: { top: 80 + id * 60, left: 300 + id * 80 },
        defaultSize: {
            width: 460,
            height: 620,
        },
        minSize: { width: 300, height: 400 },
        resizeSelector: ".chat-window",
    });

    useEffect(() => {
        if (!prompt) return;
        const timer = window.setTimeout(() => {
            clearPrompt(id);
        }, TIMING.AUTO_PROMPT_VISIBLE_MS);
        return () => window.clearTimeout(timer);
    }, [clearPrompt, id, prompt, prompt?.at]);

    const elapsed = slot && now > 0 ? Math.max(0, now - slot.openedAt) : 0;
    const palette = timerPalette(elapsed);
    const timerText = formatDuration(elapsed);
    const attention = !!runtime?.attention;
    const snoozedUntil = runtime?.snoozedUntil ?? 0;
    const snoozedRemaining = Math.max(0, snoozedUntil - now);
    const unreadSince = runtime?.unreadSince ?? 0;
    const unreadElapsed =
        unreadSince && now > 0 ? Math.max(0, now - unreadSince) : 0;
    const stats = attendanceStats(
        history,
        slot?.nome ?? "",
        now > 0 ? getToday(now) : "",
    );
    const rechamadas = Math.max(0, stats.today - 1);

    function requireOpenFrame() {
        const frame = getFrame(id);
        if (!slot || !frameIsLoaded(frame)) {
            void fwAlert("❌ Chat do slot não está aberto.");
            return null;
        }
        return frame;
    }

    function sendQuickReply(message: string) {
        const msg = message.trim();
        if (!msg) return;
        postTo(id, {
            source: "firewall-parent",
            type: "SEND_AUTO_REPLY",
            message: msg,
        });
        setPrompt(id, `enviado: ${msg}`);
    }

    async function openTabulation() {
        const frame = requireOpenFrame();
        if (!frame) return;
        try {
            const result = await sendCommand(
                frame,
                {
                    source: "firewall-parent",
                    type: "OPEN_MANUAL_TABULATION",
                },
                {
                    rocketOrigin: ROCKET_ORIGIN,
                    timeoutMs: TIMING.TABULATION_TIMEOUT_MS,
                },
            );
            if (!result.ok) {
                void fwAlert(
                    `❌ ${
                        result.message || "Falha ao abrir tabulação."
                    }`,
                );
            }
        } catch {
            // O original ignora timeouts da tabulação.
        }
    }

    async function finalize(kind: FinalizeKind) {
        const config = FINALIZE[kind];
        const guarded = kind !== "abandono";

        if (guarded && pendingFinalize) {
            void fwAlert(
                "⚠️ Já existe uma finalização pendente para este chat. Aguarde concluir para evitar duplicidade.",
            );
            return;
        }

        const frame = requireOpenFrame();
        if (!frame) return;

        if (guarded) setFinalizeRequested(id, true);

        try {
            const result = await sendCommand(
                frame,
                {
                    source: "firewall-parent",
                    type: config.command,
                },
                {
                    rocketOrigin: ROCKET_ORIGIN,
                    timeoutMs: TIMING.COMMAND_TIMEOUT_MS,
                },
            );

            if (!result.ok) {
                if (guarded) setFinalizeRequested(id, false);
                void fwAlert(
                    `❌ ${
                        result.message ||
                        `Falha ao encaminhar (${config.label}).`
                    }`,
                );
                return;
            }

            saveHistory(id, config.status, {
                motivo: config.motivo,
                includeTma: config.includeTma,
            });
            // O slot fecha sozinho quando o chat realmente sai da fila.
            setFinalizeRequested(id, true);
        } catch {
            if (guarded) setFinalizeRequested(id, false);
        }
    }

    async function copyN2() {
        if (!slot) return;
        const texto =
            `Preciso transferir para o N2\n` +
            `Colaborador: ${slot.nome}\n` +
            `Matricula: ${slot.matricula ?? ""}\n` +
            `Site: ${slot.site || "CG"}\n` +
            `Protocolo: ${slot.protocolo ?? ""}\n` +
            `Data: ${new Date().toLocaleDateString("pt-BR")}\n` +
            `Motivo: ${slot.motivo || ""}`;

        let copied = true;
        try {
            await copyText(texto);
        } catch {
            copied = false;
        }

        saveHistory(id, "transfer_n2", { includeTma: false });

        if (copied) {
            void fwAlert(
                "✓ Texto N2 copiado e atendimento registrado (sem TMA).",
            );
        } else {
            void fwAlert(
                "⚠️ Atendimento registrado (sem TMA), mas falhou ao copiar texto N2.",
            );
        }
    }

    return (
        <div
            id={`win${id}`}
            className={`chat-window-outer ${
                attention ? "slot-attention-flash" : ""
            }`}
            ref={windowRef}
            style={{
                display: open ? "flex" : "none",
                top: layout.top,
                left: layout.left,
                zIndex,
            }}
            onMouseDown={bringToFront}
        >
            <div className="slot-top-meta">
                <span id={`tipo_${id}`} className="slot-client-type">
                    {slot?.tipoCliente ?? ""}
                </span>
                <span
                    id={`timer_top_${id}`}
                    className="slot-timer-terminal slot-timer-terminal-top"
                    style={{
                        color: palette.text,
                        background: palette.bg,
                        borderColor: palette.border,
                    }}
                    title={`Tempo de chat: ${timerText} / limite ${formatDuration(
                        TIMING.SLOT_TIMER_LIMIT_MS,
                    )}`}
                >
                    {timerText}
                </span>
                <span
                    id={`atd_alert_${id}`}
                    className="slot-history-badge is-green"
                    style={{ display: stats.total > 0 ? "inline-block" : "none" }}
                >
                    ATD: {stats.total}
                </span>
                <span
                    id={`rch_alert_${id}`}
                    className="slot-history-badge is-danger"
                    style={{
                        display: rechamadas > 0 ? "inline-block" : "none",
                    }}
                >
                    RCH: {rechamadas}
                </span>
                <button
                    type="button"
                    className="slot-top-close"
                    title="Fechar slot"
                    onClick={() => setWindowOpen(id, false)}
                >
                    ✕
                </button>
            </div>

            <div
                className={`chat-window ${
                    attention ? "slot-attention-flash" : ""
                }`}
                style={{
                    width: layout.width,
                    height: layout.height,
                    borderColor: palette.windowBorder,
                    borderTopColor: palette.windowTop,
                    boxShadow: `0 0 20px ${palette.windowShadow}`,
                }}
            >
                <div className="chat-header" onMouseDown={onHeaderMouseDown}>
                    <div className="flex items-center gap-3">
                        <span style={{ color: "var(--neon-blue)" }}>
                            [TERMINAL_CR_{String(id).padStart(2, "0")}]
                        </span>
                        <button
                            type="button"
                            className="text-[0.6rem] text-gray-500 hover:text-white uppercase"
                            onClick={() => setDataOpen((value) => !value)}
                        >
                            [Dados]
                        </button>
                    </div>
                    <div className="chat-actions">
                        <button
                            type="button"
                            onClick={() => void openTabulation()}
                            title="Tabulação"
                            className="slot-action-btn hover:text-emerald-400"
                        >
                            TAB
                        </button>
                        <button
                            type="button"
                            onClick={() => void finalize("nps")}
                            title="Encaminhar para NPS"
                            className="slot-action-btn hover:text-cyan-400"
                        >
                            NPS
                        </button>
                        <button
                            type="button"
                            onClick={() => void finalize("fila")}
                            title="Fila de espera"
                            className="slot-action-btn hover:text-purple-400"
                        >
                            FILA
                        </button>
                        <button
                            type="button"
                            onClick={() => void finalize("abandono")}
                            title="Encerrar como abandono"
                            className="slot-action-btn hover:text-yellow-400"
                        >
                            ABANDONO
                        </button>
                        <button
                            type="button"
                            onClick={() => void copyN2()}
                            title="Transferir N2"
                            className="slot-action-btn hover:text-blue-400"
                        >
                            N2
                        </button>
                    </div>
                </div>

                <div
                    id={`quick_reply_${id}`}
                    className={`slot-quick-reply ${
                        attention ? "show" : ""
                    }`}
                >
                    <div className="slot-quick-head">
                        <span className="slot-quick-icon">!</span>
                        <div
                            id={`quick_title_${id}`}
                            className="slot-quick-title"
                        >
                            {snoozedRemaining > 0
                                ? "notificação pausada"
                                : "mensagem pendente"}
                        </div>
                    </div>
                    <div
                        id={`quick_elapsed_${id}`}
                        className="slot-quick-elapsed"
                    >
                        {snoozedRemaining > 0
                            ? `sem resposta: ${formatDuration(
                                  unreadElapsed,
                              )} · pausa: ${formatCountdown(
                                  snoozedRemaining,
                              )}`
                            : `sem resposta: ${formatDuration(
                                  unreadElapsed,
                              )}`}
                    </div>
                    <div className="slot-quick-actions">
                        {pendingMessages.map((message) => (
                            <button
                                type="button"
                                key={message}
                                className="slot-quick-btn"
                                onClick={() => sendQuickReply(message)}
                            >
                                {message}
                            </button>
                        ))}
                    </div>
                    <div className="slot-quick-footer">
                        <button
                            type="button"
                            id={`quick_snooze_${id}`}
                            className="slot-quick-snooze"
                            disabled={snoozedRemaining > 0}
                            onClick={() => snoozeUnread(id)}
                        >
                            {snoozedRemaining > 0
                                ? `NÃO RESPONDER AGORA (${formatCountdown(
                                      snoozedRemaining,
                                  )})`
                                : "NÃO RESPONDER AGORA (2m)"}
                        </button>
                    </div>
                </div>

                <div className={`data-bar ${dataOpen ? "" : "minimized"}`}>
                    <div className="input-group">
                        <label>Colaborador</label>
                        <input
                            type="text"
                            id={`nome_${id}`}
                            placeholder="Nome CR"
                            value={slot?.nome ?? ""}
                            onChange={(event) =>
                                patchSlot(id, { nome: event.target.value })
                            }
                        />
                    </div>
                    <div className="input-group">
                        <label>Matrícula</label>
                        <input
                            type="text"
                            id={`mat_${id}`}
                            placeholder="000000"
                            value={slot?.matricula ?? ""}
                            onChange={(event) =>
                                patchSlot(id, {
                                    matricula: event.target.value,
                                })
                            }
                        />
                    </div>
                    <div className="input-group">
                        <label>Site</label>
                        <input
                            type="text"
                            id={`site_${id}`}
                            value={slot?.site ?? "CG"}
                            onChange={(event) =>
                                patchSlot(id, { site: event.target.value })
                            }
                        />
                    </div>
                    <div className="input-group col-span-3">
                        <label>Protocolo</label>
                        <input
                            type="text"
                            id={`prot_${id}`}
                            placeholder="0000000000000"
                            className="text-blue-400"
                            value={slot?.protocolo ?? ""}
                            onChange={(event) =>
                                patchSlot(id, {
                                    protocolo: event.target.value,
                                })
                            }
                        />
                    </div>
                    <div className="input-group col-span-3">
                        <label>Motivo Atual</label>
                        <input
                            type="text"
                            id={`motivoatual_${id}`}
                            placeholder="Headset, VPN, etc..."
                            readOnly
                            value={slot?.motivoAtual ?? ""}
                            style={{
                                background: "rgba(251,191,36,.05)",
                                borderColor: "rgba(251,191,36,.3)",
                                color: "#fbbf24",
                            }}
                        />
                    </div>
                    <div className="input-group">
                        <label>Qtd. Abandono</label>
                        <input
                            type="text"
                            id={`qtd_abandono_${id}`}
                            placeholder="0"
                            readOnly
                            value={slot?.quantidadeAbandono ?? ""}
                            style={{
                                background: "rgba(239,68,68,.05)",
                                borderColor: "rgba(239,68,68,.3)",
                                color: "#ef4444",
                            }}
                        />
                    </div>
                    <div className="input-group col-span-2">
                        <label>Qtd. Chats</label>
                        <input
                            type="text"
                            id={`qtd_chats_${id}`}
                            placeholder="0"
                            readOnly
                            value={slot?.quantidadeChats ?? ""}
                            style={{
                                background: "rgba(59,130,246,.05)",
                                borderColor: "rgba(59,130,246,.3)",
                                color: "#3b82f6",
                            }}
                        />
                    </div>
                    <TagPicker slotId={id} />
                    <input
                        type="text"
                        id={`motivo_${id}`}
                        placeholder="Insira o motivo..."
                        className="col-span-3 p-2 bg-[#050a15] border border-blue-900/50 rounded text-xs outline-none focus:border-blue-500"
                        value={slot?.motivo ?? ""}
                        onChange={(event) =>
                            patchSlot(id, { motivo: event.target.value })
                        }
                    />
                </div>

                <iframe
                    id={`frame_${id}`}
                    name={slotFrameName(id)}
                    src={slot?.frameSrc ?? "about:blank"}
                    allow="fullscreen; clipboard-read; clipboard-write"
                />

                {prompt && (
                    <div className="slot-auto-prompt show">{prompt.text}</div>
                )}
            </div>
        </div>
    );
}

