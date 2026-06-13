import { useState, useEffect } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { LogOut, User, ShieldCheck, ClipboardList, PlusCircle, Search, Inbox, LifeBuoy, Menu, X, Wallet, Layers, Store } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency } from '../utils/format';

function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const h = e => setM(e.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  return m;
}

const S = {
  nav: { background: '#0f1923', borderBottom: '1px solid #0e8a7d', position: 'relative', zIndex: 100 },
  inner: { maxWidth: 1200, margin: '0 auto', padding: '0 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 60 },
  logo: { color: '#14a89a', fontWeight: 700, fontSize: '1.2rem' },
  links: { display: 'flex', alignItems: 'center', gap: '1rem' },
  navLink: (active) => ({ display: 'flex', alignItems: 'center', gap: 5, color: active ? '#14a89a' : '#64748b', fontSize: '0.85rem', textDecoration: 'none', fontWeight: active ? 600 : 400, whiteSpace: 'nowrap' }),
  toggle: { display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid #0e8a7d' },
  modeBtn: (active) => ({ padding: '5px 14px', fontSize: '0.82rem', fontWeight: 500, cursor: 'pointer', border: 'none', background: active ? '#14a89a' : 'transparent', color: active ? '#fff' : '#14a89a', transition: 'background 0.15s' }),
  nickname: { display: 'flex', alignItems: 'center', gap: 5, color: '#94a3b8', fontSize: '0.85rem' },
  logoutBtn: { display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', color: '#64748b', fontSize: '0.85rem', cursor: 'pointer' },
  hamburger: { background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 4 },
  mobileMenu: { background: '#0f1923', borderTop: '1px solid #1e3a4a', padding: '1rem', display: 'flex', flexDirection: 'column', gap: 4 },
  mobileLink: (active) => ({ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, color: active ? '#14a89a' : '#94a3b8', textDecoration: 'none', fontWeight: active ? 600 : 400, fontSize: '0.9rem', background: active ? '#0d2620' : 'transparent' }),
  mobileDivider: { height: 1, background: '#1e3a4a', margin: '6px 0' },
};

export default function Navbar() {
  const { profile, mode, setMode, signOut } = useAuth();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  // Close menu on navigation
  useEffect(() => { if (!isMobile) setOpen(false); }, [isMobile]);

  const customerLinks = [
    { to: '/orders/new',   label: 'Создать заказ', Icon: PlusCircle },
    { to: '/orders/mine',  label: 'Мои заказы',    Icon: ClipboardList },
    { to: '/services',     label: 'Каталог услуг', Icon: Store },
  ];
  const executorLinks = [
    { to: '/orders',          label: 'Биржа заказов', Icon: Search },
    { to: '/orders/applied',  label: 'Мои отклики',   Icon: Inbox },
    { to: '/services',        label: 'Каталог услуг', Icon: Store },
    { to: '/services/mine',   label: 'Мои услуги',    Icon: Layers },
  ];
  const modeLinks = mode === 'customer' ? customerLinks : executorLinks;
  const supportLink = profile ? [{ to: '/support', label: 'Поддержка', Icon: LifeBuoy }] : [];
  const adminLink   = profile?.is_admin ? [{ to: '/admin', label: 'Админ-панель', Icon: ShieldCheck }] : [];
  const allLinks    = [...modeLinks, ...supportLink, ...adminLink];

  return (
    <nav style={S.nav}>
      <div style={S.inner}>
        {/* Logo */}
        <Link to="/dashboard" style={{ ...S.logo, display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="СтудБиржа" height={34} width={34} style={{ borderRadius: 6, flexShrink: 0 }} />
          {!isMobile && 'СтудБиржа'}
        </Link>

        {/* Desktop links */}
        {!isMobile && (
          <div style={S.links}>
            {allLinks.map(({ to, label, Icon }) => (
              <NavLink key={to} to={to} end={to === '/admin'} style={({ isActive }) => S.navLink(isActive)}>
                <Icon size={15} /> {label}
              </NavLink>
            ))}
          </div>
        )}

        {/* Right side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {!isMobile && (
            <>
              <div style={S.toggle}>
                <button style={S.modeBtn(mode === 'customer')} onClick={() => setMode('customer')}>Я заказчик</button>
                <button style={S.modeBtn(mode === 'executor')} onClick={() => setMode('executor')}>Я исполнитель</button>
              </div>
              {profile && (
                <>
                  <Link to="/wallet" style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#14a89a', fontWeight: 600, fontSize: '0.88rem', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                    <Wallet size={14} />{formatCurrency(profile.balance ?? 0)}
                  </Link>
                  <span style={S.nickname}><User size={14} />{profile.nickname}</span>
                </>
              )}
              <button style={S.logoutBtn} onClick={signOut}><LogOut size={15} />Выйти</button>
            </>
          )}
          {isMobile && (
            <button style={S.hamburger} onClick={() => setOpen(o => !o)} aria-label="Меню">
              {open ? <X size={22} /> : <Menu size={22} />}
            </button>
          )}
        </div>
      </div>

      {/* Mobile menu */}
      {isMobile && open && (
        <div style={S.mobileMenu} onClick={() => setOpen(false)}>
          {allLinks.map(({ to, label, Icon }) => (
            <NavLink key={to} to={to} end={to === '/admin'} style={({ isActive }) => S.mobileLink(isActive)}>
              <Icon size={17} /> {label}
            </NavLink>
          ))}

          {profile && (
            <NavLink to="/wallet" style={({ isActive }) => S.mobileLink(isActive)}>
              <Wallet size={17} /> Кошелёк: {formatCurrency(profile.balance ?? 0)}
            </NavLink>
          )}

          <div style={S.mobileDivider} />

          {/* Mode toggle */}
          <div style={{ display: 'flex', gap: 6, padding: '4px 0' }}>
            <button style={{ ...S.modeBtn(mode === 'customer'), borderRadius: 7, padding: '7px 16px' }} onClick={() => setMode('customer')}>Я заказчик</button>
            <button style={{ ...S.modeBtn(mode === 'executor'), borderRadius: 7, padding: '7px 16px' }} onClick={() => setMode('executor')}>Я исполнитель</button>
          </div>

          {profile && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', color: '#94a3b8', fontSize: '0.88rem' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><User size={14} />{profile.nickname}</span>
              <button style={{ ...S.logoutBtn, fontSize: '0.85rem' }} onClick={signOut}><LogOut size={14} />Выйти</button>
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
