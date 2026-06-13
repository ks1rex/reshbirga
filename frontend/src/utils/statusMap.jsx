const LABELS = {
  open:                   'Открыт для заявок',
  awaiting_topup:         'Ожидает доплаты',
  assigned:               'Исполнитель выбран',
  in_progress:            'В работе',
  awaiting_confirmation:  'Ожидает подтверждения',
  completed:              'Завершён',
  disputed:               'Спор',
  cancelled:              'Отменён (возврат)',
};

const COLORS = {
  open:                   '#14a89a',
  awaiting_topup:         '#f59e0b',
  assigned:               '#6366f1',
  in_progress:            '#3b82f6',
  awaiting_confirmation:  '#a855f7',
  completed:              '#22c55e',
  disputed:               '#ef4444',
  cancelled:              '#64748b',
};

export function getStatusLabel(status) {
  return LABELS[status] ?? status;
}

export function getStatusColor(status) {
  return COLORS[status] ?? '#64748b';
}

export function StatusBadge({ status }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '3px 10px',
      borderRadius: 20,
      fontSize: '0.78rem',
      fontWeight: 600,
      background: getStatusColor(status) + '22',
      color: getStatusColor(status),
      border: `1px solid ${getStatusColor(status)}44`,
    }}>
      {getStatusLabel(status)}
    </span>
  );
}
