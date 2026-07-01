import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Download, FileText, Copy, Users, Send, MessageSquare, CheckCircle, AlertOctagon, Shield, AlertTriangle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiCall } from '../utils/api';
import { StatusBadge } from '../utils/statusMap';
import StarRating from '../components/StarRating';
import { useToast } from '../components/Toast';
import Spinner from '../components/Spinner';

const S = {
  h1: { color: '#e2e8f0', fontSize: '1.3rem', fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  card: { background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 12, padding: '1.5rem', marginBottom: '1rem' },
  sectionTitle: { color: '#94a3b8', fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1rem' },
  meta: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1rem' },
  metaItem: { color: '#64748b', fontSize: '0.85rem' },
  metaValue: { color: '#e2e8f0', fontWeight: 500, marginTop: 2 },
  paymentBox: { background: '#0d2620', border: '1px solid #0e8a7d', borderRadius: 10, padding: '1.25rem', marginBottom: '1rem' },
  paymentTitle: { color: '#14a89a', fontWeight: 700, marginBottom: 8, fontSize: '1.05rem' },
  paymentText: { color: '#94a3b8', fontSize: '0.9rem', lineHeight: 1.7 },
  amount: { color: '#14a89a', fontSize: '1.5rem', fontWeight: 700 },
  fileRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #1e3a4a' },
  dlBtn: { display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: '1px solid #1e3a4a', borderRadius: 6, padding: '4px 10px', color: '#94a3b8', fontSize: '0.8rem', cursor: 'pointer' },
  desc: { color: '#cbd5e1', lineHeight: 1.7, whiteSpace: 'pre-wrap', fontSize: '0.95rem' },
  textarea: { width: '100%', background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 8, padding: '10px 12px', color: '#e2e8f0', fontSize: '0.9rem', lineHeight: 1.6, resize: 'vertical', minHeight: 100, boxSizing: 'border-box' },
  input: { width: '100%', background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 8, padding: '9px 12px', color: '#e2e8f0', fontSize: '0.9rem', boxSizing: 'border-box' },
  submitBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#14a89a', border: 'none', borderRadius: 8, padding: '9px 20px', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem' },
  appsLink: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 20px', borderRadius: 8, background: '#1e3a4a', color: '#94a3b8', textDecoration: 'none', fontSize: '0.9rem', fontWeight: 500 },
  confirmBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#14a89a', border: 'none', borderRadius: 8, padding: '9px 18px', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: '0.88rem', marginRight: 8, marginBottom: 8 },
  disputeBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: '1px solid #ef4444', borderRadius: 8, padding: '9px 18px', color: '#ef4444', fontWeight: 600, cursor: 'pointer', fontSize: '0.88rem', marginBottom: 8 },
  cancelBtn:  { background: 'none', border: '1px solid #334155', borderRadius: 8, padding: '8px 14px', color: '#94a3b8', cursor: 'pointer', fontSize: '0.85rem' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 14, padding: '2rem', maxWidth: 440, width: '90%' },
  modalTitle: { color: '#e2e8f0', fontWeight: 700, fontSize: '1.1rem', marginBottom: 8 },
  modalText: { color: '#94a3b8', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '1.5rem' },
  modalBtns: { display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' },
  okBtn: { background: '#14a89a', border: 'none', borderRadius: 8, padding: '8px 20px', color: '#fff', fontWeight: 600, cursor: 'pointer' },
};

function copyToClipboard(text) { navigator.clipboard.writeText(text).catch(() => {}); }

function formatTimeLeft(deadline) {
  const ms = new Date(deadline) - new Date();
  if (ms <= 0) return 'совсем скоро';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
}

function PaymentBlock({ label, amount, shortId, requisites }) {
  return (
    <div style={S.paymentBox}>
      <div style={S.paymentTitle}>{label}</div>
      <div style={S.paymentText}>
        Переведите <strong style={{ color: '#14a89a' }}>{amount} ₽</strong> на реквизиты:
        <br /><br />
        {requisites === undefined ? (
          <span style={{ color: '#64748b' }}>Загрузка реквизитов...</span>
        ) : requisites ? (
          <>
            <span style={{ color: '#e2e8f0', whiteSpace: 'pre-wrap' }}>{requisites}</span>
            {' '}<button onClick={() => copyToClipboard(requisites)} style={{ background: 'none', border: 'none', color: '#14a89a', cursor: 'pointer', verticalAlign: 'middle' }}><Copy size={14} /></button>
          </>
        ) : (
          <span style={{ color: '#f59e0b' }}>Реквизиты пока не настроены, обратитесь в поддержку.</span>
        )}
        <br /><br />
        В комментарии укажите: <strong style={{ color: '#e2e8f0' }}>Заказ #{shortId}</strong>
        {' '}<button onClick={() => copyToClipboard(`Заказ #${shortId}`)} style={{ background: 'none', border: 'none', color: '#14a89a', cursor: 'pointer', verticalAlign: 'middle' }}><Copy size={14} /></button>
        <br />После перевода напишите в поддержку — администратор подтвердит оплату.
      </div>
    </div>
  );
}

export default function OrderDetail() {
  const { id } = useParams();
  const { user, profile } = useAuth();
  const toast = useToast();

  const [order, setOrder]         = useState(null);
  const [loading, setLoading]     = useState(true);
  const [dlLoading, setDlLoading] = useState(null);
  const [topupLoading, setTopupLoading] = useState(false);

  // Apply form
  const [applyMsg, setApplyMsg]     = useState('');
  const [applyPrice, setApplyPrice] = useState('');
  const [applyLoading, setApplyLoading] = useState(false);
  const [applyError, setApplyError]     = useState('');

  // Confirm / dispute
  const [confirmModal, setConfirmModal]   = useState(false);
  const [disputeOpen, setDisputeOpen]     = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [cancelOpen, setCancelOpen]       = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError]     = useState('');

  // Reviews
  const [reviews, setReviews]               = useState(null);
  const [hasReviewed, setHasReviewed]       = useState(false);
  const [reviewRating, setReviewRating]     = useState(5);
  const [reviewComment, setReviewComment]   = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError]       = useState('');

  async function loadOrder() {
    const data = await apiCall('GET', `/orders/${id}`);
    setOrder(data);
  }

  useEffect(() => {
    loadOrder().catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (order?.status === 'completed') {
      apiCall('GET', `/orders/${id}/reviews`)
        .then(data => {
          setReviews(data.reviews ?? []);
          setHasReviewed(data.has_reviewed ?? false);
        })
        .catch(() => setReviews([]));
    }
  }, [order?.status, id]);

  async function handleDownload(att) {
    setDlLoading(att.id);
    try {
      const { url } = await apiCall('GET', `/orders/${id}/attachments/${att.id}/download`);
      window.open(url, '_blank');
    } catch (e) { toast.error(e.message); }
    finally { setDlLoading(null); }
  }

  async function handleApply(e) {
    e.preventDefault();
    setApplyLoading(true);
    setApplyError('');
    try {
      const body = { message: applyMsg, proposed_amount: parseFloat(applyPrice) };
      await apiCall('POST', `/orders/${id}/apply`, body);
      await loadOrder();
      setApplyMsg(''); setApplyPrice('');
    } catch (e) { setApplyError(e.message); }
    finally { setApplyLoading(false); }
  }

  async function handleConfirm() {
    setActionLoading(true); setActionError('');
    try {
      await apiCall('POST', `/orders/${id}/confirm`, {});
      setConfirmModal(false);
      await loadOrder();
    } catch (e) { setActionError(e.message); }
    finally { setActionLoading(false); }
  }

  async function handleDispute() {
    if (!disputeReason.trim()) return;
    setActionLoading(true); setActionError('');
    try {
      await apiCall('POST', `/orders/${id}/dispute`, { reason: disputeReason });
      setDisputeOpen(false); setDisputeReason('');
      await loadOrder();
    } catch (e) { setActionError(e.message); }
    finally { setActionLoading(false); }
  }

  async function handleCancel() {
    setActionLoading(true); setActionError('');
    try {
      await apiCall('POST', `/orders/${id}/cancel`, {});
      setCancelOpen(false);
      await loadOrder();
      toast.success('Заказ отменён');
    } catch (e) { setActionError(e.message); }
    finally { setActionLoading(false); }
  }

  async function handleReviewSubmit(e) {
    e.preventDefault();
    if (!reviewRating) return;
    setReviewSubmitting(true); setReviewError('');
    try {
      await apiCall('POST', `/orders/${id}/reviews`, { rating: reviewRating, comment: reviewComment });
      const data = await apiCall('GET', `/orders/${id}/reviews`);
      setReviews(data.reviews ?? []);
      setHasReviewed(true);
    } catch (e) { setReviewError(e.message); }
    finally { setReviewSubmitting(false); }
  }

  if (loading) return <Spinner />;
  if (!order)  return <div style={{ color: '#f87171' }}>Заказ не найден</div>;

  const shortId    = order.id.slice(0, 8).toUpperCase();
  const isOwner    = order.customer_id === user?.id;
  const isExecutor = order.executor_id === user?.id;
  const isAdmin    = profile?.is_admin === true;

  const canConfirm = (isOwner || isExecutor) &&
    ['in_progress', 'awaiting_confirmation'].includes(order.status) &&
    !(isOwner && order.confirmed_by_customer) &&
    !(isExecutor && order.confirmed_by_executor);

  const canDispute = (isOwner || isExecutor) &&
    ['in_progress', 'awaiting_confirmation'].includes(order.status);

  const chatStatuses = ['in_progress', 'awaiting_topup', 'awaiting_confirmation', 'completed', 'disputed', 'cancelled', 'assigned'];

  const needsTopup = order.status === 'awaiting_topup' && isOwner;
  const topupAmount = needsTopup ? parseFloat(order.required_topup ?? 0) : null;

  async function handleTopup() {
    setTopupLoading(true); setActionError('');
    try {
      await apiCall('POST', `/orders/${id}/topup`, {});
      await loadOrder();
      toast.success('Доплата проведена, заказ в работе');
    } catch (e) { setActionError(e.message); }
    finally { setTopupLoading(false); }
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div style={S.h1}>
        {order.title}
        <StatusBadge status={order.status} />
      </div>

      <div style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <span>Заказ #{shortId} · {order.subject} · {new Date(order.created_at).toLocaleDateString('ru-RU')}</span>
        {isOwner && order.status === 'open' && (
          <Link to={`/orders/${id}/applications`} style={S.appsLink}><Users size={14} /> Заявки исполнителей</Link>
        )}
        {chatStatuses.includes(order.status) && (isOwner || isExecutor || isAdmin) && (
          <Link to={`/orders/${id}/chat`} style={{ ...S.appsLink, background: '#0d2620', color: '#14a89a', border: '1px solid #0e8a7d' }}>
            <MessageSquare size={14} /> Перейти в чат
          </Link>
        )}
      </div>

      {/* Awaiting topup — balance-based, no requisites */}
      {needsTopup && topupAmount != null && topupAmount > 0 && (
        <div style={S.paymentBox}>
          <div style={S.paymentTitle}>Требуется доплата</div>
          <div style={S.paymentText}>
            Исполнитель предложил цену выше максимума. Для продолжения нужно доплатить{' '}
            <strong style={{ color: '#14a89a' }}>{topupAmount} ₽</strong> с баланса кошелька.
          </div>
          {actionError && <div style={{ color: '#f87171', fontSize: '0.82rem', margin: '8px 0' }}>{actionError}</div>}
          {!cancelOpen ? (
            <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button style={S.confirmBtn} onClick={handleTopup} disabled={topupLoading}>
                {topupLoading ? 'Оплата...' : `Доплатить ${topupAmount} ₽ с баланса`}
              </button>
              <button style={S.cancelBtn} onClick={() => { setActionError(''); setCancelOpen(true); }} disabled={topupLoading}>
                Отменить заказ
              </button>
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: 8 }}>
                Отменить заказ? Зарезервированная сумма ({order.reserved_amount} ₽) вернётся на ваш баланс. Доплата не списывается.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={{ ...S.submitBtn, background: '#ef4444' }} onClick={handleCancel} disabled={actionLoading}>
                  {actionLoading ? 'Отмена...' : 'Да, отменить'}
                </button>
                <button style={S.cancelBtn} onClick={() => { setCancelOpen(false); setActionError(''); }}>Назад</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Cancel order — only for open orders without executor */}
      {isOwner && order.status === 'open' && order.executor_id == null && (
        <div style={S.card}>
          {!cancelOpen ? (
            <button style={S.disputeBtn} onClick={() => { setActionError(''); setCancelOpen(true); }}>
              Отменить заказ
            </button>
          ) : (
            <div>
              <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: 8 }}>
                Отменить заказ? Вся зарезервированная сумма ({order.reserved_amount} ₽) будет возвращена на ваш баланс.
              </div>
              {actionError && <div style={{ color: '#f87171', fontSize: '0.82rem', marginBottom: 6 }}>{actionError}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={{ ...S.submitBtn, background: '#ef4444' }} onClick={handleCancel} disabled={actionLoading}>
                  {actionLoading ? 'Отмена...' : 'Да, отменить'}
                </button>
                <button style={S.cancelBtn} onClick={() => { setCancelOpen(false); setActionError(''); }}>Назад</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Confirm / Dispute section ── */}
      {(canConfirm || canDispute) && (
        <div style={S.card}>
          <div style={S.sectionTitle}>Завершение работы</div>

          {/* Who confirmed */}
          {order.status === 'awaiting_confirmation' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginBottom: 14 }}>
              {[
                { label: 'Заказчик', done: order.confirmed_by_customer },
                { label: 'Исполнитель', done: order.confirmed_by_executor },
              ].map(({ label, done }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <CheckCircle size={15} style={{ color: done ? '#22c55e' : '#334155' }} />
                  <span style={{ color: done ? '#22c55e' : '#64748b', fontSize: '0.85rem' }}>{label} подтвердил</span>
                </div>
              ))}
            </div>
          )}

          {/* Deadline */}
          {order.status === 'awaiting_confirmation' && order.confirmation_deadline && (
            <div style={{ color: '#f59e0b', fontSize: '0.82rem', marginBottom: 14 }}>
              ⏱ Автоподтверждение через {formatTimeLeft(order.confirmation_deadline)}, если вторая сторона не ответит
            </div>
          )}

          {/* Confirm button */}
          {canConfirm && (
            <button style={S.confirmBtn} onClick={() => { setActionError(''); setConfirmModal(true); }}>
              <CheckCircle size={15} /> Подтвердить выполнение работы
            </button>
          )}

          {/* Dispute */}
          {canDispute && !disputeOpen && (
            <button style={S.disputeBtn} onClick={() => { setActionError(''); setDisputeOpen(true); }}>
              <AlertOctagon size={15} /> Открыть спор
            </button>
          )}

          {disputeOpen && (
            <div style={{ marginTop: 8 }}>
              <div style={{ color: '#94a3b8', fontSize: '0.82rem', marginBottom: 6 }}>Опишите причину спора:</div>
              <textarea style={S.textarea} value={disputeReason} onChange={e => setDisputeReason(e.target.value)} placeholder="Что именно пошло не так?" />
              {actionError && <div style={{ color: '#f87171', fontSize: '0.82rem', margin: '6px 0' }}>{actionError}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button style={{ ...S.submitBtn, background: '#ef4444' }} onClick={handleDispute} disabled={actionLoading || !disputeReason.trim()}>
                  {actionLoading ? 'Отправка...' : 'Подтвердить спор'}
                </button>
                <button style={S.cancelBtn} onClick={() => { setDisputeOpen(false); setDisputeReason(''); setActionError(''); }}>Отмена</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Completed ── */}
      {order.status === 'completed' && (
        <>
          <div style={{ ...S.card, borderColor: '#22c55e44', background: '#0a1f12' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#22c55e', fontWeight: 700, fontSize: '1.05rem' }}>
              <CheckCircle size={20} /> Заказ завершён
            </div>
            {order.completed_at && (
              <div style={{ color: '#64748b', fontSize: '0.82rem', marginTop: 6 }}>
                {new Date(order.completed_at).toLocaleString('ru-RU')}
              </div>
            )}
          </div>

          {/* Reviews section */}
          <div style={S.card}>
            <div style={S.sectionTitle}>Отзывы</div>

            {(isOwner || isExecutor) && !hasReviewed && (
              <form onSubmit={handleReviewSubmit} style={{ marginBottom: reviews?.length ? '1.5rem' : 0 }}>
                <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: 8 }}>
                  {isOwner ? 'Оцените исполнителя:' : 'Оцените заказчика:'}
                </div>
                <StarRating value={reviewRating} onChange={setReviewRating} size={26} gap={4} />
                <textarea
                  style={{ ...S.textarea, marginTop: 10 }}
                  value={reviewComment}
                  onChange={e => setReviewComment(e.target.value)}
                  placeholder="Комментарий (необязательно)"
                />
                {reviewError && <div style={{ color: '#f87171', fontSize: '0.82rem', marginTop: 6 }}>{reviewError}</div>}
                <button type="submit" style={{ ...S.submitBtn, marginTop: 10 }} disabled={reviewSubmitting || !reviewRating}>
                  {reviewSubmitting ? 'Отправка...' : 'Оставить отзыв'}
                </button>
              </form>
            )}

            {reviews === null && <div style={{ color: '#64748b', fontSize: '0.85rem' }}>Загрузка...</div>}
            {reviews !== null && reviews.length === 0 && hasReviewed && (
              <div style={{ color: '#64748b', fontSize: '0.85rem' }}>Вы уже оставили отзыв. Отзыв другой стороны пока не добавлен.</div>
            )}
            {reviews !== null && reviews.length === 0 && !hasReviewed && !(isOwner || isExecutor) && (
              <div style={{ color: '#64748b', fontSize: '0.85rem' }}>Отзывов пока нет.</div>
            )}

            {(reviews ?? []).map(r => (
              <div key={r.id} style={{ background: '#070d14', border: '1px solid #1e3a4a', borderRadius: 10, padding: '1rem', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  <StarRating value={r.rating} size={14} gap={1} />
                  <Link to={`/users/${r.reviewer_id}`} style={{ color: '#14a89a', fontSize: '0.82rem', fontWeight: 600, textDecoration: 'none' }}>
                    {r.reviewer?.nickname}
                  </Link>
                  <span style={{ color: '#64748b', fontSize: '0.74rem' }}>
                    {r.context === 'as_executor' ? '· о исполнителе' : '· о заказчике'}
                  </span>
                  <span style={{ color: '#64748b', fontSize: '0.72rem', marginLeft: 'auto' }}>
                    {new Date(r.created_at).toLocaleDateString('ru-RU')}
                  </span>
                </div>
                {r.comment && <div style={{ color: '#cbd5e1', fontSize: '0.88rem', lineHeight: 1.6 }}>{r.comment}</div>}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Disputed ── */}
      {order.status === 'disputed' && (
        <div style={{ ...S.card, borderColor: '#ef444444', background: '#1f0a0a' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#ef4444', fontWeight: 700, fontSize: '1.05rem' }}>
            <AlertOctagon size={20} /> Открыт спор
          </div>
          <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginTop: 6 }}>
            Ожидайте решения администратора. Средства зарезервированы до урегулирования ситуации.
          </div>
        </div>
      )}

      {/* ── Apply block (executor, open orders) ── */}
      {order.status === 'open' && !isOwner && !isAdmin && (
        <div style={S.card}>
          <div style={S.sectionTitle}>{order.already_applied ? 'Ваша заявка' : 'Откликнуться на заказ'}</div>
          {order.already_applied ? (
            <div style={{ color: '#22c55e', fontSize: '0.9rem' }}>
              ✓ Заявка подана · статус: {{'pending':'на рассмотрении','accepted':'принята','rejected':'отклонена'}[order.my_application_status] ?? order.my_application_status}
            </div>
          ) : (
            <form onSubmit={handleApply} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div>
                <div style={{ color: '#94a3b8', fontSize: '0.82rem', marginBottom: 5 }}>
                  Ваша цена (₽) <span style={{ color: '#ef4444' }}>*</span>
                  <span style={{ color: '#64748b', fontWeight: 400, marginLeft: 6 }}>— можно предложить выше или ниже бюджета заказчика</span>
                </div>
                <input style={{ ...S.input, maxWidth: 200 }} type="number" min="1" step="0.01" placeholder="500" value={applyPrice} onChange={e => setApplyPrice(e.target.value)} required />
              </div>
              <div>
                <div style={{ color: '#94a3b8', fontSize: '0.82rem', marginBottom: 5 }}>Сообщение заказчику <span style={{ color: '#ef4444' }}>*</span></div>
                <textarea style={S.textarea} placeholder="Расскажите почему подходите..." value={applyMsg} onChange={e => setApplyMsg(e.target.value)} required />
              </div>
              {applyError && (
                <div style={{ color: '#f87171', fontSize: '0.85rem' }}>
                  {applyError}
                  {applyError.includes('заблокирован') && (
                    <> · <Link to="/support" style={{ color: '#14a89a' }}>Поддержка</Link></>
                  )}
                </div>
              )}
              <div>
                <button type="submit" style={S.submitBtn} disabled={applyLoading}>
                  <Send size={14} />{applyLoading ? 'Отправка...' : 'Отправить заявку'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* ── Contact exchange banner ── */}
      {order.requires_contact_exchange && (
        <div style={{ background: '#1a120a', border: '1px solid #f59e0b44', borderRadius: 10, padding: '12px 16px', marginBottom: '1rem', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <AlertTriangle size={16} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ color: '#f59e0b', fontWeight: 600, fontSize: '0.88rem', marginBottom: 3 }}>Обмен контактными данными разрешён</div>
            {order.contact_exchange_reason && (
              <div style={{ color: '#94a3b8', fontSize: '0.83rem' }}>{order.contact_exchange_reason}</div>
            )}
          </div>
        </div>
      )}

      {/* ── Order info ── */}
      <div style={S.card}>
        <div style={S.sectionTitle}>Детали заказа</div>
        <div style={S.meta}>
          <div style={S.metaItem}>Тип заказа<div style={S.metaValue}>{{ order: 'Заказ', service: 'Услуга' }[order.order_type] ?? order.order_type}</div></div>
          <div style={S.metaItem}>Сумма исполнителю<div style={S.metaValue}>{order.final_amount ?? order.base_amount} ₽</div></div>
          {parseFloat(order.deposit_amount ?? 0) > 0 && (
            <div style={S.metaItem}>
              Залог<div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                <Shield size={13} style={{ color: '#f59e0b' }} />
                <span style={{ color: '#f59e0b', fontWeight: 500 }}>{order.deposit_amount} ₽</span>
              </div>
            </div>
          )}
          <div style={S.metaItem}>Зарезервировано<div style={S.amount}>{order.reserved_amount} ₽</div></div>
          {order.customer && <div style={S.metaItem}>Заказчик<div style={S.metaValue}><Link to={`/users/${order.customer_id}`} style={{ color: '#14a89a', textDecoration: 'none' }}>{order.customer.nickname}</Link></div></div>}
          {order.executor && <div style={S.metaItem}>Исполнитель<div style={S.metaValue}><Link to={`/users/${order.executor_id}`} style={{ color: '#14a89a', textDecoration: 'none' }}>{order.executor.nickname}</Link></div></div>}
        </div>
        <div style={S.sectionTitle}>Описание</div>
        <div style={S.desc}>{order.description}</div>
      </div>

      {/* ── Attachments ── */}
      {order.order_attachments?.length > 0 && (
        <div style={S.card}>
          <div style={S.sectionTitle}>Файлы ({order.order_attachments.length})</div>
          {order.order_attachments.map(att => (
            <div key={att.id} style={S.fileRow}>
              <FileText size={16} style={{ color: '#14a89a', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#e2e8f0', fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.file_name}</div>
                <div style={{ color: '#64748b', fontSize: '0.75rem' }}>
                  {(att.file_size / 1024).toFixed(0)} КБ · {att.visibility === 'public' ? 'Видно всем' : 'После выбора исполнителя'}
                </div>
              </div>
              <button style={S.dlBtn} onClick={() => handleDownload(att)} disabled={dlLoading === att.id}>
                <Download size={13} />{dlLoading === att.id ? '...' : 'Скачать'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Confirm modal ── */}
      {confirmModal && (
        <div style={S.overlay} onClick={() => !actionLoading && setConfirmModal(false)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <CheckCircle size={20} style={{ color: '#14a89a' }} />
              <div style={S.modalTitle}>Подтвердить выполнение?</div>
            </div>
            <div style={S.modalText}>
              Вы подтверждаете, что работа {isOwner ? 'принята и выполнена согласно договорённостям' : 'выполнена в полном объёме'}?
              {isExecutor && (
                <><br /><br />После подтверждения обеими сторонами на ваш баланс будет начислена сумма <strong style={{ color: '#14a89a' }}>{order.final_amount ?? order.base_amount} ₽</strong>.</>
              )}
            </div>
            {actionError && <div style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: 12 }}>{actionError}</div>}
            <div style={S.modalBtns}>
              <button style={{ ...S.cancelBtn, cursor: 'pointer' }} onClick={() => setConfirmModal(false)} disabled={actionLoading}>Отмена</button>
              <button style={S.okBtn} onClick={handleConfirm} disabled={actionLoading}>
                {actionLoading ? 'Обработка...' : 'Да, подтверждаю'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
