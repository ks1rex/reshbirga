import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiCall } from '../utils/api';
import ServiceForm from './ServiceForm';
import Spinner from '../components/Spinner';

export default function ServiceEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [listing, setListing] = useState(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiCall('GET', `/listings/${id}`)
      .then(setListing)
      .catch(() => setListing(null))
      .finally(() => setPageLoading(false));
  }, [id]);

  async function handleSubmit(data) {
    setError('');
    setSaving(true);
    try {
      await apiCall('PATCH', `/listings/${id}`, data);
      navigate(`/services/${id}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (pageLoading) return <Spinner />;
  if (!listing) return <div style={{ color: '#f87171', padding: '2rem' }}>Услуга не найдена</div>;

  return <ServiceForm title="Редактировать услугу" initial={listing} onSubmit={handleSubmit} loading={saving} error={error} cancelTo={`/services/${id}`} />;
}
