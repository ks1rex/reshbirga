import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';

const S = {
  page: { minHeight: '100vh', background: '#1a2332', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  card: { background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 14, padding: '2rem', width: '100%', maxWidth: 400 },
  title: { color: '#14a89a', fontSize: '1.5rem', fontWeight: 700, marginBottom: 4 },
  sub: { color: '#64748b', fontSize: '0.9rem', marginBottom: '1.5rem' },
  label: { display: 'block', color: '#94a3b8', fontSize: '0.82rem', marginBottom: 6 },
  input: { width: '100%', background: '#1a2332', border: '1px solid #1e3a4a', borderRadius: 8, padding: '10px 12px', color: '#e2e8f0', fontSize: '0.95rem', marginBottom: '1rem' },
  btn: { width: '100%', background: '#14a89a', color: '#fff', border: 'none', borderRadius: 8, padding: '11px', fontSize: '1rem', fontWeight: 600, cursor: 'pointer', marginTop: 4 },
  error: { color: '#f87171', fontSize: '0.85rem', background: '#2d1515', borderRadius: 6, padding: '8px 12px', marginBottom: '1rem' },
  footer: { marginTop: '1.5rem', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' },
  link: { color: '#14a89a' },
};

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) setError(err.message);
    else navigate('/dashboard');
    setLoading(false);
  }

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.title}>СтудБиржа</div>
        <div style={S.sub}>Войдите в аккаунт</div>
        <form onSubmit={handleSubmit}>
          {error && <div style={S.error}>{error}</div>}
          <label style={S.label}>Email</label>
          <input style={S.input} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
          <label style={S.label}>Пароль</label>
          <input style={S.input} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
          <button style={S.btn} type="submit" disabled={loading}>
            {loading ? 'Загрузка...' : 'Войти'}
          </button>
        </form>
        <div style={S.footer}>
          Нет аккаунта?{' '}
          <Link to="/register" style={S.link}>Зарегистрироваться</Link>
        </div>
      </div>
    </div>
  );
}
