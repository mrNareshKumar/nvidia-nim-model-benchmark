export default function Header({ theme, onToggleTheme, latestTestTimestamp }) {
  return (
    <header className="header">
      <button className="theme-btn" onClick={onToggleTheme} title="Toggle theme">
        {theme === 'light' ? '☀️' : '🌙'}
      </button>
      <div className="nvidia-badge">⬛ NVIDIA NIM</div>
      <h1>LLM Speed Benchmark</h1>
      <p className="subtitle">
        Same prompt · All free endpoints · Ranked by{' '}
        <span>tokens / second</span>
      </p>
      {latestTestTimestamp && (
        <p         style={{ fontSize: 11, color: 'var(--muted)', margin: '8px 0 0', textAlign: 'center' }}>
          Last tested: {latestTestTimestamp}
        </p>
      )}
    </header>
  );
}
