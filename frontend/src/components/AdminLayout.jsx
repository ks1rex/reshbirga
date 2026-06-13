import { NavLink, Outlet } from 'react-router-dom';
import { BarChart2, BookOpen, AlertOctagon, MessageSquare, Shield, Users, Settings, ArrowDownCircle, ArrowUpCircle, UserCheck, ClipboardList, MessagesSquare } from 'lucide-react';

const ITEMS = [
  { to: '/admin',                          label: 'Обзор',              icon: BarChart2,        end: true },
  { to: '/admin/orders',                   label: 'Все заказы',         icon: ClipboardList },
  { to: '/admin/conversations',            label: 'Все чаты',           icon: MessagesSquare },
  { to: '/admin/ledger',                   label: 'Журнал',             icon: BookOpen },
  { to: '/admin/deposits',                 label: 'Пополнения',         icon: ArrowDownCircle },
  { to: '/admin/withdrawals',              label: 'Выводы',             icon: ArrowUpCircle },
  { to: '/admin/disputes',                 label: 'Споры',              icon: AlertOctagon },
  { to: '/admin/contact-exchange-orders',  label: 'Сделки с контактами', icon: UserCheck },
  { to: '/admin/support',                  label: 'Поддержка',          icon: MessageSquare },
  { to: '/admin/chat-moderation',          label: 'Модерация чатов',    icon: Shield },
  { to: '/admin/users',                    label: 'Пользователи',       icon: Users },
  { to: '/admin/settings',                 label: 'Настройки',          icon: Settings },
];

export default function AdminLayout() {
  return (
    <div style={{ display: 'flex', gap: '1.75rem', alignItems: 'flex-start' }}>
      <aside style={{ width: 192, flexShrink: 0, position: 'sticky', top: 24 }}>
        <div style={{ color: '#64748b', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10, paddingLeft: 12 }}>
          Админ-панель
        </div>
        <nav>
          {ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                borderRadius: 8,
                marginBottom: 2,
                textDecoration: 'none',
                color:      isActive ? '#14a89a' : '#64748b',
                background: isActive ? '#0d2620' : 'transparent',
                fontSize: '0.88rem',
                fontWeight: isActive ? 600 : 400,
                transition: 'background 0.15s, color 0.15s',
              })}
            >
              <Icon size={15} />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div style={{ flex: 1, minWidth: 0 }}>
        <Outlet />
      </div>
    </div>
  );
}
