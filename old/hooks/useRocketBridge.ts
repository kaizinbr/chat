'use client';

import { useEffect } from 'react';
import { frameKeyFromSource, openChatInSlotFrame, postTo } from '@/lib/bridge/frames';
import { isFromExtension } from '@/lib/bridge/protocol';
import { ROCKET_ORIGIN } from '@/lib/config';
import { useFirewall } from '@/store/firewall';

/**
 * Único listener de mensagens da extensão. Substitui o `window.addEventListener('message')`
 * gigante do script.js. Monte UMA vez (em page.tsx).
 */
export function useRocketBridge() {
  useEffect(() => {
    const st = useFirewall.getState();

    // restaura slots do cache e re-abre o chat certo em cada iframe (o original esperava 800ms)
    // (lê do estado, não do retorno: o StrictMode do dev roda este effect duas vezes)
    st.hydrate();
    const t = setTimeout(() => {
      const cur = useFirewall.getState();
      Object.values(cur.slots).forEach((sl) => sl && openChatInSlotFrame(sl.id, sl.nome, sl.chatUrl));
    }, 800);

    function onMessage(ev: MessageEvent) {
      if (ev.origin !== ROCKET_ORIGIN || !isFromExtension(ev.data)) return;
      const msg = ev.data;
      const s = useFirewall.getState();
      const from = frameKeyFromSource(ev.source, s.maxSlots);

      switch (msg.type) {
        case 'ROCKETCHAT_BRIDGE_READY':
          s.setBridgeActive();
          // frame de slot acabou de carregar → abre o chat certo (além dos retries do original)
          if (typeof from === 'number' && s.slots[from]) {
            openChatInSlotFrame(from, s.slots[from]!.nome, s.slots[from]!.chatUrl);
          }
          break;

        case 'ROCKETCHAT_BRIDGE_UPDATE': {
          s.setBridgeActive();
          const d = msg.data;
          s.setAgent({ agentStatus: d.agentStatus, omniActive: d.omniActive });
          // a fila só vale se vier do frame principal (os slots escondem a sidebar)
          if (from === 'rocket' && d.sidebarChats) {
            if (d.sidebarChats.length > 0 || d.agentStatus) s.setMainSidebarReady();
            const reopen = useFirewall.getState().applySidebar(d.sidebarChats);
            reopen.forEach((r) => openChatInSlotFrame(r.id, r.nome, r.chatUrl));
          }
          break;
        }

        case 'ROCKETCHAT_BRIDGE_DETAILS':
          s.applyDetails(msg.data);
          break;

        case 'ROCKETCHAT_SLOT_SIGNAL':
          if (typeof from === 'number') s.applySignal(from, msg.data);
          break;

        case 'ROCKETCHAT_CHAT_REMOVED':
          if (from === 'rocket') s.releaseByName(msg.data.nome);
          break;

        case 'ROCKETCHAT_AVATAR_LETTER':
          if (msg.data.avatarUrl) s.setAvatarUrl(msg.data.avatarUrl);
          break;
        // *_RESULT são tratados por sendCommand() no ponto de chamada
      }
    }

    window.addEventListener('message', onMessage);

    // aquecimento: até a bridge responder, pede dados ao frame principal
    const warm = setInterval(() => {
      if (useFirewall.getState().bridgeActive) return clearInterval(warm);
      postTo('rocket', { source: 'firewall-parent', type: 'DATA_REQUEST' });
    }, 1000);

    return () => {
      clearTimeout(t);
      clearInterval(warm);
      window.removeEventListener('message', onMessage);
    };
  }, []);
}
