import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Search, DollarSign, ChevronRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiCall } from '../utils/api';
import { formatCurrency } from '../utils/format';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';

const ORDER_META = { icon: DollarSign, label: 'Заказ', color: '#14a89a' };

const S = {
  header: { marginBottom: '1.5rem' },
  h1: { color: '#e2e8f0', fontSize: '1.4rem', fontWeight: 700, marginBottom: '1rem' },
  searchWrap: { position: 'relative', maxWidth: 480 },
  searchIcon: { position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#64748b', pointerEvents: 'none' },
  searchInput: { width: '100%', background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 8, padding: '9px 12px 9px 38px', color: '#e2e8f0', fontSize: '0.92rem' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' },
  card: { background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 12, padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  cardTitle: { color: '#e2e8f0', fontWeight: 600, fontSize: '1rem', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
  typeBadge: (color) => ({ display: 'inline-flex', alignItems: 'center', gap: 5, background: color + '18', color, border: `1px solid ${color}33`, borderRadius: 6, padding: '3px 9px', fontSize: '0.75rem', fontWeight: 600 }),
  subjectTag: { display: 'inline-block', background: '#1e3a4a', color: '#94a3b8', borderRadius: 6, padding: '3px 9px', fontSize: '0.75rem' },
  amount: { color: '#14a89a', fontWeight: 700, fontSize: '1.05rem' },
  amountSub: { color: '#64748b', fontSize: '0.78rem', marginTop: 2 },
  footer: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 4 },
  meta: { color: '#64748b', fontSize: '0.75rem' },
  btn: (variant) => ({
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '6px 14px', borderRadius: 7, fontSize: '0.82rem', fontWeight: 600,
    cursor: variant === 'disabled' ? 'default' : 'pointer',
    border: 'none', textDecoration: 'none',
    background: variant === 'primary' ? '#14a89a' : variant === 'muted' ? '#1e3a4a' : 'transparent',
    color: variant === 'primary' ? '#fff' : '#64748b',
    opacity: variant === 'disabled' ? 0.6 : 1,
  }),
  empty: { textAlign: 'center', color: '#64748b', padding: '4rem 2rem' },
};

function AmountBlock({ order }) {
  return (
    <div>
      <div style={S.amount}>{formatCurrency(order.base_amount)}</div>
      <div style={S.amountSub}>бюджет заказчика · можно предложить свою цену</div>
    </div>
  );
}

export default function OrderFeed() {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (q) => {
    setLoading(true);
    try {
      const params = q ? `?search=${encodeURIComponent(q)}` : '';
      const data = await apiCall('GET', `/orders${params}`);
      setOrders(Array.isArray(data) ? data : []);
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(search), 350);
    return () => clearTimeout(t);
  }, [search, load]);

  return (
    <div>
      <div style={S.header}>
        <div style={S.h1}>Биржа заказов</div>
        <div style={S.searchWrap}>
          <Search size={16} style={S.searchIcon} />
          <input
            style={S.searchInput}
            placeholder="Поиск по заголовку, предмету, описанию..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : orders.length === 0 ? (
        <EmptyState
          icon={Search}
          title={search ? 'Ничего не найдено' : 'Открытых заказов пока нет'}
          subtitle={search ? 'Попробуйте изменить запрос или очистить поиск' : 'Загляните позже — исполнители ждут новых заказов'}
        />
      ) : (
        <div style={S.grid}>
          {orders.map(order => {
            const meta = ORDER_META;
            const Icon = meta.icon;
            const isOwner = order.customer_id === user?.id;
            return (
              <div key={order.id} style={S.card}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div style={S.cardTitle}>{order.title}</div>
                </div>

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span style={S.typeBadge(meta.color)}>
                    <Icon size={12} />{meta.label}
                  </span>
                  <span style={S.subjectTag}>{order.subject}</span>
                </div>

                <AmountBlock order={order} />

                <div style={S.footer}>
                  <div style={S.meta}>
                    {order.customer?.nickname} · {new Date(order.created_at).toLocaleDateString('ru-RU')}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Link to={`/orders/${order.id}`} style={S.btn('muted')}>
                      <ChevronRight size={13} /> Подробнее
                    </Link>
                    {!isOwner && (
                      order.already_applied
                        ? <span style={S.btn('disabled')}>Заявка подана</span>
                        : <Link to={`/orders/${order.id}`} style={S.btn('primary')}>Откликнуться</Link>
                    )}
                    {isOwner && (
                      <span style={S.btn('disabled')}>Мой заказ</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
