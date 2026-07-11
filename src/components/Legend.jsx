import { getAllProviders, getProviderColor } from '../utils/providers';

export default function Legend({ data }) {
  if (!data || data.length === 0) return null;
  const providers = getAllProviders(data);

  return (
    <div className="legend">
      {providers.map(p => (
        <span key={p} className="legend-item">
          <span className="legend-dot" style={{ background: getProviderColor(p) }} />
          {p}
        </span>
      ))}
    </div>
  );
}
