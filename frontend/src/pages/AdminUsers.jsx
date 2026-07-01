import { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, Shield, ShieldOff, Ban, CheckCircle, AlertTriangle } from 'lucide-react';
import { apiCall } from '../utils/api';

const S = {
  h1:   { color: '#e2e8f0', fontSize: '1.4rem', fontWeight: 700, marginBottom: '0.25rem' },
  sub:  { color: '#64748b', fontSize: '0.88rem', marginBottom: '1.5rem' },
  toolbar: { display: 'flex', gap: 10, marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' },
  searchWrap: { display: 'flex', alignItems: 'center', gap: 8, background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 8, padding: '8px 12px', flex: 1, minWidth: 200, maxWidth: 360 },
  searchInput: { background: 'none', border: 'none', color: '#e2e8f0', fontSize: '0.9rem', outline: 'none', flex: 1 },
  filterBtn: (active) => ({
    padding: '7px 16px', borderRadius: 8, border: `1px solid ${active ? '#14a89a' : '#1e3a4a'}`,
    background: active ? '#0d2620' : 'transparent', color: active ? '#14a89a' : '#64748b',
    fontSize: '0.85rem', cursor: 'pointer', fontWeight: active ? 600 : 400,
  }),
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { color: '#64748b', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #1e3a4a', whiteSpace: 'nowrap' },
  td: { padding: '11px 12px', borderBottom: '1px solid #1e3a4a', color: '#e2e8f0', fontSize: '0.85rem', verticalAlign: 'middle' },
  badge: (color) => ({ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 10, fontSize: '0.72rem', fontWeight: 600, background: color + '22', color, border: `1px solid ${color}44`, marginRight: 4 }),
  actionBtn: (color) => ({ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, border: `1px solid ${color}55`, background: color + '11', color, fontSize: '0.78rem', cursor: 'pointer', fontWeight: 500, marginRight: 4, marginBottom: 4 }),
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 14, padding: '2rem', maxWidth: 420, width: '90%' },
  modalTitle: { color: '#e2e8f0', fontWeight: 700, fontSize: '1.05rem', marginBottom: 8 },
  modalText: { color: '#94a3b8', fontSize: '0.88rem', lineHeight: 1.6, marginBottom: '1.5rem' },
  modalBtns: { display: 'flex', gap: 10, justifyContent: 'flex-end' },
  cancelBtn: { background: 'none', border: '1px solid #334155', borderRadius: 8, padding: '8px 16px', color: '#94a3b8', cursor: 'pointer' },
  okBtn: (danger) => ({ background: danger ? '#ef4444' : '#14a89a', border: 'none', borderRadius: 8, padding: '8px 18px', color: '#fff', fontWeight: 600, cursor: 'pointer' }),
};

const FILTERS = [
  { value: 'all',    label: 'Все' },
  { value: 'admins', label: 'Админы' },
  { value: 'banned', label: 'Заблокированные' },
];

export default function AdminUsers() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [users, setUsers]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [filter, setFilter]   = useState(searchParams.get('filter') ?? 'all');
  const [modal, setModal]     = useState(null); // { user, action: 'ban'|'unban'|'make_admin'|'remove_admin' }
  const [acting, setActing]   = useState(false);
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (filter !== 'all') params.set('filter', filter);
      const data = await apiCall('GET', `/admin/users?${params}`);
      setUsers(Array.isArray(data) ? data : []);
    } catch {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [search, filter]);

  useEffect(() => {
    const t = setTimeout(load, search ? 350 : 0);
    return () => clearTimeout(t);
  }, [load]);

  function openModal(user, action) {
    setActionError('');
    setModal({ user, action });
  }

  async function handleAction() {
    if (!modal) return;
    setActing(true);
    setActionError('');
    try {
      const body = {};
      if (modal.action === 'ban')          body.is_banned = true;
      if (modal.action === 'unban')        body.is_banned = false;
      if (modal.action === 'make_admin')   body.is_admin  = true;
      if (modal.action === 'remove_admin') body.is_admin  = false;

      await apiCall('PATCH', `/admin/users/${modal.user.id}`, body);
      setModal(null);
      load();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setActing(false);
    }
  }

  const ACTION_LABELS = {
    ban:          'Заблокировать',
    unban:        'Разблокировать',
    make_admin:   'Сделать администратором',
    remove_admin: 'Убрать права администратора',
  };
  const ACTION_DANGER = { ban: true, remove_admin: true };

  return (
    <div>
      <div style={S.h1}>Пользователи</div>
      <div style={S.sub}>Управление аккаунтами</div>

      <div style={S.toolbar}>
        <div style={S.searchWrap}>
          <Search size={15} style={{ color: '#64748b', flexShrink: 0 }} />
          <input
            style={S.searchInput}
            placeholder="Поиск по нику или email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        {FILTERS.map(f => (
          <button
            key={f.value}
            style={S.filterBtn(filter === f.value)}
            onClick={() => { setFilter(f.value); setSearchParams(f.value !== 'all' ? { filter: f.value } : {}); }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ color: '#64748b' }}>Загрузка...</div>
      ) : users.length === 0 ? (
        <div style={{ color: '#64748b', textAlign: 'center', padding: '3rem' }}>Пользователи не найдены</div>
      ) : (
        <div style={{ background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 12, overflow: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Пользователь</th>
                <th style={S.th}>Рейтинг</th>
                <th style={S.th}>Баланс к выплате</th>
                <th style={S.th}>Дата регистрации</th>
                <th style={S.th}>Статус</th>
                <th style={S.th}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td style={S.td}>
                    <Link to={`/users/${u.id}`} style={{ color: '#14a89a', fontWeight: 600, textDecoration: 'none', fontSize: '0.9rem' }}>
                      {u.nickname}
                    </Link>
                    <div style={{ color: '#64748b', fontSize: '0.75rem', marginTop: 2 }}>{u.email ?? '—'}</div>
                  </td>
                  <td style={S.td}>
                    <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                      Исп: <span style={{ color: '#f59e0b' }}>{u.reviews_count_executor > 0 ? parseFloat(u.rating_as_executor ?? 0).toFixed(1) : '—'}</span>
                      {' '}({u.reviews_count_executor ?? 0})
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                      Зак: <span style={{ color: '#f59e0b' }}>{u.reviews_count_customer > 0 ? parseFloat(u.rating_as_customer ?? 0).toFixed(1) : '—'}</span>
                      {' '}({u.reviews_count_customer ?? 0})
                    </div>
                  </td>
                  <td style={{ ...S.td, color: '#14a89a', fontWeight: 600 }}>
                    {parseFloat(u.balance ?? 0) > 0 ? `${parseFloat(u.balance).toFixed(2)} ₽` : '—'}
                  </td>
                  <td style={{ ...S.td, color: '#64748b' }}>
                    {new Date(u.created_at).toLocaleDateString('ru-RU')}
                  </td>
                  <td style={S.td}>
                    {u.is_admin   && <span style={S.badge('#14a89a')}><Shield size={10} /> Админ</span>}
                    {u.is_banned  && <span style={S.badge('#ef4444')}><Ban    size={10} /> Заблок.</span>}
                    {!u.is_admin && !u.is_banned && <span style={{ color: '#64748b', fontSize: '0.78rem' }}>—</span>}
                  </td>
                  <td style={S.td}>
                    {u.is_banned
                      ? <button style={S.actionBtn('#22c55e')} onClick={() => openModal(u, 'unban')}><CheckCircle size={13} /> Разблокировать</button>
                      : <button style={S.actionBtn('#ef4444')} onClick={() => openModal(u, 'ban')}><Ban size={13} /> Заблокировать</button>
                    }
                    {u.is_admin
                      ? <button style={S.actionBtn('#f59e0b')} onClick={() => openModal(u, 'remove_admin')}><ShieldOff size={13} /> Убрать админа</button>
                      : <button style={S.actionBtn('#14a89a')} onClick={() => openModal(u, 'make_admin')}><Shield size={13} /> Сделать админом</button>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div style={S.overlay} onClick={() => !acting && setModal(null)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <AlertTriangle size={20} style={{ color: ACTION_DANGER[modal.action] ? '#ef4444' : '#14a89a' }} />
              <div style={S.modalTitle}>{ACTION_LABELS[modal.action]}?</div>
            </div>
            <div style={S.modalText}>
              Пользователь: <strong>{modal.user.nickname}</strong> ({modal.user.email})
              {modal.action === 'ban' && <><br /><br />Пользователь не сможет создавать заказы, откликаться, писать сообщения и открывать споры. Доступ к поддержке сохраняется.</>}
              {modal.action === 'remove_admin' && <><br /><br />Права администратора будут отозваны. Если это последний администратор, операция будет заблокирована.</>}
            </div>
            {actionError && <div style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: 12 }}>{actionError}</div>}
            <div style={S.modalBtns}>
              <button style={S.cancelBtn} onClick={() => setModal(null)} disabled={acting}>Отмена</button>
              <button style={S.okBtn(!!ACTION_DANGER[modal.action])} onClick={handleAction} disabled={acting}>
                {acting ? 'Обработка...' : ACTION_LABELS[modal.action]}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
