import { useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Upload, X, Eye, Lock, AlertCircle, AlertTriangle } from 'lucide-react';
import { apiCall } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency } from '../utils/format';

const S = {
  page: { maxWidth: 720, margin: '0 auto' },
  h1: { color: '#e2e8f0', fontSize: '1.4rem', fontWeight: 700, marginBottom: '1.5rem' },
  section: { marginBottom: '1.5rem' },
  label: { display: 'block', color: '#94a3b8', fontSize: '0.82rem', marginBottom: 6 },
  hint: { color: '#64748b', fontSize: '0.76rem', marginTop: 4 },
  input: { width: '100%', background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 8, padding: '10px 12px', color: '#e2e8f0', fontSize: '0.95rem', boxSizing: 'border-box' },
  textarea: { width: '100%', background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 8, padding: '10px 12px', color: '#e2e8f0', fontSize: '0.95rem', minHeight: 110, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' },
  balanceBox: (warn) => ({
    background: warn ? '#1f0808' : '#0d2620',
    border: `1px solid ${warn ? '#ef4444' : '#0e8a7d'}`,
    borderRadius: 8,
    padding: '14px 16px',
    marginBottom: '1.5rem',
  }),
  balanceLabel: { color: '#64748b', fontSize: '0.78rem', marginBottom: 6 },
  balanceAmt: (warn) => ({ color: warn ? '#f87171' : '#14a89a', fontSize: '1.3rem', fontWeight: 700 }),
  dropzone: (over) => ({
    border: `2px dashed ${over ? '#14a89a' : '#1e3a4a'}`,
    borderRadius: 10,
    padding: '2rem',
    textAlign: 'center',
    cursor: 'pointer',
    background: over ? '#0d2620' : 'transparent',
    transition: 'all 0.15s',
    marginBottom: '1rem',
  }),
  fileRow: { background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 8, padding: '10px 12px', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 12 },
  visBtn: (pub) => ({
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '4px 10px', borderRadius: 6, border: `1px solid ${pub ? '#0e8a7d' : '#334155'}`,
    background: 'transparent', color: pub ? '#14a89a' : '#64748b',
    fontSize: '0.78rem', cursor: 'pointer',
  }),
  removeBtn: { background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center' },
  btn: { background: '#14a89a', color: '#fff', border: 'none', borderRadius: 8, padding: '11px 28px', fontSize: '1rem', fontWeight: 600, cursor: 'pointer' },
  error: { color: '#f87171', background: '#2d1515', borderRadius: 6, padding: '10px 14px', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.88rem' },
};

export default function NewOrder() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const fileInputRef = useRef(null);

  const [title, setTitle]           = useState('');
  const [description, setDescription] = useState('');
  const [subject, setSubject]       = useState('');
  const [baseAmount, setBaseAmount] = useState('');
  const [requiresCE, setRequiresCE] = useState(false);
  const [ceReason, setCeReason]     = useState('');
  const [files, setFiles]           = useState([]);
  const [dragOver, setDragOver]     = useState(false);
  const [error, setError]           = useState('');
  const [loading, setLoading]       = useState(false);

  const amount = parseFloat(baseAmount) || 0;
  const balance = parseFloat(profile?.balance ?? 0);
  const insufficient = amount > 0 && balance < amount;

  function addFiles(fileList) {
    const next = Array.from(fileList).map(f => ({
      id: Math.random().toString(36).slice(2),
      file: f,
      visibility: 'public',
    }));
    setFiles(prev => [...prev, ...next]);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }

  function toggleVisibility(id) {
    setFiles(prev => prev.map(f =>
      f.id === id ? { ...f, visibility: f.visibility === 'public' ? 'after_assignment' : 'public' } : f
    ));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!title.trim()) return setError('Введите заголовок');
    if (!description.trim()) return setError('Введите описание');
    if (!subject.trim()) return setError('Введите предмет');
    if (amount <= 0) return setError('Введите корректную сумму');
    if (requiresCE && !ceReason.trim()) return setError('Укажите, для чего нужен обмен контактами');

    setLoading(true);
    try {
      const order = await apiCall('POST', '/orders', {
        title: title.trim(),
        description: description.trim(),
        subject: subject.trim(),
        order_type: 'order',
        base_amount: amount,
        requires_contact_exchange: requiresCE,
        contact_exchange_reason: requiresCE ? ceReason.trim() : undefined,
      });

      for (const { file, visibility } of files) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('visibility', visibility);
        await apiCall('POST', `/orders/${order.id}/attachments`, fd);
      }

      navigate(`/orders/${order.id}`);
    } catch (err) {
      if (err.data?.error === 'insufficient_balance') {
        setError(`Недостаточно средств. Нужно ${formatCurrency(err.data.required)}, на балансе ${formatCurrency(err.data.balance)}.`);
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={S.page}>
      <div style={S.h1}>Новый заказ</div>

      <form onSubmit={handleSubmit}>
        {error && (
          <div style={S.error}>
            <AlertCircle size={16} />
            <span>
              {error}
              {error.includes('заблокирован') && (
                <> · <Link to="/support" style={{ color: '#14a89a' }}>Написать в поддержку</Link></>
              )}
              {error.includes('средств') && (
                <> · <Link to="/wallet" style={{ color: '#14a89a' }}>Пополнить кошелёк</Link></>
              )}
            </span>
          </div>
        )}

        <div style={S.section}>
          <label style={S.label}>Заголовок заказа</label>
          <input style={S.input} value={title} onChange={e => setTitle(e.target.value)}
            placeholder="Например: Помогите с курсовой по маркетингу" maxLength={120} />
        </div>

        <div style={S.section}>
          <label style={S.label}>Описание / требования</label>
          <textarea style={S.textarea} value={description} onChange={e => setDescription(e.target.value)}
            placeholder="Подробно опишите задание, требования, формат сдачи. Здесь можно указать удобное время, детали и любые дополнительные условия." />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
          <div>
            <label style={S.label}>Предмет / дисциплина</label>
            <input style={S.input} value={subject} onChange={e => setSubject(e.target.value)}
              placeholder="Маркетинг, Математика, Физика..." />
          </div>
          <div>
            <label style={S.label}>Ваш бюджет, ₽</label>
            <input style={S.input} type="number" min="1" step="1" value={baseAmount}
              onChange={e => setBaseAmount(e.target.value)} placeholder="500" />
            <div style={S.hint}>Исполнитель может предложить другую цену</div>
          </div>
        </div>

        {amount > 0 && (
          <div style={S.balanceBox(insufficient)}>
            <div style={S.balanceLabel}>Сумма заказа — списывается с вашего баланса</div>
            <div style={S.balanceAmt(insufficient)}>{formatCurrency(amount)}</div>
            <div style={{ marginTop: 8, fontSize: '0.82rem', color: insufficient ? '#f87171' : '#64748b' }}>
              Ваш баланс: {formatCurrency(balance)}
              {insufficient && (
                <>
                  {' '}— недостаточно средств.{' '}
                  <Link to="/wallet" style={{ color: '#14a89a' }}>Пополнить кошелёк</Link>
                </>
              )}
            </div>
          </div>
        )}

        {/* Contact exchange */}
        <div style={S.section}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <input id="requiresCE" type="checkbox" checked={requiresCE} onChange={e => setRequiresCE(e.target.checked)}
              style={{ width: 18, height: 18, marginTop: 2, accentColor: '#14a89a', flexShrink: 0 }} />
            <div>
              <label htmlFor="requiresCE" style={{ color: '#e2e8f0', fontSize: '0.9rem', cursor: 'pointer' }}>
                Нужен обмен контактными данными
              </label>
              <div style={{ color: '#64748b', fontSize: '0.76rem', marginTop: 3 }}>
                При включении в чат появится системное сообщение с предупреждением
              </div>
            </div>
          </div>
          {requiresCE && (
            <div style={{ marginTop: 10, paddingLeft: 28 }}>
              <label style={S.label}>Для чего нужен обмен контактами <span style={{ color: '#ef4444' }}>*</span></label>
              <textarea
                style={{ ...S.textarea, minHeight: 70 }}
                value={ceReason}
                onChange={e => setCeReason(e.target.value)}
                placeholder="Например: выезд на дом, очный экзамен, передача материалов..."
                required={requiresCE}
              />
              <div style={{ color: '#f59e0b', fontSize: '0.76rem', marginTop: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                <AlertTriangle size={12} />Обмен контактами будет разрешён без предупреждения в этом чате
              </div>
            </div>
          )}
        </div>

        {/* File upload */}
        <div style={S.section}>
          <label style={S.label}>Файлы (необязательно)</label>
          <div
            style={S.dropzone(dragOver)}
            onDrop={handleDrop}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={24} style={{ color: '#14a89a', marginBottom: 8 }} />
            <div style={{ color: '#94a3b8', marginBottom: 4 }}>Перетащите файлы сюда или нажмите</div>
            <div style={{ color: '#64748b', fontSize: '0.78rem' }}>Максимум 10 МБ на файл</div>
            <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }}
              onChange={e => addFiles(e.target.files)} />
          </div>

          {files.map(({ id, file, visibility }) => (
            <div key={id} style={S.fileRow}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#e2e8f0', fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
                <div style={{ color: '#64748b', fontSize: '0.75rem' }}>{(file.size / 1024).toFixed(0)} КБ</div>
              </div>
              <button type="button" style={S.visBtn(visibility === 'public')}
                onClick={() => toggleVisibility(id)}
                title={visibility === 'public' ? 'Видно всем в ленте — нажмите чтобы скрыть до выбора исполнителя' : 'Видно исполнителю только после того как вы его выберете'}>
                {visibility === 'public' ? <Eye size={13} /> : <Lock size={13} />}
                {visibility === 'public' ? 'Видно всем' : 'После выбора'}
              </button>
              <button type="button" style={S.removeBtn} onClick={() => setFiles(prev => prev.filter(f => f.id !== id))}>
                <X size={16} />
              </button>
            </div>
          ))}
        </div>

        <button
          style={{ ...S.btn, opacity: (insufficient || loading) ? 0.5 : 1, cursor: (insufficient || loading) ? 'not-allowed' : 'pointer' }}
          type="submit"
          disabled={loading || insufficient}
        >
          {loading ? 'Создание заказа...' : 'Разместить заказ'}
        </button>
      </form>
    </div>
  );
}
