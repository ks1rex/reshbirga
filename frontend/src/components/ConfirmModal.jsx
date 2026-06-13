import { AlertTriangle } from 'lucide-react';

const S = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 14, padding: '2rem', maxWidth: 420, width: '90%' },
  title: { color: '#e2e8f0', fontWeight: 700, fontSize: '1.05rem', marginBottom: 8 },
  body: { color: '#94a3b8', fontSize: '0.88rem', lineHeight: 1.6, marginBottom: '1.5rem' },
  btns: { display: 'flex', gap: 10, justifyContent: 'flex-end' },
  cancel: { background: 'none', border: '1px solid #334155', borderRadius: 8, padding: '8px 16px', color: '#94a3b8', cursor: 'pointer', fontSize: '0.88rem' },
  ok: (danger) => ({ background: danger ? '#ef4444' : '#14a89a', border: 'none', borderRadius: 8, padding: '8px 18px', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: '0.88rem' }),
};

/**
 * Props:
 *   open         — boolean
 *   title        — string
 *   body         — ReactNode
 *   confirmLabel — string (default "Подтвердить")
 *   danger       — boolean (red confirm button)
 *   loading      — boolean
 *   onConfirm    — fn
 *   onCancel     — fn
 *   error        — string
 */
export default function ConfirmModal({ open, title, body, confirmLabel = 'Подтвердить', danger = false, loading = false, onConfirm, onCancel, error }) {
  if (!open) return null;
  return (
    <div style={S.overlay} onClick={() => !loading && onCancel?.()}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <AlertTriangle size={20} style={{ color: danger ? '#ef4444' : '#14a89a', flexShrink: 0 }} />
          <div style={S.title}>{title}</div>
        </div>
        <div style={S.body}>{body}</div>
        {error && <div style={{ color: '#f87171', fontSize: '0.82rem', marginBottom: 12 }}>{error}</div>}
        <div style={S.btns}>
          <button style={S.cancel} onClick={onCancel} disabled={loading}>Отмена</button>
          <button style={S.ok(danger)} onClick={onConfirm} disabled={loading}>
            {loading ? 'Обработка...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
