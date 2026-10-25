"use client";

import BootScreen from "@/components/init/boot-screen";
import { ModalHost } from "@/components/core/modal-host";
import { RocketPanel } from "@/components/core/rocket-panel";
import { SlotRail } from "@/components/core/slot-rail";
import { SlotWindow } from "@/components/slots/slot-window";
import { WorkspaceTools } from "@/components/tools/workspace-tools";
import { WorkspaceLinks } from "@/components/tools/workspace-links";
import { useRocketBridge } from "@/hooks/useRocketBridge";
import { useFirewall } from "@/store/firewall";

/**
 * Composição final do painel. A tela de boot fica fora de #app-shell para não
 * herdar o zoom; todo o resto (ferramentas, slots, iframes e modal) fica
 * dentro, exatamente como no original.
 */
export default function AppShell() {
    useRocketBridge();

    const maxSlots = useFirewall((state) => state.maxSlots);

    return (
        <>
            <BootScreen />
            <div id="app-shell">
                <WorkspaceTools />
                <WorkspaceLinks />
                <RocketPanel />
                <SlotRail />
                {Array.from({ length: maxSlots }, (_, index) => (
                    <SlotWindow key={index + 1} id={index + 1} />
                ))}
                <ModalHost />
            </div>
        </>
    );
}
