"use client";

import { useEffect } from "react";
import { useWindowLayout } from "@/hooks/useWindowLayout";
import { ensureRocketFrameOnline, useFirewall } from "@/store/firewall";
import { RestartIcon } from '@solar-icons/react/linear/restart'

/**
 * Iframe principal (frame_rocket): é ele que a extensão usa para ler a
 * fila/status. Fica sempre montado, mesmo quando o painel está fechado.
 */
export function RocketPanel() {
    const open = useFirewall((state) => state.rocketOpen);
    const setOpen = useFirewall((state) => state.setRocketOpen);
    const {
        layout,
        windowRef,
        onHeaderMouseDown,
        bringToFront,
        zIndex,
    } = useWindowLayout({
        storageKey: "fw_notepad_layouts_v1",
        layoutId: "rocket-panel",
        defaultPosition: { top: 80, left: 120 },
        defaultSize: { width: 520, height: 600 },
        minSize: { width: 300, height: 400 },
    });

    useEffect(() => {
        if (!open) return;
        ensureRocketFrameOnline(false);
        bringToFront();
    }, [bringToFront, open]);

    return (
        <div
            ref={windowRef}
            id="rocket-panel"
            className="notepad-window"
            style={{
                display: "flex",
                top: layout.top,
                left: layout.left,
                width: layout.width,
                height: layout.height,
                zIndex,
                visibility: open ? "visible" : "hidden",
                opacity: open ? 1 : 0,
                pointerEvents: open ? "auto" : "none",
                borderTop: "4px solid var(--neon-blue)",
                transition: "opacity .2s ease, transform .2s ease",
                transform: open ? "translateY(0)" : "translateY(-8px)",
            }}
            onMouseDown={bringToFront}
        >
            <div className="chat-header" onMouseDown={onHeaderMouseDown}>
                <span style={{ color: "var(--neon-blue)" }}>
                    [ROCKET_CONTROL]
                </span>
                <div className="flex gap-4 items-center">
                    <button
                        type="button"
                        onClick={() => ensureRocketFrameOnline(true)}
                        className="hover:text-red-500 font-bold"
                        title="Recarregar conteúdo"
                        aria-label="Recarregar conteúdo do iframe"
                    >
                        <RestartIcon size={20} />
                    </button>
                    <button
                        type="button"
                        onClick={() => setOpen(false)}
                        className="hover:text-red-500 font-bold"
                    >
                        ✕
                    </button>
                </div>
            </div>
            <iframe
                id="frame_rocket"
                name="frame_rocket"
                src="about:blank"
                allow="fullscreen; clipboard-read; clipboard-write"
                style={{ flexGrow: 1, border: "none", background: "#fff" }}
            />
        </div>
    );
}
