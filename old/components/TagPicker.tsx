'use client';

import { useEffect, useState } from 'react';
import { getFrame } from '@/lib/bridge/frames';
import { sendCommand } from '@/lib/bridge/protocol';
import { ROCKET_ORIGIN } from '@/lib/config';
import { useFirewall } from '@/store/firewall';

/** Porte de renderTagOptionsForSlot / loadTagOptionsForSlot / applyTagsFromSlot. */
export function TagPicker({ slotId }: { slotId: number }) {
  const slot = useFirewall((s) => s.slots[slotId]);
  const patchSlot = useFirewall((s) => s.patchSlot);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  // quando a extensão lê as tags já marcadas na sala, refletimos aqui
  useEffect(() => setSelected(slot?.tags ?? []), [slot?.tags]);

  if (!slot) return null;
  const options = slot.availableTags;

  const toggle = (t: string) => setSelected((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  async function refresh() {
    const frame = getFrame(slotId);
    if (!frame) return;
    setLoading(true);
    try {
      const res = await sendCommand<'OPEN_FETCH_TAG_OPTIONS'>(
        frame,
        { source: 'firewall-parent', type: 'OPEN_FETCH_TAG_OPTIONS', requestId: `${slotId}-${Date.now()}` },
        { rocketOrigin: ROCKET_ORIGIN, timeoutMs: 30_000 },
      );
      if (res.ok) patchSlot(slotId, { availableTags: res.options, tags: res.tags });
      else window.alert(`❌ ${res.message}`);
    } catch (e) {
      window.alert(`❌ ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  async function apply() {
    const frame = getFrame(slotId);
    if (!frame || !selected.length) return;
    try {
      const res = await sendCommand<'OPEN_APPLY_TAGS'>(
        frame,
        { source: 'firewall-parent', type: 'OPEN_APPLY_TAGS', tags: selected },
        { rocketOrigin: ROCKET_ORIGIN, timeoutMs: 60_000 },
      );
      if (res.ok) patchSlot(slotId, { tags: res.tags });
      else window.alert(`❌ ${res.message}`);
    } catch (e) {
      window.alert(`❌ ${(e as Error).message}`);
    }
  }

  return (
    <div className={`col-span-3 tag-box ${open ? 'is-open' : ''}`}>
      <div className="tag-box-header" onClick={() => setOpen((o) => !o)}>
        <span className="tag-box-label">🏷 Tags</span>
        <span className={`tag-box-summary ${selected.length ? 'has-value' : ''}`}>
          {selected.length ? selected.join(', ') : 'Nenhuma selecionada'}
        </span>
        <div className="tag-box-actions">
          <button
            type="button"
            title="Recarregar opções"
            className={`tag-refresh-btn ${loading ? 'is-loading' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              refresh();
            }}
          >
            ↺
          </button>
          <span className="tag-box-arrow">▾</span>
        </div>
      </div>
      <div className="tag-dropdown">
        <div className="tag-dropdown-list">
          {options.length === 0 ? (
            <div className="tag-dropdown-empty">Abra o chat para carregar as tags automaticamente.</div>
          ) : (
            options.map((t) => (
              <div key={t} className={`tag-row ${selected.includes(t) ? 'selected' : ''}`} onClick={() => toggle(t)}>
                <span className="tag-row-check">✓</span>
                {t}
              </div>
            ))
          )}
        </div>
        <button type="button" className="tag-apply-btn" onClick={apply}>
          ✓ Aplicar na Tabulação
        </button>
      </div>
    </div>
  );
}
