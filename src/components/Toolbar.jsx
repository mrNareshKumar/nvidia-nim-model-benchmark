import { getAllProviders } from '../utils/providers';

export default function Toolbar({
  data,
  searchQuery,
  onSearchChange,
  providerFilter,
  onProviderChange,
  onExportCSV,
  onPrint,
  children,
}) {
  const providers = data ? getAllProviders(data) : [];

  return (
    <div className="toolbar">
      <input
        id="search-box"
        type="text"
        placeholder="Filter models by name or ID..."
        value={searchQuery}
        onChange={e => onSearchChange(e.target.value)}
      />
      <select
        id="provider-filter"
        value={providerFilter}
        onChange={e => onProviderChange(e.target.value)}
      >
        <option value="">All Providers</option>
        {providers.map(p => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
      {children}
      <button className="btn-outline" onClick={onExportCSV}>
        ⬇ CSV
      </button>
      <button className="btn-outline" onClick={onPrint} title="Print / Save as PDF">
        🖨 Print
      </button>
    </div>
  );
}
