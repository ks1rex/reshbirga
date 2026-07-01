import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Star, AlertTriangle, ArrowLeft } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiCall } from '../utils/api';
import Spinner from '../components/Spinner';

const S = {
  back: { display: 'inline-flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: '0.85rem', marginBottom: '1.25rem', textDecoration: 'none' },
  h1: { color: '#e2e8f0', fontSize: '1.3rem', fontWeight: 700, marginBottom: '0.25rem' },
  sub: { color: '#64748b', fontSize: '0.85rem', marginBottom: '1.5rem' },
  card: { background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 12, padding: '1.25rem', marginBottom: 10 },
  nick: { color: '#e2e8f0', fontWeight: 700, fontSize: '1rem', marginBottom: 4 },
  rating: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 },
  stars: { color: '#f59e0b', fontSize: '0.9rem' },
  reviewCount: { color: '#64748b', fontSize: '0.78rem' },
  msg: { color: '#cbd5e1', fontSize: '0.88rem', lineHeight: 1.6, marginBottom: 10 },
  price: { color: '#14a89a', fontSize: '1.1rem', fontWeight: 700, marginBottom: 10 },
  date: { color: '#64748b', fontSize: '0.75rem' },
  selectBtn: { background: '#14a89a', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem' },
  // Modal
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 14, padding: '2rem', maxWidth: 440, width: '90%' },
  modalTitle: { color: '#e2e8f0', fontWeight: 700, fontSize: '1.1rem', marginBottom: 8 },
  modalText: { color: '#94a3b8', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '1.5rem' },
  modalBtns: { display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' },
  cancelBtn: { background: 'none', border: '1px solid #334155', borderRadius: 8, padding: '8px 16px', color: '#94a3b8', cursor: 'pointer' },
  okBtn: { background: '#14a89a', border: 'none', borderRadius: 8, padding: '8px 20px', color: '#fff', fontWeight: 600, cursor: 'pointer' },
};

function StarsRow({ rating, count }) {
  const filled = Math.round(rating || 0);
  return (
    <div style={S.rating}>
      <span style={S.stars}>{'★'.repeat(filled)}{'☆'.repeat(5 - filled)}</span>
      <span style={{ color: '#f59e0b', fontSize: '0.82rem', fontWeight: 600 }}>{(rating || 0).toFixed(1)}</span>
      <span style={S.reviewCount}>({count || 0} отзывов)</span>
    </div>
  );
}

export default function Applications() {
  const { id: orderId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [order, setOrder] = useState(null);
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // selected app
  const [acting, setActing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      apiCall('GET', `/orders/${orderId}`),
      apiCall('GET', `/orders/${orderId}/applications`),
    ]).then(([ord, appList]) => {
      // Redirect if not the owner
      if (ord.customer_id !== user?.id) {
        navigate(`/orders/${orderId}`, { replace: true });
        return;
      }
      setOrder(ord);
      setApps(Array.isArray(appList) ? appList : []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [orderId, user?.id, navigate]);

  async function handleSelect() {
    setActing(true);
    setError('');
    try {
      await apiCall('POST', `/orders/${orderId}/applications/${modal.id}/select`, {});
      navigate(`/orders/${orderId}`);
    } catch (e) {
      setError(e.message);
      setActing(false);
    }
  }

  if (loading) return <Spinner />;
  if (!order) return <div style={{ color: '#f87171' }}>Заказ не найден</div>;

  const pendingApps = apps.filter(a => a.status === 'pending');

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <Link to={`/orders/${orderId}`} style={S.back}>
        <ArrowLeft size={14} /> Назад к заказу
      </Link>
      <div style={S.h1}>Заявки исполнителей</div>
      <div style={S.sub}>
        Заказ: «{order.title}» · {pendingApps.length} активных заявок
      </div>

      {apps.length === 0 && (
        <div style={{ color: '#64748b', textAlign: 'center', padding: '3rem' }}>
          Заявок пока нет
        </div>
      )}

      {apps.map(app => (
        <div key={app.id} style={{ ...S.card, opacity: app.status !== 'pending' ? 0.5 : 1 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <Link to={`/users/${app.executor?.id}`} style={{ ...S.nick, color: '#14a89a', textDecoration: 'none', display: 'block' }}>{app.executor?.nickname}</Link>
              <StarsRow rating={app.executor?.rating_as_executor} count={app.executor?.reviews_count_executor} />
              {app.proposed_amount && (
                <div style={S.price}>{app.proposed_amount} ₽ — предложенная цена</div>
              )}
              <div style={S.msg}>{app.message}</div>
              <div style={S.date}>{new Date(app.created_at).toLocaleString('ru-RU')}</div>
            </div>
            {app.status === 'pending' && (
              <button style={S.selectBtn} onClick={() => setModal(app)}>Выбрать</button>
            )}
            {app.status === 'accepted' && (
              <span style={{ color: '#22c55e', fontSize: '0.82rem', fontWeight: 600 }}>✓ Выбран</span>
            )}
            {app.status === 'rejected' && (
              <span style={{ color: '#64748b', fontSize: '0.82rem' }}>Отклонён</span>
            )}
          </div>
        </div>
      ))}

      {error && <div style={{ color: '#f87171', marginTop: 8, fontSize: '0.85rem' }}>{error}</div>}

      {modal && (
        <div style={S.overlay} onClick={() => !acting && setModal(null)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <AlertTriangle size={20} style={{ color: '#14a89a' }} />
              <div style={S.modalTitle}>Выбрать исполнителя?</div>
            </div>
            <div style={S.modalText}>
              Вы выбираете <strong>{modal.executor?.nickname}</strong>
              {modal.proposed_amount && <> с ценой <strong>{modal.proposed_amount} ₽</strong></>}.
              <br />
              Остальные заявки будут отклонены. Отменить это действие нельзя.
              {modal.proposed_amount && (
                <>
                  <br /><br />
                  Если предложенная цена отличается от вашего первоначального бюджета, система автоматически создаст транзакцию на доплату или возврат.
                </>
              )}
            </div>
            <div style={S.modalBtns}>
              <button style={S.cancelBtn} onClick={() => setModal(null)} disabled={acting}>Отмена</button>
              <button style={S.okBtn} onClick={handleSelect} disabled={acting}>
                {acting ? 'Обработка...' : 'Подтвердить выбор'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
