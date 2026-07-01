import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Navbar from './Navbar';
import Spinner from './Spinner';

export default function Layout() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#1a2332' }}>
        <Spinner text="Загрузка..." />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  return (
    <div style={{ minHeight: '100vh', background: '#1a2332' }}>
      <Navbar />
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem 1rem' }}>
        <Outlet />
      </main>
    </div>
  );
}
