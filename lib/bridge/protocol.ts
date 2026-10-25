/**
 * Contrato de mensagens entre o painel e o content.js da extensão.
 * A extensão decide o papel do iframe pelo window.name:
 *   - frame_rocket       -> lê fila, status, omnichannel e avatar
 *   - frame_slot_<id>    -> um por atendimento
 *
 * Toda mensagem carrega `source`:
 *   - firewall-extension -> iframe -> painel
 *   - firewall-parent    -> painel -> iframe
 */
import {
    MSG_SOURCE_EXTENSION,
    MSG_SOURCE_PARENT,
    TIMING,
} from "@/lib/config";

export type AgentStatus = "online" | "away" | "busy" | "offline";

export interface SidebarChat {
    nome: string;
    badgeCount: number;
    isSelected: boolean;
    chatUrl: string | null;
}

export interface FrAuth {
    token: string;
    userId: string;
}

export interface FrMe {
    _id?: string;
    name?: string;
    username?: string;
    status?: string;
}

export interface FrAgent {
    _id: string;
    username: string;
    name?: string;
    status?: string;
    statusLivechat?: string;
    departments?: Array<{ _id?: string } | string>;
}

export interface FrQueueEntry {
    user?: { _id?: string };
    chats?: number;
}

/** Dados brutos devolvidos pelo content.js via FR_REQUEST. */
export interface FrDashboardData {
    me: FrMe | null;
    queueCount: number | null;
    agents: FrAgent[];
    queueEntries: FrQueueEntry[];
}

export interface VisitorDetails {
    matricula: string | null;
    protocolo: string | null;
    tipoCliente: string | null;
    motivoAtual: string | null;
    quantidadeAbandono: string | null;
    quantidadeChats: string | null;
    tags: string[];
    nome: string | null;
    availableTags?: string[];
}

interface FromExtensionBase {
    source: typeof MSG_SOURCE_EXTENSION;
}

export type FromExtension =
    | (FromExtensionBase & {
          type: "ROCKETCHAT_BRIDGE_READY";
          frameUrl: string;
          timestamp: number;
      })
    | (FromExtensionBase & {
          type: "ROCKETCHAT_BRIDGE_UPDATE";
          frameUrl: string;
          timestamp: number;
          data: {
              sidebarChats: SidebarChat[];
              activeChatName: string | null;
              agentStatus: AgentStatus;
              /** null = desconhecido (botão escondido no kebab). */
              omniActive: boolean | null;
          };
      })
    | (FromExtensionBase & {
          type: "ROCKETCHAT_BRIDGE_DETAILS";
          frameUrl: string;
          timestamp: number;
          data: VisitorDetails;
      })
    | (FromExtensionBase & {
          type: "ROCKETCHAT_SLOT_SIGNAL";
          frameUrl: string;
          timestamp: number;
          data: {
              hasUnreadDivider: boolean;
              lastMessageFromVisitor: boolean;
              lastSenderName: string;
              chatName: string;
          };
      })
    | (FromExtensionBase & {
          type: "ROCKETCHAT_CHAT_REMOVED";
          data: { nome: string };
      })
    | (FromExtensionBase & {
          type: "ROCKETCHAT_AVATAR_LETTER";
          data: { letter: string; username: string; avatarUrl: string };
      })
    | (FromExtensionBase & {
          type: "ROCKETCHAT_TAB_OPEN_RESULT";
          ok: boolean;
          message: string;
      })
    | (FromExtensionBase & {
          type: "ROCKETCHAT_AUTO_REPLY_RESULT";
          ok: boolean;
          message: string;
      })
    | (FromExtensionBase & {
          type: "ROCKETCHAT_NPS_RESULT";
          ok: boolean;
          message: string;
      })
    | (FromExtensionBase & {
          type: "ROCKETCHAT_FILA_RESULT";
          ok: boolean;
          message: string;
      })
    | (FromExtensionBase & {
          type: "ROCKETCHAT_ABANDONO_RESULT";
          ok: boolean;
          message: string;
      })
    | (FromExtensionBase & {
          type: "ROCKETCHAT_APPLY_TAGS_RESULT";
          ok: boolean;
          message: string;
          tags: string[];
      })
    | (FromExtensionBase & {
          type: "ROCKETCHAT_FETCH_TAG_OPTIONS_RESULT";
          requestId: string | null;
          ok: boolean;
          message: string;
          options: string[];
          tags: string[];
      })
    | (FromExtensionBase & {
          type: "ROCKETCHAT_FR_RESULT";
          requestId: string;
          ok: boolean;
          unauthorized?: boolean;
          error?: string;
          token?: string;
          userId?: string;
          data?: FrDashboardData;
      });

interface FromParentBase {
    source: typeof MSG_SOURCE_PARENT;
}

export type ToExtension =
    | (FromParentBase & { type: "DATA_REQUEST" })
    | (FromParentBase & { type: "TOGGLE_OMNICHANNEL" })
    | (FromParentBase & { type: "OPEN_MANUAL_TABULATION" })
    | (FromParentBase & { type: "SEND_AUTO_REPLY"; message: string })
    | (FromParentBase & { type: "OPEN_NPS_FORWARD" })
    | (FromParentBase & { type: "OPEN_FILA_FORWARD" })
    | (FromParentBase & { type: "OPEN_ABANDONO_FLOW" })
    | (FromParentBase & { type: "OPEN_APPLY_TAGS"; tags: string[] })
    | (FromParentBase & { type: "OPEN_FETCH_TAG_OPTIONS"; requestId?: string })
    | (FromParentBase & {
          type: "OPEN_CHAT_BY_NAME";
          chatName: string;
          chatUrl?: string;
      })
    | (FromParentBase & {
          type: "FR_REQUEST";
          requestId: string;
          action: "dashboard" | "login";
          auth?: FrAuth;
          username?: string;
          digest?: string;
      });

export const RESULT_FOR_COMMAND = {
    OPEN_MANUAL_TABULATION: "ROCKETCHAT_TAB_OPEN_RESULT",
    SEND_AUTO_REPLY: "ROCKETCHAT_AUTO_REPLY_RESULT",
    OPEN_NPS_FORWARD: "ROCKETCHAT_NPS_RESULT",
    OPEN_FILA_FORWARD: "ROCKETCHAT_FILA_RESULT",
    OPEN_ABANDONO_FLOW: "ROCKETCHAT_ABANDONO_RESULT",
    OPEN_APPLY_TAGS: "ROCKETCHAT_APPLY_TAGS_RESULT",
    OPEN_FETCH_TAG_OPTIONS: "ROCKETCHAT_FETCH_TAG_OPTIONS_RESULT",
    FR_REQUEST: "ROCKETCHAT_FR_RESULT",
} as const;

export type CommandWithResult = keyof typeof RESULT_FOR_COMMAND;

export function isFromExtension(data: unknown): data is FromExtension {
    return (
        typeof data === "object" &&
        data !== null &&
        (data as { source?: string }).source === MSG_SOURCE_EXTENSION &&
        typeof (data as { type?: unknown }).type === "string"
    );
}

/**
 * Envia um comando e espera a resposta correspondente. Valida a origem e o
 * iframe de origem para que outro frame não responda no lugar do correto.
 */
export function sendCommand<C extends CommandWithResult>(
    frame: HTMLIFrameElement,
    command: Extract<ToExtension, { type: C }>,
    opts: {
        rocketOrigin: string;
        timeoutMs?: number;
        filter?: (message: FromExtension) => boolean;
    },
): Promise<Extract<FromExtension, { type: (typeof RESULT_FOR_COMMAND)[C] }>> {
    const {
        rocketOrigin,
        timeoutMs = TIMING.COMMAND_TIMEOUT_MS,
        filter,
    } = opts;
    const commandType = (command as { type: CommandWithResult }).type;
    const expected = RESULT_FOR_COMMAND[commandType];

    return new Promise((resolve, reject) => {
        const win = frame.contentWindow;
        if (!win) {
            reject(new Error("iframe sem contentWindow"));
            return;
        }

        const timer = setTimeout(() => {
            window.removeEventListener("message", onMessage);
            reject(new Error(`timeout aguardando ${expected}`));
        }, timeoutMs);

        function onMessage(event: MessageEvent) {
            if (event.source !== win || event.origin !== rocketOrigin) return;
            if (!isFromExtension(event.data) || event.data.type !== expected) {
                return;
            }
            if (filter && !filter(event.data)) return;

            clearTimeout(timer);
            window.removeEventListener("message", onMessage);
            resolve(event.data as never);
        }

        window.addEventListener("message", onMessage);
        try {
            win.postMessage(command, rocketOrigin);
        } catch (error) {
            clearTimeout(timer);
            window.removeEventListener("message", onMessage);
            reject(error);
        }
    });
}
