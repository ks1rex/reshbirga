import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiCall } from '../utils/api';

const STATUS_LABELS = {
  open:                 'Открытые',
  awaiting_topup:       'Ждут доплаты',
  in_progress:          'В работе',
  awaiting_confirmation:'На подтверждении',
  completed:            'Завершённые',
  disputed:             'Спорные',
  cancelled:            'Отменённые',
  assigned:             'Назначены',
};

const S = {
  h1: { color: '#e2e8f0', fontSize: '1.4rem', fontWeight: 700, marginBottom: '0.25rem' },
  sub: { color: '#64748b', fontSize: '0.88rem', marginBottom: '1.75rem' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: '1.75rem' },
  card: (clickable) => ({
    background: '#0f1923',
    border: '1px solid #1e3a4a',
    borderRadius: 12,
    padding: '1.25rem',
    textDecoration: 'none',
    display: 'block',
    transition: clickable ? 'border-color 0.15s' : 'none',
    cursor: clickable ? 'pointer' : 'default',
  }),
  cardLabel: { color: '#64748b', fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 },
  cardVal: { color: '#e2e8f0', fontSize: '1.75rem', fontWeight: 700, lineHeight: 1 },
  cardSub: { color: '#64748b', fontSize: '0.78rem', marginTop: 4 },
  alertCard: (color) => ({
    background: '#0f1923',
    border: `1px solid ${color}44`,
    borderRadius: 12,
    padding: '1.25rem',
    textDecoration: 'none',
    display: 'block',
    transition: 'border-color 0.15s',
  }),
  alertVal: (color) => ({ color, fontSize: '2rem', fontWeight: 700, lineHeight: 1 }),
  alertLabel: { color: '#64748b', fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 },
  alertSub: { color: '#94a3b8', fontSize: '0.78rem', marginTop: 6 },
  section: { background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 12, padding: '1.25rem', marginBottom: '1rem' },
  sectionTitle: { color: '#94a3b8', fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1rem' },
  statusRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #1e3a4a' },
};

function StatCard({ label, value, sub, to, accentColor }) {
  const inner = (
    <>
      <div style={S.cardLabel}>{label}</div>
      <div style={{ ...S.cardVal, color: accentColor ?? '#e2e8f0' }}>{value}</div>
      {sub && <div style={S.cardSub}>{sub}</div>}
    </>
  );
  if (to) return <Link to={to} style={S.card(true)}>{inner}</Link>;
  return <div style={S.card(false)}>{inner}</div>;
}

function AlertCard({ label, value, sub, to, color }) {
  return (
    <Link to={to} style={S.alertCard(color)}>
      <div style={S.alertLabel}>{label}</div>
      <div style={S.alertVal(color)}>{value}</div>
      {sub && <div style={S.alertSub}>{sub}</div>}
    </Link>
  );
}

export default function Admin() {
  const [stats, setStats]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState(null);

  useEffect(() => {
    apiCall('GET', '/admin/stats')
      .then(setStats)
      .catch(e => { console.error('[admin/stats]', e); setErr(e?.message ?? String(e)); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ color: '#64748b' }}>Загрузка...</div>;
  if (!stats)  return (
    <div style={{ color: '#f87171' }}>
      Ошибка загрузки статистики{err ? `: ${err}` : ''}
    </div>
  );

  const statusOrder = ['open','in_progress','awaiting_confirmation','awaiting_topup','disputed','completed','cancelled'];

  return (
    <div>
      <div style={S.h1}>Обзор</div>
      <div style={S.sub}>Сводная статистика платформы</div>

      {/* Alert counters */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12, marginBottom: '1.75rem' }}>
        <AlertCard
          label="Открытых споров"
          value={stats.open_disputes_count}
          sub="требуют решения"
          to="/admin/disputes"
          color="#ef4444"
        />
        <AlertCard
          label="Открытых тикетов"
          value={stats.open_support_tickets_count}
          sub="без ответа / ожидают"
          to="/admin/support"
          color="#3b82f6"
        />
        <AlertCard
          label="Заблокированных"
          value={stats.banned_users}
          sub="пользователей"
          to="/admin/users?filter=banned"
          color="#64748b"
        />
      </div>

      {/* General stats */}
      <div style={S.grid}>
        <StatCard
          label="Пользователей"
          value={stats.total_users}
          to="/admin/users"
        />
        <StatCard
          label="Комиссия заработана"
          value={`${stats.total_commission_earned.toLocaleString('ru-RU')} ₽`}
          sub="10% с пополнений"
          accentColor="#14a89a"
        />
        <StatCard
          label="Общий оборот"
          value={`${stats.total_volume.toLocaleString('ru-RU')} ₽`}
          sub="сумма исполнителям"
          accentColor="#14a89a"
        />
        <StatCard
          label="Завершено заказов"
          value={stats.orders_by_status?.completed ?? 0}
        />
      </div>

      {/* Orders by status */}
      <div style={S.section}>
        <div style={S.sectionTitle}>Заказы по статусам</div>
        {statusOrder.map(st => {
          const count = stats.orders_by_status?.[st];
          if (!count) return null;
          return (
            <div key={st} style={S.statusRow}>
              <span style={{ color: '#94a3b8', fontSize: '0.88rem' }}>{STATUS_LABELS[st] ?? st}</span>
              <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: '0.95rem' }}>{count}</span>
            </div>
          );
        })}
        {!Object.keys(stats.orders_by_status ?? {}).length && (
          <div style={{ color: '#64748b', fontSize: '0.85rem' }}>Заказов пока нет</div>
        )}
      </div>
    </div>
  );
}
