import { useState, useRef, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function StatusDot({ status }) {
  const colors = { ok: '#2ecc71', timeout: '#f39c12', error: '#e74c3c', testing: '#3498db', waiting: '#95a5a6' };
  return <span className="status-dot" style={{ background: colors[status] || '#888' }} />;
}

const RunBenchmark = forwardRef(function RunBenchmark({ onComplete, onVisibleChange, onRetryModel }, ref) {
  const [running, setRunning] = useState(false);
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [toRun, setToRun] = useState(0);
  const [current, setCurrent] = useState(null);
  const [results, setResults] = useState([]);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [waitSec, setWaitSec] = useState(0);
  const bottomRef = useRef(null);
  const esRef = useRef(null);
  const currentIdRef = useRef(null);

  // Settings
  const [apiBaseUrl, setApiBaseUrl] = useState(() => localStorage.getItem('nim-api-base-url') || '');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('nim-api-key') || '');
  const [apiSettingsOpen, setApiSettingsOpen] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [allModels, setAllModels] = useState([]);
  const [selectedModelIds, setSelectedModelIds] = useState(new Set());
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [searchText, setSearchText] = useState('');

  // Expanded error rows
  const [expandedErrors, setExpandedErrors] = useState(new Set());

  const debouncedMainRefreshRef = useRef(null);
  const resultsLoadGuardRef = useRef(false);

  // Load models.json + existing results on mount
  useEffect(() => {
    fetch('/models.json?_t=' + Date.now())
      .then(r => r.json())
      .then(models => {
        setAllModels(models);
        const chatIds = models.filter(m => m.group === 'chat').map(m => m.id);
        setSelectedModelIds(new Set(chatIds));
        setExpandedGroups(new Set(['chat']));
      })
      .catch(() => {});
    fetch('/results.json?_t=' + Date.now())
      .then(r => r.ok ? r.json() : [])
      .then(saved => {
        if (saved.length > 0 && !resultsLoadGuardRef.current) {
          setResults(saved);
        }
      })
      .catch(() => {});
  }, []);

  const groups = useMemo(() => {
    const map = {};
    allModels.forEach(m => {
      if (!map[m.group]) map[m.group] = [];
      map[m.group].push(m);
    });
    return map;
  }, [allModels]);

  const getSelected = useCallback(() => {
    return Array.from(selectedModelIds);
  }, [selectedModelIds]);

  function sendNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body });
    } else if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(p => {
        if (p === 'granted') new Notification(title, { body });
      });
    }
  }

  const connect = useCallback((restart, rerunModels) => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    setRunning(true);
    setVisible(true);
    
    onVisibleChange?.(true);
    setReady(false);
    setTotal(0);
    setDone(0);
    setToRun(0);
    resultsLoadGuardRef.current = true;
    if (restart) setResults([]);
    if (!rerunModels) setResults([]);
    setSummary(null);
    setError(null);
    setCurrent(null);
    setWaitSec(0);

    let connected = false;
    const connTimeout = setTimeout(() => {
      if (!connected && esRef.current) {
        esRef.current.close();
        esRef.current = null;
        setError('Cannot connect to server. Is the server running on port 3000?');
        setRunning(false);
        
      }
    }, 5000);

    try {
      const params = new URLSearchParams();
      if (restart) params.set('restart', '1');
      if (customPrompt.trim()) params.set('prompt', customPrompt.trim());
      if (apiBaseUrl.trim()) params.set('api_base_url', apiBaseUrl.trim());
      if (apiKey.trim()) params.set('api_key', apiKey.trim());
      const selected = rerunModels || getSelected();
      if (selected && selected.length > 0) {
        params.set('models', selected.join(','));
      }
      if (rerunModels) params.set('rerun', rerunModels.join(','));

      const url = '/api/benchmark?' + params.toString();
      const es = new EventSource(url);
      esRef.current = es;

      es.onmessage = (event) => {
        let data;
        try { data = JSON.parse(event.data); } catch { return; }

        const t = data.type;

        if (t === 'connected') {
          connected = true;
          clearTimeout(connTimeout);
          return;
        }

        if (t === 'init') {
          setTotal(data.total);
          setDone(data.existing || 0);
          setToRun(data.toRun || 0);
          setReady(true);
        } else if (t === 'begin') {
          currentIdRef.current = data.modelId;
          setCurrent({ modelId: data.modelId, label: data.label, index: data.index, total: data.total, status: 'testing', elapsed: 0, tokenCount: 0 });
        } else if (t === 'progress') {
          if (data.modelId === currentIdRef.current) {
            setCurrent(prev => prev ? { ...prev, elapsed: data.elapsed || 0, tokenCount: data.tokenCount || 0, status: data.waiting ? 'waiting' : 'testing' } : prev);
          }
        } else if (t === 'result') {
          setResults(prev => [...prev, data]);
          setDone(prev => prev + 1);
          setCurrent(null);
          currentIdRef.current = null;
          setWaitSec(0);
          if (debouncedMainRefreshRef.current) clearTimeout(debouncedMainRefreshRef.current);
          debouncedMainRefreshRef.current = setTimeout(() => onComplete?.(), 2000);
        } else if (t === 'wait') {
          setWaitSec(data.seconds);
        } else if (t === 'summary') {
          setSummary(data);
          sendNotification('Benchmark Complete', `${data.succeeded} OK, ${data.timeouts} timeouts, ${data.errors} errors in ${fmtTime(data.elapsed)}`);
        } else if (t === 'done') {
          clearTimeout(connTimeout);
          es.close();
          esRef.current = null;
          setRunning(false);
          
          setCurrent(null);
          currentIdRef.current = null;
          setWaitSec(0);
          resultsLoadGuardRef.current = false;
          onComplete?.();
        } else if (t === 'error') {
          clearTimeout(connTimeout);
          resultsLoadGuardRef.current = false;
          setError(data.text);
          es.close();
          esRef.current = null;
          setRunning(false);
          
        }
      };

      es.onerror = () => {
        clearTimeout(connTimeout);
        if (!connected) {
          setError('Cannot connect to server. Is the server running on port 3000?');
        } else {
          setError('Connection lost during benchmark');
        }
        setRunning(false);
        
        resultsLoadGuardRef.current = false;
        es.close();
        esRef.current = null;
      };
    } catch (e) {
      clearTimeout(connTimeout);
      setError(e.message);
      setRunning(false);
    }
  }, [onComplete, onVisibleChange, customPrompt, getSelected, allModels.length, apiBaseUrl, apiKey]);

  function retryCategory(status) {
    const modelIds = results
      .filter(r => {
        if (status === 'ok') return r.status === 'ok';
        const isTimeout = r.error?.toLowerCase().includes('timeout');
        if (status === 'timeout') return isTimeout;
        if (status === 'error') return r.status !== 'ok' && !isTimeout;
        return false;
      })
      .map(r => r.id);
    if (modelIds.length === 0) return;
    setResults(prev => prev.filter(r => !modelIds.includes(r.id)));
    connect(false, modelIds);
  }

  useImperativeHandle(ref, () => ({
    start() {
      if (getSelected().length === 0) { setError('Select at least one model to test'); return; }
      const selected = getSelected();
      if (selected.length > 0 && selected.every(id => results.some(r => r.id === id))) {
        setError('All selected models already tested. Use Restart to re-test.');
        return;
      }
      connect(false);
    },
    resume() {
      if (getSelected().length === 0) { setError('Select at least one model to test'); return; }
      const selected = getSelected();
      if (selected.length > 0 && selected.every(id => results.some(r => r.id === id))) {
        setError('All selected models already tested. Use Restart to re-test.');
        return;
      }
      connect(false);
    },
    restart() { connect(true); },
    rerunModels(modelIds) {
      if (!modelIds || modelIds.length === 0) return;
      setResults(prev => prev.filter(r => !modelIds.includes(r.id)));
      connect(false, modelIds);
    },
    stop() {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      setRunning(false);
      
      setCurrent(null);
      currentIdRef.current = null;
      if (debouncedMainRefreshRef.current) clearTimeout(debouncedMainRefreshRef.current);
      debouncedMainRefreshRef.current = setTimeout(() => onComplete?.(), 0);
    },
    hide() {
      setVisible(false);
      onVisibleChange?.(false);
    },
    show() {
      setVisible(true);
      onVisibleChange?.(true);
    },
    get running() { return running; },
    get visible() { return visible; },
  }), [connect, onVisibleChange, onRetryModel, running, visible, getSelected, setError, results]);

  useEffect(() => {
    if (!running) {
      setCurrent(null);
      currentIdRef.current = null;
    }
  }, [running]);

  useEffect(() => {
    return () => esRef.current?.close();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [results]);

  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;
  const okCount = summary ? summary.succeeded : results.filter(r => r.status === 'ok').length;
  const timeoutCount = summary ? summary.timeouts : results.filter(r => r.status === 'error' && r.error?.toLowerCase().includes('timeout')).length;
  const errorCountRs = summary ? summary.errors : results.filter(r => r.status !== 'ok' && !r.error?.toLowerCase().includes('timeout')).length;
  const derivedSummary = summary || (!running && results.length > 0 ? { total: results.length, succeeded: okCount, timeouts: timeoutCount, errors: errorCountRs, elapsed: 0 } : null);

  function toggleModel(mid) {
    setSelectedModelIds(prev => {
      const next = new Set(prev);
      if (next.has(mid)) next.delete(mid); else next.add(mid);
      return next;
    });
  }

  function toggleGroup(groupName) {
    const groupModels = groups[groupName];
    if (!groupModels) return;
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupName)) next.delete(groupName); else next.add(groupName);
      return next;
    });
    setSelectedModelIds(prev => {
      const groupIds = groupModels.map(m => m.id);
      const allInGroup = groupIds.every(id => prev.has(id));
      const next = new Set(prev);
      if (allInGroup) {
        groupIds.forEach(id => next.delete(id));
      } else {
        groupIds.forEach(id => next.add(id));
      }
      return next;
    });
  }

  function toggleErrorRow(idx) {
    setExpandedErrors(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }

  const filteredModels = Object.entries(groups)
    .filter(([g]) => expandedGroups.has(g))
    .sort((a, b) => {
      if (a[0] === 'chat') return -1;
      if (b[0] === 'chat') return 1;
      return a[0].localeCompare(b[0]);
    })
    .flatMap(([groupName, models]) => models.map(m => ({ ...m, groupName })))
    .filter(m => {
      if (!searchText.trim()) return true;
      const q = searchText.toLowerCase();
      return m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || m.groupName.toLowerCase().includes(q);
    });

  if (!visible) return null;

  return (
    <div className="bm-section">
      <div className="bm-header">
        <span className="bm-title">
          {running ? '⏳ Benchmark' : error ? '❌ Failed' : (summary || derivedSummary) ? '✅ Complete' : 'Benchmark'}
        </span>
        <span className="bm-progress-text">
          {ready ? `${done} / ${total} models (${progressPct}%)` : running ? 'Starting…' : ''}
        </span>
      </div>

      {!running && (
        <div className="bm-settings">
          <h6>Select only: chat model</h6>
          <label className="bm-settings-label">Prompt</label>
          <textarea
            className="bm-prompt-input"
            rows={2}
            placeholder="What is the capital of India? Please answer in one sentence."
            value={customPrompt}
            onChange={e => setCustomPrompt(e.target.value)}
          />

          <div className="bm-section-header bm-api-settings-header" onClick={() => setApiSettingsOpen(o => !o)} style={{ cursor: 'pointer', userSelect: 'none', marginTop: 10, marginBottom: 4 }}>
            <span className={`section-arrow ${apiSettingsOpen ? 'open' : ''}`}>▶</span>
            <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>API Settings</span>
          </div>
          {apiSettingsOpen && (
            <div className="bm-api-settings" style={{ marginBottom: 10 }}>
              <label className="bm-settings-label">Base URL</label>
              <input className="bm-prompt-input" type="text" placeholder="https://integrate.api.nvidia.com/v1" value={apiBaseUrl} onChange={e => setApiBaseUrl(e.target.value)} style={{ marginBottom: 6 }} />
              <label className="bm-settings-label">API Key</label>
              <div style={{ display: 'flex', gap: 4 }}>
                <input className="bm-prompt-input" type={showApiKey ? 'text' : 'password'} placeholder={apiKey ? '••••••••' : 'NVIDIA_API_KEY'} value={apiKey} onChange={e => setApiKey(e.target.value)} style={{ flex: 1 }} />
                <button className="bm-btn" style={{ fontSize: 12, padding: '2px 6px', minWidth: 28, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--muted)' }} onClick={() => setShowApiKey(s => !s)} title={showApiKey ? 'Hide API key' : 'Show API key'}>{showApiKey ? '🙈' : '👁'}</button>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button className="bm-btn bm-btn-start" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => { localStorage.setItem('nim-api-base-url', apiBaseUrl); localStorage.setItem('nim-api-key', apiKey); }}>💾 Save</button>
                <button className="bm-btn bm-btn-stop" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => { localStorage.removeItem('nim-api-base-url'); localStorage.removeItem('nim-api-key'); setApiBaseUrl(''); setApiKey(''); }}>✕ Clear</button>
              </div>
            </div>
          )}
          <label className="bm-settings-label">Model Groups</label>
          <div className="bm-model-groups-chip">
            {Object.entries(groups).sort((a, b) => {
              if (a[0] === 'chat') return -1;
              if (b[0] === 'chat') return 1;
              return a[0].localeCompare(b[0]);
            }).map(([groupName, models]) => {
              const selectedCount = models.filter(m => selectedModelIds.has(m.id)).length;
              const active = expandedGroups.has(groupName);
              return (
                <button key={groupName} className={`bm-chip${active ? ' active' : ''}`} onClick={() => toggleGroup(groupName)}>
                  {groupName}
                  <span className="bm-chip-count">{selectedCount}/{models.length}</span>
                </button>
              );
            })}
          </div>

          <div className="bm-individual-header">
            <label className="bm-settings-label">Individual models</label>
            {filteredModels.length > 0 && (() => {
              const allSelected = filteredModels.every(x => selectedModelIds.has(x.id));
              return (
                <button
                  className="bm-select-all-btn"
                  onClick={() => {
                    const ids = filteredModels.map(x => x.id);
                    setSelectedModelIds(prev => {
                      const next = new Set(prev);
                      if (allSelected) {
                        ids.forEach(id => next.delete(id));
                      } else {
                        ids.forEach(id => next.add(id));
                      }
                      return next;
                    });
                  }}
                >{allSelected ? 'Deselect All' : 'Select All'}</button>
              );
            })()}
          </div>
          <div className="bm-model-checklist">
            <div className="bm-checklist-search">
              <input
                className="bm-search-input"
                type="text"
                placeholder="Search models..."
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
              />
            </div>
            <div className="bm-checklist-scroll">
              {filteredModels.map(m => (
                <label key={m.id} className="bm-checklist-item">
                  <input type="checkbox" checked={selectedModelIds.has(m.id)} onChange={() => toggleModel(m.id)} />
                  <span className="bm-checklist-label">{m.label}</span>
                  <span className="bm-checklist-badge">{m.groupName}</span>
                  <span className="bm-checklist-id">{m.id}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="bm-controls">
        {running ? (
          <button className="bm-btn bm-btn-stop" onClick={() => { ref.current?.stop(); }}>
            ⏹ Stop
          </button>
        ) : (
          <>
            <button className="bm-btn bm-btn-start" onClick={() => ref.current?.start()} title={toRun ? `Test ${toRun} models` : 'Start benchmark'}>
              ▶ Start
            </button>
            <button className="bm-btn bm-btn-resume" onClick={() => ref.current?.resume()} title="Continue from existing progress">
              ▶ Resume
            </button>
            <button className="bm-btn bm-btn-restart" onClick={() => ref.current?.restart()} title="Delete all results and start fresh">
              ⟳ Restart
            </button>
            <button className="bm-btn bm-btn-close" onClick={() => { setVisible(false); onVisibleChange?.(false); }}>
              ✕ Close
            </button>
          </>
        )}
      </div>

      <div className="bm-progress-bar">
        <div className="bm-progress-fill" style={{ width: `${progressPct}%` }} />
      </div>

      <div className="bm-stats">
        <div className="bm-stat"><span className="bm-stat-val">{(summary || derivedSummary) ? fmtTime((summary || derivedSummary).elapsed) : running ? '…' : '--:--'}</span><span className="bm-stat-lbl">Elapsed</span></div>
        <div className="bm-stat ok"><span className="bm-stat-val">{okCount}</span><span className="bm-stat-lbl">OK</span></div>
        <div className="bm-stat timeout"><span className="bm-stat-val">{timeoutCount}</span><span className="bm-stat-lbl">Timeouts</span></div>
        <div className="bm-stat err"><span className="bm-stat-val">{errorCountRs}</span><span className="bm-stat-lbl">Errors</span></div>
        {okCount + timeoutCount + errorCountRs > 0 && <div className="bm-stat"><span className="bm-stat-val">{Math.round((okCount / Math.max(okCount + timeoutCount + errorCountRs, 1)) * 100)}%</span><span className="bm-stat-lbl">Success</span></div>}
      </div>

      {current && (
        <div className="bm-current">
          <div className="bm-current-header">
            <StatusDot status={current.status} />
            <span className="bm-current-label">{current.label}</span>
            <span className="bm-current-idx">{current.index}/{current.total}</span>
            {current.status === 'waiting'
              ? <span className="bm-current-status waiting">Waiting…</span>
              : <span className="bm-current-status testing">Streaming…</span>}
          </div>
          <div className="bm-current-metrics">
            <span className="bm-metric">Elapsed: {current.elapsed.toFixed(1)}s</span>
            <span className="bm-metric">Tokens: {current.tokenCount}</span>
            {current.tokenCount > 0 && current.elapsed > 0 && <span className="bm-metric">Speed: {(current.tokenCount / Math.max(current.elapsed, 0.001)).toFixed(1)} tok/s</span>}
            <span className="bm-metric-bar">{'█'.repeat(Math.min(current.tokenCount, 30))}</span>
          </div>
        </div>
      )}

      {running && waitSec > 0 && !current && (
        <div className="bm-wait">Rate limit — next model in {waitSec}s…</div>
      )}

      {error && <div className="bm-error-banner">{error}</div>}

      <div className="bm-results">
        <div className="bm-results-header">
          <span className="bm-col-status" />
          <span className="bm-col-name">Model</span>
          <span className="bm-col-speed">Speed</span>
          <span className="bm-col-ttft">TTFT</span>
          <span className="bm-col-tokens">Tokens</span>
          <span className="bm-col-actions" />
        </div>
        <div className="bm-results-body">
          {results.length === 0 && !running && !error && (
            <div className="bm-empty">Click Start, Resume, or Restart to begin</div>
          )}
          {results.length === 0 && running && !ready && (
            <div className="bm-empty">Connecting…</div>
          )}
          {results.length === 0 && running && ready && (
            <div className="bm-empty">Waiting for results…</div>
          )}
          {results.map((r, i) => {
            const isTimeout = r.error?.toLowerCase().includes('timeout');
            const errorStatus = r.status === 'ok' ? 'ok' : isTimeout ? 'timeout' : 'error';
            const isExpanded = expandedErrors.has(i);
            return (
              <div key={i}>
                <div className={`bm-row ${r.status}`} style={{ borderLeftColor: '#3498db' }}>
                  <span className="bm-col-status"><StatusDot status={errorStatus} /></span>
                  <span className="bm-col-name">
                    <span className="bm-row-label">{r.label}</span>
                    <span className="bm-row-id">{r.id}</span>
                  </span>
                  <span className="bm-col-speed">{r.status === 'ok' ? `${r.tokens_per_second.toFixed(1)} tok/s` : '—'}</span>
                  <span className="bm-col-ttft">{r.ttft_s ? `${r.ttft_s.toFixed(2)}s` : '—'}</span>
                  <span className="bm-col-tokens">{r.status === 'ok' ? r.tokens : '—'}</span>
                  <span className="bm-col-actions">
                    {r.status === 'ok' && r.response_preview && (
                      <button className="bm-row-btn" title="Show response" onClick={() => toggleErrorRow(i)}>
                        {isExpanded ? '▲' : '▼'}
                      </button>
                    )}
                    {r.status !== 'ok' && (
                      <>
                        <button className="bm-row-btn" title="Error details" onClick={() => toggleErrorRow(i)}>
                          {isExpanded ? '▲' : '⚠'}
                        </button>
                        <button className="bm-row-btn bm-row-retry" title="Retry" onClick={() => onRetryModel?.(r.id)}>
                          ⟳
                        </button>
                      </>
                    )}
                  </span>
                </div>
                {isExpanded && (
                  <div className="bm-row-detail">
                    {r.status === 'ok' ? (
                      <div className="bm-response-preview">{r.response_preview}</div>
                    ) : (
                      <div className="bm-error-detail">{r.error}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
});

export default RunBenchmark;
