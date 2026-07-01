import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { User, Star } from 'lucide-react';
import { apiCall } from '../utils/api';
import StarRating from '../components/StarRating';
import Spinner from '../components/Spinner';

const S = {
  wrap: { maxWidth: 720, margin: '0 auto' },
  avatarWrap: { width: 80, height: 80, borderRadius: '50%', background: '#1e3a4a', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 },
  avatar: { width: '100%', height: '100%', objectFit: 'cover' },
  nickname: { color: '#e2e8f0', fontSize: '1.5rem', fontWeight: 700 },
  since: { color: '#64748b', fontSize: '0.85rem', marginTop: 4 },
  ratingBlock: { background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 12, padding: '1.25rem', marginBottom: '1rem' },
  ratingTitle: { color: '#94a3b8', fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' },
  ratingRow: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: '0.75rem' },
  ratingNum: { color: '#f59e0b', fontWeight: 700, fontSize: '1.3rem' },
  ratingCount: { color: '#64748b', fontSize: '0.85rem' },
  reviewCard: { background: '#070d14', border: '1px solid #1e3a4a', borderRadius: 10, padding: '1rem', marginBottom: 8 },
  reviewMeta: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 },
  reviewNick: { color: '#14a89a', fontSize: '0.85rem', fontWeight: 600 },
  reviewSubject: { color: '#64748b', fontSize: '0.75rem' },
  reviewComment: { color: '#cbd5e1', fontSize: '0.88rem', lineHeight: 1.6, marginTop: 6 },
  reviewDate: { color: '#64748b', fontSize: '0.72rem', marginTop: 4 },
  moreBtn: { background: 'none', border: '1px solid #1e3a4a', borderRadius: 8, padding: '7px 18px', color: '#64748b', cursor: 'pointer', fontSize: '0.85rem', marginTop: 8 },
  empty: { color: '#64748b', fontSize: '0.85rem', padding: '1rem 0' },
};

function ReviewsList({ userId, context, label }) {
  const [reviews, setReviews] = useState([]);
  const [offset, setOffset]   = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const LIMIT = 10;

  async function load(off) {
    setLoading(true);
    try {
      const data = await apiCall('GET', `/users/${userId}/reviews?context=${context}&limit=${LIMIT}&offset=${off}`);
      const list = Array.isArray(data) ? data : [];
      setReviews(prev => off === 0 ? list : [...prev, ...list]);
      setHasMore(list.length === LIMIT);
      setOffset(off + list.length);
    } catch {}
    finally { setLoading(false); }
  }

  useEffect(() => { setReviews([]); setOffset(0); setHasMore(true); load(0); }, [userId, context]);

  return (
    <div style={S.ratingBlock}>
      <div style={S.ratingTitle}>{label}</div>
      {reviews.length === 0 && !loading && <div style={S.empty}>Пока нет отзывов</div>}
      {reviews.map(r => (
        <div key={r.id} style={S.reviewCard}>
          <div style={S.reviewMeta}>
            <StarRating value={r.rating} size={14} gap={1} />
            <span style={S.reviewNick}>{r.reviewer?.nickname}</span>
            <span style={S.reviewSubject}>{r.orders?.subject}</span>
          </div>
          {r.comment && <div style={S.reviewComment}>{r.comment}</div>}
          <div style={S.reviewDate}>{new Date(r.created_at).toLocaleDateString('ru-RU')}</div>
        </div>
      ))}
      {hasMore && reviews.length > 0 && (
        <button style={S.moreBtn} onClick={() => load(offset)} disabled={loading}>
          {loading ? 'Загрузка...' : 'Показать ещё'}
        </button>
      )}
    </div>
  );
}

export default function UserProfile() {
  const { id } = useParams();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiCall('GET', `/users/${id}`)
      .then(setProfile)
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Spinner />;
  if (!profile) return <div style={{ color: '#f87171' }}>Пользователь не найден</div>;

  return (
    <div style={S.wrap}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', marginBottom: '1.75rem' }}>
        <div style={S.avatarWrap}>
          {profile.avatar_url
            ? <img src={profile.avatar_url} alt={profile.nickname} style={S.avatar} />
            : <User size={36} style={{ color: '#334155' }} />
          }
        </div>
        <div>
          <div style={S.nickname}>{profile.nickname}</div>
          <div style={S.since}>
            На бирже с {new Date(profile.created_at).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}
          </div>
        </div>
      </div>

      {/* Rating summary */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: '1.5rem' }}>
        {[
          { label: 'Как исполнитель', rating: profile.rating_as_executor, count: profile.reviews_count_executor },
          { label: 'Как заказчик',    rating: profile.rating_as_customer,  count: profile.reviews_count_customer },
        ].map(({ label, rating, count }) => (
          <div key={label} style={{ background: '#0f1923', border: '1px solid #1e3a4a', borderRadius: 10, padding: '1rem' }}>
            <div style={{ color: '#64748b', fontSize: '0.78rem', marginBottom: 8 }}>{label}</div>
            <div style={S.ratingRow}>
              <Star size={16} fill="#f59e0b" style={{ color: '#f59e0b' }} />
              <span style={S.ratingNum}>{count > 0 ? parseFloat(rating ?? 0).toFixed(1) : '—'}</span>
              <span style={S.ratingCount}>({count} отзывов)</span>
            </div>
          </div>
        ))}
      </div>

      {/* Reviews lists */}
      <ReviewsList userId={id} context="as_executor" label="Отзывы как исполнитель" />
      <ReviewsList userId={id} context="as_customer"  label="Отзывы как заказчик" />
    </div>
  );
}
