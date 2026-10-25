"use client";

import { useRef } from "react";
import {
    frameIsLoaded,
    getFrame,
    postTo,
    type FrameKey,
} from "@/lib/bridge/frames";
import { DEFAULT_AVATAR_URL } from "@/lib/config";
import { fwAlert, fwConfirm } from "@/lib/modal";
import { useFirewall } from "@/store/firewall";

const OMNI_COOLDOWN_MS = 3_000;

function Ball({ id }: { id: number }) {
    const slot = useFirewall((state) => state.slots[id]);
    const setWindowOpen = useFirewall((state) => state.setWindowOpen);

    return (
        <div
            id={`ball_${id}`}
            className="ball shadow-blue-500/20 relative"
            onClick={() => setWindowOpen(id, true)}
        >
            {String(id).padStart(2, "0")}
            <span
                className="ball-badge"
                style={{
                    display:
                        slot && slot.badgeCount > 0 ? "flex" : "none",
                }}
            >
                {slot?.badgeCount}
            </span>
            <span
                className="ball-name"
                style={{ display: slot ? "block" : "none" }}
            >
                {slot?.nome.split(" ")[0]}
            </span>
        </div>
    );
}

export function SlotRail() {
    const maxSlots = useFirewall((state) => state.maxSlots);
    const slots = useFirewall((state) => state.slots);
    const omniActive = useFirewall((state) => state.omniActive);
    const agentStatus = useFirewall((state) => state.agentStatus);
    const avatarUrl = useFirewall((state) => state.avatarUrl);
    const addSlot = useFirewall((state) => state.addSlot);
    const setRocketOpen = useFirewall((state) => state.setRocketOpen);
    const cooldownRef = useRef(false);

    const allFilled = Array.from(
        { length: maxSlots },
        (_, index) => index + 1,
    ).every((id) => !!slots[id]);
    const omniOpen = !!omniActive;

    function canReceive(): FrameKey | null {
        const keys: FrameKey[] = [
            "rocket",
            ...Array.from(
                { length: maxSlots },
                (_, index) => index + 1,
            ),
        ];
        for (const key of keys) {
            if (frameIsLoaded(getFrame(key))) return key;
        }
        return null;
    }

    async function toggleOmnichannel() {
        if (cooldownRef.current) return;
        const action = omniOpen ? "DESATIVAR" : "ATIVAR";
        const ok = await fwConfirm(
            `${action} recebimento de chats?`,
        );
        if (!ok) return;

        cooldownRef.current = true;
        window.setTimeout(() => {
            cooldownRef.current = false;
        }, OMNI_COOLDOWN_MS);

        const key = canReceive();
        if (key !== null) {
            postTo(key, {
                source: "firewall-parent",
                type: "TOGGLE_OMNICHANNEL",
            });
            return;
        }

        void fwAlert(
            "Rocket não disponível no iframe ainda. Abra o painel do agente primeiro.",
        );
    }

    return (
        <div className="fixed left-6 top-1/2 -translate-y-1/2 flex flex-col z-[100]">
            <div
                id="omni-toggle"
                className={`omni-toggle cursor-pointer ${omniOpen ? "open" : "closed"}`}
                onClick={() => void toggleOmnichannel()}
                title={
                    omniOpen
                        ? "CHATS: ATIVO — clique para desativar"
                        : "CHATS: INATIVO — clique para ativar"
                }
            >
                <span id="omni-icon">{omniOpen ? "◉" : "⊘"}</span>
                <span id="omni-label">{omniOpen ? "ON" : "OFF"}</span>
            </div>

            <div
                id="agent-card"
                className="agent-card cursor-pointer"
                onClick={() => setRocketOpen(true)}
            >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    id="agent-avatar"
                    src={avatarUrl ?? DEFAULT_AVATAR_URL}
                    alt="avatar"
                    className="agent-avatar"
                />
                <span
                    id="agent-status-dot"
                    className={`agent-status-dot ${
                        agentStatus === "online" ? "online" : "offline"
                    }`}
                />
            </div>

            {Array.from(
                { length: maxSlots },
                (_, index) => index + 1,
            ).map((id) => (
                <Ball key={id} id={id} />
            ))}

            {allFilled && (
                <div
                    id="add-slot-btn"
                    className="ball shadow-green-500/20 relative"
                    style={{
                        background: "rgba(34,197,94,.1)",
                        borderColor: "rgba(34,197,94,.3)",
                        color: "#22c55e",
                        fontSize: "1.5rem",
                    }}
                    onClick={addSlot}
                    title="Adicionar novo slot"
                >
                    +
                </div>
            )}
        </div>
    );
}
