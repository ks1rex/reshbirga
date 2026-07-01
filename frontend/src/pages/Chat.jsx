import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiCall } from '../utils/api';
import ChatWindow from '../components/ChatWindow';
import Spinner from '../components/Spinner';

export default function Chat() {
  const { id: orderId } = useParams();
  const { user } = useAuth();

  const [order, setOrder]   = useState(null);
  const [convId, setConvId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    Promise.all([
      apiCall('GET', `/orders/${orderId}`),
      apiCall('GET', `/orders/${orderId}/conversation`),
    ]).then(([ord, conv]) => {
      setOrder(ord);
      setConvId(conv.conversation_id);
    }).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [orderId]);

  if (loading) return <Spinner />;
  if (error)   return <div style={{ color: '#f87171' }}>{error}</div>;
  if (!convId) return <div style={{ color: '#f87171' }}>Чат для этого заказа ещё не создан</div>;

  const allowContacts = order?.requires_contact_exchange === true;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)', maxWidth: 800, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <Link to={`/orders/${orderId}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#64748b', textDecoration: 'none', fontSize: '0.85rem' }}>
          <ArrowLeft size={14} /> К заказу
        </Link>
        <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: '1.1rem' }}>
          Чат по заказу «{order?.title}»
        </div>
      </div>

      <ChatWindow
        conversationId={convId}
        readOnly={false}
        scheduledBanner={allowContacts}
        checkContacts={!allowContacts}
      />
    </div>
  );
}
