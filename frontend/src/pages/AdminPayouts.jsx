import { useEffect, useState } from 'react';
import { CheckCircle, AlertTriangle, CreditCard } from 'lucide-react';
import { apiCall } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';

const S = {
  h1:   { color: '#e2e8f0', fontSize: '1.4rem', fontWeight: 700, marginBottom: '0.25rem' },
  sub:  { color: '#64748b', fontSize: '0.88rem', marginBottom: '1.5rem' },
  card: { background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 12, padding: '1.25rem', marginBottom: 12 },
  nick:   { color: '#e2e8f0', fontWeight: 700, fontSize: '1.05rem', marginBottom: 4 },
  total:  { color: '#14a89a', fontWeight: 700, fontSize: '1.3rem', marginBottom: 10 },
  txRow:  { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid #1e3a4a14' },
  txTitle: { color: '#94a3b8', fontSize: '0.82rem', flex: 1 },
  txAmt:   { color: '#14a89a', fontWeight: 600, fontSize: '0.88rem', whiteSpace: 'nowrap' },
  txDate:  { color: '#64748b', fontSize: '0.75rem', whiteSpace: 'nowrap' },
  confirmBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12, background: '#14a89a', border: 'none', borderRadius: 8, padding: '9px 18px', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: '0.88rem' },
  empty: { color: '#64748b', textAlign: 'center', padding: '4rem 2rem' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal:   { background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 14, padding: '2rem', maxWidth: 420, width: '90%' },
  modalTitle: { color: '#e2e8f0', fontWeight: 700, fontSize: '1.05rem', marginBottom: 10 },
  modalText:  { color: '#94a3b8', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '1.5rem' },
  modalBtns:  { display: 'flex', gap: 10, justifyContent: 'flex-end' },
  cancelBtn:  { background: 'none', border: '1px solid #334155', borderRadius: 8, padding: '8px 16px', color: '#94a3b8', cursor: 'pointer' },
  okBtn:      { background: '#14a89a', border: 'none', borderRadius: 8, padding: '8px 18px', color: '#fff', fontWeight: 600, cursor: 'pointer' },
};

export default function AdminPayouts() {
  const { profile } = useAuth();
  const toast = useToast();
  const [executors, setExecutors] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [modal, setModal]         = useState(null); // { executor }
  const [acting, setActing]       = useState(false);

  async function load() {
    setLoading(true);
    try { setExecutors(await apiCall('GET', '/admin/payouts') ?? []); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (profile?.is_admin) load(); }, [profile]);

  async function handleConfirm() {
    setActing(true);
    try {
      await apiCall('POST', `/admin/payouts/${modal.executor.id}/confirm`, {});
      setModal(null);
      load();
    } catch (e) { toast.error(e.message); }
    finally { setActing(false); }
  }

  if (!profile?.is_admin) return null;

  return (
    <div>
      <div style={S.h1}>Выплаты исполнителям</div>
      <div style={S.sub}>Исполнители с ожидающим балансом</div>

      {loading ? (
        <div style={{ color: '#64748b' }}>Загрузка...</div>
      ) : executors.length === 0 ? (
        <div style={S.empty}>Нет ожидающих выплат</div>
      ) : (
        executors.map(ex => (
          <div key={ex.id} style={S.card}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={S.nick}>{ex.nickname}</div>
                <div style={S.total}>{ex.balance_pending} ₽ к выплате</div>
                {ex.balance_available > 0 && (
                  <div style={{ color: '#64748b', fontSize: '0.78rem', marginBottom: 8 }}>
                    Выплачено всего: {ex.balance_available} ₽
                  </div>
                )}
              </div>
              <CreditCard size={20} style={{ color: '#14a89a', flexShrink: 0 }} />
            </div>

            {ex.transactions?.length > 0 && (
              <div style={{ marginBottom: 4 }}>
                {ex.transactions.map(tx => (
                  <div key={tx.id} style={S.txRow}>
                    <div style={S.txTitle}>{tx.orders?.title ?? `Заказ #${tx.order_id?.slice(0, 8)}`}</div>
                    <div style={S.txDate}>{new Date(tx.created_at).toLocaleDateString('ru-RU')}</div>
                    <div style={S.txAmt}>+{tx.amount} ₽</div>
                  </div>
                ))}
              </div>
            )}

            <button style={S.confirmBtn} onClick={() => setModal({ executor: ex })}>
              <CheckCircle size={15} /> Подтвердить выплату
            </button>
          </div>
        ))
      )}

      {modal && (
        <div style={S.overlay} onClick={() => !acting && setModal(null)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <AlertTriangle size={20} style={{ color: '#14a89a' }} />
              <div style={S.modalTitle}>Подтвердить выплату?</div>
            </div>
            <div style={S.modalText}>
              Вы перевели исполнителю <strong>{modal.executor.nickname}</strong> сумму{' '}
              <strong style={{ color: '#14a89a' }}>{modal.executor.balance_pending} ₽</strong>?
              <br /><br />
              После подтверждения средства перейдут из «ожидающих» в «выплаченные», и исполнитель увидит это в своём профиле.
            </div>
            <div style={S.modalBtns}>
              <button style={S.cancelBtn} onClick={() => setModal(null)} disabled={acting}>Нет, отмена</button>
              <button style={S.okBtn} onClick={handleConfirm} disabled={acting}>
                {acting ? 'Обработка...' : 'Да, перевёл'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
