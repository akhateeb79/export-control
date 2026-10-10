import StatusBadge from './StatusBadge';

const UAE_BADGE_STYLES = {
  UAE_CONTROLLED:           'bg-orange-900/40 text-orange-300 border border-orange-700/50',
  UAE_DECLARATION_REQUIRED: 'bg-red-900/40 text-red-300 border border-red-700/50',
  UAE_CLEAR:                'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50',
  UAE_UNKNOWN:              'bg-slate-800 text-slate-400 border border-slate-700'
};

const UAE_LABELS = {
  UAE_CONTROLLED:           'UAE Controlled',
  UAE_DECLARATION_REQUIRED: 'UAE Declaration Required',
  UAE_CLEAR:                'UAE Clear',
  UAE_UNKNOWN:              'UAE Unscreened'
};

function UaeBadge({ status }) {
  if (!status) return null;
  const style = UAE_BADGE_STYLES[status] || UAE_BADGE_STYLES.UAE_UNKNOWN;
  const label = UAE_LABELS[status] || status;
  return <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${style}`}>{label}</span>;
}

function classificationRows(classifications) {
  if (Array.isArray(classifications)) return classifications;
  return classifications?.results || [];
}

export default function ClassificationResult({ classifications }) {
  const rows = classificationRows(classifications);
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">02 / product intelligence</p>
          <h2>Classification</h2>
        </div>
        <span className="muted">{rows.length} products</span>
      </div>
      {!rows.length ? (
        <div className="empty-state">No product classification has been recorded.</div>
      ) : (
        <div className="grid gap-3">
          {rows.map((item, index) => (
            <article className="subpanel" key={item.id || item.product_id || index}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-white">{item.product_name || item.name || `Product ${index + 1}`}</p>
                  <p className="mt-1 text-xs text-slate-500">{item.product_id || 'Product reference unavailable'}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {item.uae_control_status && <UaeBadge status={item.uae_control_status} />}
                  <StatusBadge status={item.status || (item.is_ear99 ? 'EAR99' : 'CLASSIFIED')} />
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div><span className="data-label">ECCN</span><span className="data-value">{item.eccn || (item.is_ear99 ? 'EAR99' : 'Unassigned')}</span></div>
                <div><span className="data-label">Confidence</span><span className="data-value">{item.confidence != null ? `${item.confidence}%` : '—'}</span></div>
                <div><span className="data-label">Review</span><span className="data-value">{item.requires_human_review ? 'Required' : 'Not required'}</span></div>
                <div><span className="data-label">Revalidation</span><span className="data-value">{item.requires_revalidation ? 'Required' : 'Current'}</span></div>
              </div>
              {(item.uae_control_status === 'UAE_CONTROLLED' || item.uae_control_status === 'UAE_DECLARATION_REQUIRED') && (
                <div className="mt-4 rounded border border-orange-700/40 bg-orange-950/30 px-4 py-3 text-sm text-orange-200">
                  <strong>UAE National Control List:</strong>{' '}
                  {item.uae_control_status === 'UAE_DECLARATION_REQUIRED'
                    ? 'This product requires a UAE declaration or permit before export from or through the UAE.'
                    : 'This product appears on the UAE National Control List. Verify UAE licensing requirements.'}
                  {item.uae_match_score != null && (
                    <span className="ml-2 text-xs text-orange-400">(match score: {(item.uae_match_score * 100).toFixed(0)}%)</span>
                  )}
                </div>
              )}
              {item.reasoning && <p className="mt-4 text-sm leading-6 text-slate-400">{item.reasoning}</p>}
              <details className="mt-4 text-xs text-slate-500"><summary className="cursor-pointer text-cyan-200">Full classification record</summary><pre className="mt-2 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(item, null, 2)}</pre></details>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}