import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PlusCircle, ChevronRight, MessageCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiCall } from '../utils/api';
import Spinner from '../components/Spinner';

const TICKET_STATUS = {
  open:     { label: 'Открыто',   color: '#14a89a' },
  answered: { label: 'Отвечено',  color: '#3b82f6' },
  closed:   { label: 'Закрыто',   color: '#64748b' },
};

const S = {
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' },
  h1: { color: '#e2e8f0', fontSize: '1.4rem', fontWeight: 700 },
  newBtn: { display: 'flex', alignItems: 'center', gap: 6, background: '#14a89a', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer', textDecoration: 'none' },
  row: { background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 10, padding: '1rem 1.25rem', marginBottom: 8, display: 'flex', alignItems: 'center', gap: '1rem', textDecoration: 'none' },
  subject: { color: '#e2e8f0', fontWeight: 600, fontSize: '0.95rem' },
  preview: { color: '#64748b', fontSize: '0.78rem', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 340 },
  badge: (color) => ({ display: 'inline-block', padding: '2px 9px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600, background: color + '22', color, border: `1px solid ${color}44`, whiteSpace: 'nowrap', flexShrink: 0 }),
  empty: { textAlign: 'center', color: '#64748b', padding: '4rem 2rem' },
  // Create form
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal:   { background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 14, padding: '2rem', maxWidth: 480, width: '90%' },
  modalTitle: { color: '#e2e8f0', fontWeight: 700, fontSize: '1.1rem', marginBottom: '1.25rem' },
  label: { color: '#94a3b8', fontSize: '0.82rem', marginBottom: 5 },
  input: { width: '100%', background: '#1e3a4a', border: '1px solid #334155', borderRadius: 8, padding: '9px 12px', color: '#e2e8f0', fontSize: '0.9rem', boxSizing: 'border-box', marginBottom: 12 },
  textarea: { width: '100%', background: '#1e3a4a', border: '1px solid #334155', borderRadius: 8, padding: '10px 12px', color: '#e2e8f0', fontSize: '0.9rem', resize: 'vertical', minHeight: 100, boxSizing: 'border-box', lineHeight: 1.6 },
  formBtns: { display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 },
  cancelBtn: { background: 'none', border: '1px solid #334155', borderRadius: 8, padding: '8px 16px', color: '#94a3b8', cursor: 'pointer' },
  submitBtn: { background: '#14a89a', border: 'none', borderRadius: 8, padding: '8px 20px', color: '#fff', fontWeight: 600, cursor: 'pointer' },
};

export default function Support() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tickets, setTickets]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [subject, setSubject]     = useState('');
  const [message, setMessage]     = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  async function load() {
    try { setTickets(await apiCall('GET', '/support/tickets') ?? []); }
    catch { setTickets([]); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (user) load(); }, [user]);

  async function handleCreate(e) {
    e.preventDefault();
    setFormError('');
    if (!subject.trim() || !message.trim()) { setFormError('Заполните оба поля'); return; }
    setSubmitting(true);
    try {
      const { conversation_id } = await apiCall('POST', '/support/tickets', { subject, message });
      setShowForm(false);
      navigate(`/support/${conversation_id}`);
    } catch (err) { setFormError(err.message); }
    finally { setSubmitting(false); }
  }

  if (loading) return <Spinner />;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div style={S.header}>
        <div>
          <div style={S.h1}>Поддержка</div>
          <div style={{ color: '#64748b', fontSize: '0.85rem', marginTop: 4 }}>Ваши обращения в службу поддержки</div>
        </div>
        <button style={S.newBtn} onClick={() => { setShowForm(true); setFormError(''); setSubject(''); setMessage(''); }}>
          <PlusCircle size={15} /> Создать обращение
        </button>
      </div>

      {tickets.length === 0 ? (
        <div style={S.empty}>
          <MessageCircle size={40} style={{ color: '#334155', marginBottom: 12 }} />
          <div style={{ marginBottom: 12 }}>У вас пока нет обращений</div>
          <button style={S.newBtn} onClick={() => setShowForm(true)}>
            <PlusCircle size={15} /> Создать первое обращение
          </button>
        </div>
      ) : (
        tickets.map(t => {
          const meta = TICKET_STATUS[t.status] ?? TICKET_STATUS.open;
          return (
            <Link key={t.id} to={`/support/${t.conversation_id ?? t.id}`} style={S.row}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={S.subject}>{t.subject}</div>
                {t.last_message && (
                  <div style={S.preview}>{t.last_message.sender_nickname}: {t.last_message.content}</div>
                )}
                <div style={{ color: '#64748b', fontSize: '0.75rem', marginTop: 3 }}>
                  {new Date(t.created_at).toLocaleDateString('ru-RU')}
                </div>
              </div>
              <span style={S.badge(meta.color)}>{meta.label}</span>
              <ChevronRight size={16} style={{ color: '#334155', flexShrink: 0 }} />
            </Link>
          );
        })
      )}

      {showForm && (
        <div style={S.overlay} onClick={() => setShowForm(false)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={S.modalTitle}>Новое обращение</div>
            <form onSubmit={handleCreate}>
              <div style={S.label}>Тема обращения <span style={{ color: '#ef4444' }}>*</span></div>
              <input style={S.input} placeholder="Кратко опишите вопрос" value={subject} onChange={e => setSubject(e.target.value)} />
              <div style={S.label}>Сообщение <span style={{ color: '#ef4444' }}>*</span></div>
              <textarea style={S.textarea} placeholder="Подробно опишите ситуацию..." value={message} onChange={e => setMessage(e.target.value)} />
              {formError && <div style={{ color: '#f87171', fontSize: '0.82rem', marginTop: 8 }}>{formError}</div>}
              <div style={S.formBtns}>
                <button type="button" style={S.cancelBtn} onClick={() => setShowForm(false)}>Отмена</button>
                <button type="submit" style={S.submitBtn} disabled={submitting}>
                  {submitting ? 'Отправка...' : 'Отправить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
