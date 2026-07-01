import { useEffect, useState } from 'react';
import { ClipboardList, PlusCircle, Search, Briefcase, Star } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiCall } from '../utils/api';

const S = {
  heading: { color: '#e2e8f0', fontSize: '1.4rem', fontWeight: 700, marginBottom: 6 },
  sub: { color: '#64748b', fontSize: '0.9rem', marginBottom: '2rem' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1rem' },
  card: {
    background: '#0f1923',
    border: '1px solid #1e3a4a',
    borderRadius: 12,
    padding: '1.5rem',
    cursor: 'pointer',
    transition: 'border-color 0.2s',
  },
  cardTitle: { display: 'flex', alignItems: 'center', gap: 8, color: '#14a89a', fontWeight: 600, marginBottom: 8 },
  cardText: { color: '#64748b', fontSize: '0.88rem', lineHeight: 1.5 },
  balanceBar: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '2rem',
    flexWrap: 'wrap',
  },
  balanceCard: {
    background: '#0f1923',
    border: '1px solid #1e3a4a',
    borderRadius: 10,
    padding: '1rem 1.5rem',
    minWidth: 160,
  },
  balanceLabel: { color: '#64748b', fontSize: '0.78rem', marginBottom: 4 },
  balanceValue: { color: '#14a89a', fontSize: '1.3rem', fontWeight: 700 },
};

const customerCards = [
  { icon: PlusCircle, title: 'Создать заказ', text: 'Разместите задание — репетитор, курсовая, реферат или любая учебная помощь' },
  { icon: ClipboardList, title: 'Мои заказы', text: 'Отслеживайте статусы ваших заказов и переписку с исполнителями' },
];

const executorCards = [
  { icon: Search, title: 'Биржа заказов', text: 'Открытые заказы от студентов — откликайтесь и предлагайте цену' },
  { icon: Briefcase, title: 'Мои отклики', text: 'Заказы, на которые вы откликнулись, и активные работы' },
];

export default function Dashboard() {
  const { profile, mode, user } = useAuth();
  const cards = mode === 'customer' ? customerCards : executorCards;

  const [pendingReviews, setPendingReviews] = useState([]);

  useEffect(() => {
    if (!user) return;
    apiCall('GET', '/orders/pending-reviews')
      .then(data => setPendingReviews(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [user]);

  return (
    <div>
      <div style={S.heading}>
        Добро пожаловать, {profile?.nickname ?? '...'}
      </div>
      <div style={S.sub}>
        Режим: <strong style={{ color: '#14a89a' }}>{mode === 'customer' ? 'Заказчик' : 'Исполнитель'}</strong>
        {' '}— переключайтесь через кнопки в шапке
      </div>

      {mode === 'executor' && (
        <div style={S.balanceBar}>
          <div style={S.balanceCard}>
            <div style={S.balanceLabel}>Баланс кошелька</div>
            <div style={S.balanceValue}>{parseFloat(profile?.balance ?? 0).toFixed(2)} ₽</div>
          </div>
        </div>
      )}

      {pendingReviews.length > 0 && (
        <div style={{ background: '#0f1923', border: '1px solid #f59e0b44', borderRadius: 12, padding: '1.25rem', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f59e0b', fontWeight: 600, marginBottom: '0.75rem' }}>
            <Star size={16} fill="#f59e0b" style={{ color: '#f59e0b' }} />
            Ожидают вашего отзыва
          </div>
          {pendingReviews.map(o => (
            <Link
              key={o.id}
              to={`/orders/${o.id}`}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #1e3a4a', textDecoration: 'none', color: 'inherit' }}
            >
              <div>
                <div style={{ color: '#e2e8f0', fontSize: '0.9rem', fontWeight: 500 }}>{o.title}</div>
                <div style={{ color: '#64748b', fontSize: '0.75rem', marginTop: 2 }}>
                  {o.subject} · {o.role === 'customer' ? 'Вы заказчик' : 'Вы исполнитель'}
                </div>
              </div>
              <span style={{ color: '#f59e0b', fontSize: '0.8rem', fontWeight: 600, flexShrink: 0, marginLeft: 12 }}>Оставить отзыв →</span>
            </Link>
          ))}
        </div>
      )}

      <div style={S.grid}>
        {cards.map(({ icon: Icon, title, text }) => (
          <div key={title} style={S.card}>
            <div style={S.cardTitle}>
              <Icon size={18} />
              {title}
            </div>
            <div style={S.cardText}>{text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
