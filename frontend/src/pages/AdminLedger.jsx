import { useState, useEffect } from 'react';
import { apiCall } from '../utils/api';
import { formatCurrency } from '../utils/format';
import Spinner from '../components/Spinner';

const TX_TYPES = [
  { value: '', label: 'Все типы' },
  { value: 'deposit',                label: 'Пополнение' },
  { value: 'withdrawal',             label: 'Вывод' },
  { value: 'order_payment',          label: 'Оплата заказа' },
  { value: 'order_cancel_refund',    label: 'Возврат (отмена)' },
  { value: 'order_refund_excess',    label: 'Возврат излишка' },
  { value: 'order_topup',            label: 'Доплата заказа' },
  { value: 'order_payout',           label: 'Выплата исполнителю' },
  { value: 'dispute_refund_customer', label: 'Возврат (спор)' },
  { value: 'dispute_refund_full',    label: 'Полный возврат (спор)' },
];

const TYPE_LABEL = Object.fromEntries(TX_TYPES.slice(1).map(t => [t.value, t.label]));

const S = {
  h1: { color: '#e2e8f0', fontSize: '1.3rem', fontWeight: 700, marginBottom: '1.5rem' },
  filters: { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: '1.25rem', alignItems: 'flex-end' },
  select: { background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 8, padding: '8px 10px', color: '#e2e8f0', fontSize: '0.88rem' },
  input: { background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 8, padding: '8px 10px', color: '#e2e8f0', fontSize: '0.88rem', width: 160 },
  btn: { background: '#14a89a', border: 'none', borderRadius: 8, padding: '8px 18px', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: '0.88rem' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', color: '#64748b', fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', padding: '8px 12px', borderBottom: '1px solid #1e3a4a' },
  td: { padding: '10px 12px', color: '#e2e8f0', fontSize: '0.88rem', borderBottom: '1px solid #1a2b38', verticalAlign: 'middle' },
  empty: { color: '#64748b', padding: '2rem', textAlign: 'center' },
};

function typeBadge(type) {
  const label = TYPE_LABEL[type] ?? type;
  const isIn = ['deposit', 'order_cancel_refund', 'order_refund_excess', 'dispute_refund_customer', 'dispute_refund_full', 'order_payout'].includes(type);
  const isOut = ['withdrawal', 'order_payment', 'order_topup'].includes(type);
  const color = isIn ? '#22c55e' : isOut ? '#ef4444' : '#94a3b8';
  return (
    <span style={{ background: color + '22', color, border: `1px solid ${color}44`, borderRadius: 12, padding: '2px 8px', fontSize: '0.74rem', fontWeight: 600 }}>
      {label}
    </span>
  );
}

export default function AdminLedger() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(false);
  const [type, setType]       = useState('');
  const [nickname, setNickname] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]   = useState('');

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (type) params.set('type', type);
      if (nickname.trim()) params.set('nickname', nickname.trim());
      if (dateFrom) params.set('date_from', new Date(dateFrom).toISOString());
      if (dateTo)   params.set('date_to', new Date(dateTo + 'T23:59:59').toISOString());
      const qs = params.toString();
      const data = await apiCall('GET', `/admin/ledger${qs ? '?' + qs : ''}`);
      setRows(data ?? []);
    } catch (e) {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div>
      <div style={S.h1}>Журнал транзакций</div>

      <div style={S.filters}>
        <select style={S.select} value={type} onChange={e => setType(e.target.value)}>
          {TX_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <input style={S.input} placeholder="Никнейм" value={nickname} onChange={e => setNickname(e.target.value)} />
        <input style={S.input} type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="От" />
        <input style={S.input} type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} title="До" />
        <button style={S.btn} onClick={load}>Применить</button>
      </div>

      {loading ? <Spinner /> : (
        rows.length === 0 ? (
          <div style={S.empty}>Транзакций не найдено</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Тип</th>
                  <th style={S.th}>Пользователь</th>
                  <th style={S.th}>Сумма</th>
                  <th style={S.th}>Заказ</th>
                  <th style={S.th}>Дата</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(tx => (
                  <tr key={tx.id}>
                    <td style={S.td}>{typeBadge(tx.type)}</td>
                    <td style={{ ...S.td, color: '#14a89a' }}>{tx.user?.nickname ?? '—'}</td>
                    <td style={S.td}>{formatCurrency(tx.amount)}</td>
                    <td style={{ ...S.td, color: '#64748b', fontSize: '0.78rem' }}>
                      {tx.order_id ? tx.order_id.slice(0, 8).toUpperCase() : '—'}
                    </td>
                    <td style={{ ...S.td, color: '#64748b', fontSize: '0.8rem' }}>
                      {new Date(tx.created_at).toLocaleString('ru-RU')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
