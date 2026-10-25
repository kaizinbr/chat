import { postTo } from "@/lib/bridge/frames";
import { MSG_SOURCE_PARENT, TIMING } from "@/lib/config";
import { ensureRocketFrameOnline, firewall } from "@/store/firewall";

const sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Porte de waitForBridgeActivation(): pergunta ao frame principal a cada 220ms
 * até a extensão responder READY/UPDATE ou estourar os 4,5s.
 */
export async function waitForBridgeActivation(
    timeoutMs = TIMING.BRIDGE_WAIT_MS,
) {
    const startedAt = Date.now();
    ensureRocketFrameOnline(false);

    while (Date.now() - startedAt < timeoutMs) {
        if (firewall.getState().bridgeActive) return true;
        ensureRocketFrameOnline(false);
        postTo("rocket", { source: MSG_SOURCE_PARENT, type: "DATA_REQUEST" });
        await sleep(TIMING.BRIDGE_WAIT_POLL_MS);
    }

    return firewall.getState().bridgeActive;
}
