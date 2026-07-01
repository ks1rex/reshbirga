import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PlusCircle, ChevronRight, ClipboardList } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiCall } from '../utils/api';
import { StatusBadge } from '../utils/statusMap';
import { formatCurrency, formatDate } from '../utils/format';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';

const ORDER_TYPE_LABEL = { order: 'Заказ', service: 'Услуга' };

const S = {
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: 12 },
  h1: { color: '#e2e8f0', fontSize: '1.4rem', fontWeight: 700 },
  newBtn: { display: 'flex', alignItems: 'center', gap: 6, background: '#14a89a', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer', textDecoration: 'none', whiteSpace: 'nowrap' },
  row: { background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 10, padding: '1rem 1.25rem', marginBottom: 8, display: 'flex', alignItems: 'center', gap: '1rem', textDecoration: 'none', flexWrap: 'wrap' },
  title: { color: '#e2e8f0', fontWeight: 600, fontSize: '0.95rem' },
  subject: { color: '#64748b', fontSize: '0.78rem', marginTop: 2 },
  amount: { color: '#14a89a', fontWeight: 700, fontSize: '1rem', whiteSpace: 'nowrap' },
};

export default function MyOrders() {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    apiCall('GET', '/orders/mine')
      .then(data => setOrders(Array.isArray(data) ? data : []))
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  }, [user]);

  if (loading) return <Spinner />;

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div style={S.header}>
        <div style={S.h1}>Мои заказы</div>
        <Link to="/orders/new" style={S.newBtn}><PlusCircle size={16} /> Создать заказ</Link>
      </div>

      {orders.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Заказов пока нет"
          subtitle="Создайте первый заказ — исполнители откликнутся уже сегодня"
          action={<Link to="/orders/new" style={S.newBtn}><PlusCircle size={16} /> Создать заказ</Link>}
        />
      ) : (
        orders.map(order => (
          <Link key={order.id} to={`/orders/${order.id}`} style={S.row}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={S.title}>{order.title}</div>
              <div style={S.subject}>
                {order.subject} · {ORDER_TYPE_LABEL[order.order_type]} · {formatDate(order.created_at)}
              </div>
            </div>
            <StatusBadge status={order.status} />
            <div style={S.amount}>{formatCurrency(order.reserved_amount)}</div>
            <ChevronRight size={16} style={{ color: '#334155', flexShrink: 0 }} />
          </Link>
        ))
      )}
    </div>
  );
}
