import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import ParticleBackground from './components/ParticleBackground';
import Header from './components/Header';
import SummaryCards from './components/SummaryCards';
import Toolbar from './components/Toolbar';
import MainChart from './components/MainChart';
import TtftChart from './components/TtftChart';
import TokenChart from './components/TokenChart';
import Footer from './components/Footer';
import ModelDetailPanel from './components/ModelDetailPanel';
import RunBenchmark from './components/RunBenchmark';
import { getProvider } from './utils/providers';
import { exportCSV } from './utils/csvExport';

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('nim-theme') || 'dark');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('nim-theme', theme);
  }, [theme]);
  const toggle = useCallback(() => setTheme(t => (t === 'light' ? 'dark' : 'light')), []);
  return [theme, toggle];
}

function useUrlState(key, defaultValue) {
  const [value, setValue] = useState(() => {
    const sp = new URLSearchParams(window.location.search);
    return sp.get(key) ?? defaultValue;
  });
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (value && value !== defaultValue) sp.set(key, value);
    else sp.delete(key);
    const qs = sp.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }, [value]);
  return [value, setValue];
}

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [fileMtime, setFileMtime] = useState(null);

  const [theme, toggleTheme] = useTheme();
  const [searchQuery, setSearchQuery] = useUrlState('q', '');
  const [providerFilter, setProviderFilter] = useUrlState('p', '');
  const [sortKey, setSortKey] = useState(() => new URLSearchParams(window.location.search).get('s') || 'tokens_per_second');
  const [sortDir, setSortDir] = useState(() => parseInt(new URLSearchParams(window.location.search).get('d') || '-1'));
  const [selectedModel, setSelectedModel] = useState(null);
  const benchmarkRef = useRef(null);
  const [bmVisible, setBmVisible] = useState(false);

  // Sync sort to URL
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sortKey !== 'tokens_per_second') sp.set('s', sortKey); else sp.delete('s');
    if (sortDir !== -1) sp.set('d', String(sortDir)); else sp.delete('d');
    const qs = sp.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }, [sortKey, sortDir]);

  // Fetch data
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('results.json?_t=' + Date.now());
        if (!res.ok) throw new Error('results.json not found');
        const lastMod = res.headers.get('last-modified');
        setFileMtime(lastMod ? new Date(lastMod).toLocaleString() : null);
        const json = await res.json();
        setData(json);
      } catch (e) {
        setFetchError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Filtered + sorted data
  const { filteredData, filteredOk, errors, timeouts } = useMemo(() => {
    if (!data) return { filteredData: [], filteredOk: [], errors: [], timeouts: [] };

    let filtered = data;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(d => (d.label + ' ' + d.id).toLowerCase().includes(q));
    }
    if (providerFilter) {
      filtered = filtered.filter(d => getProvider(d.id) === providerFilter);
    }

    const ok = filtered.filter(d => d.status === 'ok');
    const timeout = filtered.filter(d => d.status !== 'ok' && d.error?.toLowerCase().includes('timeout'));
    const err = filtered.filter(d => d.status !== 'ok' && (!d.error || !d.error.toLowerCase().includes('timeout')));

    const sortFn = (a, b) => {
      let va = a[sortKey], vb = b[sortKey];
      if (va == null) va = sortDir === -1 ? -Infinity : Infinity;
      if (vb == null) vb = sortDir === -1 ? -Infinity : Infinity;
      if (typeof va === 'string') return sortDir * va.localeCompare(vb);
      return sortDir * (va - vb);
    };
    ok.sort(sortFn);

    return { filteredData: filtered, filteredOk: ok, errors: err, timeouts: timeout };
  }, [data, searchQuery, providerFilter, sortKey, sortDir]);

  const latestTestTimestamp = useMemo(() => {
    if (!data || data.length === 0) return fileMtime;
    const ts = data.map(d => d.timestamp).filter(Boolean);
    if (ts.length === 0) return fileMtime;
    return new Date(Math.max(...ts.map(t => new Date(t).getTime()))).toLocaleString();
  }, [data, fileMtime]);

  const handleSort = useCallback((key) => {
    setSortKey(prev => {
      if (prev === key) {
        setSortDir(d => -d);
        return prev;
      }
      setSortDir(key === 'ttft_s' ? 1 : -1);
      return key;
    });
  }, []);

  const handleBenchmarkComplete = useCallback(() => {
    // Re-fetch results.json
    fetch('results.json?' + Date.now())
      .then(res => res.json())
      .then(json => setData(json))
      .catch(() => {});
  }, []);

  const handleRetryModel = useCallback(async (modelId) => {
    try {
      await fetch('/api/results/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelIds: [modelId] }),
      });
      const res = await fetch('results.json?' + Date.now());
      if (res.ok) setData(await res.json());
      if (benchmarkRef.current) {
        benchmarkRef.current.show();
        benchmarkRef.current.rerunModels([modelId]);
      }
    } catch {}
  }, []);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  if (loading) {
    return (
      <>
        <ParticleBackground />
        <div className="content" style={{ textAlign: 'center', paddingTop: 120 }}>
          <div className="spinner" />
          <p style={{ color: 'var(--muted)', marginTop: 16 }}>Loading results.json …</p>
        </div>
      </>
    );
  }

  if (fetchError) {
    return (
      <>
        <ParticleBackground />
        <div className="content" style={{ textAlign: 'center', paddingTop: 120 }}>
          <p style={{ color: '#f87171' }}>
            ⚠ {fetchError}<br />
            Make sure the server is running (npm run dev).
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <ParticleBackground />
      <div className="content">
        <Header theme={theme} onToggleTheme={toggleTheme} latestTestTimestamp={latestTestTimestamp} />
        <SummaryCards data={filteredData} latestTestTimestamp={latestTestTimestamp} />
        <Toolbar
          data={data}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          providerFilter={providerFilter}
          onProviderChange={setProviderFilter}
          onExportCSV={() => exportCSV(data)}
          onPrint={handlePrint}
        >
          <button
            className="btn-outline"
            onClick={() => {
              const bm = benchmarkRef.current;
              if (!bm) return;
              if (bmVisible) { bm.hide(); setBmVisible(false); }
              else { bm.show(); setBmVisible(true); }
            }}
            title={bmVisible ? 'Hide benchmark sidebar' : 'Open benchmark sidebar'}
          >
            {bmVisible ? '✕ Sidebar' : '▦ Benchmark'}
          </button>
        </Toolbar>
        <MainChart
          data={data}
          filteredOk={filteredOk}
          errors={errors}
          timeouts={timeouts}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={handleSort}
          searchQuery={searchQuery}
          providerFilter={providerFilter}
          onSelectModel={setSelectedModel}
          onRetryModel={handleRetryModel}
        />
        <TtftChart sortedOk={filteredOk} />
        <TokenChart sortedOk={filteredOk} />
        <Footer timestamp={latestTestTimestamp} />
      </div>
      <div className={`bm-sidebar${bmVisible ? ' bm-sidebar-visible' : ''}`}>
        <RunBenchmark ref={benchmarkRef} onComplete={handleBenchmarkComplete} onVisibleChange={setBmVisible} onRetryModel={handleRetryModel} />
      </div>
      <ModelDetailPanel model={selectedModel} onClose={() => setSelectedModel(null)} />
    </>
  );
}
