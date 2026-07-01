export function formatCurrency(amount) {
  if (amount == null) return '—';
  const n = parseFloat(amount);
  if (isNaN(n)) return '—';
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽';
}

export function formatDate(date) {
  if (!date) return '—';
  const d = new Date(date);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 0) return d.toLocaleDateString('ru-RU');
  if (diff < 60_000)       return 'только что';
  if (diff < 3_600_000)    return `${Math.floor(diff / 60_000)} мин назад`;
  if (diff < 86_400_000)   return `${Math.floor(diff / 3_600_000)} ч назад`;
  if (diff < 172_800_000)  return 'вчера';
  if (diff < 604_800_000)  return `${Math.floor(diff / 86_400_000)} дн назад`;
  return d.toLocaleDateString('ru-RU');
}
