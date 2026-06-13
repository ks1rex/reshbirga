import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { apiCall } from '../utils/api';
import { useToast } from '../components/Toast';

const S = {
  h1: { color: '#e2e8f0', fontSize: '1.4rem', fontWeight: 700, marginBottom: '0.25rem' },
  sub: { color: '#64748b', fontSize: '0.88rem', marginBottom: '1.5rem' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { color: '#64748b', fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #1e3a4a' },
  td: { padding: '12px 12px', borderBottom: '1px solid #1e3a4a', color: '#e2e8f0', fontSize: '0.88rem', verticalAlign: 'middle' },
  confirmBtn: { display: 'flex', alignItems: 'center', gap: 5, background: '#0d2620', border: '1px solid #14a89a', borderRadius: 6, padding: '5px 12px', color: '#14a89a', fontSize: '0.82rem', cursor: 'pointer', fontWeight: 600 },
  rejectBtn:  { display: 'flex', alignItems: 'center', gap: 5, background: '#2d1515', border: '1px solid #ef4444', borderRadius: 6, padding: '5px 12px', color: '#ef4444', fontSize: '0.82rem', cursor: 'pointer', fontWeight: 600 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 14, padding: '2rem', maxWidth: 420, width: '90%' },
  modalTitle: { color: '#e2e8f0', fontWeight: 700, fontSize: '1.1rem', marginBottom: 8 },
  modalText: { color: '#94a3b8', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '1.5rem' },
  modalBtns: { display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' },
  cancelBtn: { background: 'none', border: '1px solid #334155', borderRadius: 8, padding: '8px 16px', color: '#94a3b8', cursor: 'pointer' },
  okBtn: (danger) => ({ background: danger ? '#ef4444' : '#14a89a', border: 'none', borderRadius: 8, padding: '8px 16px', color: '#fff', fontWeight: 600, cursor: 'pointer' }),
};

const TX_TYPE = { reserve: 'Резервирование', topup: 'Доплата', refund_excess: 'Возврат излишка' };

export default function AdminTransactions() {
  const toast = useToast();
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading]           = useState(true);
  const [modal, setModal]               = useState(null);
  const [acting, setActing]             = useState(false);

  async function load() {
    setLoading(true);
    try { setTransactions(await apiCall('GET', '/admin/transactions?status=pending') ?? []); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleConfirm() {
    setActing(true);
    try { await apiCall('POST', `/admin/transactions/${modal.tx.id}/confirm`, {}); setModal(null); load(); }
    catch (e) { toast.error(e.message); }
    finally { setActing(false); }
  }

  async function handleReject() {
    setActing(true);
    try { await apiCall('POST', `/admin/transactions/${modal.tx.id}/reject`, {}); setModal(null); load(); }
    catch (e) { toast.error(e.message); }
    finally { setActing(false); }
  }

  return (
    <div>
      <div style={S.h1}>Платежи в обработке</div>
      <div style={S.sub}>Подтвердите или отклоните ожидающие транзакции</div>

      {loading ? (
        <div style={{ color: '#64748b' }}>Загрузка...</div>
      ) : transactions.length === 0 ? (
        <div style={{ color: '#64748b', padding: '3rem', textAlign: 'center' }}>Нет ожидающих платежей</div>
      ) : (
        <div style={{ background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 12, overflow: 'hidden', overflowX: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Заказ</th>
                <th style={S.th}>Тип</th>
                <th style={S.th}>Заказчик</th>
                <th style={S.th}>Сумма</th>
                <th style={S.th}>Дата</th>
                <th style={S.th}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map(tx => (
                <tr key={tx.id}>
                  <td style={S.td}>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>{tx.orders?.title ?? '—'}</div>
                    <div style={{ color: '#64748b', fontSize: '0.75rem' }}>#{tx.order_id?.slice(0, 8).toUpperCase()}</div>
                  </td>
                  <td style={{ ...S.td, color: '#94a3b8', fontSize: '0.8rem' }}>{TX_TYPE[tx.type] ?? tx.type}</td>
                  <td style={S.td}>{tx.customer?.nickname ?? '—'}</td>
                  <td style={{ ...S.td, color: '#14a89a', fontWeight: 700 }}>{tx.amount} ₽</td>
                  <td style={{ ...S.td, color: '#64748b' }}>
                    {new Date(tx.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td style={S.td}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button style={S.confirmBtn} onClick={() => setModal({ type: 'confirm', tx })}>
                        <CheckCircle size={14} /> Подтвердить
                      </button>
                      <button style={S.rejectBtn} onClick={() => setModal({ type: 'reject', tx })}>
                        <XCircle size={14} /> Отклонить
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div style={S.overlay} onClick={() => !acting && setModal(null)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <AlertTriangle size={20} style={{ color: modal.type === 'reject' ? '#ef4444' : '#14a89a' }} />
              <div style={S.modalTitle}>{modal.type === 'confirm' ? 'Подтвердить оплату?' : 'Отклонить платёж?'}</div>
            </div>
            <div style={S.modalText}>
              {modal.type === 'confirm'
                ? <>Заказ <strong>«{modal.tx.orders?.title}»</strong> получит статус «Открыт». Сумма: <strong>{modal.tx.amount} ₽</strong>.</>
                : <>Платёж по заказу <strong>«{modal.tx.orders?.title}»</strong> будет отклонён. Заказ — «Отменён».</>
              }
            </div>
            <div style={S.modalBtns}>
              <button style={S.cancelBtn} onClick={() => setModal(null)} disabled={acting}>Отмена</button>
              <button style={S.okBtn(modal.type === 'reject')} onClick={modal.type === 'confirm' ? handleConfirm : handleReject} disabled={acting}>
                {acting ? 'Обработка...' : modal.type === 'confirm' ? 'Подтвердить' : 'Отклонить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
