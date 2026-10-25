"use client";

import { ROCKET_HOME_URL } from "@/lib/config";
import { useWindowLayout } from "@/hooks/useWindowLayout";
import { useFirewall } from "@/store/firewall";

/** Iframe principal (frame_rocket): é ele que a extensão usa para ler a fila/status. Fica sempre montado. */
export function RocketPanel() {
    const open = useFirewall((s) => s.rocketOpen);
    const setOpen = useFirewall((s) => s.setRocketOpen);
    const { layout, windowRef, onHeaderMouseDown } = useWindowLayout({
        storageKey: "fw_notepad_layouts_v1",
        layoutId: "rocket-panel",
        defaultPosition: { top: 80, left: 120 },
        defaultSize: { width: 520, height: 600 },
        minSize: { width: 300, height: 400 },
    });

    return (
        <div
            ref={windowRef}
            id="rocket-panel"
            className="notepad-window"
            style={{
                top: layout.top,
                left: layout.left,
                width: layout.width,
                height: layout.height,
                zIndex: 40,
                display: "flex",
                visibility: open ? "visible" : "hidden",
                opacity: open ? 1 : 0,
                pointerEvents: open ? "auto" : "none",
                borderTop: "4px solid var(--neon-blue)",
                transition: "opacity .2s ease, transform .2s ease",
                transform: open ? "translateY(0)" : "translateY(-8px)",
            }}
        >
            <div className="chat-header" onMouseDown={onHeaderMouseDown}>
                <span style={{ color: "var(--neon-blue)" }}>
                    [ROCKET_CONTROL]
                </span>
                <button
                    onClick={() => setOpen(false)}
                    className="hover:text-red-500 font-bold"
                >
                    ✕
                </button>
            </div>
            <iframe
                id="frame_rocket"
                name="frame_rocket"
                src={ROCKET_HOME_URL}
                allow="fullscreen; clipboard-read; clipboard-write"
                style={{ flexGrow: 1, border: "none", background: "#fff" }}
            />
        </div>
    );
}
