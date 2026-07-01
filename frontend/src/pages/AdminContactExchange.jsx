import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, ExternalLink, AlertTriangle } from 'lucide-react';
import { apiCall } from '../utils/api';
import { formatCurrency, formatDate } from '../utils/format';
import { StatusBadge } from '../utils/statusMap';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';

const S = {
  h1: { color: '#e2e8f0', fontSize: '1.3rem', fontWeight: 700, marginBottom: '0.25rem' },
  sub: { color: '#64748b', fontSize: '0.88rem', marginBottom: '1.5rem' },
  filterRow: { display: 'flex', gap: 8, marginBottom: '1.25rem', flexWrap: 'wrap' },
  filterBtn: (a) => ({ padding: '6px 16px', borderRadius: 20, border: '1px solid', fontSize: '0.83rem', cursor: 'pointer', fontWeight: a ? 600 : 400, background: a ? '#14a89a' : 'transparent', color: a ? '#fff' : '#64748b', borderColor: a ? '#14a89a' : '#334155' }),
  card: { background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 12, padding: '1.15rem', marginBottom: 10 },
  titleRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 6 },
  title: { color: '#e2e8f0', fontWeight: 600, fontSize: '0.95rem', textDecoration: 'none' },
  meta: { display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: '0.8rem', color: '#64748b', marginTop: 4 },
  metaVal: { color: '#94a3b8', fontWeight: 500 },
  reason: { color: '#fca5a5', background: '#1f0808', border: '1px solid #ef444422', borderRadius: 8, padding: '7px 10px', fontSize: '0.82rem', marginTop: 8 },
  flagBadge: { display: 'inline-flex', alignItems: 'center', gap: 4, background: '#ef444422', color: '#ef4444', borderRadius: 10, padding: '2px 8px', fontSize: '0.75rem', fontWeight: 600 },
  actions: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 },
  actionLink: { display: 'inline-flex', alignItems: 'center', gap: 5, color: '#64748b', fontSize: '0.8rem', textDecoration: 'none', border: '1px solid #334155', borderRadius: 7, padding: '5px 10px' },
  userLink: { color: '#14a89a', textDecoration: 'none', fontSize: '0.8rem' },
};

const STATUSES = [
  { value: '', label: 'Все' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'disputed', label: 'Споры' },
  { value: 'completed', label: 'Завершённые' },
];

export default function AdminContactExchange() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  async function load(s = statusFilter) {
    setLoading(true);
    try {
      const qs = s ? `?status=${s}` : '';
      const data = await apiCall('GET', `/admin/contact-exchange-orders${qs}`);
      setOrders(data ?? []);
    } catch { setOrders([]); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function handleFilter(s) {
    setStatusFilter(s);
    load(s);
  }

  return (
    <div>
      <div style={S.h1}>Сделки с обменом контактов</div>
      <div style={S.sub}>Заказы, где разрешён обмен контактными данными</div>

      <div style={S.filterRow}>
        {STATUSES.map(({ value, label }) => (
          <button key={value} style={S.filterBtn(statusFilter === value)} onClick={() => handleFilter(value)}>
            {label}
          </button>
        ))}
      </div>

      {loading ? <Spinner /> : orders.length === 0 ? (
        <EmptyState>Нет заказов</EmptyState>
      ) : (
        orders.map(order => (
          <div key={order.id} style={S.card}>
            <div style={S.titleRow}>
              <Link to={`/orders/${order.id}`} style={S.title}>
                <ExternalLink size={13} style={{ marginRight: 5, verticalAlign: 'middle', color: '#14a89a' }} />
                {order.title}
              </Link>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <StatusBadge status={order.status} />
                {order.flagged_messages > 0 && (
                  <span style={S.flagBadge}><AlertTriangle size={11} />{order.flagged_messages} флаг</span>
                )}
              </div>
            </div>

            <div style={S.meta}>
              <span>Заказчик: <Link to={`/admin/users`} style={S.userLink}>{order.customer?.nickname ?? '—'}</Link></span>
              <span>Исполнитель: <Link to={`/admin/users`} style={S.userLink}>{order.executor?.nickname ?? '—'}</Link></span>
              {parseFloat(order.deposit_amount ?? 0) > 0 && (
                <span>Залог: <span style={S.metaVal}>{formatCurrency(order.deposit_amount)}</span></span>
              )}
              <span>{formatDate(order.created_at)}</span>
            </div>

            {order.contact_exchange_reason && (
              <div style={S.reason}>
                <AlertTriangle size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} />
                {order.contact_exchange_reason}
              </div>
            )}

            <div style={S.actions}>
              {order.conversation_id && (
                <Link to={`/orders/${order.id}/chat`} style={S.actionLink}>
                  <MessageSquare size={13} />Посмотреть чат
                </Link>
              )}
              <Link to={`/admin/users`} style={S.actionLink}>
                <ExternalLink size={13} />Управление пользователями
              </Link>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
