'use client';

import { useEffect, useState } from 'react';
import { useWindowLayout } from '@/hooks/useWindowLayout';
import { useNow } from '@/hooks/useNow';
import { frameIsLoaded, getFrame } from '@/lib/bridge/frames';
import { sendCommand, slotFrameName } from '@/lib/bridge/protocol';
import { ROCKET_ORIGIN, TIMING } from '@/lib/config';
import { formatDuration, timerPalette } from '@/lib/format';
import type { Slot } from '@/lib/slots/reconcile';
import { useFirewall, type FinalStatus } from '@/store/firewall';
import { TagPicker } from './TagPicker';

type FinalizeKind = 'nps' | 'fila' | 'abandono';
const FINALIZE = {
  nps: { cmd: 'OPEN_NPS_FORWARD', status: 'resolvido', motivo: '', tma: true, label: 'NPS' },
  fila: { cmd: 'OPEN_FILA_FORWARD', status: 'fila', motivo: 'fila de espera', tma: false, label: 'fila' },
  abandono: { cmd: 'OPEN_ABANDONO_FLOW', status: 'abandono', motivo: 'abandono', tma: false, label: 'abandono' },
} as const satisfies Record<FinalizeKind, { cmd: string; status: FinalStatus; motivo: string; tma: boolean; label: string }>;

export function SlotWindow({ id }: { id: number }) {
  const slot = useFirewall((s) => s.slots[id]);
  const open = useFirewall((s) => !!s.windowOpen[id]);
  const pending = useFirewall((s) => !!s.meta[id]?.finalizeRequestedAt);
  const signal = useFirewall((s) => s.signals[id]);
  const patchSlot = useFirewall((s) => s.patchSlot);
  const setWindowOpen = useFirewall((s) => s.setWindowOpen);
  const setFinalizeRequested = useFirewall((s) => s.setFinalizeRequested);
  const saveHistory = useFirewall((s) => s.saveHistory);

  const now = useNow(1000);
  const [dataOpen, setDataOpen] = useState(true);
  const [snoozedUntil, setSnoozedUntil] = useState(0);
  const { layout, windowRef, onHeaderMouseDown, bringToFront, zIndex } = useWindowLayout({
    storageKey: 'chat_slot_layouts',
    layoutId: String(id),
    defaultPosition: { top: 80 + id * 60, left: 300 + id * 80 },
    defaultSize: { width: 460, height: 620 },
    minSize: { width: 300, height: 400 },
    resizeSelector: '.chat-window',
  });

  const elapsed = slot && now > 0 ? now - slot.openedAt : 0;
  const pal = timerPalette(elapsed);
  const timerText = formatDuration(elapsed);
  const pendingMessage = !!signal && (signal.hasUnreadDivider || signal.lastMessageFromVisitor) && now > snoozedUntil;
  const pendingElapsed = signal?.updatedAt ? Math.max(0, now - signal.updatedAt) : 0;

  useEffect(() => {
    if (!pendingMessage || localStorage.getItem('fw_attention_sound_muted_v1') === '1') return;
    const src = localStorage.getItem('fw_attention_audio');
    if (!src) return;
    const audio = new Audio(src);
    audio.play().catch(() => undefined);
  }, [pendingMessage]);

  async function sendQuickReply(message: string) {
    const frame = requireOpenFrame();
    if (!frame) return;
    try {
      const res = await sendCommand(frame, { source: 'firewall-parent', type: 'SEND_AUTO_REPLY', message }, { rocketOrigin: ROCKET_ORIGIN, timeoutMs: TIMING.COMMAND_TIMEOUT_MS });
      if (!res.ok) window.alert(`❌ ${res.message}`);
    } catch (error) {
      window.alert(`❌ ${(error as Error).message}`);
    }
  }

  function requireOpenFrame() {
    const frame = getFrame(id);
    if (!slot || !frameIsLoaded(frame)) {
      window.alert('❌ Chat do slot não está aberto.');
      return null;
    }
    return frame;
  }

  async function openTabulation() {
    const frame = requireOpenFrame();
    if (!frame) return;
    try {
      const res = await sendCommand(
        frame,
        { source: 'firewall-parent', type: 'OPEN_MANUAL_TABULATION' },
        { rocketOrigin: ROCKET_ORIGIN, timeoutMs: 10_000 },
      );
      if (!res.ok) window.alert(`❌ ${res.message || 'Falha ao abrir tabulação.'}`);
    } catch {}
  }

  /** NPS / FILA / ABANDONO: mesmo fluxo do original, uma função só. */
  async function finalize(kind: FinalizeKind) {
    const cfg = FINALIZE[kind];
    const guarded = kind !== 'abandono'; // abandono não bloqueia por "finalização pendente"
    if (guarded && pending) {
      window.alert('⚠️ Já existe uma finalização pendente para este chat. Aguarde concluir para evitar duplicidade.');
      return;
    }
    const frame = requireOpenFrame();
    if (!frame) return;
    if (guarded) setFinalizeRequested(id, true);

    try {
      const res = await sendCommand(
        frame,
        { source: 'firewall-parent', type: cfg.cmd },
        { rocketOrigin: ROCKET_ORIGIN, timeoutMs: TIMING.COMMAND_TIMEOUT_MS },
      );
      if (!res.ok) {
        if (guarded) setFinalizeRequested(id, false);
        window.alert(`❌ ${res.message || `Falha ao encaminhar (${cfg.label}).`}`);
        return;
      }
      saveHistory(id, cfg.status, { motivo: cfg.motivo, includeTma: cfg.tma });
      setFinalizeRequested(id, true); // o slot fecha sozinho quando o chat sair da fila
    } catch {
      if (guarded) setFinalizeRequested(id, false); // timeout
    }
  }

  async function copyN2() {
    if (!slot) return;
    const texto =
      `Preciso transferir para o N2\nColaborador: ${slot.nome}\nMatricula: ${slot.matricula ?? ''}\n` +
      `Site: ${slot.site || 'CG'}\nProtocolo: ${slot.protocolo ?? ''}\n` +
      `Data: ${new Date().toLocaleDateString('pt-BR')}\nMotivo: ${slot.motivo}`;
    let copied = true;
    try {
      await navigator.clipboard.writeText(texto);
    } catch {
      copied = false;
    }
    saveHistory(id, 'transfer_n2', { includeTma: false });
    window.alert(
      copied ? '✓ Texto N2 copiado e atendimento registrado (sem TMA).' : '⚠️ Atendimento registrado (sem TMA), mas falhou ao copiar texto N2.',
    );
  }

  const field = (key: 'nome' | 'matricula' | 'protocolo' | 'site' | 'motivo') => ({
    value: slot?.[key] ?? '',
    onChange: (e: { target: { value: string } }) => patchSlot(id, { [key]: e.target.value } as Partial<Slot>),
  });

  return (
    <div
      id={`win${id}`}
      className="chat-window-outer"
      ref={windowRef}
      style={{ display: open && slot ? 'flex' : 'none', top: layout.top, left: layout.left, zIndex }}
      onMouseDown={bringToFront}
    >
      <div className="slot-top-meta">
        <span className="slot-client-type">{slot?.tipoCliente}</span>
        <span
          className="slot-timer-terminal slot-timer-terminal-top"
          style={{ color: pal.text, background: pal.bg, borderColor: pal.border }}
          title={`Tempo de chat: ${timerText} / limite ${formatDuration(TIMING.SLOT_TIMER_LIMIT_MS)}`}
        >
          {timerText}
        </span>
        <button onClick={() => setWindowOpen(id, false)} className="slot-top-close" title="Fechar slot">
          ✕
        </button>
      </div>

      <div
        className="chat-window"
        style={{ width: layout.width, height: layout.height, borderColor: pal.windowBorder, borderTopColor: pal.windowTop, boxShadow: `0 0 20px ${pal.glow}` }}
      >
        {pendingMessage && (
          <div className="slot-quick-reply show">
            <div className="slot-quick-head"><span className="slot-quick-icon">!</span><strong className="slot-quick-title">mensagem pendente</strong></div>
            <div className="slot-quick-elapsed">sem resposta: {formatDuration(pendingElapsed)}</div>
            {['Só mais um momento.', 'Estou validando algumas correções, só um momento.', 'Ok, um momento, por favor.'].map((message) => (
              <button key={message} className="slot-quick-btn" onClick={() => sendQuickReply(message)}>{message}</button>
            ))}
            <button className="slot-quick-snooze" onClick={() => setSnoozedUntil(Date.now() + 120000)}>NÃO RESPONDER AGORA (2m)</button>
          </div>
        )}
        <div className="chat-header" onMouseDown={onHeaderMouseDown}>
          <div className="flex items-center gap-3">
            <span style={{ color: 'var(--neon-blue)' }}>[TERMINAL_CR_0{id}]</span>
            <button onClick={() => setDataOpen((v) => !v)} className="text-[0.6rem] text-gray-500 hover:text-white uppercase">
              [Dados]
            </button>
          </div>
          <div className="chat-actions">
            <button onClick={openTabulation} title="Tabulação" className="slot-action-btn hover:text-emerald-400">TAB</button>
            <button onClick={() => finalize('nps')} title="Encaminhar para NPS" className="slot-action-btn hover:text-cyan-400">NPS</button>
            <button onClick={() => finalize('fila')} title="Fila de espera" className="slot-action-btn hover:text-purple-400">FILA</button>
            <button onClick={() => finalize('abandono')} title="Encerrar como abandono" className="slot-action-btn hover:text-yellow-400">ABANDONO</button>
            <button onClick={copyN2} title="Transferir N2" className="slot-action-btn hover:text-blue-400">N2</button>
          </div>
        </div>

        <div className={`data-bar ${dataOpen ? '' : 'minimized'}`}>
          <div className="input-group"><label>Colaborador</label><input type="text" placeholder="Nome CR" {...field('nome')} /></div>
          <div className="input-group"><label>Matrícula</label><input type="text" placeholder="000000" {...field('matricula')} /></div>
          <div className="input-group"><label>Site</label><input type="text" {...field('site')} /></div>
          <div className="input-group col-span-3"><label>Protocolo</label><input type="text" placeholder="0000000000000" className="text-blue-400" {...field('protocolo')} /></div>
          <div className="input-group col-span-3">
            <label>Motivo Atual</label>
            <input type="text" readOnly placeholder="Headset, VPN, etc..." value={slot?.motivoAtual ?? ''}
              style={{ background: 'rgba(251,191,36,.05)', borderColor: 'rgba(251,191,36,.3)', color: '#fbbf24' }} />
          </div>
          <div className="input-group">
            <label>Qtd. Abandono</label>
            <input type="text" readOnly placeholder="0" value={slot?.quantidadeAbandono ?? ''}
              style={{ background: 'rgba(239,68,68,.05)', borderColor: 'rgba(239,68,68,.3)', color: '#ef4444' }} />
          </div>
          <div className="input-group col-span-2">
            <label>Qtd. Chats</label>
            <input type="text" readOnly placeholder="0" value={slot?.quantidadeChats ?? ''}
              style={{ background: 'rgba(59,130,246,.05)', borderColor: 'rgba(59,130,246,.3)', color: '#3b82f6' }} />
          </div>
          <TagPicker slotId={id} />
          <input type="text" placeholder="Insira o motivo..."
            className="col-span-3 p-2 bg-[#050a15] border border-blue-900/50 rounded text-xs outline-none focus:border-blue-500"
            {...field('motivo')} />
        </div>

        <iframe
          id={`frame_${id}`}
          name={slotFrameName(id)}
          src={slot?.frameSrc ?? 'about:blank'}
          allow="fullscreen; clipboard-read; clipboard-write"
        />
      </div>
    </div>
  );
}
