import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle, ExternalLink, Bot, Type } from 'lucide-react';
import { apiCall } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';

const TYPE_LABEL = { order: 'Заказ', service: 'Услуга' };
const TYPE_COLOR = { order: '#ef4444', service: '#a78bfa' };

const S = {
  h1: { color: '#e2e8f0', fontSize: '1.4rem', fontWeight: 700, marginBottom: '0.25rem' },
  sub: { color: '#64748b', fontSize: '0.88rem', marginBottom: '1rem' },
  filterRow: { display: 'flex', gap: 8, marginBottom: '1.25rem' },
  filterBtn: (active) => ({ padding: '6px 14px', borderRadius: 7, border: '1px solid', fontSize: '0.82rem', fontWeight: 500, cursor: 'pointer', background: active ? '#14a89a' : 'transparent', borderColor: active ? '#14a89a' : '#1e3a4a', color: active ? '#fff' : '#64748b' }),
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { color: '#64748b', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #1e3a4a' },
  td: { padding: '11px 12px', borderBottom: '1px solid #0f1923', color: '#e2e8f0', fontSize: '0.85rem', verticalAlign: 'top' },
  orderTitle: { fontWeight: 600, marginBottom: 2 },
  typeBadge: (color) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 600, background: color + '22', color, border: `1px solid ${color}44` }),
  flagBadge: (src) => ({
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '2px 8px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 600,
    background: src === 'regex' ? '#f59e0b22' : '#3b82f622',
    color:      src === 'regex' ? '#f59e0b'   : '#3b82f6',
    border:     `1px solid ${src === 'regex' ? '#f59e0b44' : '#3b82f644'}`,
    marginTop: 4,
    whiteSpace: 'nowrap',
  }),
  msgText: { color: '#cbd5e1', lineHeight: 1.5, maxWidth: 360, wordBreak: 'break-word' },
  nick: { color: '#94a3b8' },
  date: { color: '#64748b', fontSize: '0.78rem', whiteSpace: 'nowrap' },
  reviewedBadge: { display: 'inline-flex', alignItems: 'center', gap: 4, color: '#22c55e', fontSize: '0.8rem' },
  reviewBtn: { display: 'inline-flex', alignItems: 'center', gap: 5, background: '#0d2620', border: '1px solid #14a89a', borderRadius: 6, padding: '5px 10px', color: '#14a89a', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 600 },
  chatLink: { display: 'inline-flex', alignItems: 'center', gap: 4, color: '#64748b', textDecoration: 'none', fontSize: '0.78rem' },
  empty: { color: '#64748b', textAlign: 'center', padding: '3rem' },
};

export default function AdminChatModeration() {
  const { profile } = useAuth();
  const toast = useToast();
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState('all');
  const [marking, setMarking] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const q = filter === 'pending' ? '?reviewed=false' : filter === 'reviewed' ? '?reviewed=true' : '';
      const data = await apiCall('GET', `/admin/chat-moderation${q}`);
      setItems(data ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [filter]);

  async function markReviewed(msgId) {
    setMarking(msgId);
    try {
      await apiCall('PATCH', `/admin/chat-moderation/${msgId}/review`, {});
      setItems(prev => prev.map(m => m.id === msgId ? { ...m, moderation_reviewed: true } : m));
    } catch (e) { toast.error(e.message); }
    finally { setMarking(null); }
  }

  if (!profile?.is_admin) return null;

  return (
    <div>
      <div style={S.h1}>Модерация чата</div>
      <div style={S.sub}>Сообщения с признаками контактных данных — по regex-правилам или ИИ-анализу</div>

      <div style={S.filterRow}>
        {[['all', 'Все'], ['pending', 'Не просмотрено'], ['reviewed', 'Просмотрено']].map(([val, label]) => (
          <button key={val} style={S.filterBtn(filter === val)} onClick={() => setFilter(val)}>{label}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ color: '#64748b' }}>Загрузка...</div>
      ) : items.length === 0 ? (
        <div style={S.empty}>Нет сообщений по фильтру</div>
      ) : (
        <div style={{ background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 12, overflow: 'hidden', overflowX: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Заказ</th>
                <th style={S.th}>Отправитель</th>
                <th style={S.th}>Сообщение</th>
                <th style={S.th}>Дата</th>
                <th style={S.th}>Статус / Действие</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const order = item.conversations?.orders;
                const orderType = order?.order_type;
                const color = TYPE_COLOR[orderType] ?? '#64748b';
                const src = item.flag_source ?? 'regex';
                return (
                  <tr key={item.id}>
                    <td style={S.td}>
                      <div style={S.orderTitle}>{order?.title ?? '—'}</div>
                      <div style={{ marginTop: 3 }}>
                        <span style={S.typeBadge(color)}>
                          {TYPE_LABEL[orderType] ?? (orderType ?? '—')}
                        </span>
                      </div>
                      {/* Flag source badge */}
                      <div style={S.flagBadge(src)}>
                        {src === 'regex'
                          ? <><Type size={10} />По правилам</>
                          : <><Bot size={10} />ИИ-подозрение</>
                        }
                      </div>
                      {order?.id && (
                        <Link to={`/orders/${order.id}/chat`} style={{ ...S.chatLink, marginTop: 4 }}>
                          <ExternalLink size={11} /> открыть чат
                        </Link>
                      )}
                    </td>
                    <td style={{ ...S.td, ...S.nick }}>{item.sender?.nickname ?? '—'}</td>
                    <td style={S.td}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                        <AlertTriangle size={14} style={{ color: src === 'regex' ? '#f59e0b' : '#3b82f6', flexShrink: 0, marginTop: 2 }} />
                        <div style={S.msgText}>{item.content}</div>
                      </div>
                    </td>
                    <td style={S.td}>
                      <div style={S.date}>
                        {new Date(item.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </td>
                    <td style={S.td}>
                      {item.moderation_reviewed ? (
                        <div style={S.reviewedBadge}>
                          <CheckCircle size={14} /> Просмотрено
                        </div>
                      ) : (
                        <button
                          style={S.reviewBtn}
                          onClick={() => markReviewed(item.id)}
                          disabled={marking === item.id}
                        >
                          <CheckCircle size={13} />
                          {marking === item.id ? '...' : 'Просмотрено'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
