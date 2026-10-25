"use client";

import { RocketPanel } from "@/components/RocketPanel";
import { SlotRail } from "@/components/SlotRail";
import { SlotWindow } from "@/components/SlotWindow";
import { useRocketBridge } from "@/hooks/useRocketBridge";
import { useFirewall } from "@/store/firewall";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import { WorkspaceTools } from "@/components/WorkspaceTools";

export default function Home() {
    useRocketBridge();
    const maxSlots = useFirewall((s) => s.maxSlots);

    return (
        <ConfirmProvider>
          <div id="app-shell">
            {/* Sempre montado: o frame principal precisa carregar para a extensão ler a fila */}
            <RocketPanel />
            <SlotRail />
            <WorkspaceTools />
            {Array.from({ length: maxSlots }, (_, i) => i + 1).map((id) => (
                <SlotWindow key={id} id={id} />
            ))}
          </div>
        </ConfirmProvider>
    );
}
