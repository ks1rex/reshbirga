const spin = `
@keyframes _spin { to { transform: rotate(360deg); } }
`;

export default function Spinner({ size = 32, color = '#14a89a', text = 'Загрузка...' }) {
  return (
    <>
      <style>{spin}</style>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '3rem 1rem', color: '#64748b' }}>
        <div style={{
          width: size, height: size,
          border: `3px solid #1e3a4a`,
          borderTopColor: color,
          borderRadius: '50%',
          animation: '_spin 0.75s linear infinite',
        }} />
        {text && <span style={{ fontSize: '0.88rem' }}>{text}</span>}
      </div>
    </>
  );
}

export function InlineSpinner({ size = 16, color = '#14a89a' }) {
  return (
    <>
      <style>{spin}</style>
      <span style={{
        display: 'inline-block',
        width: size, height: size,
        border: `2px solid #1e3a4a`,
        borderTopColor: color,
        borderRadius: '50%',
        animation: '_spin 0.75s linear infinite',
        flexShrink: 0,
      }} />
    </>
  );
}
