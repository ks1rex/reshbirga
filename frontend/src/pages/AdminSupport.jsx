import { useEffect, useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import { apiCall } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import ChatWindow from '../components/ChatWindow';
import { useToast } from '../components/Toast';

const TABS = [
  { key: 'open',     label: 'Открытые' },
  { key: 'answered', label: 'Отвеченные' },
  { key: 'closed',   label: 'Закрытые' },
];
const STATUS_COLOR = { open: '#14a89a', answered: '#3b82f6', closed: '#64748b' };

const S = {
  h1: { color: '#e2e8f0', fontSize: '1.4rem', fontWeight: 700, marginBottom: '0.25rem' },
  sub: { color: '#64748b', fontSize: '0.88rem', marginBottom: '1.25rem' },
  tabs: { display: 'flex', borderBottom: '1px solid #1e3a4a', marginBottom: '1.25rem' },
  tab: (active) => ({ padding: '8px 18px', fontWeight: 500, fontSize: '0.88rem', cursor: 'pointer', background: 'none', border: 'none', borderBottom: active ? '2px solid #14a89a' : '2px solid transparent', color: active ? '#14a89a' : '#64748b', marginBottom: -1 }),
  row: (active) => ({ background: active ? '#0d2620' : '#0f1923', border: `1px solid ${active ? '#0e8a7d' : '#1e3a4a'}`, borderRadius: 10, padding: '1rem 1.25rem', marginBottom: 8, cursor: 'pointer' }),
  rowSubject: { color: '#e2e8f0', fontWeight: 600, fontSize: '0.95rem', marginBottom: 3 },
  rowMeta: { color: '#64748b', fontSize: '0.78rem', display: 'flex', gap: 12 },
  preview: { color: '#64748b', fontSize: '0.78rem', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  badge: (color) => ({ display: 'inline-block', padding: '2px 9px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600, background: color + '22', color, border: `1px solid ${color}44` }),
  empty: { textAlign: 'center', color: '#64748b', padding: '4rem 2rem' },
  // Chat pane
  chatPanelWrap: { flex: 1, display: 'flex', flexDirection: 'column', background: '#070d14', border: '1px solid #1e3a4a', borderRadius: 12, overflow: 'hidden', padding: '1rem' },
  chatHeader: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: '0.75rem', flexShrink: 0 },
  chatTitle: { color: '#e2e8f0', fontWeight: 700, flex: 1, fontSize: '1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  closeBtn: { background: '#1e3a4a', border: 'none', borderRadius: 8, padding: '6px 14px', color: '#94a3b8', cursor: 'pointer', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 5 },
  closeTixBtn: { display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: '1px solid #64748b', borderRadius: 8, padding: '6px 12px', color: '#64748b', cursor: 'pointer', fontSize: '0.82rem', marginLeft: 'auto' },
};

export default function AdminSupport() {
  const { profile } = useAuth();
  const toast = useToast();
  const [tab, setTab]         = useState('open');
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null); // ticket
  const [closing, setClosing] = useState(false);

  async function load(status) {
    setLoading(true);
    try {
      const data = await apiCall('GET', `/support/tickets?all=true&status=${status}`);
      setTickets(Array.isArray(data) ? data : []);
    } catch { setTickets([]); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (profile?.is_admin) { setSelected(null); load(tab); }
  }, [tab, profile]);

  async function handleClose() {
    if (!selected) return;
    setClosing(true);
    try {
      await apiCall('PATCH', `/admin/support/tickets/${selected.id}/close`, {});
      // update local state
      setSelected(prev => prev ? { ...prev, status: 'closed' } : null);
      setTickets(prev => prev.map(t => t.id === selected.id ? { ...t, status: 'closed' } : t));
    } catch (e) { toast.error(e.message); }
    finally { setClosing(false); }
  }

  if (!profile?.is_admin) return null;

  return (
    <div style={{ display: 'flex', gap: '1.5rem', maxWidth: 1100, height: 'calc(100vh - 140px)', minHeight: 0 }}>
      {/* Left: list */}
      <div style={{ width: 360, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={S.h1}>Обращения</div>
        <div style={S.sub}>Служба поддержки</div>

        <div style={S.tabs}>
          {TABS.map(t => (
            <button key={t.key} style={S.tab(tab === t.key)} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? <div style={{ color: '#64748b' }}>Загрузка...</div>
          : tickets.length === 0 ? <div style={S.empty}><MessageCircle size={32} style={{ color: '#334155', marginBottom: 8 }} /><div>Нет обращений</div></div>
          : tickets.map(t => {
            const color = STATUS_COLOR[t.status] ?? '#64748b';
            const isActive = selected?.id === t.id;
            return (
              <div key={t.id} style={S.row(isActive)} onClick={() => setSelected(t)}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={S.rowSubject}>{t.subject}</div>
                    <div style={S.rowMeta}>
                      <span>{t.user?.nickname}</span>
                      <span>{new Date(t.created_at).toLocaleDateString('ru-RU')}</span>
                    </div>
                    {t.last_message && <div style={S.preview}>{t.last_message.sender_nickname}: {t.last_message.content}</div>}
                  </div>
                  <span style={S.badge(color)}>{
                    { open: 'Открыто', answered: 'Отвечено', closed: 'Закрыто' }[t.status]
                  }</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: chat pane */}
      {selected ? (
        <div style={S.chatPanelWrap}>
          <div style={S.chatHeader}>
            <div style={S.chatTitle}>{selected.subject}</div>
            <div style={{ color: '#64748b', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{selected.user?.nickname}</div>
            {selected.status !== 'closed' && (
              <button style={S.closeTixBtn} onClick={handleClose} disabled={closing}>
                <X size={13} /> {closing ? 'Закрытие...' : 'Закрыть обращение'}
              </button>
            )}
            <button style={S.closeBtn} onClick={() => setSelected(null)}>Закрыть</button>
          </div>
          <ChatWindow
            conversationId={selected.conversation_id}
            readOnly={selected.status === 'closed'}
            checkContacts={false}
            scheduledBanner={false}
          />
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155', flexDirection: 'column', gap: 12 }}>
          <MessageCircle size={48} />
          <div style={{ color: '#64748b', fontSize: '0.9rem' }}>Выберите обращение для просмотра</div>
        </div>
      )}
    </div>
  );
}
