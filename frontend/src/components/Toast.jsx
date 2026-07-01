import { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle, XCircle, X } from 'lucide-react';

const ToastCtx = createContext(null);

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => setToasts(p => p.filter(t => t.id !== id)), []);

  const add = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, message, type }]);
    setTimeout(() => dismiss(id), 4500);
  }, [dismiss]);

  const api = { success: m => add(m, 'success'), error: m => add(m, 'error') };

  return (
    <ToastCtx.Provider value={api}>
      {children}
      {toasts.length > 0 && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 9999, maxWidth: 360, width: 'calc(100vw - 48px)' }}>
          {toasts.map(t => (
            <div key={t.id} style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              background: '#0f1923',
              border: `1px solid ${t.type === 'error' ? '#ef444488' : '#22c55e88'}`,
              borderRadius: 10, padding: '12px 14px',
              color: '#e2e8f0', fontSize: '0.88rem', lineHeight: 1.5,
              boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
            }}>
              {t.type === 'error'
                ? <XCircle     size={16} style={{ color: '#ef4444', flexShrink: 0, marginTop: 1 }} />
                : <CheckCircle size={16} style={{ color: '#22c55e', flexShrink: 0, marginTop: 1 }} />
              }
              <span style={{ flex: 1 }}>{t.message}</span>
              <button
                style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 0, flexShrink: 0, display: 'flex', marginTop: 1 }}
                onClick={() => dismiss(t.id)}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </ToastCtx.Provider>
  );
}
