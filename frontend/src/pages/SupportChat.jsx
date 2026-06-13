import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiCall } from '../utils/api';
import ChatWindow from '../components/ChatWindow';
import Spinner from '../components/Spinner';

const TICKET_STATUS = {
  open:     { label: 'Открыто',  color: '#14a89a' },
  answered: { label: 'Отвечено', color: '#3b82f6' },
  closed:   { label: 'Закрыто',  color: '#64748b' },
};

function StatusBadge({ status }) {
  const meta = TICKET_STATUS[status] ?? TICKET_STATUS.open;
  return (
    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: '0.78rem', fontWeight: 600, background: meta.color + '22', color: meta.color, border: `1px solid ${meta.color}44` }}>
      {meta.label}
    </span>
  );
}

export default function SupportChat() {
  // :id can be either conversation_id (preferred) or ticket_id
  const { id } = useParams();
  const { user } = useAuth();

  const [convId, setConvId]   = useState(null);
  const [ticket, setTicket]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    if (!user || !id) return;
    // Try to get ticket by conversation_id first — or by ticket_id
    // We navigate here with conversation_id, so try loading messages to verify access,
    // then load ticket info separately via support/tickets
    apiCall('GET', `/conversations/${id}/messages?limit=1`)
      .then(() => {
        setConvId(id);
        // load ticket by conv lookup
        return apiCall('GET', '/support/tickets');
      })
      .then(tickets => {
        const found = (tickets ?? []).find(t => t.conversation_id === id);
        if (found) setTicket(found);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [id, user]);

  if (loading) return <Spinner />;
  if (error)   return <div style={{ color: '#f87171' }}>{error}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)', maxWidth: 800, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <Link to="/support" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#64748b', textDecoration: 'none', fontSize: '0.85rem' }}>
          <ArrowLeft size={14} /> К обращениям
        </Link>
        <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: '1.05rem', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {ticket?.subject ?? 'Обращение в поддержку'}
        </div>
        {ticket && <StatusBadge status={ticket.status} />}
      </div>

      {ticket?.status === 'closed' && (
        <div style={{ background: '#1e3a4a', borderRadius: 8, padding: '8px 14px', marginBottom: 10, color: '#64748b', fontSize: '0.85rem' }}>
          Обращение закрыто — вы можете просматривать историю переписки.
        </div>
      )}

      <ChatWindow
        conversationId={convId}
        readOnly={ticket?.status === 'closed'}
        checkContacts={false}
        scheduledBanner={false}
      />
    </div>
  );
}
