"use client";

import { postTo } from "@/lib/bridge/frames";
import { useFirewall } from "@/store/firewall";
import { useConfirm } from "@/components/ConfirmProvider";

function Ball({ id }: { id: number }) {
    const slot = useFirewall((s) => s.slots[id]);
    const setWindowOpen = useFirewall((s) => s.setWindowOpen);
    return (
        <div
            id={`ball_${id}`}
            onClick={() => setWindowOpen(id, true)}
            className="ball shadow-blue-500/20 relative"
        >
            {String(id).padStart(2, "0")}
            <span
                className="ball-badge"
                style={{
                    display: slot && slot.badgeCount > 0 ? "flex" : "none",
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
    const {
        maxSlots,
        slots,
        omniActive,
        agentStatus,
        avatarUrl,
        addSlot,
        setRocketOpen,
    } = useFirewall();
    const confirm = useConfirm();
    const allFilled = Array.from({ length: maxSlots }, (_, i) => i + 1).every(
        (id) => slots[id],
    );
    const omniOpen = !!omniActive;

    async function toggleOmni() {
        const action = omniOpen ? "DESATIVAR" : "ATIVAR";
        if (!(await confirm(`${action} recebimento de chats?`))) return;
        // frame principal primeiro; se não estiver pronto, tenta qualquer slot (como o original)
        if (
            postTo("rocket", {
                source: "firewall-parent",
                type: "TOGGLE_OMNICHANNEL",
            })
        )
            return;
        for (let i = 1; i <= maxSlots; i++) {
            if (
                postTo(i, {
                    source: "firewall-parent",
                    type: "TOGGLE_OMNICHANNEL",
                })
            )
                return;
        }
        window.alert(
            "Rocket não disponível no iframe ainda. Abra o painel do agente primeiro.",
        );
    }

    return (
        <div className="fixed left-6 top-1/2 -translate-y-1/2 flex flex-col z-999">
            <div
                id="omni-toggle"
                className={`omni-toggle ${omniOpen ? "open" : "closed"}`}
                onClick={toggleOmni}
                title={
                    omniOpen
                        ? "CHATS: ATIVO — clique para desativar"
                        : "CHATS: INATIVO — clique para ativar"
                }
            >
                <span>{omniOpen ? "◉" : "⊘"}</span>
                <span>{omniOpen ? "ON" : "OFF"}</span>
            </div>

            <div className="agent-card" onClick={() => setRocketOpen(true)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {avatarUrl && (
                    <img
                        src={avatarUrl}
                        alt="avatar"
                        className="agent-avatar"
                    />
                )}
                <span
                    className={`agent-status-dot ${agentStatus === "online" ? "online" : "offline"}`}
                />
            </div>

            {Array.from({ length: maxSlots }, (_, i) => i + 1).map((id) => (
                <Ball key={id} id={id} />
            ))}

            {allFilled && (
                <div
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
