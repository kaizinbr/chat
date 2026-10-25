/**
 * Contrato de mensagens entre o painel (Next.js, janela "pai") e o content.js
 * da extensão (rodando dentro dos iframes do Rocket.Chat).
 *
 * Extraído de content.js (emissor/receptor) e script.js (consumidor).
 * Toda mensagem carrega um discriminador `source`:
 *   - 'firewall-extension' → vem da extensão (iframe → pai)
 *   - 'firewall-parent'    → vem do painel   (pai → iframe)
 */

// ───────────── nomes de iframe: a extensão decide o papel pelo window.name ─────────────
export const MAIN_FRAME_NAME = 'frame_rocket'; // lê fila, status, omnichannel, avatar
export const slotFrameName = (slotId: number) => `frame_slot_${slotId}`; // um por atendimento

// ───────────── dados ─────────────
export type AgentStatus = 'online' | 'away' | 'busy' | 'offline';

export interface SidebarChat {
  nome: string;
  badgeCount: number;
  isSelected: boolean;
  chatUrl: string | null;
}

export interface VisitorDetails {
  matricula: string | null;
  protocolo: string | null;
  tipoCliente: string | null;
  motivoAtual: string | null;
  quantidadeAbandono: string | null;
  quantidadeChats: string | null;
  tags: string[];
}

// ───────────── extensão → painel ─────────────
interface FromExtensionBase {
  source: 'firewall-extension';
}

export type FromExtension =
  | (FromExtensionBase & { type: 'ROCKETCHAT_BRIDGE_READY'; frameUrl: string; timestamp: number })
  | (FromExtensionBase & {
      type: 'ROCKETCHAT_BRIDGE_UPDATE';
      frameUrl: string;
      timestamp: number;
      data: {
        sidebarChats: SidebarChat[];
        activeChatName: string | null;
        agentStatus: AgentStatus;
        omniActive: boolean | null; // null = desconhecido (botão escondido no kebab)
      };
    })
  | (FromExtensionBase & {
      type: 'ROCKETCHAT_BRIDGE_DETAILS';
      frameUrl: string;
      timestamp: number;
      data: VisitorDetails & { nome: string | null; availableTags?: string[] };
    })
  | (FromExtensionBase & {
      type: 'ROCKETCHAT_SLOT_SIGNAL'; // só emitido por frames de slot
      frameUrl: string;
      timestamp: number;
      data: {
        hasUnreadDivider: boolean;
        lastMessageFromVisitor: boolean;
        lastSenderName: string;
        chatName: string;
      };
    })
  | (FromExtensionBase & { type: 'ROCKETCHAT_CHAT_REMOVED'; data: { nome: string } }) // só do frame principal
  | (FromExtensionBase & {
      type: 'ROCKETCHAT_AVATAR_LETTER';
      data: { letter: string; username: string; avatarUrl: string };
    })
  // respostas de comandos
  | (FromExtensionBase & { type: 'ROCKETCHAT_TAB_OPEN_RESULT'; ok: boolean; message: string })
  | (FromExtensionBase & { type: 'ROCKETCHAT_AUTO_REPLY_RESULT'; ok: boolean; message: string })
  | (FromExtensionBase & { type: 'ROCKETCHAT_NPS_RESULT'; ok: boolean; message: string })
  | (FromExtensionBase & { type: 'ROCKETCHAT_FILA_RESULT'; ok: boolean; message: string })
  | (FromExtensionBase & { type: 'ROCKETCHAT_ABANDONO_RESULT'; ok: boolean; message: string })
  | (FromExtensionBase & {
      type: 'ROCKETCHAT_APPLY_TAGS_RESULT';
      ok: boolean;
      message: string;
      tags: string[];
    })
  | (FromExtensionBase & {
      type: 'ROCKETCHAT_FETCH_TAG_OPTIONS_RESULT';
      requestId: string | null;
      ok: boolean;
      message: string;
      options: string[];
      tags: string[];
    });

// ───────────── painel → extensão ─────────────
interface FromParentBase {
  source: 'firewall-parent';
}

export type ToExtension =
  | (FromParentBase & { type: 'DATA_REQUEST' }) // força reenvio do UPDATE
  | (FromParentBase & { type: 'TOGGLE_OMNICHANNEL' })
  | (FromParentBase & { type: 'OPEN_MANUAL_TABULATION' })
  | (FromParentBase & { type: 'SEND_AUTO_REPLY'; message: string })
  | (FromParentBase & { type: 'OPEN_NPS_FORWARD' })
  | (FromParentBase & { type: 'OPEN_FILA_FORWARD' })
  | (FromParentBase & { type: 'OPEN_ABANDONO_FLOW' }) // só preenche; confirmação é manual
  | (FromParentBase & { type: 'OPEN_APPLY_TAGS'; tags: string[] })
  | (FromParentBase & { type: 'OPEN_FETCH_TAG_OPTIONS'; requestId?: string })
  | (FromParentBase & { type: 'OPEN_CHAT_BY_NAME'; chatName: string; chatUrl?: string });

// ───────────── mapa comando → tipo de resposta (para o helper request/response) ─────────────
export const RESULT_FOR_COMMAND = {
  OPEN_MANUAL_TABULATION: 'ROCKETCHAT_TAB_OPEN_RESULT',
  SEND_AUTO_REPLY: 'ROCKETCHAT_AUTO_REPLY_RESULT',
  OPEN_NPS_FORWARD: 'ROCKETCHAT_NPS_RESULT',
  OPEN_FILA_FORWARD: 'ROCKETCHAT_FILA_RESULT',
  OPEN_ABANDONO_FLOW: 'ROCKETCHAT_ABANDONO_RESULT',
  OPEN_APPLY_TAGS: 'ROCKETCHAT_APPLY_TAGS_RESULT',
  OPEN_FETCH_TAG_OPTIONS: 'ROCKETCHAT_FETCH_TAG_OPTIONS_RESULT',
} as const;

export type CommandWithResult = keyof typeof RESULT_FOR_COMMAND;

export function isFromExtension(data: unknown): data is FromExtension {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { source?: string }).source === 'firewall-extension' &&
    typeof (data as { type?: unknown }).type === 'string'
  );
}

/**
 * Envia um comando a um iframe e espera a resposta correspondente.
 * No código original isso era feito com `window.addEventListener('message', onResult)`
 * avulso dentro de cada função (NPS, FILA, ABANDONO, TAB, tags...). Aqui vira uma
 * Promise com timeout, e o listener é sempre removido.
 *
 * `rocketOrigin` deve ser 'https://helptechho.digitalaec.com.br' — filtrar por
 * origin evita que outro frame qualquer responda no lugar do Rocket.
 */
export function sendCommand<C extends CommandWithResult>(
  frame: HTMLIFrameElement,
  command: Extract<ToExtension, { type: C }>,
  opts: { rocketOrigin: string; timeoutMs?: number },
): Promise<Extract<FromExtension, { type: (typeof RESULT_FOR_COMMAND)[C] }>> {
  const { rocketOrigin, timeoutMs = 30_000 } = opts;
  const commandType = (command as { type: CommandWithResult }).type;
  const expected = RESULT_FOR_COMMAND[commandType];

  return new Promise((resolve, reject) => {
    const win = frame.contentWindow;
    if (!win) return reject(new Error('iframe sem contentWindow'));

    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error(`timeout aguardando ${expected}`));
    }, timeoutMs);

    function onMessage(ev: MessageEvent) {
      if (ev.source !== win || ev.origin !== rocketOrigin) return;
      if (!isFromExtension(ev.data) || ev.data.type !== expected) return;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(ev.data as never);
    }

    window.addEventListener('message', onMessage);
    win.postMessage(command, rocketOrigin); // origin explícito em vez de '*'
  });
}
