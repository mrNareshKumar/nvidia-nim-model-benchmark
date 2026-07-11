import { getProvider } from './providers';

export function exportCSV(data) {
  const headers = ['Rank', 'Label', 'Model ID', 'Provider', 'Status', 'Tok/s', 'TTFT (s)', 'Total Time (s)', 'Error', 'Response Preview'];
  const rows = data.map((d, i) => [
    d.status === 'ok' ? i + 1 : '',
    d.label,
    d.id,
    getProvider(d.id),
    d.status,
    d.tokens_per_second != null ? d.tokens_per_second.toFixed(2) : '',
    d.ttft_s != null ? d.ttft_s.toFixed(4) : '',
    d.total_time_s != null ? d.total_time_s.toFixed(2) : '',
    d.error || '',
    d.response_preview ? d.response_preview.replace(/"/g, '""') : '',
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'nim-benchmark.csv';
  a.click();
  URL.revokeObjectURL(url);
}
