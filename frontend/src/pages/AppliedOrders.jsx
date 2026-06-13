import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Inbox } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiCall } from '../utils/api';
import { StatusBadge } from '../utils/statusMap';
import { formatCurrency, formatDate } from '../utils/format';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';

const APP_STATUS = {
  pending:  { label: 'На рассмотрении', color: '#f59e0b' },
  accepted: { label: 'Принята',         color: '#22c55e' },
  rejected: { label: 'Отклонена',       color: '#64748b' },
};
const TYPE_LABEL = { order: 'Заказ', service: 'Услуга' };

const S = {
  h1:  { color: '#e2e8f0', fontSize: '1.4rem', fontWeight: 700, marginBottom: '1.5rem' },
  row: { background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 10, padding: '1rem 1.25rem', marginBottom: 8, display: 'flex', alignItems: 'center', gap: '1rem', textDecoration: 'none', flexWrap: 'wrap' },
  title:   { color: '#e2e8f0', fontWeight: 600, fontSize: '0.95rem' },
  meta:    { color: '#64748b', fontSize: '0.78rem', marginTop: 2 },
  appBadge: (color) => ({ display: 'inline-block', padding: '2px 9px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600, background: color + '22', color, border: `1px solid ${color}44`, whiteSpace: 'nowrap' }),
  price:   { color: '#14a89a', fontWeight: 700, whiteSpace: 'nowrap', fontSize: '0.95rem' },
};

export default function AppliedOrders() {
  const { user } = useAuth();
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    apiCall('GET', '/orders/applied')
      .then(data => setItems(Array.isArray(data) ? data : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [user]);

  if (loading) return <Spinner />;

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div style={S.h1}>Мои отклики</div>

      {items.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Откликов пока нет"
          subtitle="Перейдите на биржу заказов и откликнитесь на понравившийся заказ"
          action={<Link to="/orders" style={{ background: '#14a89a', color: '#fff', textDecoration: 'none', borderRadius: 8, padding: '8px 18px', fontWeight: 600, fontSize: '0.9rem' }}>Биржа заказов</Link>}
        />
      ) : (
        items.map(item => {
          const order   = item.orders;
          const appMeta = APP_STATUS[item.status] ?? APP_STATUS.pending;
          return (
            <Link key={item.id} to={`/orders/${order?.id}`} style={S.row}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={S.title}>{order?.title ?? 'Заказ'}</div>
                <div style={S.meta}>
                  {order?.subject} · {TYPE_LABEL[order?.order_type]} · {formatDate(item.created_at)}
                </div>
              </div>
              <span style={S.appBadge(appMeta.color)}>{appMeta.label}</span>
              {order && <StatusBadge status={order.status} />}
              {item.proposed_amount && <div style={S.price}>{formatCurrency(item.proposed_amount)}</div>}
              <ChevronRight size={16} style={{ color: '#334155', flexShrink: 0 }} />
            </Link>
          );
        })
      )}
    </div>
  );
}
