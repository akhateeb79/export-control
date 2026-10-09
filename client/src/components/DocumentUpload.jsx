import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

const FIELD_LABELS = {
  exporter_name: 'Exporter name',
  exporter_country: 'Exporter country',
  consignee_name: 'Consignee name',
  consignee_country: 'Consignee country',
  end_user_name: 'End user name',
  end_user_country: 'End user country',
  product_description: 'Product description',
  part_number: 'Part number',
  quantity: 'Quantity',
  declared_end_use: 'Declared end use',
  destination_country: 'Destination country',
  unit_value: 'Unit value',
  total_value: 'Total value',
  currency: 'Currency'
};
const PARTY_NAME_FIELDS = new Set(['exporter_name', 'consignee_name', 'end_user_name']);

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function confidenceClass(score) {
  if (score >= 0.85) return 'confidence-high';
  if (score >= 0.6) return 'confidence-medium';
  return 'confidence-low';
}

function reviewFields(fields) {
  return (Array.isArray(fields) ? fields : []).map((field) => ({
    ...field,
    mode: Number(field.confidence_score) >= 0.85 ? 'accepted' : 'omit',
    overrideValue: field.value
  }));
}

function statusLabel(status) {
  if (status === 'APPLIED') return 'Applied';
  if (status === 'EXTRACTED') return 'Pending review';
  return 'Not extracted';
}

export default function DocumentUpload({ caseId, onApplied }) {
  const [documents, setDocuments] = useState([]);
  const [file, setFile] = useState(null);
  const [documentType, setDocumentType] = useState('OTHER');
  const [extractions, setExtractions] = useState({});
  const [state, setState] = useState({ busy: '', error: '', message: '' });

  async function load() {
    try {
      const result = await apiFetch(`/api/v1/cases/${caseId}/documents`);
      setDocuments(result.documents || []);
      setExtractions(Object.fromEntries(
        (result.documents || [])
          .filter((document) => Array.isArray(document.extracted_fields))
          .map((document) => [document.id, reviewFields(document.extracted_fields)])
      ));
      setState((previous) => ({ ...previous, error: '' }));
    } catch (error) {
      setState({ busy: '', error: error.message, message: '' });
    }
  }

  useEffect(() => { load(); }, [caseId]);

  async function upload(event) {
    event.preventDefault();
    if (!file) return;
    const form = event.currentTarget;
    setState({ busy: 'upload', error: '', message: '' });
    const body = new FormData();
    body.append('file', file);
    body.append('document_type', documentType);
    try {
      await apiFetch(`/api/v1/cases/${caseId}/documents`, { method: 'POST', body });
      setFile(null);
      form.reset();
      await load();
      setState({ busy: '', error: '', message: '' });
    } catch (error) {
      setState({ busy: '', error: error.body?.error?.code || error.message, message: '' });
    }
  }

  async function extract(document) {
    setState({ busy: `extract:${document.id}`, error: '', message: '' });
    try {
      const result = await apiFetch(`/api/v1/cases/${caseId}/documents/${document.id}/extract`, { method: 'POST' });
      setExtractions((previous) => ({ ...previous, [document.id]: reviewFields(result.fields) }));
      setDocuments((previous) => previous.map((item) => item.id === document.id
        ? { ...item, extraction_status: 'EXTRACTED', extracted_fields: result.fields, extraction_confidence_avg: result.extraction_confidence_avg }
        : item));
      setState({ busy: '', error: '', message: '' });
    } catch (error) {
      setState({ busy: '', error: error.body?.error?.code || error.message, message: '' });
    }
  }

  function changeReview(documentId, field, changes) {
    setExtractions((previous) => ({
      ...previous,
      [documentId]: previous[documentId].map((item) => item.field === field ? { ...item, ...changes } : item)
    }));
  }

  async function apply(document) {
    const fields = extractions[document.id] || [];
    const acceptedFields = fields
      .filter((field) => field.mode === 'accepted' || field.mode === 'override')
      .map((field) => ({
        field: field.field,
        value: field.mode === 'override' ? field.overrideValue : field.value,
        arabic_value: field.arabic_value || null,
        english_value: field.mode === 'override'
          ? field.overrideValue
          : field.english_value || null
      }))
      .filter((field) => field.value.trim());
    setState({ busy: `apply:${document.id}`, error: '', message: '' });
    try {
      const result = await apiFetch(`/api/v1/cases/${caseId}/documents/${document.id}/apply-extraction`, {
        method: 'POST',
        body: JSON.stringify({ accepted_fields: acceptedFields })
      });
      const count = result.applied_fields?.length || 0;
      await load();
      await onApplied?.();
      setState({ busy: '', error: '', message: `${count} field${count === 1 ? '' : 's'} applied to case` });
    } catch (error) {
      setState({ busy: '', error: error.body?.error?.code || error.message, message: '' });
    }
  }

  return (
    <section className="panel">
      <div className="section-heading">
        <div><p className="eyebrow">05 / supporting evidence</p><h2>Documents</h2></div>
        <span className="muted">{documents.length} attached</span>
      </div>
      <form className="grid gap-3 border-b border-white/7 pb-5 sm:grid-cols-[180px_1fr_auto]" onSubmit={upload}>
        <select className="field" value={documentType} onChange={(event) => setDocumentType(event.target.value)}>
          <option value="OTHER">Other</option>
          <option value="END_USER_STATEMENT">End-user statement</option>
          <option value="PURCHASE_ORDER">Purchase order</option>
          <option value="TECHNICAL_DATASHEET">Technical datasheet</option>
          <option value="LICENCE">Licence</option>
        </select>
        <input className="field" type="file" accept=".pdf,application/pdf" required onChange={(event) => setFile(event.target.files?.[0] || null)} />
        <button className="button-primary" disabled={state.busy === 'upload' || !file}>{state.busy === 'upload' ? 'Uploading…' : 'Upload'}</button>
      </form>
      {state.error && <div className="callout callout-danger mt-4">{state.error}</div>}
      {state.message && <div className="callout callout-success mt-4">{state.message}</div>}
      {!documents.length ? <div className="empty-state">No documents attached.</div> : (
        <div className="divide-y divide-white/7">
          {documents.map((document) => {
            const fields = extractions[document.id];
            const extracting = state.busy === `extract:${document.id}`;
            const applying = state.busy === `apply:${document.id}`;
            return (
              <div className="document-row" key={document.id}>
                <div className="document-row-main">
                  <div>
                    <p className="font-semibold text-white">{document.original_filename}</p>
                    <p className="mt-1 text-xs text-slate-500">{document.document_type} · {document.mime_type || 'Unknown type'} · {formatBytes(document.size_bytes)}</p>
                  </div>
                  <div className="document-row-actions">
                    <span className={`extraction-badge extraction-${String(document.extraction_status || 'UPLOADED').toLowerCase()}`}>{statusLabel(document.extraction_status)}</span>
                    {document.extraction_status !== 'APPLIED' && <button className="button-secondary" disabled={Boolean(state.busy)} onClick={() => extract(document)}>{extracting ? 'Extracting…' : 'Extract fields'}</button>}
                  </div>
                </div>
                {extracting && <p className="extraction-loading">Reading document and extracting compliance fields...</p>}
                {fields && <ExtractionPanel document={document} fields={fields} applying={applying} onChange={changeReview} onApply={apply} onDismiss={() => setExtractions((previous) => { const next = { ...previous }; delete next[document.id]; return next; })} />}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ExtractionPanel({ document, fields, applying, onChange, onApply, onDismiss }) {
  const hasMismatch = fields.some((field) => field.bilingual_mismatch === true);
  return (
    <div className="extraction-panel">
      <div className="section-heading">
        <div><p className="eyebrow">AI review</p><h3>Extracted fields — review before applying</h3></div>
        <span className="muted">{fields.length} found</span>
      </div>
      {hasMismatch && <div className="bilingual-mismatch-banner" role="alert">⚠ Bilingual mismatch detected — the Arabic and English versions of one or more fields differ. This may indicate a document error or compliance concern. Review carefully before submitting.</div>}
      {!fields.length && <p className="empty-state">No supported fields were found in this document.</p>}
      <div className="extraction-fields">
        {fields.map((field) => (
          <div className="extraction-field" key={field.field}>
            <div className="extraction-field-header">
              <strong>{FIELD_LABELS[field.field] || field.field}</strong>
              <div className="extraction-field-badges">
                <span className={`source-language-badge source-language-${field.source_language || 'en'}`}>{field.source_language === 'both' ? 'EN+AR' : String(field.source_language || 'en').toUpperCase()}</span>
                {field.bilingual_mismatch && <span className="mismatch-badge">Mismatch</span>}
                <span className={`confidence-label ${confidenceClass(field.confidence_score)}`}>{Math.round(field.confidence_score * 100)}%</span>
              </div>
            </div>
            <div className="confidence-bar"><span className={confidenceClass(field.confidence_score)} style={{ width: `${field.confidence_score * 100}%` }} /></div>
            {field.bilingual_mismatch ? (
              <div className="bilingual-comparison">
                <div><span>English</span><strong>{field.english_value || field.value}</strong></div>
                <div dir="rtl"><span>Arabic</span><strong>{field.arabic_value || 'Not provided'}</strong></div>
              </div>
            ) : PARTY_NAME_FIELDS.has(field.field) && field.arabic_value ? (
              <div className="party-name-display"><strong>{field.english_value || field.value}</strong><span dir="rtl">{field.arabic_value}</span></div>
            ) : (
              <p className="extraction-value">{field.value}</p>
            )}
            <details><summary>Source text</summary><p>{field.source_text}</p></details>
            <div className="extraction-review-control">
              <label>Review action
                <select className="field" value={field.mode} onChange={(event) => onChange(document.id, field.field, { mode: event.target.value })}>
                  <option value="accepted">Accept</option>
                  <option value="override">Override</option>
                  <option value="omit">Do not apply</option>
                </select>
              </label>
              {field.mode === 'override' && <label>Override value
                <input className="field" value={field.overrideValue} onChange={(event) => onChange(document.id, field.field, { overrideValue: event.target.value })} />
              </label>}
            </div>
          </div>
        ))}
      </div>
      <div className="extraction-footer">
        <span>AI-generated extraction. Review all fields before applying.</span>
        <div className="flex gap-2">
          <button className="button-quiet" disabled={applying} onClick={onDismiss}>Dismiss</button>
          <button className="button-primary" disabled={applying || !fields.some((field) => field.mode !== 'omit')} onClick={() => onApply(document)}>{applying ? 'Applying…' : 'Apply accepted fields to case'}</button>
        </div>
      </div>
    </div>
  );
}