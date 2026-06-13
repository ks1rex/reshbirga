import { useEffect, useState } from 'react';
import { Wallet as WalletIcon, ArrowDownCircle, ArrowUpCircle, Clock, Users, Copy, Check } from 'lucide-react';
import { apiCall } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import Spinner from '../components/Spinner';
import { formatCurrency, formatDate } from '../utils/format';

const S = {
  h1:   { color: '#e2e8f0', fontSize: '1.4rem', fontWeight: 700, marginBottom: '0.25rem' },
  balanceCard: {
    background: 'linear-gradient(135deg, #0d2a26 0%, #0f1923 100%)',
    border: '1px solid #0e8a7d',
    borderRadius: 14, padding: '2rem', marginBottom: '1.5rem',
    display: 'flex', alignItems: 'center', gap: 20,
  },
  balanceAmt: { color: '#14a89a', fontWeight: 800, fontSize: '2.2rem', lineHeight: 1 },
  balanceLabel: { color: '#64748b', fontSize: '0.85rem', marginTop: 4 },
  card: { background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 12, padding: '1.5rem', marginBottom: '1.5rem' },
  sectionTitle: { color: '#e2e8f0', fontWeight: 700, fontSize: '1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: 8 },
  note: { color: '#64748b', fontSize: '0.83rem', marginBottom: '1rem', lineHeight: 1.6 },
  requisites: { background: '#1a2332', border: '1px solid #1e3a4a', borderRadius: 8, padding: '12px 16px', color: '#e2e8f0', fontSize: '0.9rem', fontFamily: 'monospace', whiteSpace: 'pre-wrap', marginBottom: '1rem', wordBreak: 'break-all' },
  input: { width: '100%', background: '#1a2332', border: '1px solid #1e3a4a', borderRadius: 8, padding: '10px 12px', color: '#e2e8f0', fontSize: '0.92rem', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 8 },
  btn: { background: '#14a89a', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 22px', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer' },
  btnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  error: { color: '#f87171', fontSize: '0.83rem', marginBottom: 8 },
  historyRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: '1px solid #1e3a421a' },
  historyAmt: { fontWeight: 700, fontSize: '0.95rem', whiteSpace: 'nowrap' },
  historyDate: { color: '#64748b', fontSize: '0.78rem', marginTop: 2 },
  badge: (s) => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: '0.75rem', fontWeight: 600,
    background: s === 'confirmed' ? '#0d2620' : s === 'rejected' ? '#2d1515' : '#1a2332',
    color:      s === 'confirmed' ? '#14a89a' : s === 'rejected' ? '#f87171' : '#94a3b8',
  }),
  timer: { color: '#94a3b8', fontSize: '0.8rem', marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: 6 },
};

function statusLabel(s) {
  if (s === 'pending')   return 'Ожидает';
  if (s === 'confirmed') return 'Подтверждено';
  if (s === 'rejected')  return 'Отклонено';
  return s;
}

export default function Wallet() {
  const { profile, fetchProfile, user } = useAuth();
  const toast = useToast();

  const [loading, setLoading]   = useState(true);
  const [data, setData]         = useState(null);
  const [requisites, setRequisites] = useState('');

  // Deposit form
  const [depAmount, setDepAmount]   = useState('');
  const [depLoading, setDepLoading] = useState(false);
  const [depError, setDepError]     = useState('');

  // Withdrawal form
  const [wdAmount, setWdAmount]   = useState('');
  const [wdCard, setWdCard]       = useState('');
  const [wdLoading, setWdLoading] = useState(false);
  const [wdError, setWdError]     = useState('');

  // Referral copy state
  const [copied, setCopied] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [walletData, settingsData] = await Promise.all([
        apiCall('GET', '/wallet'),
        apiCall('GET', '/settings/payment_requisites').catch(() => ({ value: '' })),
      ]);
      setData(walletData);
      setRequisites(settingsData.value ?? '');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeposit(e) {
    e.preventDefault();
    setDepError('');
    const amt = parseFloat(depAmount);
    if (!amt || amt <= 0) { setDepError('Введите сумму'); return; }
    setDepLoading(true);
    try {
      await apiCall('POST', '/wallet/deposits', { claimed_amount: amt });
      toast.success('Заявка на пополнение отправлена! Средства будут зачислены после проверки.');
      setDepAmount('');
      load();
    } catch (e) {
      if (e.message.includes('429') || e.message.toLowerCase().includes('лимит')) {
        setDepError(e.message);
      } else {
        setDepError(e.message);
      }
    } finally {
      setDepLoading(false);
    }
  }

  async function handleWithdraw(e) {
    e.preventDefault();
    setWdError('');
    const amt = parseFloat(wdAmount);
    if (!amt || amt <= 0) { setWdError('Введите сумму'); return; }
    if (!wdCard.trim())   { setWdError('Введите номер карты'); return; }
    const balance = data?.balance ?? 0;
    if (amt > balance)    { setWdError(`На балансе только ${formatCurrency(balance)}`); return; }
    setWdLoading(true);
    try {
      await apiCall('POST', '/wallet/withdrawals', { amount: amt, card_number: wdCard.trim() });
      toast.success('Заявка на вывод отправлена! Перевод будет выполнен в течение 24 часов.');
      setWdAmount('');
      setWdCard('');
      await fetchProfile(user.id);
      load();
    } catch (e) {
      setWdError(e.message);
    } finally {
      setWdLoading(false);
    }
  }

  if (loading) return <Spinner />;

  const balance = data?.balance ?? 0;

  // Build the referral link client-side from the app's own base path so it always
  // points at the real route (the app is served under BASE_URL, e.g. /reshbirga/);
  // the backend's referral_link omits that prefix. Fall back to the API value.
  const referralLink = data?.referral_code
    ? `${window.location.origin}${import.meta.env.BASE_URL}register?ref=${data.referral_code}`
    : (data?.referral_link ?? null);

  return (
    <div style={{ maxWidth: 680 }}>
      <div style={S.h1}>Кошелёк</div>

      {/* Balance */}
      <div style={S.balanceCard}>
        <WalletIcon size={40} color="#14a89a" />
        <div>
          <div style={S.balanceAmt}>{formatCurrency(balance)}</div>
          <div style={S.balanceLabel}>Ваш баланс</div>
        </div>
      </div>

      {/* ─── Deposit ─── */}
      <div style={S.card}>
        <div style={S.sectionTitle}><ArrowDownCircle size={18} color="#14a89a" />Пополнить баланс</div>

        {requisites ? (
          <>
            <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: 6 }}>Номер карты для пополнений:</div>
            <div style={S.requisites}>{requisites}</div>
          </>
        ) : (
          <div style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: '1rem' }}>
            Реквизиты временно недоступны. Обратитесь в поддержку.
          </div>
        )}

        <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '1rem', lineHeight: 1.6 }}>
          Переведите любую сумму на эту карту, затем укажите сумму перевода и нажмите кнопку.
          После проверки администратором на ваш баланс поступит <strong style={{ color: '#e2e8f0' }}>90% от переведённой суммы</strong> (комиссия площадки&nbsp;10%).
        </div>

        <form onSubmit={handleDeposit}>
          <input
            style={S.input}
            type="number"
            min="1"
            step="any"
            placeholder="Сумма перевода, ₽"
            value={depAmount}
            onChange={e => setDepAmount(e.target.value)}
          />
          {depError && <div style={S.error}>{depError}</div>}
          <button style={{ ...S.btn, ...(depLoading ? S.btnDisabled : {}) }} disabled={depLoading}>
            {depLoading ? 'Отправка...' : 'Подтвердить перевод'}
          </button>
        </form>

        {data?.recent_deposits?.length > 0 && (
          <div style={{ marginTop: '1.25rem' }}>
            <div style={{ color: '#64748b', fontSize: '0.8rem', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>История заявок</div>
            {data.recent_deposits.map(d => (
              <div key={d.id} style={S.historyRow}>
                <div>
                  <div style={{ color: '#e2e8f0', fontSize: '0.88rem' }}>
                    Перевод {formatCurrency(d.claimed_amount)}
                    {d.credited_amount != null && (
                      <span style={{ color: '#14a89a', marginLeft: 6 }}>→ +{formatCurrency(d.credited_amount)}</span>
                    )}
                  </div>
                  <div style={S.historyDate}>{formatDate(d.created_at)}</div>
                  {d.admin_comment && <div style={{ color: '#64748b', fontSize: '0.78rem', marginTop: 2 }}>{d.admin_comment}</div>}
                </div>
                <span style={S.badge(d.status)}>{statusLabel(d.status)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Withdrawal ─── */}
      <div style={S.card}>
        <div style={S.sectionTitle}><ArrowUpCircle size={18} color="#14a89a" />Вывести средства</div>

        <form onSubmit={handleWithdraw}>
          <input
            style={S.input}
            type="number"
            min="1"
            step="any"
            placeholder={`Сумма (доступно ${formatCurrency(balance)})`}
            value={wdAmount}
            onChange={e => setWdAmount(e.target.value)}
          />
          <input
            style={S.input}
            type="text"
            placeholder="Номер карты для перевода"
            value={wdCard}
            onChange={e => setWdCard(e.target.value)}
          />
          {wdError && <div style={S.error}>{wdError}</div>}
          <button style={{ ...S.btn, ...(wdLoading ? S.btnDisabled : {}) }} disabled={wdLoading}>
            {wdLoading ? 'Отправка...' : 'Запросить вывод'}
          </button>
        </form>

        {data?.recent_withdrawals?.length > 0 && (
          <div style={{ marginTop: '1.25rem' }}>
            <div style={{ color: '#64748b', fontSize: '0.8rem', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>История заявок</div>
            {data.recent_withdrawals.map(w => (
              <div key={w.id} style={S.historyRow}>
                <div>
                  <div style={{ color: '#e2e8f0', fontSize: '0.88rem' }}>
                    Вывод {formatCurrency(w.amount)} на карту {w.card_number}
                  </div>
                  <div style={S.historyDate}>{formatDate(w.created_at)}</div>
                  {w.admin_comment && <div style={{ color: '#64748b', fontSize: '0.78rem', marginTop: 2 }}>{w.admin_comment}</div>}
                </div>
                <span style={S.badge(w.status)}>{statusLabel(w.status)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Referral ─── */}
      {referralLink && (
        <div style={S.card}>
          <div style={S.sectionTitle}><Users size={18} color="#14a89a" />Реферальная программа</div>
          <div style={S.note}>
            За первые 3 пополнения (от&nbsp;100&nbsp;₽) каждого приглашённого вам начисляется <strong style={{ color: '#e2e8f0' }}>5%&nbsp;от суммы перевода</strong>.
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: '1rem' }}>
            <input
              style={{ ...S.input, marginBottom: 0, flex: 1 }}
              readOnly
              value={referralLink}
              onFocus={e => e.target.select()}
            />
            <button
              style={{ ...S.btn, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
              onClick={() => {
                navigator.clipboard.writeText(referralLink);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? 'Скопировано' : 'Скопировать'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
            <div>
              <div style={{ color: '#64748b', fontSize: '0.78rem', marginBottom: 2 }}>Заработано по рефералам</div>
              <div style={{ color: '#14a89a', fontWeight: 700, fontSize: '1.1rem' }}>{formatCurrency(data.referral_earnings ?? 0)}</div>
            </div>
            <div>
              <div style={{ color: '#64748b', fontSize: '0.78rem', marginBottom: 2 }}>Зарегистрировано по вашей ссылке</div>
              <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: '1.1rem' }}>{data.referral_registered_count ?? 0}</div>
            </div>
          </div>
        </div>
      )}

      <div style={S.timer}>
        <Clock size={14} />
        ⏱ Пополнение и вывод средств могут занимать до 24 часов.
      </div>
    </div>
  );
}
