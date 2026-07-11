import { useRef, useEffect, useMemo, useState } from 'react';
import { getProvider, getProviderColor, ProviderIcon } from '../utils/providers';
import Legend from './Legend';

export default function MainChart({
  data,
  filteredOk,
  errors,
  timeouts,
  sortKey,
  sortDir,
  onSort,
  onSelectModel,
  onRetryModel,
}) {
  const chartRef = useRef(null);
  const [expanded, setExpanded] = useState({ succeeded: true, timeouts: false, errors: false });

  const maxTps = useMemo(() => {
    return filteredOk.length ? Math.max(...filteredOk.map(d => d.tokens_per_second)) : 1;
  }, [filteredOk]);

  useEffect(() => {
    if (!expanded.succeeded) return;
    const rows = chartRef.current?.querySelectorAll('.bar-row:not(.visible)');
    if (!rows || rows.length === 0) return;
    const delay = Math.min(40, 3000 / rows.length);
    let i = 0;
    function showNext() {
      if (i >= rows.length) return;
      rows[i].classList.add('visible');
      const fill = rows[i].querySelector('.bar-fill, .bar-provider-fill');
      if (fill) setTimeout(() => { fill.style.width = fill.dataset.pct + '%'; }, 80);
      i++;
      if (i < rows.length) setTimeout(showNext, delay);
    }
    showNext();
  }, [data, sortKey, sortDir, expanded.succeeded, filteredOk.length]);

  useEffect(() => {
    const fills = chartRef.current?.querySelectorAll('.bar-row.visible .bar-fill, .bar-row.visible .bar-provider-fill');
    if (fills) fills.forEach(f => { f.style.width = f.dataset.pct + '%'; });
  }, [data, expanded.succeeded, filteredOk.length]);

  // Fill bars for timeout/error rows (they start at their target width)
  useEffect(() => {
    const fills = chartRef.current?.querySelectorAll('.timeout-row .bar-fill, .timeout-row .bar-provider-fill, .error-row .bar-fill, .error-row .bar-provider-fill');
    if (fills) fills.forEach(f => { f.style.width = f.dataset.pct + '%'; });
  }, [data, expanded.timeouts, expanded.errors, errors.length, timeouts.length]);

  function toggleSection(name) {
    setExpanded(prev => ({ ...prev, [name]: !prev[name] }));
  }

  function renderRow(d, index, sectionType) {
    const isOk = sectionType === 'succeeded';
    const provider = getProvider(d.id);
    const color = getProviderColor(provider);
    const emoji = isOk ? '✅' : sectionType === 'timeouts' ? '⏰' : '❌';
    const pct = isOk ? (d.tokens_per_second / maxTps) * 100 : 4;
    const tooltip = d.response_preview
      ? `${d.id}\n\n${d.response_preview.replace(/<[^>]*>/g, '')}`
      : d.id;

    let rowClass = 'bar-row';
    if (sectionType === 'timeouts') rowClass += ' timeout-row visible';
    if (sectionType === 'errors') rowClass += ' error-row visible';

    const valHtml = isOk
      ? `${d.tokens_per_second.toFixed(1)} <span class="unit">tok/s</span>`
      : `<span>${sectionType === 'timeouts' ? 'timeout' : 'error'}</span>`;

    return (
      <div
        key={d.id}
        className={rowClass}
        onClick={() => onSelectModel(d)}
        title="Click for details"
      >
        <div className="rank">{isOk ? index + 1 : ''}</div>
        <span className="status-icon">{emoji}</span>
        <div className="model-name" title={tooltip}>
              <ProviderIcon provider={provider} size={12} color={color} />
          {d.label}
        </div>
        <div className="bar-ttft">{isOk && d.ttft_s ? `${d.ttft_s.toFixed(2)}s` : ''}</div>
        <div className="bar-track">
          <div
            className={isOk ? 'bar-provider-fill' : 'bar-fill'}
            data-pct={pct}
            style={{
              width: isOk ? '0%' : `${pct}%`,
              ...(isOk ? { background: color, boxShadow: `0 0 16px ${color}44` } : {}),
            }}
          />
        </div>
        <div className="bar-val" dangerouslySetInnerHTML={{ __html: valHtml }} />
        {onRetryModel && (
          <button className="row-retry-btn" onClick={e => { e.stopPropagation(); onRetryModel(d.id); }} title="Delete and retest this model">⟳</button>
        )}
      </div>
    );
  }

  function renderSection(type, items) {
    if (!items || items.length === 0) return null;
    const labels = { timeouts: { icon: '⏰', label: 'Timeouts' }, errors: { icon: '❌', label: 'Errors' } };
    const info = labels[type];
    const isOpen = expanded[type];

    return (
      <div className="chart-section">
        <div className="section-header" onClick={() => toggleSection(type)}>
          <span className={`section-arrow ${isOpen ? 'open' : ''}`}>▶</span>
          <span>{info.icon}</span>
          <span className="section-label">{info.label}</span>
          <span className="section-count">{items.length}</span>
        </div>
        {isOpen && (
          <div className="section-body">
            {items.map((d, i) => <div key={d.id}>{renderRow(d, i, type)}</div>)}
          </div>
        )}
      </div>
    );
  }

  const sortCols = [
    { key: null, cls: 'col-rank', label: '#' },
    { key: null, cls: 'col-icon', label: '' },
    { key: 'label', cls: 'col-name', label: 'Model' },
    { key: 'ttft_s', cls: 'col-ttft', label: 'TTFT' },
    { key: null, cls: 'col-bar', label: '' },
    { key: 'tokens_per_second', cls: 'col-val', label: 'Tok/s' },
  ];

  return (
    <div className="chart-wrap">
      <div className="chart-title">Tokens per Second ↑ (higher is better)</div>

      <div className="section-header" onClick={() => toggleSection('succeeded')}>
        <span className={`section-arrow ${expanded.succeeded ? 'open' : ''}`}>▶</span>
        <span>✅</span>
        <span className="section-label">Succeeded</span>
        <span className="section-count">{filteredOk.length}</span>
      </div>
      {expanded.succeeded && (
        <div className="section-body" ref={chartRef}>
          {filteredOk.length > 0 && (
            <div className="chart-header">
              {sortCols.map(col => (
                <span
                  key={col.cls}
                  className={`col ${col.cls}${col.key && sortKey === col.key ? ' active' : ''}`}
                  onClick={col.key ? () => onSort(col.key) : undefined}
                  style={col.key ? { cursor: 'pointer' } : undefined}
                >
                  {col.label}
                  {col.key && (
                    <span className="arrow">
                      {sortKey === col.key ? (sortDir === -1 ? '▾' : '▴') : '▾'}
                    </span>
                  )}
                </span>
              ))}
            </div>
          )}
          {filteredOk.map((d, i) => <div key={d.id}>{renderRow(d, i, 'succeeded')}</div>)}
          {filteredOk.length > 0 && (
            <div className="axis">
              <span className="axis-label">tokens / second →</span>
            </div>
          )}
        </div>
      )}

      {renderSection('timeouts', timeouts)}
      {renderSection('errors', errors)}

      {filteredOk.length === 0 && timeouts.length === 0 && errors.length === 0 && (
        <div className="empty-state">No models match the current filters.</div>
      )}

      <Legend data={data} />
    </div>
  );
}
