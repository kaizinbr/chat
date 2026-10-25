"use client";

import { useEffect, useRef, useState } from "react";
import { frameIsLoaded, getFrame } from "@/lib/bridge/frames";
import { sendCommand } from "@/lib/bridge/protocol";
import { ROCKET_ORIGIN, TIMING } from "@/lib/config";
import { fwAlert } from "@/lib/modal";
import { normalizeChatName } from "@/lib/slots/reconcile";
import { firewall, useFirewall } from "@/store/firewall";

/**
 * Porte de renderTagOptionsForSlot / loadTagOptionsForSlot / applyTagsFromSlot.
 * A seleção é gravada imediatamente no slot (igual toggleTagSelection).
 */
export function TagPicker({ slotId }: { slotId: number }) {
    const slot = useFirewall((state) => state.slots[slotId]);
    const patchSlot = useFirewall((state) => state.patchSlot);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const boxRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDocumentClick = (event: MouseEvent) => {
            if (!boxRef.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("click", onDocumentClick);
        return () => document.removeEventListener("click", onDocumentClick);
    }, [open]);

    if (!slot) return null;

    const selected = Array.isArray(slot.tags) ? slot.tags : [];
    const options = Array.isArray(slot.availableTags)
        ? slot.availableTags
        : [];

    function toggle(tag: string) {
        if (!slot) return;
        const exists = selected.some(
            (value) =>
                normalizeChatName(value) === normalizeChatName(tag),
        );
        patchSlot(slotId, {
            tags: exists
                ? selected.filter(
                      (value) =>
                          normalizeChatName(value) !==
                          normalizeChatName(tag),
                  )
                : [...selected, tag],
        });
        setOpen(true);
    }

    async function refresh() {
        const frame = getFrame(slotId);
        if (!frame || !frameIsLoaded(frame)) {
            void fwAlert("❌ Chat do slot não está aberto.");
            return;
        }

        const requestId = `tagopts_${slotId}_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 8)}`;

        setLoading(true);
        try {
            const result = await sendCommand(
                frame,
                {
                    source: "firewall-parent",
                    type: "OPEN_FETCH_TAG_OPTIONS",
                    requestId,
                },
                {
                    rocketOrigin: ROCKET_ORIGIN,
                    timeoutMs: TIMING.TAG_OPTIONS_TIMEOUT_MS,
                    filter: (message) =>
                        message.type ===
                            "ROCKETCHAT_FETCH_TAG_OPTIONS_RESULT" &&
                        message.requestId === requestId,
                },
            );

            if (!result.ok) {
                void fwAlert(
                    `❌ ${
                        result.message ||
                        "Falha ao carregar opções de tags."
                    }`,
                );
                return;
            }

            const current = firewall.getState().slots[slotId];
            const tags =
                Array.isArray(result.tags) && result.tags.length
                    ? result.tags
                    : current?.tags ?? [];

            patchSlot(slotId, {
                availableTags: Array.isArray(result.options)
                    ? result.options
                    : [],
                tags,
            });
            setOpen(true);
        } catch (error) {
            void fwAlert(
                `❌ ${
                    (error as Error).message ||
                    "Falha ao carregar opções de tags."
                }`,
            );
        } finally {
            setLoading(false);
        }
    }

    async function apply() {
        const frame = getFrame(slotId);
        if (!frame || !frameIsLoaded(frame)) {
            void fwAlert("❌ Chat do slot não está aberto.");
            return;
        }
        if (!selected.length) {
            void fwAlert(
                "❌ Informe pelo menos uma tag (separe por vírgula).",
            );
            return;
        }

        try {
            const result = await sendCommand(
                frame,
                {
                    source: "firewall-parent",
                    type: "OPEN_APPLY_TAGS",
                    tags: selected,
                },
                {
                    rocketOrigin: ROCKET_ORIGIN,
                    timeoutMs: TIMING.TAG_APPLY_TIMEOUT_MS,
                },
            );

            if (!result.ok) {
                void fwAlert(
                    `❌ ${result.message || "Falha ao aplicar tags."}`,
                );
                return;
            }

            patchSlot(slotId, {
                tags: Array.isArray(result.tags)
                    ? result.tags
                    : selected,
            });
        } catch (error) {
            void fwAlert(
                `❌ ${(error as Error).message || "Falha ao aplicar tags."}`,
            );
        }
    }

    return (
        <div
            ref={boxRef}
            id={`tag_box_${slotId}`}
            className={`col-span-3 tag-box ${open ? "is-open" : ""}`}
        >
            <div
                className="tag-box-header"
                onClick={() => setOpen((value) => !value)}
            >
                <span className="tag-box-label">🏷 Tags</span>
                <span
                    id={`tag_summary_${slotId}`}
                    className={`tag-box-summary ${
                        selected.length ? "has-value" : ""
                    }`}
                >
                    {selected.length
                        ? selected.join(", ")
                        : "Nenhuma selecionada"}
                </span>
                <div className="tag-box-actions">
                    <button
                        type="button"
                        id={`tag_refresh_${slotId}`}
                        title="Recarregar opções"
                        className={`tag-refresh-btn ${
                            loading ? "is-loading" : ""
                        }`}
                        onClick={(event) => {
                            event.stopPropagation();
                            void refresh();
                        }}
                    >
                        ↺
                    </button>
                    <span className="tag-box-arrow">▾</span>
                </div>
            </div>
            <div className="tag-dropdown">
                <div
                    className="tag-dropdown-list"
                    id={`tag_options_${slotId}`}
                >
                    {options.length === 0 ? (
                        <div className="tag-dropdown-empty">
                            Nenhuma opção carregada ainda. Clique em ↺ para
                            buscar.
                        </div>
                    ) : (
                        options.map((tag) => {
                            const active = selected.some(
                                (value) =>
                                    normalizeChatName(value) ===
                                    normalizeChatName(tag),
                            );
                            return (
                                <div
                                    key={tag}
                                    className={`tag-row ${
                                        active ? "selected" : ""
                                    }`}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        toggle(tag);
                                    }}
                                >
                                    <span>{tag}</span>
                                    <span className="tag-row-check">✓</span>
                                </div>
                            );
                        })
                    )}
                </div>
                <button
                    type="button"
                    className="tag-apply-btn"
                    onClick={() => void apply()}
                >
                    ✓ Aplicar na Tabulação
                </button>
            </div>
        </div>
    );
}
