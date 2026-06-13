import { useEffect, useState } from 'react';
import { CheckCircle, XCircle } from 'lucide-react';
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
  amtClaimed: { color: '#94a3b8', fontSize: '0.9rem' },
  confirmedInput: {
    background: '#1a2332', border: '1px solid #1e3a4a', borderRadius: 7,
    padding: '7px 10px', color: '#e2e8f0', fontSize: '0.88rem', width: 140,
  },
  actions: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10 },
  confirmBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#14a89a', border: 'none', borderRadius: 8, padding: '8px 16px', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' },
  rejectBtn:  { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#2d1515', border: '1px solid #7f1d1d', borderRadius: 8, padding: '8px 16px', color: '#f87171', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' },
  commentInput: { background: '#1a2332', border: '1px solid #1e3a4a', borderRadius: 7, padding: '7px 10px', color: '#e2e8f0', fontSize: '0.85rem', width: '100%', fontFamily: 'inherit', resize: 'vertical', marginTop: 6 },
  filterRow: { display: 'flex', gap: 8, marginBottom: '1.5rem', flexWrap: 'wrap' },
  filterBtn: (a) => ({ padding: '6px 16px', borderRadius: 20, border: '1px solid', fontSize: '0.83rem', cursor: 'pointer', fontWeight: a ? 600 : 400, background: a ? '#14a89a' : 'transparent', color: a ? '#fff' : '#64748b', borderColor: a ? '#14a89a' : '#334155' }),
  credited: { color: '#14a89a', fontWeight: 700, fontSize: '0.88rem' },
};

export default function AdminDeposits() {
  const { profile } = useAuth();
  const toast = useToast();

  const [deposits, setDeposits] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState('pending');

  // Per-row state
  const [confirmedAmts, setConfirmedAmts]   = useState({});
  const [rejectOpen, setRejectOpen]         = useState({});
  const [rejectComment, setRejectComment]   = useState({});
  const [acting, setActing]                 = useState({});

  async function load() {
    setLoading(true);
    try {
      const data = await apiCall('GET', `/admin/deposits?status=${filter}`);
      setDeposits(data ?? []);
      const amts = {};
      for (const d of (data ?? [])) amts[d.id] = String(d.claimed_amount);
      setConfirmedAmts(amts);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (profile?.is_admin) load(); }, [profile, filter]);

  function calcBreakdown(dep) {
    const confirmed = parseFloat(confirmedAmts[dep.id]) || 0;
    const credited  = Math.round(confirmed * 0.9 * 100) / 100;
    const isRef     = dep.has_referrer && (dep.referral_qualifying_deposits_count < 3) && confirmed >= 100;
    const commPct   = isRef ? 5 : 10;
    const commAmt   = Math.round(confirmed * (commPct / 100) * 100) / 100;
    const bonus     = isRef ? Math.round(confirmed * 0.05 * 100) / 100 : 0;
    return { confirmed, credited, isRef, commPct, commAmt, bonus };
  }

  async function handleConfirm(dep) {
    setActing(a => ({ ...a, [dep.id]: true }));
    try {
      const confirmed_amount = parseFloat(confirmedAmts[dep.id]);
      const result = await apiCall('POST', `/admin/deposits/${dep.id}/confirm`, { confirmed_amount });
      const bonus = result.referral_bonus ?? 0;
      const msg = bonus > 0
        ? `Зачислено ${formatCurrency(result.credited_amount)} · Реф. бонус ${formatCurrency(bonus)} → ${dep.referrer_nickname}`
        : `Зачислено ${formatCurrency(result.credited_amount)} (−10% комиссия)`;
      toast.success(msg);
      load();
    } catch (e) { toast.error(e.message); }
    finally { setActing(a => ({ ...a, [dep.id]: false })); }
  }

  async function handleReject(dep) {
    setActing(a => ({ ...a, [dep.id]: true }));
    try {
      await apiCall('POST', `/admin/deposits/${dep.id}/reject`, { admin_comment: rejectComment[dep.id] ?? '' });
      toast.success('Заявка отклонена');
      load();
    } catch (e) { toast.error(e.message); }
    finally { setActing(a => ({ ...a, [dep.id]: false })); }
  }

  if (!profile?.is_admin) return null;

  return (
    <div>
      <div style={S.h1}>Заявки на пополнение</div>
      <div style={S.sub}>Подтвердите или отклоните перевод пользователя</div>

      <div style={S.filterRow}>
        {['pending', 'confirmed', 'rejected'].map(s => (
          <button key={s} style={S.filterBtn(filter === s)} onClick={() => setFilter(s)}>
            {s === 'pending' ? 'Ожидают' : s === 'confirmed' ? 'Подтверждённые' : 'Отклонённые'}
          </button>
        ))}
      </div>

      {loading ? <Spinner /> : deposits.length === 0 ? (
        <EmptyState>Нет заявок</EmptyState>
      ) : (
        deposits.map(dep => (
          <div key={dep.id} style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={S.nick}>{dep.user?.nickname ?? '—'}</div>
                <div style={S.meta}>{formatDate(dep.created_at)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={S.amtClaimed}>Заявлено: <strong>{formatCurrency(dep.claimed_amount)}</strong></div>
                {dep.credited_amount != null && (
                  <div style={S.credited}>Зачислено: +{formatCurrency(dep.credited_amount)}</div>
                )}
              </div>
            </div>

            {dep.admin_comment && (
              <div style={{ color: '#64748b', fontSize: '0.8rem', marginTop: 6 }}>Комментарий: {dep.admin_comment}</div>
            )}

            {dep.status === 'pending' && (() => {
              const bd = calcBreakdown(dep);
              return (
              <>
                <div style={S.actions}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: '#94a3b8', fontSize: '0.83rem' }}>Переведено:</span>
                    <input
                      style={S.confirmedInput}
                      type="number"
                      min="0.01"
                      step="any"
                      value={confirmedAmts[dep.id] ?? ''}
                      onChange={e => setConfirmedAmts(a => ({ ...a, [dep.id]: e.target.value }))}
                    />
                    <span style={{ color: '#64748b', fontSize: '0.83rem' }}>₽</span>
                  </div>
                  <button style={S.confirmBtn} onClick={() => handleConfirm(dep)} disabled={acting[dep.id]}>
                    <CheckCircle size={14} />{acting[dep.id] ? '...' : 'Подтвердить'}
                  </button>
                  <button style={S.rejectBtn} onClick={() => setRejectOpen(o => ({ ...o, [dep.id]: !o[dep.id] }))} disabled={acting[dep.id]}>
                    <XCircle size={14} />Отклонить
                  </button>
                </div>

                {bd.confirmed > 0 && (
                  <div style={{ marginTop: 8, padding: '8px 12px', background: '#0a1420', borderRadius: 8, fontSize: '0.82rem', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <div style={{ color: '#94a3b8' }}>
                      Поступит пользователю: <strong style={{ color: '#14a89a' }}>{formatCurrency(bd.credited)}</strong>
                    </div>
                    <div style={{ color: bd.isRef ? '#f59e0b' : '#94a3b8' }}>
                      Комиссия сайта: <strong>{bd.commPct}%</strong> ({formatCurrency(bd.commAmt)})
                    </div>
                    {bd.isRef && (
                      <div style={{ color: '#f59e0b' }}>
                        Из них 5% ({formatCurrency(bd.bonus)}) — реферальный бонус пользователю{' '}
                        <strong>{dep.referrer_nickname}</strong>{' '}
                        (пополнение {dep.referral_qualifying_deposits_count + 1} из 3)
                      </div>
                    )}
                  </div>
                )}

                {rejectOpen[dep.id] && (
                  <div style={{ marginTop: 8 }}>
                    <textarea
                      style={S.commentInput}
                      rows={2}
                      placeholder="Причина отклонения (необязательно)"
                      value={rejectComment[dep.id] ?? ''}
                      onChange={e => setRejectComment(c => ({ ...c, [dep.id]: e.target.value }))}
                    />
                    <button style={{ ...S.rejectBtn, marginTop: 6 }} onClick={() => handleReject(dep)} disabled={acting[dep.id]}>
                      {acting[dep.id] ? 'Обработка...' : 'Подтвердить отклонение'}
                    </button>
                  </div>
                )}
              </>
          );
        })()}
          </div>
        ))
      )}
    </div>
  );
}
