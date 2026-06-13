import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Search, MessageSquare, LifeBuoy, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { apiCall } from '../utils/api';
import { formatDate } from '../utils/format';
import ChatWindow from '../components/ChatWindow';
import Spinner from '../components/Spinner';

const S = {
  h1:         { color: '#e2e8f0', fontSize: '1.3rem', fontWeight: 700, marginBottom: '0.2rem' },
  sub:        { color: '#64748b', fontSize: '0.88rem', marginBottom: '1.25rem' },
  topRow:     { display: 'flex', gap: 10, marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' },
  searchBox:  { display: 'flex', alignItems: 'center', gap: 8, background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 8, padding: '7px 12px', flex: 1, minWidth: 200, maxWidth: 380 },
  searchInput:{ background: 'none', border: 'none', color: '#e2e8f0', fontSize: '0.9rem', outline: 'none', width: '100%' },
  filterRow:  { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: '1.25rem' },
  chip:  (a) => ({ padding: '5px 13px', borderRadius: 16, border: '1px solid', fontSize: '0.8rem', cursor: 'pointer', fontWeight: a ? 600 : 400, background: a ? '#14a89a' : 'transparent', color: a ? '#fff' : '#64748b', borderColor: a ? '#14a89a' : '#334155' }),
  card:       { background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 12, padding: '1rem', marginBottom: 8, cursor: 'pointer', transition: 'border-color 0.15s' },
  cardActive: { background: '#0f1923', border: '1px solid #14a89a', borderRadius: 12, padding: '1rem', marginBottom: 8 },
  cardTop:    { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 5 },
  typeBadge:  (t) => ({ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.73rem', fontWeight: 600, padding: '2px 7px', borderRadius: 10, background: t === 'order_chat' ? '#14a89a22' : '#3b82f622', color: t === 'order_chat' ? '#14a89a' : '#3b82f6', border: `1px solid ${t === 'order_chat' ? '#14a89a44' : '#3b82f644'}` }),
  subject:    { color: '#e2e8f0', fontWeight: 500, fontSize: '0.88rem', textDecoration: 'none' },
  meta:       { display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: '0.78rem', color: '#64748b' },
  preview:    { color: '#64748b', fontSize: '0.8rem', marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 520 },
  pagination: { display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end', marginTop: '1rem', fontSize: '0.85rem', color: '#64748b' },
  pageBtn: (d) => ({ display: 'flex', alignItems: 'center', background: 'none', border: '1px solid #334155', borderRadius: 7, padding: '5px 10px', color: d ? '#334155' : '#94a3b8', cursor: d ? 'default' : 'pointer' }),
  chatWrap:   { border: '1px solid #1e3a4a', borderRadius: 10, overflow: 'hidden', padding: '10px 12px', background: '#070d14', marginTop: 10, height: 340, display: 'flex', flexDirection: 'column' },
  closeBtn:   { display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: '1px solid #334155', borderRadius: 7, padding: '4px 10px', color: '#64748b', fontSize: '0.78rem', cursor: 'pointer', marginTop: 8 },
  empty:      { color: '#64748b', textAlign: 'center', padding: '3rem 2rem' },
};

const TYPE_FILTERS = [
  { value: '', label: 'Все чаты' },
  { value: 'order_chat',     label: 'Чаты заказов' },
  { value: 'support_ticket', label: 'Тикеты поддержки' },
];

export default function AdminConversations() {
  const [convs,    setConvs]    = useState([]);
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [type,     setType]     = useState('');
  const [search,   setSearch]   = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page,     setPage]     = useState(1);
  const [openId,   setOpenId]   = useState(null); // conv ID with expanded chat
  const LIMIT = 50;

  const load = useCallback(async (p = 1, t = type, sr = search) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: p, limit: LIMIT });
      if (t)       qs.set('type', t);
      if (sr.trim()) qs.set('search', sr.trim());
      const data = await apiCall('GET', `/admin/conversations?${qs}`);
      setConvs(data.conversations ?? []);
      setTotal(data.total ?? 0);
    } catch { setConvs([]); setTotal(0); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(1, type, search); }, []);

  function applyType(t) {
    setType(t);
    setOpenId(null);
    setPage(1);
    load(1, t, search);
  }

  function handleSearch(e) {
    e.preventDefault();
    setSearch(searchInput);
    setOpenId(null);
    setPage(1);
    load(1, type, searchInput);
  }

  function goPage(p) {
    setPage(p);
    setOpenId(null);
    load(p, type, search);
  }

  function handleCardClick(conv) {
    if (conv.type === 'order_chat') {
      setOpenId(prev => prev === conv.id ? null : conv.id);
    }
    // support_ticket: handled by link in render
  }

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div>
      <div style={S.h1}>Все чаты</div>
      <div style={S.sub}>Полный список переписок — заказы и тикеты поддержки</div>

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
            onClick={() => { setSearchInput(''); setSearch(''); setPage(1); load(1, type, ''); }}>
            × Сбросить
          </button>
        )}
      </div>

      <div style={S.filterRow}>
        {TYPE_FILTERS.map(f => (
          <button key={f.value} style={S.chip(type === f.value)} onClick={() => applyType(f.value)}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? <Spinner /> : convs.length === 0 ? (
        <div style={S.empty}>Нет чатов</div>
      ) : (
        <>
          {convs.map(conv => {
            const isOpen = openId === conv.id;
            const isOrderChat = conv.type === 'order_chat';
            const label = isOrderChat ? conv.order_title : conv.ticket_subject;

            return (
              <div
                key={conv.id}
                style={isOpen ? S.cardActive : S.card}
                onClick={() => handleCardClick(conv)}
              >
                <div style={S.cardTop}>
                  <div>
                    <span style={S.typeBadge(conv.type)}>
                      {isOrderChat ? <><MessageSquare size={11} /> Чат заказа</> : <><LifeBuoy size={11} /> Поддержка</>}
                    </span>
                    {' '}
                    {isOrderChat ? (
                      <span style={S.subject}>{label ?? '—'}</span>
                    ) : (
                      <Link
                        to="/admin/support"
                        style={S.subject}
                        onClick={e => e.stopPropagation()}
                      >
                        {label ?? 'Тикет без темы'}
                      </Link>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <span style={{ color: '#334155', fontSize: '0.75rem' }}>{conv.message_count} сообщ.</span>
                    <span style={{ color: '#64748b', fontSize: '0.75rem' }}>{formatDate(conv.last_message?.created_at ?? conv.created_at)}</span>
                    {isOpen && (
                      <span style={{ color: '#14a89a', fontSize: '0.75rem' }}>▾</span>
                    )}
                  </div>
                </div>

                <div style={S.meta}>
                  {conv.participants.map(p => (
                    <span key={p.id}>{p.nickname}</span>
                  ))}
                </div>

                {conv.last_message && (
                  <div style={S.preview}>
                    {conv.last_message.sender_nickname && (
                      <strong style={{ color: '#475569' }}>{conv.last_message.sender_nickname}: </strong>
                    )}
                    {conv.last_message.content}
                  </div>
                )}

                {/* Inline chat for order_chat */}
                {isOpen && isOrderChat && (
                  <div onClick={e => e.stopPropagation()}>
                    <div style={S.chatWrap}>
                      <ChatWindow conversationId={conv.id} readOnly={true} />
                    </div>
                    {conv.order_id && (
                      <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
                        <Link
                          to={`/orders/${conv.order_id}`}
                          style={{ color: '#14a89a', fontSize: '0.8rem', textDecoration: 'none' }}
                        >
                          Открыть заказ →
                        </Link>
                      </div>
                    )}
                    <button style={S.closeBtn} onClick={() => setOpenId(null)}>
                      <X size={13} /> Свернуть
                    </button>
                  </div>
                )}

                {/* Support ticket — hint */}
                {!isOrderChat && (
                  <div style={{ marginTop: 5, fontSize: '0.78rem', color: '#64748b' }}>
                    Перейдите в «Поддержка» для ответа на тикет
                  </div>
                )}
              </div>
            );
          })}

          <div style={S.pagination}>
            <span>{total} чатов · стр. {page} / {totalPages}</span>
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
