"use client";

import type { CSSProperties, MouseEvent } from "react";
import {
    resolveModal,
    useModalRequest,
    type ModalButtonStyle,
} from "@/lib/modal";

const BASE_BUTTON: CSSProperties = {
    padding: "12px 32px",
    borderRadius: 4,
    fontSize: "0.7rem",
    fontWeight: "bold",
    fontFamily: "'Fira Code', monospace",
    cursor: "pointer",
    textTransform: "uppercase",
    letterSpacing: 2,
    border: "1px solid",
    transition: "all 0.3s",
};

const BUTTON_COLORS: Record<
    ModalButtonStyle,
    { background: string; color: string; borderColor: string; hover: string }
> = {
    default: {
        background: "rgba(234,179,8,0.1)",
        color: "#eab308",
        borderColor: "rgba(234,179,8,0.4)",
        hover: "#eab308",
    },
    danger: {
        background: "rgba(234,179,8,0.1)",
        color: "#eab308",
        borderColor: "rgba(234,179,8,0.4)",
        hover: "#eab308",
    },
    success: {
        background: "rgba(34,197,94,0.1)",
        color: "#22c55e",
        borderColor: "rgba(34,197,94,0.4)",
        hover: "#22c55e",
    },
};

/**
 * Porte do modal customizado (#fw-modal-overlay) do painel original.
 * Fica dentro de #app-shell para herdar o zoom da interface.
 */
export function ModalHost() {
    const request = useModalRequest();

    if (!request) {
        return (
            <div
                id="fw-modal-overlay"
                className="fw-modal-overlay"
                style={{ display: "none" }}
            />
        );
    }

    return (
        <div
            id="fw-modal-overlay"
            className="fw-modal-overlay"
            style={{ display: "flex" }}
        >
            <div
                id="fw-modal"
                className="fw-modal"
                style={{
                    background: "#0a0e1a",
                    border: "2px solid rgba(59,130,246,0.5)",
                    borderTop: "3px solid #3b82f6",
                    borderRadius: 6,
                    padding: "35px 45px",
                    minWidth: 500,
                    maxWidth: 600,
                    boxShadow:
                        "0 0 50px rgba(59,130,246,0.4), inset 0 0 20px rgba(59,130,246,0.05)",
                    fontFamily: "'Fira Code', monospace",
                }}
            >
                <div
                    style={{
                        color: "#3b82f6",
                        fontSize: "0.65rem",
                        textTransform: "uppercase",
                        letterSpacing: 3,
                        marginBottom: 20,
                        borderBottom: "1px solid rgba(59,130,246,0.2)",
                        paddingBottom: 10,
                    }}
                >
                    root@firewall:~$
                </div>
                <div
                    id="fw-modal-msg"
                    style={{
                        color: "#94a3b8",
                        fontSize: "0.8rem",
                        marginBottom: 30,
                        lineHeight: 1.8,
                        fontFamily: "'Fira Code', monospace",
                        whiteSpace: "pre-line",
                        textAlign: "left",
                    }}
                >
                    {request.message}
                </div>
                <div
                    id="fw-modal-buttons"
                    style={{
                        display: "flex",
                        gap: 15,
                        justifyContent: "center",
                        flexWrap: "wrap",
                    }}
                >
                    {request.buttons.map((button, index) => {
                        const palette =
                            BUTTON_COLORS[button.style ?? "default"];
                        return (
                            <button
                                key={`${button.label}-${index}`}
                                type="button"
                                onClick={() => resolveModal(button.value)}
                                style={{
                                    ...BASE_BUTTON,
                                    background: palette.background,
                                    color: palette.color,
                                    borderColor: palette.borderColor,
                                }}
                                onMouseEnter={(
                                    event: MouseEvent<HTMLButtonElement>,
                                ) => {
                                    event.currentTarget.style.background =
                                        palette.hover;
                                    event.currentTarget.style.color = "#000";
                                }}
                                onMouseLeave={(
                                    event: MouseEvent<HTMLButtonElement>,
                                ) => {
                                    event.currentTarget.style.background =
                                        palette.background;
                                    event.currentTarget.style.color =
                                        palette.color;
                                }}
                            >
                                {button.label}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
