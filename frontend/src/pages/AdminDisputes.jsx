import { useEffect, useState } from 'react';
import { AlertOctagon, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiCall } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import ChatWindow from '../components/ChatWindow';

const TYPE_LABEL = { order: 'Заказ', service: 'Услуга' };

const RESOLUTIONS = [
  {
    value: 'pay_executor',
    label: 'Выплатить исполнителю',
    desc: 'Заказ завершён. Исполнитель получает сумму заказа целиком.',
    color: '#22c55e',
  },
  {
    value: 'refund_customer',
    label: 'Вернуть заказчику',
    desc: 'Заказ отменён. Заказчику возвращается вся зарезервированная сумма.',
    color: '#3b82f6',
  },
];

const S = {
  h1: { color: '#e2e8f0', fontSize: '1.4rem', fontWeight: 700, marginBottom: '0.25rem' },
  sub: { color: '#64748b', fontSize: '0.88rem', marginBottom: '1.5rem' },
  disputeCard: { background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 12, padding: '1.25rem', marginBottom: 12, cursor: 'pointer' },
  disputeCardActive: { background: '#0f1923', border: '1px solid #14a89a', borderRadius: 12, padding: '1.25rem', marginBottom: 12 },
  orderTitle: { color: '#e2e8f0', fontWeight: 700, fontSize: '1rem', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 10 },
  metaRow: { display: 'flex', flexWrap: 'wrap', gap: 20, marginBottom: 8 },
  metaItem: { color: '#64748b', fontSize: '0.82rem' },
  metaVal: { color: '#94a3b8', fontWeight: 500 },
  reason: { color: '#f87171', fontSize: '0.88rem', background: '#1f0a0a', border: '1px solid #ef444422', borderRadius: 8, padding: '8px 12px', marginTop: 8 },
  sectionTitle: { color: '#64748b', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '1.25rem 0 0.75rem' },
  chatWrap: { height: 360, display: 'flex', flexDirection: 'column', border: '1px solid #1e3a4a', borderRadius: 10, overflow: 'hidden', padding: '10px 12px', background: '#070d14' },
  radio: (active, color) => ({
    border: `1px solid ${active ? color : '#334155'}`,
    background: active ? color + '11' : 'transparent',
    borderRadius: 10,
    padding: '10px 14px',
    cursor: 'pointer',
    marginBottom: 8,
    transition: 'border-color 0.15s',
  }),
  radioLabel: (active, color) => ({ color: active ? color : '#94a3b8', fontWeight: 600, fontSize: '0.9rem' }),
  radioDesc:  { color: '#64748b', fontSize: '0.8rem', marginTop: 3 },
  commentArea: { width: '100%', background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 8, padding: '10px 12px', color: '#e2e8f0', fontSize: '0.9rem', resize: 'vertical', minHeight: 80, boxSizing: 'border-box', marginTop: 10 },
  applyBtn: (disabled) => ({ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, background: disabled ? '#1e3a4a' : '#14a89a', border: 'none', borderRadius: 8, padding: '10px 20px', color: disabled ? '#64748b' : '#fff', fontWeight: 600, cursor: disabled ? 'default' : 'pointer', fontSize: '0.9rem' }),
  empty: { color: '#64748b', textAlign: 'center', padding: '4rem 2rem' },
};

function fmt(n) { return n != null ? `${parseFloat(n).toFixed(2)} ₽` : '—'; }

export default function AdminDisputes() {
  const { profile } = useAuth();
  const [disputes, setDisputes] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState(null); // dispute object
  const [resolution, setResolution] = useState('');
  const [comment, setComment]   = useState('');
  const [banCustomer, setBanCustomer] = useState(false);
  const [banExecutor, setBanExecutor] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyErr, setApplyErr] = useState('');
  const [showChat, setShowChat] = useState(false);

  async function load() {
    setLoading(true);
    try { setDisputes(await apiCall('GET', '/admin/disputes?status=open') ?? []); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (profile?.is_admin) load(); }, [profile]);

  function selectDispute(d) {
    setSelected(d);
    setResolution('');
    setComment('');
    setBanCustomer(false);
    setBanExecutor(false);
    setApplyErr('');
    setShowChat(false);
  }

  async function handleApply() {
    if (!resolution) { setApplyErr('Выберите решение'); return; }
    setApplying(true);
    setApplyErr('');
    try {
      await apiCall('POST', `/admin/disputes/${selected.id}/resolve`, { resolution, admin_comment: comment, ban_customer: banCustomer, ban_executor: banExecutor });
      setSelected(null);
      load();
    } catch (e) { setApplyErr(e.message); }
    finally { setApplying(false); }
  }

  if (!profile?.is_admin) return null;

  return (
    <div style={{ display: 'flex', gap: '1.5rem', maxWidth: 1100 }}>
      {/* Left: list */}
      <div style={{ width: 380, flexShrink: 0 }}>
        <div style={S.h1}>Споры</div>
        <div style={S.sub}>Открытые споры по заказам</div>

        {loading ? <div style={{ color: '#64748b' }}>Загрузка...</div>
        : disputes.length === 0 ? <div style={S.empty}><AlertOctagon size={36} style={{ color: '#334155', marginBottom: 10 }} /><div>Открытых споров нет</div></div>
        : disputes.map(d => {
          const order = d.orders;
          const isActive = selected?.id === d.id;
          return (
            <div key={d.id} style={isActive ? S.disputeCardActive : S.disputeCard} onClick={() => selectDispute(d)}>
              <div style={S.orderTitle}>
                <AlertOctagon size={16} style={{ color: '#ef4444' }} />
                {order?.title}
                <span style={{ color: '#64748b', fontSize: '0.78rem', marginLeft: 'auto' }}>
                  {new Date(d.created_at).toLocaleDateString('ru-RU')}
                </span>
              </div>
              <div style={S.metaRow}>
                <div style={S.metaItem}>Тип: <span style={S.metaVal}>{TYPE_LABEL[order?.order_type]}</span></div>
                <div style={S.metaItem}>Сумма: <span style={S.metaVal}>{fmt(order?.final_amount ?? order?.base_amount)}</span></div>
                <div style={S.metaItem}>Зарез.: <span style={S.metaVal}>{fmt(order?.reserved_amount)}</span></div>
              </div>
              <div style={S.metaRow}>
                <div style={S.metaItem}>Заказчик: <span style={S.metaVal}>{order?.customer?.nickname}</span></div>
                <div style={S.metaItem}>Исполнитель: <span style={S.metaVal}>{order?.executor?.nickname ?? '—'}</span></div>
              </div>
              <div style={{ color: '#64748b', fontSize: '0.78rem' }}>
                Открыл: {d.opened_by_profile?.nickname}
              </div>
              {d.reason && <div style={S.reason}>{d.reason}</div>}
            </div>
          );
        })}
      </div>

      {/* Right: detail */}
      {selected && (
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>
            Спор: «{selected.orders?.title}»
          </div>

          {/* Chat link */}
          <div style={{ marginBottom: 8 }}>
            <button
              onClick={() => setShowChat(v => !v)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#1e3a4a', border: 'none', borderRadius: 8, padding: '7px 14px', color: '#94a3b8', cursor: 'pointer', fontSize: '0.85rem' }}
            >
              <ExternalLink size={14} /> {showChat ? 'Скрыть переписку' : 'Посмотреть переписку по заказу'}
            </button>
          </div>

          {showChat && selected.orders?.id && (
            <OrderChatForAdmin orderId={selected.orders.id} />
          )}

          <div style={S.sectionTitle}>Решение спора</div>
          {RESOLUTIONS.map(r => (
            <div key={r.value} style={S.radio(resolution === r.value, r.color)} onClick={() => setResolution(r.value)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 16, height: 16, borderRadius: '50%',
                  border: `2px solid ${resolution === r.value ? r.color : '#334155'}`,
                  background: resolution === r.value ? r.color : 'transparent',
                  flexShrink: 0,
                }} />
                <div style={S.radioLabel(resolution === r.value, r.color)}>{r.label}</div>
              </div>
              <div style={S.radioDesc}>{r.desc}</div>
            </div>
          ))}

          <div style={{ color: '#94a3b8', fontSize: '0.82rem', marginTop: 12, marginBottom: 5 }}>Комментарий (необязательно):</div>
          <textarea
            style={S.commentArea}
            placeholder="Опишите решение для сторон спора..."
            value={comment}
            onChange={e => setComment(e.target.value)}
          />

          {/* Ban flags */}
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ color: '#94a3b8', fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>Дополнительно</div>
            {[
              { id: 'ban_customer', label: 'Заблокировать заказчика', val: banCustomer, set: setBanCustomer },
              { id: 'ban_executor', label: 'Заблокировать исполнителя', val: banExecutor, set: setBanExecutor },
            ].map(({ id, label, val, set }) => (
              <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: val ? '#ef4444' : '#64748b', fontSize: '0.85rem', fontWeight: val ? 600 : 400 }}>
                <input type="checkbox" checked={val} onChange={e => set(e.target.checked)}
                  style={{ width: 15, height: 15, accentColor: '#ef4444', flexShrink: 0 }} />
                {label}
              </label>
            ))}
          </div>

          {applyErr && <div style={{ color: '#f87171', fontSize: '0.82rem', marginTop: 8 }}>{applyErr}</div>}
          <button style={S.applyBtn(applying || !resolution)} onClick={handleApply} disabled={applying || !resolution}>
            {applying ? 'Применение...' : 'Применить решение'}
          </button>
        </div>
      )}
    </div>
  );
}

// Loads order conversation and renders read-only ChatWindow
function OrderChatForAdmin({ orderId }) {
  const [convId, setConvId] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    apiCall('GET', `/orders/${orderId}/conversation`)
      .then(d => setConvId(d.conversation_id))
      .catch(e => setErr(e.message));
  }, [orderId]);

  if (err) return <div style={{ color: '#f87171', fontSize: '0.82rem', marginBottom: 12 }}>{err}</div>;
  if (!convId) return <div style={{ color: '#64748b', fontSize: '0.82rem', marginBottom: 12 }}>Загрузка чата...</div>;

  return (
    <div style={{ height: 340, display: 'flex', flexDirection: 'column', border: '1px solid #1e3a4a', borderRadius: 10, overflow: 'hidden', padding: '10px 12px', background: '#070d14', marginBottom: 16 }}>
      <ChatWindow conversationId={convId} readOnly={true} />
    </div>
  );
}
