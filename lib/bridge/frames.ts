import {
    MAIN_FRAME_NAME,
    ROCKET_ORIGIN,
    TIMING,
    slotFrameId,
    slotFrameName,
} from "@/lib/config";
import type { ToExtension } from "./protocol";

export type FrameKey = "rocket" | number;

export function getFrame(key: FrameKey): HTMLIFrameElement | null {
    if (typeof document === "undefined") return null;
    return document.getElementById(
        key === "rocket" ? MAIN_FRAME_NAME : slotFrameId(key),
    ) as HTMLIFrameElement | null;
}

export function frameIsLoaded(
    frame: HTMLIFrameElement | null,
): frame is HTMLIFrameElement {
    const src = frame?.getAttribute("src")?.trim();
    return !!frame?.contentWindow && !!src && src !== "about:blank";
}

export function postTo(key: FrameKey, message: ToExtension) {
    const frame = getFrame(key);
    if (!frame?.contentWindow) return false;
    try {
        frame.contentWindow.postMessage(message, ROCKET_ORIGIN);
        return true;
    } catch {
        return false;
    }
}

/** Descobre de qual frame (principal ou slot) veio um MessageEvent. */
export function frameKeyFromSource(
    source: MessageEventSource | null,
    maxSlots: number,
): FrameKey | null {
    if (!source) return null;
    if (getFrame("rocket")?.contentWindow === source) return "rocket";
    for (let id = 1; id <= maxSlots; id++) {
        if (getFrame(id)?.contentWindow === source) return id;
    }
    return null;
}

/**
 * O Rocket é uma SPA: logo após carregar, o content.js pode ainda não estar
 * ouvindo. O original reenviava em 200/900/1800ms.
 */
export function openChatInSlotFrame(
    slotId: number,
    chatName: string,
    chatUrl: string | null,
) {
    if (!chatName) return;
    const send = () =>
        postTo(slotId, {
            source: "firewall-parent",
            type: "OPEN_CHAT_BY_NAME",
            chatName,
            chatUrl: chatUrl ?? undefined,
        });
    for (const delay of TIMING.OPEN_CHAT_RETRY_MS) {
        window.setTimeout(send, delay);
    }
}

export function slotIframeName(slotId: number) {
    return slotFrameName(slotId);
}
