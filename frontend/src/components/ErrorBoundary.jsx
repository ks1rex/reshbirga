import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(err) {
    return { hasError: true, message: err?.message ?? 'Неизвестная ошибка' };
  }

  componentDidCatch(err, info) {
    console.error('[ErrorBoundary]', err, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div style={{ minHeight: '100vh', background: '#1a2332', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <div style={{ textAlign: 'center', maxWidth: 480 }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
          <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: '1.25rem', marginBottom: '0.75rem' }}>
            Произошла непредвиденная ошибка
          </div>
          <div style={{ color: '#64748b', fontSize: '0.88rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
            {this.state.message}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{ background: '#14a89a', border: 'none', borderRadius: 8, padding: '10px 24px', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: '0.95rem' }}
          >
            Обновить страницу
          </button>
        </div>
      </div>
    );
  }
}
