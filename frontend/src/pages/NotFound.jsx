import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div style={{ minHeight: '100vh', background: '#1a2332', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '5rem', fontWeight: 700, color: '#1e3a4a', lineHeight: 1 }}>404</div>
        <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: '1.3rem', margin: '1rem 0 0.5rem' }}>
          Страница не найдена
        </div>
        <div style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: '1.75rem' }}>
          Такого адреса не существует или он был перемещён
        </div>
        <Link
          to="/dashboard"
          style={{ background: '#14a89a', color: '#fff', textDecoration: 'none', borderRadius: 8, padding: '10px 24px', fontWeight: 600, fontSize: '0.95rem' }}
        >
          На главную
        </Link>
      </div>
    </div>
  );
}
