'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface ConfirmRequest {
  message: string;
  resolve: (accepted: boolean) => void;
}

const ConfirmContext = createContext<(message: string) => Promise<boolean>>(
  () => Promise.resolve(false),
);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const confirm = useMemo(
    () => (message: string) => new Promise<boolean>((resolve) => setRequest({ message, resolve })),
    [],
  );

  function close(accepted: boolean) {
    request?.resolve(accepted);
    setRequest(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && (
        <div className="fw-modal-overlay" role="dialog" aria-modal="true">
          <div className="fw-modal">
            <div className="fw-modal-title">&gt;_ CONFIRMAÇÃO</div>
            <p>{request.message}</p>
            <div className="fw-modal-actions">
              <button className="settings-btn settings-btn-secondary" onClick={() => close(false)}>Cancelar</button>
              <button className="settings-btn settings-btn-primary" onClick={() => close(true)}>Confirmar</button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext);
}
