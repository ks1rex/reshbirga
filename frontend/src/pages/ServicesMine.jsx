import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Shield, AlertTriangle, Eye, EyeOff, Edit } from 'lucide-react';
import { apiCall } from '../utils/api';
import { formatCurrency, formatDate } from '../utils/format';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';
import { useToast } from '../components/Toast';

const S = {
  h1: { color: '#e2e8f0', fontSize: '1.3rem', fontWeight: 700, marginBottom: '1.5rem' },
  newBtn: { background: '#14a89a', border: 'none', borderRadius: 8, padding: '9px 18px', color: '#fff', fontWeight: 600, textDecoration: 'none', fontSize: '0.88rem' },
  card: { background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 12, padding: '1.15rem', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  info: { flex: 1, minWidth: 0 },
  cardTitle: { color: '#e2e8f0', fontWeight: 600, fontSize: '0.95rem', textDecoration: 'none' },
  meta: { color: '#64748b', fontSize: '0.78rem', marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' },
  badge: (color) => ({ display: 'inline-flex', alignItems: 'center', gap: 4, background: color + '22', color, border: `1px solid ${color}44`, borderRadius: 10, padding: '2px 7px', fontSize: '0.72rem', fontWeight: 600 }),
  actions: { display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 },
  iconBtn: (active) => ({ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: `1px solid ${active ? '#14a89a' : '#334155'}`, borderRadius: 7, padding: '6px 12px', color: active ? '#14a89a' : '#64748b', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 500 }),
  editLink: { display: 'flex', alignItems: 'center', gap: 5, color: '#64748b', textDecoration: 'none', fontSize: '0.8rem', border: '1px solid #334155', borderRadius: 7, padding: '6px 12px' },
};

export default function ServicesMine() {
  const toast = useToast();
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState({});

  async function load() {
    setLoading(true);
    try { setListings(await apiCall('GET', '/listings/mine') ?? []); }
    catch { setListings([]); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleToggle(id, current) {
    setToggling(t => ({ ...t, [id]: true }));
    try {
      const r = await apiCall('PATCH', `/listings/${id}/toggle`, {});
      setListings(ls => ls.map(l => l.id === id ? { ...l, is_active: r.is_active } : l));
      toast.success(r.is_active ? 'Услуга активирована' : 'Услуга скрыта');
    } catch (e) { toast.error(e.message); }
    finally { setToggling(t => ({ ...t, [id]: false })); }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', gap: 12 }}>
        <div style={S.h1}>Мои услуги</div>
        <Link to="/services/new" style={S.newBtn}>+ Новая услуга</Link>
      </div>

      {loading ? <Spinner /> : listings.length === 0 ? (
        <EmptyState>
          У вас нет услуг. <Link to="/services/new" style={{ color: '#14a89a' }}>Создать первую</Link>
        </EmptyState>
      ) : (
        listings.map(l => (
          <div key={l.id} style={{ ...S.card, opacity: l.is_active ? 1 : 0.6 }}>
            <div style={S.info}>
              <Link to={`/services/${l.id}`} style={S.cardTitle}>{l.title}</Link>
              <div style={S.meta}>
                <span>{formatCurrency(l.price)}</span>
                {parseFloat(l.deposit_amount ?? 0) > 0 && (
                  <span style={S.badge('#f59e0b')}><Shield size={10} />Залог {formatCurrency(l.deposit_amount)}</span>
                )}
                {l.requires_contact_exchange && (
                  <span style={S.badge('#ef4444')}><AlertTriangle size={10} />Обмен контактами</span>
                )}
                <span>{formatDate(l.created_at)}</span>
              </div>
            </div>
            <div style={S.actions}>
              <button
                style={S.iconBtn(l.is_active)}
                onClick={() => handleToggle(l.id, l.is_active)}
                disabled={toggling[l.id]}
                title={l.is_active ? 'Скрыть' : 'Активировать'}
              >
                {l.is_active ? <Eye size={14} /> : <EyeOff size={14} />}
                {l.is_active ? 'Активна' : 'Скрыта'}
              </button>
              <Link to={`/services/${l.id}/edit`} style={S.editLink}>
                <Edit size={13} />Изменить
              </Link>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
