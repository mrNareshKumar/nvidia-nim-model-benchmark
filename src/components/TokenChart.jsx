import { useMemo, useEffect, useRef } from 'react';
import { getProvider, getProviderColor, ProviderIcon } from '../utils/providers';

export default function TokenChart({ sortedOk }) {
  const chartRef = useRef(null);

  const okWithTokens = useMemo(() => {
    return sortedOk
      .filter(d => d.tokens > 0)
      .sort((a, b) => ((a.input_tokens || 0) + a.tokens) - ((b.input_tokens || 0) + b.tokens));
  }, [sortedOk]);

  const maxTotal = useMemo(() => {
    return okWithTokens.length
      ? Math.max(...okWithTokens.map(d => (d.input_tokens || 0) + d.tokens))
      : 1;
  }, [okWithTokens]);

  useEffect(() => {
    if (okWithTokens.length < 2) return;
    const fills = chartRef.current?.querySelectorAll('.bar-provider-fill');
    if (fills) {
      Array.from(fills).forEach(f => {
        f.style.width = f.dataset.pct + '%';
      });
    }
  }, [okWithTokens]);

  if (okWithTokens.length < 2) return null;

  return (
    <div className="chart-wrap token-chart" style={{ marginTop: 20 }}>
      <div className="chart-title">Token Usage per Model ↓ (lower is better)</div>
      <div ref={chartRef}>
        {okWithTokens.map(d => {
          const provider = getProvider(d.id);
          const color = getProviderColor(provider);
          const input = d.input_tokens || 0;
          const output = d.tokens;
          const total = input + output;
          const pct = (total / maxTotal) * 100;
          const inputPct = (input / maxTotal) * 100;
          const fillInputRatio = total > 0 ? (input / total) * 100 : 0;
          const tooltip = `${d.id}\nInput: ${input} · Output: ${output} · Total: ${total}`;

          return (
            <div key={d.id} className="bar-row visible">
              <div className="rank" />
              <span className="status-icon">📊</span>
              <div className="model-name" title={tooltip}>
                <ProviderIcon provider={provider} size={12} color={color} />
                {d.label}
              </div>
              <div className="bar-ttft" />
              <div className="bar-track">
                <div
                  className="bar-provider-fill"
                  data-pct={pct}
                  style={{
                    width: '0%',
                    background: `linear-gradient(90deg, ${color}55 0%, ${color}55 ${fillInputRatio}%, ${color} ${fillInputRatio}%, ${color} 100%)`,
                    boxShadow: `0 0 16px ${color}44`,
                  }}
                />
              </div>
              <div className="bar-val">
                {total} <span className="unit">tok</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="axis">
        <span className="axis-label">tokens →</span>
      </div>
      <div className="token-legend" style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 12, fontSize: 11, color: 'var(--muted)' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--text)', opacity: 0.33, marginRight: 4, verticalAlign: 'middle' }} /> Input</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--text)', opacity: 0.8, marginRight: 4, verticalAlign: 'middle' }} /> Output</span>
      </div>
    </div>
  );
}
