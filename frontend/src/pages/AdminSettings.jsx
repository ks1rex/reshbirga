import { useEffect, useState } from 'react';
import { Save, CheckCircle } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { apiCall } from '../utils/api';

const S = {
  h1: { color: '#e2e8f0', fontSize: '1.4rem', fontWeight: 700, marginBottom: '0.25rem' },
  sub: { color: '#64748b', fontSize: '0.88rem', marginBottom: '2rem' },
  card: { background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 12, padding: '1.5rem' },
  fieldLabel: { color: '#e2e8f0', fontWeight: 600, marginBottom: 4 },
  fieldDesc: { color: '#64748b', fontSize: '0.82rem', lineHeight: 1.5, marginBottom: '1rem' },
  textarea: {
    width: '100%', background: '#1a2332', border: '1px solid #1e3a4a',
    borderRadius: 8, padding: '12px', color: '#e2e8f0', fontSize: '0.92rem',
    fontFamily: 'inherit', resize: 'vertical', marginBottom: '1rem',
  },
  saveBtn: (saved) => ({
    display: 'flex', alignItems: 'center', gap: 6,
    background: saved ? '#0e8a7d' : '#14a89a',
    color: '#fff', border: 'none', borderRadius: 8,
    padding: '9px 20px', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer',
  }),
  meta: { color: '#64748b', fontSize: '0.8rem' },
  error: { color: '#f87171', fontSize: '0.82rem' },
};

export default function AdminSettings() {
  const [value, setValue] = useState('');
  const [updatedBy, setUpdatedBy] = useState(null); // { nickname, at }
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const data = await apiCall('GET', '/settings/payment_requisites');
      setValue(data.value ?? '');

      if (data.updated_by && data.updated_at) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('nickname')
          .eq('id', data.updated_by)
          .single();
        setUpdatedBy({ nickname: profile?.nickname ?? 'Неизвестно', at: data.updated_at });
      } else {
        setUpdatedBy(null);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setError('');
    setSaving(true);
    setSaved(false);
    try {
      await apiCall('PUT', '/admin/settings/payment_requisites', { value });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 700 }}>
      <div style={S.h1}>Настройки сайта</div>
      <div style={S.sub}>Данные, отображаемые пользователям</div>

      <div style={S.card}>
        <div style={S.fieldLabel}>Реквизиты для оплаты</div>
        <div style={S.fieldDesc}>
          Карта, СБП, номер телефона — любой текст с переносами строк.
          Показывается заказчику на странице заказа со статусом «Ожидает оплаты».
        </div>

        {loading ? (
          <div style={{ color: '#64748b' }}>Загрузка...</div>
        ) : (
          <>
            <textarea
              style={S.textarea}
              rows={6}
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder={'Например:\nСбербанк: 4276 1234 5678 9012\nСБП: +7 (999) 123-45-67\nПолучатель: Иван И.'}
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <button style={S.saveBtn(saved)} onClick={handleSave} disabled={saving}>
                {saved ? <CheckCircle size={16} /> : <Save size={16} />}
                {saving ? 'Сохранение...' : saved ? 'Сохранено!' : 'Сохранить'}
              </button>

              {updatedBy && (
                <div style={S.meta}>
                  Последнее изменение:{' '}
                  <strong style={{ color: '#94a3b8' }}>{updatedBy.nickname}</strong>
                  {' · '}
                  {new Date(updatedBy.at).toLocaleString('ru-RU', {
                    day: '2-digit', month: '2-digit', year: '2-digit',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </div>
              )}

              {error && <div style={S.error}>{error}</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
