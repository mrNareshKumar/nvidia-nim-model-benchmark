import { getProvider, getProviderColor } from '../utils/providers';

export default function ModelDetailPanel({ model, onClose }) {
  if (!model) return null;

const PROMPT = "What is the capital of India? Please answer in one sentence.";
const provider = getProvider(model.id);
const color = getProviderColor(provider);
const statusEmoji = model.status === 'ok' ? '✅' : model.error?.toLowerCase().includes('timeout') ? '⏰' : '❌';

  return (
    <>
      <div className="panel-overlay" onClick={onClose} />
      <div className="detail-panel">
        <button className="panel-close" onClick={onClose}>✕</button>

        <div className="panel-section">
          <div className="panel-model-label">{model.label}</div>
          <div className="panel-model-id">{model.id}</div>
        </div>

        <div className="panel-section">
          <div className="panel-grid">
            <div className="panel-item">
              <span className="panel-item-label">Provider</span>
              <span className="panel-item-val">
                <span className="legend-dot" style={{ background: color, display: 'inline-block', width: 10, height: 10, borderRadius: '50%', marginRight: 6 }} />
                {provider}
              </span>
            </div>
            <div className="panel-item">
              <span className="panel-item-label">Status</span>
              <span className="panel-item-val">{statusEmoji} {model.status}</span>
            </div>
          </div>
        </div>

        {model.status === 'ok' && (
          <div className="panel-section">
            <div className="panel-grid panel-grid-3">
              <div className="panel-item">
                <span className="panel-item-label">Speed</span>
                <span className="panel-item-val highlight">{model.tokens_per_second?.toFixed(1)} <small>tok/s</small></span>
              </div>
              <div className="panel-item">
                <span className="panel-item-label">TTFT</span>
                <span className="panel-item-val">{model.ttft_s?.toFixed(3)} <small>s</small></span>
              </div>
              <div className="panel-item">
                <span className="panel-item-label">Total Time</span>
                <span className="panel-item-val">{model.total_time_s?.toFixed(2)} <small>s</small></span>
              </div>
            </div>
          </div>
        )}

        {model.input_tokens != null && (
          <div className="panel-section">
            <div className="panel-grid panel-grid-3">
              <div className="panel-item">
                <span className="panel-item-label">Input Tokens</span>
                <span className="panel-item-val">{model.input_tokens}</span>
              </div>
              <div className="panel-item">
                <span className="panel-item-label">Output Tokens</span>
                <span className="panel-item-val">{model.tokens}</span>
              </div>
              <div className="panel-item">
                <span className="panel-item-label">Total Tokens</span>
                <span className="panel-item-val">{(model.input_tokens || 0) + (model.tokens || 0)}</span>
              </div>
            </div>
          </div>
        )}

        <div className="panel-section">
          <div className="panel-item-label">Input Prompt</div>
          <div className="panel-response" style={{ fontSize: 12 }}>{PROMPT}</div>
        </div>

        {model.timestamp && (
          <div className="panel-section">
            <span className="panel-item-label">Benchmarked</span>
            <span className="panel-item-val" style={{ marginLeft: 8 }}>{new Date(model.timestamp).toLocaleString()}</span>
          </div>
        )}

        {model.response_preview && (
          <div className="panel-section">
            <div className="panel-item-label">Response Preview</div>
            <div className="panel-response">{model.response_preview}</div>
          </div>
        )}

        {model.error && (
          <div className="panel-section">
            <div className="panel-item-label" style={{ color: 'var(--red)' }}>Error</div>
            <div className="panel-response error-text">{model.error}</div>
          </div>
        )}
      </div>
    </>
  );
}
