import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronLeft, ChevronRight, Shield, AlertTriangle } from 'lucide-react';
import { apiCall } from '../utils/api';
import { formatCurrency, formatDate } from '../utils/format';
import { StatusBadge } from '../utils/statusMap';
import Spinner from '../components/Spinner';

const S = {
  h1:         { color: '#e2e8f0', fontSize: '1.3rem', fontWeight: 700, marginBottom: '0.2rem' },
  sub:        { color: '#64748b', fontSize: '0.88rem', marginBottom: '1.25rem' },
  topRow:     { display: 'flex', gap: 10, marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' },
  searchBox:  { display: 'flex', alignItems: 'center', gap: 8, background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 8, padding: '7px 12px', flex: 1, minWidth: 200, maxWidth: 380 },
  searchInput:{ background: 'none', border: 'none', color: '#e2e8f0', fontSize: '0.9rem', outline: 'none', width: '100%' },
  filterRow:  { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: '1rem' },
  chip:  (a) => ({ padding: '5px 13px', borderRadius: 16, border: '1px solid', fontSize: '0.8rem', cursor: 'pointer', fontWeight: a ? 600 : 400, background: a ? '#14a89a' : 'transparent', color: a ? '#fff' : '#64748b', borderColor: a ? '#14a89a' : '#334155' }),
  table:      { width: '100%', borderCollapse: 'collapse' },
  th:         { color: '#64748b', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #1e3a4a', whiteSpace: 'nowrap' },
  tr:         { borderBottom: '1px solid #0f1923', cursor: 'pointer', transition: 'background 0.12s' },
  td:         { padding: '10px 10px', fontSize: '0.85rem', color: '#94a3b8', verticalAlign: 'middle' },
  titleTd:    { color: '#e2e8f0', fontWeight: 500, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  pagination: { display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end', marginTop: '1rem', fontSize: '0.85rem', color: '#64748b' },
  pageBtn: (d) => ({ display: 'flex', alignItems: 'center', background: 'none', border: '1px solid #334155', borderRadius: 7, padding: '5px 10px', color: d ? '#334155' : '#94a3b8', cursor: d ? 'default' : 'pointer' }),
  empty:      { color: '#64748b', textAlign: 'center', padding: '3rem 2rem' },
  iconBadge:  (color) => ({ display: 'inline-flex', alignItems: 'center', gap: 3, color, fontSize: '0.72rem', fontWeight: 600 }),
};

const STATUS_FILTERS = [
  { value: '', label: 'Все статусы' },
  { value: 'open',                   label: 'Открытые' },
  { value: 'in_progress',            label: 'В работе' },
  { value: 'awaiting_topup',         label: 'Доплата' },
  { value: 'awaiting_confirmation',  label: 'Подтверждение' },
  { value: 'completed',              label: 'Завершены' },
  { value: 'disputed',               label: 'Споры' },
  { value: 'cancelled',              label: 'Отменены' },
];

const TYPE_FILTERS = [
  { value: '', label: 'Все типы' },
  { value: 'order',   label: 'Заказы' },
  { value: 'service', label: 'Услуги' },
];

export default function AdminOrders() {
  const navigate = useNavigate();
  const [orders,  setOrders]  = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [status,  setStatus]  = useState('');
  const [orderType, setOrderType] = useState('');
  const [search,  setSearch]  = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page,    setPage]    = useState(1);
  const LIMIT = 50;

  const load = useCallback(async (p = page, s = status, ot = orderType, sr = search) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: p, limit: LIMIT });
      if (s)  qs.set('status', s);
      if (ot) qs.set('order_type', ot);
      if (sr.trim()) qs.set('search', sr.trim());
      const data = await apiCall('GET', `/admin/orders?${qs}`);
      setOrders(data.orders ?? []);
      setTotal(data.total ?? 0);
    } catch { setOrders([]); setTotal(0); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(1, status, orderType, search); }, []);

  function applyFilter(newStatus, newType) {
    setStatus(newStatus);
    setOrderType(newType);
    setPage(1);
    load(1, newStatus, newType, search);
  }

  function handleSearch(e) {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
    load(1, status, orderType, searchInput);
  }

  function goPage(p) {
    setPage(p);
    load(p, status, orderType, search);
  }

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div>
      <div style={S.h1}>Все заказы</div>
      <div style={S.sub}>Полный список заказов и услуг на платформе</div>

      <div style={S.topRow}>
        <form onSubmit={handleSearch} style={S.searchBox}>
          <Search size={15} style={{ color: '#64748b', flexShrink: 0 }} />
          <input
            style={S.searchInput}
            placeholder="Поиск по названию, нику..."
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
          />
        </form>
        {search && (
          <button style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '0.82rem', cursor: 'pointer' }}
            onClick={() => { setSearchInput(''); setSearch(''); setPage(1); load(1, status, orderType, ''); }}>
            × Сбросить поиск
          </button>
        )}
      </div>

      <div style={S.filterRow}>
        {STATUS_FILTERS.map(f => (
          <button key={f.value} style={S.chip(status === f.value)}
            onClick={() => applyFilter(f.value, orderType)}>{f.label}</button>
        ))}
      </div>
      <div style={{ ...S.filterRow, marginBottom: '1.25rem' }}>
        {TYPE_FILTERS.map(f => (
          <button key={f.value} style={S.chip(orderType === f.value)}
            onClick={() => applyFilter(status, f.value)}>{f.label}</button>
        ))}
      </div>

      {loading ? <Spinner /> : orders.length === 0 ? (
        <div style={S.empty}>Нет заказов</div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  {['Название', 'Тип', 'Статус', 'Заказчик', 'Исполнитель', 'Сумма', 'Дата'].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.id} style={S.tr}
                    onClick={() => navigate(`/orders/${o.id}`)}
                    onMouseEnter={e => e.currentTarget.style.background = '#0f1923'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ ...S.td, ...S.titleTd }}>
                      {o.title}
                      {o.requires_contact_exchange && (
                        <span style={{ ...S.iconBadge('#f59e0b'), marginLeft: 6 }}><AlertTriangle size={10} /></span>
                      )}
                      {parseFloat(o.deposit_amount ?? 0) > 0 && (
                        <span style={{ ...S.iconBadge('#6366f1'), marginLeft: 4 }}><Shield size={10} /></span>
                      )}
                    </td>
                    <td style={S.td}>
                      <span style={{ color: o.order_type === 'service' ? '#a78bfa' : '#94a3b8', fontSize: '0.8rem' }}>
                        {o.order_type === 'service' ? 'Услуга' : 'Заказ'}
                      </span>
                    </td>
                    <td style={S.td}><StatusBadge status={o.status} /></td>
                    <td style={S.td}>{o.customer?.nickname ?? '—'}</td>
                    <td style={S.td}>{o.executor?.nickname ?? <span style={{ color: '#334155' }}>нет</span>}</td>
                    <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                      {formatCurrency(o.final_amount ?? o.base_amount)}
                    </td>
                    <td style={{ ...S.td, whiteSpace: 'nowrap' }}>{formatDate(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={S.pagination}>
            <span>{total} заказов · стр. {page} / {totalPages}</span>
            <button style={S.pageBtn(page <= 1)} disabled={page <= 1} onClick={() => goPage(page - 1)}>
              <ChevronLeft size={15} />
            </button>
            <button style={S.pageBtn(page >= totalPages)} disabled={page >= totalPages} onClick={() => goPage(page + 1)}>
              <ChevronRight size={15} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
