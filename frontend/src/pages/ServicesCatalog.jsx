import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Star, AlertTriangle, Shield, Search } from 'lucide-react';
import { apiCall } from '../utils/api';
import { formatCurrency } from '../utils/format';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';

const S = {
  page: { maxWidth: 1100, margin: '0 auto' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: 12 },
  h1: { color: '#e2e8f0', fontSize: '1.4rem', fontWeight: 700 },
  searchRow: { display: 'flex', gap: 10, alignItems: 'center' },
  searchInput: { background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 8, padding: '9px 12px', color: '#e2e8f0', fontSize: '0.9rem', width: 240 },
  searchBtn: { background: '#14a89a', border: 'none', borderRadius: 8, padding: '9px 16px', color: '#fff', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' },
  card: { background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 12, padding: '1.25rem', textDecoration: 'none', display: 'flex', flexDirection: 'column', gap: 10, transition: 'border-color 0.15s' },
  cardTitle: { color: '#e2e8f0', fontWeight: 700, fontSize: '1rem', lineHeight: 1.3 },
  ownerRow: { display: 'flex', alignItems: 'center', gap: 8 },
  ownerName: { color: '#14a89a', fontSize: '0.82rem', fontWeight: 500 },
  rating: { display: 'flex', alignItems: 'center', gap: 4, color: '#f59e0b', fontSize: '0.8rem' },
  price: { color: '#14a89a', fontSize: '1.3rem', fontWeight: 700, marginTop: 'auto' },
  badges: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  badge: (color) => ({ background: color + '22', color, border: `1px solid ${color}44`, borderRadius: 12, padding: '3px 8px', fontSize: '0.72rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }),
  newBtn: { background: '#14a89a', border: 'none', borderRadius: 8, padding: '9px 18px', color: '#fff', fontWeight: 600, cursor: 'pointer', textDecoration: 'none', fontSize: '0.9rem' },
};

export default function ServicesCatalog() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  async function load(q = '') {
    setLoading(true);
    try {
      const qs = q ? `?search=${encodeURIComponent(q)}` : '';
      const data = await apiCall('GET', `/listings${qs}`);
      setListings(data ?? []);
    } catch { setListings([]); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function handleSearch(e) {
    e.preventDefault();
    setQuery(search.trim());
    load(search.trim());
  }

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div style={S.h1}>Каталог услуг</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <form onSubmit={handleSearch} style={S.searchRow}>
            <input style={S.searchInput} placeholder="Поиск услуги..." value={search}
              onChange={e => setSearch(e.target.value)} />
            <button style={S.searchBtn} type="submit"><Search size={15} />Найти</button>
          </form>
          <Link to="/services/new" style={S.newBtn}>+ Разместить услугу</Link>
        </div>
      </div>

      {loading ? <Spinner /> : listings.length === 0 ? (
        <EmptyState>Услуг пока нет{query ? ` по запросу «${query}»` : ''}</EmptyState>
      ) : (
        <div style={S.grid}>
          {listings.map(l => (
            <Link key={l.id} to={`/services/${l.id}`} style={S.card}>
              <div style={S.cardTitle}>{l.title}</div>
              <div style={S.ownerRow}>
                <div style={S.ownerName}>{l.owner?.nickname}</div>
                {parseFloat(l.owner?.rating_as_executor ?? 0) > 0 && (
                  <div style={S.rating}>
                    <Star size={11} fill="#f59e0b" />{parseFloat(l.owner.rating_as_executor).toFixed(1)}
                  </div>
                )}
              </div>
              <div style={S.badges}>
                {parseFloat(l.deposit_amount ?? 0) > 0 && (
                  <span style={S.badge('#f59e0b')}><Shield size={11} />Залог {formatCurrency(l.deposit_amount)}</span>
                )}
                {l.requires_contact_exchange && (
                  <span style={S.badge('#ef4444')}><AlertTriangle size={11} />Обмен контактами</span>
                )}
              </div>
              <div style={S.price}>{formatCurrency(l.price)}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
