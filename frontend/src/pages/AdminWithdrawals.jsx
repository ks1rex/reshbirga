import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Copy } from 'lucide-react';
import { apiCall } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';
import { formatCurrency, formatDate } from '../utils/format';

const S = {
  h1:  { color: '#e2e8f0', fontSize: '1.4rem', fontWeight: 700, marginBottom: '0.25rem' },
  sub: { color: '#64748b', fontSize: '0.88rem', marginBottom: '1.5rem' },
  card: { background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 12, padding: '1.25rem', marginBottom: 10 },
  nick: { color: '#e2e8f0', fontWeight: 700, fontSize: '0.98rem' },
  meta: { color: '#64748b', fontSize: '0.78rem', marginTop: 2 },
  amount: { color: '#14a89a', fontWeight: 700, fontSize: '1.15rem' },
  card_number: { color: '#e2e8f0', fontFamily: 'monospace', fontSize: '0.95rem', letterSpacing: '0.05em', background: '#1a2332', padding: '4px 10px', borderRadius: 6, display: 'inline-block', marginTop: 4 },
  actions: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 12 },
  confirmBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#14a89a', border: 'none', borderRadius: 8, padding: '8px 16px', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' },
  rejectBtn:  { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#2d1515', border: '1px solid #7f1d1d', borderRadius: 8, padding: '8px 16px', color: '#f87171', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' },
  commentInput: { background: '#1a2332', border: '1px solid #1e3a4a', borderRadius: 7, padding: '7px 10px', color: '#e2e8f0', fontSize: '0.85rem', width: '100%', fontFamily: 'inherit', resize: 'vertical', marginTop: 6 },
  filterRow: { display: 'flex', gap: 8, marginBottom: '1.5rem', flexWrap: 'wrap' },
  filterBtn: (a) => ({ padding: '6px 16px', borderRadius: 20, border: '1px solid', fontSize: '0.83rem', cursor: 'pointer', fontWeight: a ? 600 : 400, background: a ? '#14a89a' : 'transparent', color: a ? '#fff' : '#64748b', borderColor: a ? '#14a89a' : '#334155' }),
  copyBtn: { background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '2px 6px', verticalAlign: 'middle' },
};

export default function AdminWithdrawals() {
  const { profile } = useAuth();
  const toast = useToast();

  const [withdrawals, setWithdrawals] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [filter, setFilter]           = useState('pending');

  const [rejectOpen, setRejectOpen]       = useState({});
  const [rejectComment, setRejectComment] = useState({});
  const [acting, setActing]               = useState({});

  async function load() {
    setLoading(true);
    try {
      const data = await apiCall('GET', `/admin/withdrawals?status=${filter}`);
      setWithdrawals(data ?? []);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (profile?.is_admin) load(); }, [profile, filter]);

  async function handleConfirm(wr) {
    setActing(a => ({ ...a, [wr.id]: true }));
    try {
      await apiCall('POST', `/admin/withdrawals/${wr.id}/confirm`, {});
      toast.success(`Вывод ${formatCurrency(wr.amount)} подтверждён`);
      load();
    } catch (e) { toast.error(e.message); }
    finally { setActing(a => ({ ...a, [wr.id]: false })); }
  }

  async function handleReject(wr) {
    setActing(a => ({ ...a, [wr.id]: true }));
    try {
      await apiCall('POST', `/admin/withdrawals/${wr.id}/reject`, { admin_comment: rejectComment[wr.id] ?? '' });
      toast.success('Заявка отклонена, средства возвращены на баланс');
      load();
    } catch (e) { toast.error(e.message); }
    finally { setActing(a => ({ ...a, [wr.id]: false })); }
  }

  function copyCard(num) {
    navigator.clipboard.writeText(num).then(() => toast.success('Номер карты скопирован'));
  }

  if (!profile?.is_admin) return null;

  return (
    <div>
      <div style={S.h1}>Заявки на вывод</div>
      <div style={S.sub}>Переведите средства пользователю и подтвердите</div>

      <div style={S.filterRow}>
        {['pending', 'confirmed', 'rejected'].map(s => (
          <button key={s} style={S.filterBtn(filter === s)} onClick={() => setFilter(s)}>
            {s === 'pending' ? 'Ожидают' : s === 'confirmed' ? 'Выполненные' : 'Отклонённые'}
          </button>
        ))}
      </div>

      {loading ? <Spinner /> : withdrawals.length === 0 ? (
        <EmptyState>Нет заявок</EmptyState>
      ) : (
        withdrawals.map(wr => (
          <div key={wr.id} style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={S.nick}>{wr.user?.nickname ?? '—'}</div>
                <div style={S.meta}>{formatDate(wr.created_at)}</div>
                <div style={S.card_number}>
                  {wr.card_number}
                  {wr.status === 'pending' && (
                    <button style={S.copyBtn} onClick={() => copyCard(wr.card_number)} title="Скопировать">
                      <Copy size={13} />
                    </button>
                  )}
                </div>
              </div>
              <div style={S.amount}>{formatCurrency(wr.amount)}</div>
            </div>

            {wr.admin_comment && (
              <div style={{ color: '#64748b', fontSize: '0.8rem', marginTop: 6 }}>Комментарий: {wr.admin_comment}</div>
            )}

            {wr.status === 'pending' && (
              <>
                <div style={S.actions}>
                  <button style={S.confirmBtn} onClick={() => handleConfirm(wr)} disabled={acting[wr.id]}>
                    <CheckCircle size={14} />{acting[wr.id] ? '...' : 'Перевёл, подтвердить'}
                  </button>
                  <button style={S.rejectBtn} onClick={() => setRejectOpen(o => ({ ...o, [wr.id]: !o[wr.id] }))} disabled={acting[wr.id]}>
                    <XCircle size={14} />Отклонить
                  </button>
                </div>

                {rejectOpen[wr.id] && (
                  <div style={{ marginTop: 8 }}>
                    <textarea
                      style={S.commentInput}
                      rows={2}
                      placeholder="Причина отклонения (необязательно)"
                      value={rejectComment[wr.id] ?? ''}
                      onChange={e => setRejectComment(c => ({ ...c, [wr.id]: e.target.value }))}
                    />
                    <button style={{ ...S.rejectBtn, marginTop: 6 }} onClick={() => handleReject(wr)} disabled={acting[wr.id]}>
                      {acting[wr.id] ? 'Обработка...' : 'Подтвердить отклонение'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ))
      )}
    </div>
  );
}
