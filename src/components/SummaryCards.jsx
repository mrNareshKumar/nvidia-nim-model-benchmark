import { useAnimatedCounter } from '../hooks/useAnimatedCounter';

export default function SummaryCards({ data }) {
  if (!data || data.length === 0) return null;

  const ok = data.filter(d => d.status === 'ok');
  const timeout = data.filter(d => d.status !== 'ok' && d.error?.toLowerCase().includes('timeout'));
  const errors = data.filter(d => d.status !== 'ok' && (!d.error || !d.error.toLowerCase().includes('timeout')));
  const fastest = ok.length ? Math.max(...ok.map(d => d.tokens_per_second)) : null;

  return (
    <div className="cards">
      <AnimatedCard value={data.length} label="Models Tested" colorClass="cyan" />
      <AnimatedCard value={ok.length} label="Succeeded" colorClass="green" />
      <AnimatedCard value={timeout.length} label="Timeouts" colorClass="yellow" />
      <AnimatedCard value={errors.length} label="Errors" colorClass="red" />
      <AnimatedCard value={fastest} label="Fastest (tok/s)" colorClass="green" decimals={1} />
    </div>
  );
}

function AnimatedCard({ value, label, colorClass, decimals = 0, suffix = '' }) {
  const animated = useAnimatedCounter(value);
  const display = value != null ? (decimals ? animated.toFixed(decimals) : Math.round(animated)) : '—';
  return (
    <div className="card">
      <div className="card-val-row">
        <div className={`card-val ${colorClass}`}>{display}{suffix}</div>
      </div>
      <div className="card-label">{label}</div>
    </div>
  );
}
