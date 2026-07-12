import { useMemo, useEffect, useRef } from 'react';
import { getProvider, getProviderColor, ProviderIcon } from '../utils/providers';

export default function TtftChart({ sortedOk }) {
  const chartRef = useRef(null);

  const okWithTtft = useMemo(() => {
    return sortedOk.filter(d => d.ttft_s != null).sort((a, b) => a.ttft_s - b.ttft_s);
  }, [sortedOk]);

  const maxTtft = useMemo(() => {
    return okWithTtft.length ? okWithTtft[okWithTtft.length - 1].ttft_s : 1;
  }, [okWithTtft]);

  useEffect(() => {
    if (okWithTtft.length < 2) return;
    const fills = chartRef.current?.querySelectorAll('.bar-provider-fill');
    if (fills) {
      Array.from(fills).forEach(f => {
        f.style.width = f.dataset.pct + '%';
      });
    }
  }, [okWithTtft]);

  if (okWithTtft.length < 2) return null;

  return (
    <div className="chart-wrap ttft-chart" style={{ marginTop: 20 }}>
      <div className="chart-title">Time to First Token ↓ (lower is better)</div>
      <div ref={chartRef}>
        {okWithTtft.map(d => {
          const provider = getProvider(d.id);
          const color = getProviderColor(provider);
          const pct = (d.ttft_s / maxTtft) * 100;
          const tooltip = `${d.id}\nTTFT: ${d.ttft_s.toFixed(3)}s`;

          return (
            <div key={d.id} className="bar-row visible">
              <div className="rank" />
              <span className="status-icon">⚡</span>
              <div className="model-name" title={tooltip}>
                <ProviderIcon provider={provider} size={12} />
                {d.label}
              </div>
              <div className="bar-ttft" />
              <div className="bar-track">
                <div
                  className="bar-provider-fill"
                  data-pct={pct}
                  style={{
                    width: '0%',
                    background: color,
                    boxShadow: `0 0 16px ${color}44`,
                  }}
                />
              </div>
              <div className="bar-val">
                {d.ttft_s.toFixed(3)} <span className="unit">s</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="axis">
        <span className="axis-label">seconds →</span>
      </div>
    </div>
  );
}
