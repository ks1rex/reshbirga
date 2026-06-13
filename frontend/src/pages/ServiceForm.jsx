import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { formatCurrency } from '../utils/format';

const S = {
  page: { maxWidth: 680, margin: '0 auto' },
  h1: { color: '#e2e8f0', fontSize: '1.3rem', fontWeight: 700, marginBottom: '1.5rem' },
  section: { marginBottom: '1.25rem' },
  label: { display: 'block', color: '#94a3b8', fontSize: '0.82rem', marginBottom: 6 },
  hint: { color: '#64748b', fontSize: '0.75rem', marginTop: 4 },
  input: { width: '100%', background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 8, padding: '10px 12px', color: '#e2e8f0', fontSize: '0.93rem', boxSizing: 'border-box' },
  textarea: { width: '100%', background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 8, padding: '10px 12px', color: '#e2e8f0', fontSize: '0.93rem', minHeight: 120, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' },
  checkRow: { display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  checkbox: { width: 18, height: 18, marginTop: 2, accentColor: '#14a89a', flexShrink: 0 },
  checkLabel: { color: '#e2e8f0', fontSize: '0.9rem', cursor: 'pointer' },
  checkDesc: { color: '#64748b', fontSize: '0.76rem', marginTop: 3 },
  subfield: { marginTop: 8, paddingLeft: 28 },
  btn: { background: '#14a89a', color: '#fff', border: 'none', borderRadius: 8, padding: '11px 28px', fontSize: '1rem', fontWeight: 600, cursor: 'pointer' },
  cancelLink: { color: '#64748b', fontSize: '0.85rem', marginLeft: 16, textDecoration: 'none' },
  err: { color: '#f87171', background: '#2d1515', borderRadius: 6, padding: '10px 14px', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.88rem' },
};

export default function ServiceForm({ initial = {}, onSubmit, loading, error, title, cancelTo = '/services/mine' }) {
  const [formTitle, setFormTitle]         = useState(initial.title ?? '');
  const [description, setDescription]     = useState(initial.description ?? '');
  const [price, setPrice]                 = useState(initial.price ?? '');
  const [hasDeposit, setHasDeposit]       = useState(parseFloat(initial.deposit_amount ?? 0) > 0);
  const [depositAmt, setDepositAmt]       = useState(initial.deposit_amount ?? '');
  const [requiresCE, setRequiresCE]       = useState(!!initial.requires_contact_exchange);
  const [ceReason, setCeReason]           = useState(initial.contact_exchange_reason ?? '');

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit({
      title: formTitle,
      description,
      price: parseFloat(price),
      deposit_amount: hasDeposit ? parseFloat(depositAmt || 0) : 0,
      requires_contact_exchange: requiresCE,
      contact_exchange_reason: requiresCE ? ceReason : '',
    });
  }

  const amt = parseFloat(price) || 0;
  const dep = hasDeposit ? (parseFloat(depositAmt) || 0) : 0;

  return (
    <div style={S.page}>
      <div style={S.h1}>{title}</div>

      <form onSubmit={handleSubmit}>
        {error && (
          <div style={S.err}><AlertCircle size={16} />{error}</div>
        )}

        <div style={S.section}>
          <label style={S.label}>Заголовок услуги</label>
          <input style={S.input} value={formTitle} onChange={e => setFormTitle(e.target.value)}
            placeholder="Например: Репетиторство по математике (ЕГЭ)" maxLength={200} required />
        </div>

        <div style={S.section}>
          <label style={S.label}>Описание</label>
          <textarea style={S.textarea} value={description} onChange={e => setDescription(e.target.value)}
            placeholder="Опишите услугу, условия работы, что включено. Укажите детали, удобное время, любые дополнительные условия." required />
        </div>

        <div style={S.row}>
          <div>
            <label style={S.label}>Цена, ₽</label>
            <input style={S.input} type="number" min="1" step="1" value={price}
              onChange={e => setPrice(e.target.value)} placeholder="1500" required />
          </div>
          <div>
            <label style={S.label}>Стоимость{dep > 0 ? ` + залог = ${formatCurrency(amt + dep)}` : ''}</label>
            <div style={{ color: '#64748b', fontSize: '0.82rem', paddingTop: 10 }}>
              {amt > 0 ? `${formatCurrency(amt)}` : '—'}
            </div>
          </div>
        </div>

        {/* Deposit */}
        <div style={S.section}>
          <div style={S.checkRow}>
            <input id="hasDeposit" type="checkbox" style={S.checkbox} checked={hasDeposit}
              onChange={e => setHasDeposit(e.target.checked)} />
            <div>
              <label htmlFor="hasDeposit" style={S.checkLabel}>Требуется залог</label>
              <div style={S.checkDesc}>Залог возвращается заказчику после успешного завершения, или переходит исполнителю при споре в его пользу</div>
            </div>
          </div>
          {hasDeposit && (
            <div style={S.subfield}>
              <label style={S.label}>Сумма залога, ₽</label>
              <input style={{ ...S.input, maxWidth: 200 }} type="number" min="1" step="1"
                value={depositAmt} onChange={e => setDepositAmt(e.target.value)}
                placeholder="500" required={hasDeposit} />
            </div>
          )}
        </div>

        {/* Contact exchange */}
        <div style={S.section}>
          <div style={S.checkRow}>
            <input id="requiresCE" type="checkbox" style={S.checkbox} checked={requiresCE}
              onChange={e => setRequiresCE(e.target.checked)} />
            <div>
              <label htmlFor="requiresCE" style={S.checkLabel}>Нужен обмен контактными данными</label>
              <div style={S.checkDesc}>При включении в чат автоматически появится системное предупреждение</div>
            </div>
          </div>
          {requiresCE && (
            <div style={S.subfield}>
              <label style={S.label}>Для чего нужен обмен контактами <span style={{ color: '#ef4444' }}>*</span></label>
              <textarea
                style={{ ...S.textarea, minHeight: 70 }}
                value={ceReason}
                onChange={e => setCeReason(e.target.value)}
                placeholder="Например: выезд на дом для проведения занятий, примерка одежды, передача материалов..."
                required={requiresCE}
              />
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center' }}>
          <button style={S.btn} type="submit" disabled={loading}>
            {loading ? 'Сохранение...' : 'Сохранить'}
          </button>
          <Link to={cancelTo} style={S.cancelLink}>Отмена</Link>
        </div>
      </form>
    </div>
  );
}
