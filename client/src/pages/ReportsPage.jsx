import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch, apiFetchRaw } from '../lib/api';
import RadarChart from '../components/RadarChart';

const CRITERIA = ['Management Commitment', 'Risk Analysis', 'Organisation & Responsibilities', 'Human Resources & Reliability', 'Workflow Management', 'Record Keeping & Monitoring', 'Staff Training', 'ICP Audit', 'Physical Security & IT Security'];
const TABS = [['bafa', 'BAFA ICP'], ['outcomes', 'Case outcomes'], ['hits', 'Screening hits'], ['cycle', 'Cycle time'], ['licence', 'Licence exceptions']];

function value(data, ...keys) { for (const key of keys) if (data?.[key] !== undefined && data?.[key] !== null) return data[key]; return undefined; }
function list(data, ...keys) { const result = value(data, ...keys); return Array.isArray(result) ? result : []; }
function title(valueToFormat) { return String(valueToFormat || '—').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function pct(number) { return `${Math.round(Number(number || 0))}%`; }
function dateLabel(date) { return date ? new Date(date).toLocaleDateString() : '—'; }

function BarList({ rows, suffix = '' }) {
  const max = Math.max(...rows.map((row) => Number(row.value || 0)), 1);
  return rows.length ? <div className="report-bars">{rows.map((row, index) => <div className="report-bar-row" key={row.id || row.label || index}><span>{title(row.label)}</span><i><b style={{ width: `${Math.min(100, Number(row.value || 0) / max * 100)}%` }} /></i><strong>{row.value ?? 0}{suffix}</strong></div>)}</div> : <div className="empty-state">No data for this period.</div>;
}

function Table({ columns, rows }) {
  return <div className="table-scroll"><table className="data-table"><thead><tr>{columns.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={row.id || index}>{columns.map(([key, , render]) => <td key={key}>{render ? render(row) : row[key] ?? '—'}</td>)}</tr>) : <tr><td colSpan={columns.length}><div className="empty-state">No data for this period.</div></td></tr>}</tbody></table></div>;
}

function Period({ period, setPeriod, onApply, loading }) {
  return <div className="report-period"><label className="field-label">From<input className="field" type="date" value={period.start} onChange={(event) => setPeriod({ ...period, start: event.target.value })} /></label><label className="field-label">To<input className="field" type="date" value={period.end} onChange={(event) => setPeriod({ ...period, end: event.target.value })} /></label><button className="button-primary" onClick={onApply} disabled={loading}>{loading ? 'Loading…' : 'Apply period'}</button></div>;
}

export default function ReportsPage({ session }) {
  const role = session?.user?.role;
  const isPlatform = role === 'SUPER_ADMIN' && session?.user?.tenant_id == null;
  const canBafa = role === 'COMPLIANCE_ADMIN';
  const [tab, setTab] = useState(isPlatform ? 'platform' : canBafa ? 'bafa' : 'outcomes');
  const [period, setPeriod] = useState(() => { const end = new Date(); const start = new Date(end); start.setDate(start.getDate() - 30); return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }; });
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (target = tab) => {
    setLoading(true); setError('');
    try {
      if (target === 'bafa') {
        const [latest, history] = await Promise.all([apiFetch('/api/v1/reports/bafa-icp/latest'), apiFetch('/api/v1/reports/bafa-icp/history').catch(() => ({ reports: [] }))]);
        setData((current) => ({ ...current, bafa: latest, bafaHistory: history }));
      } else if (target === 'platform') {
        const [crossTenant, agents, freshness] = await Promise.all([apiFetch('/api/v1/admin/reports/cross-tenant'), apiFetch('/api/v1/admin/reports/agent-performance'), apiFetch('/api/v1/admin/reports/list-freshness')]);
        setData((current) => ({ ...current, crossTenant, agents, freshness }));
      } else {
        const endpoint = { outcomes: 'case-outcomes', hits: 'screening-hits', cycle: 'cycle-time', licence: 'licence-exceptions' }[target];
        const result = await apiFetch(`/api/v1/reports/${endpoint}?period_start=${period.start}&period_end=${period.end}`);
        setData((current) => ({ ...current, [target]: result }));
      }
    } catch (requestError) { setError(requestError.body?.error?.message || requestError.message); } finally { setLoading(false); }
  }, [period, tab]);
  useEffect(() => { load(); }, [load]);

  async function generate() {
    setLoading(true); setError(''); setNotice('');
    try { const report = await apiFetch('/api/v1/reports/bafa-icp', { method: 'POST', body: JSON.stringify({ period_start: period.start, period_end: period.end }) }); setData((current) => ({ ...current, bafa: report })); setNotice('BAFA ICP report generated.'); } catch (requestError) { setError(requestError.body?.error?.message || requestError.message); } finally { setLoading(false); }
  }
  async function download(path, name) {
    try { const response = await apiFetchRaw(path); if (!response.ok) throw new Error(`Download failed (${response.status})`); const link = document.createElement('a'); link.href = URL.createObjectURL(await response.blob()); link.download = name; link.click(); URL.revokeObjectURL(link.href); setNotice(`${name} downloaded.`); } catch (requestError) { setError(requestError.message); }
  }
  async function ingest(source) { try { await apiFetch(`/api/v1/admin/lists/${encodeURIComponent(source.code || source.id)}/sync`, { method: 'POST' }); setNotice(`${source.name || source.code} ingestion started.`); await load('platform'); } catch (requestError) { setError(requestError.message); } }

  const report = data.bafa?.report || data.bafa || {};
  const criteria = (Array.isArray(report.criteria) ? report.criteria : Object.entries(report.criteria || {}).map(([key, item]) => ({ ...item, key }))).map((item, index) => ({ label: item.name || item.label || CRITERIA[index] || item.key, value: item.score ?? item.value ?? 0, gap: item.gap }));
  const summary = report.transaction_summary || report.summary || {};
  const tabItems = isPlatform ? [['platform', 'Platform reports']] : TABS.filter(([id]) => id !== 'bafa' || canBafa);

  function renderBafa() {
    return <><Period period={period} setPeriod={setPeriod} onApply={() => load('bafa')} loading={loading} /><div className="report-actions"><button className="button-primary" onClick={generate} disabled={loading}>{loading ? 'Computing BAFA ICP criteria scores…' : 'Generate BAFA ICP Report'}</button>{report.id && <><button className="button-secondary" onClick={() => download(`/api/v1/reports/bafa-icp/${report.id}/pdf`, `bafa-icp-report-${report.id}.pdf`)}>Download PDF</button><button className="button-secondary" onClick={() => download(`/api/v1/reports/bafa-export?period_start=${period.start}&period_end=${period.end}`, `bafa-export-${period.end}.json`)}>BAFA Export JSON</button></>}</div>{report.id && <><section className="panel"><div className="section-heading"><div><p className="eyebrow">Programme score</p><h2>BAFA 9-Criteria Score</h2></div><strong className="report-score">{pct(report.overall_score ?? report.overall_health ?? criteria.reduce((sum, item) => sum + Number(item.value), 0) / Math.max(criteria.length, 1))}</strong></div><div className="report-radar-layout"><RadarChart values={criteria.map((item) => item.value)} size={320} /><div className="report-criteria">{criteria.length ? criteria.map((item, index) => <div className="report-criterion" key={item.label}><div><span>{index + 1}. {item.label}</span><strong>{pct(item.value)}</strong></div><i><b className={Number(item.value) >= 80 ? 'good' : Number(item.value) >= 60 ? 'warn' : 'bad'} style={{ width: `${Math.min(100, Number(item.value))}%` }} /></i>{item.gap && Number(item.value) < 100 && <small>{item.gap}</small>}</div>) : <div className="empty-state">Generate a report to calculate all nine criteria.</div>}</div></div></section><div className="report-metrics"><div className="report-metric"><span>Total cases this period</span><strong>{summary.total_cases ?? summary.total_cases_submitted ?? 0}</strong></div><div className="report-metric"><span>Approved</span><strong>{pct(summary.approved_percent ?? summary.approved_rate)}</strong></div><div className="report-metric"><span>Blocked</span><strong>{pct(summary.blocked_percent ?? summary.blocked_rate)}</strong></div><div className="report-metric"><span>Avg cycle time</span><strong>{summary.average_cycle_time_hours ?? summary.avg_cycle_time_hours ?? 0}h</strong></div><div className="report-metric"><span>CECO reviews</span><strong>{summary.ceco_review_cases ?? 0}</strong></div></div></>}{<section className="panel"><div className="section-heading"><div><p className="eyebrow">Archive</p><h2>Previous reports</h2></div></div><Table rows={list(data.bafaHistory, 'reports')} columns={[['generated_at', 'Generated', (row) => dateLabel(row.generated_at)], ['period_start', 'From'], ['period_end', 'To'], ['overall_score', 'Score', (row) => pct(row.overall_score)], ['id', 'Reference']]} /></section>}</>;
  }

  function renderPlatform() {
    const tenants = list(data.crossTenant, 'tenants', 'rows', 'data');
    const agents = list(data.agents, 'agents', 'rows', 'data');
    const sources = list(data.freshness, 'sources', 'lists', 'rows', 'data');
    return <div className="page-stack"><section className="panel"><div className="section-heading"><div><p className="eyebrow">Platform reporting</p><h2>Cross-tenant compliance summary</h2></div><button className="button-secondary" onClick={() => download('/api/v1/admin/audit/export?limit=20000', 'platform-audit.csv')}>Export CSV</button></div><Table rows={tenants} columns={[['tenant_name', 'Tenant'], ['tenant_ref', 'Reference'], ['icp_score', 'ICP score'], ['total_cases', 'Case volume'], ['open_cases', 'Open cases'], ['open_corrective_actions', 'Open actions']]} /></section><section className="panel"><div className="section-heading"><div><p className="eyebrow">Automation</p><h2>Agent performance</h2></div></div><Table rows={agents} columns={[['agent_code', 'Agent'], ['average_confidence', 'Confidence'], ['average_runtime_seconds', 'Avg seconds'], ['failed_count', 'Failures'], ['version_label', 'Version']]} /></section><section className="panel"><div className="section-heading"><div><p className="eyebrow">Data freshness</p><h2>List ingestion</h2></div></div><Table rows={sources} columns={[['name', 'Source'], ['fetched_at', 'Last sync', (row) => dateLabel(row.fetched_at)], ['entry_count', 'Records'], ['status', 'Status'], ['code', 'Action', (row) => <button className="button-secondary" onClick={() => ingest(row)}>Trigger ingestion</button>]]} /></section></div>;
  }

  const CSV_ENDPOINTS = { outcomes: 'case-outcomes', hits: 'screening-hits', cycle: 'cycle-time', licence: 'licence-exceptions' };

  function renderAnalytics() {
    const result = data[tab] || {};
    const rows = tab === 'outcomes' ? list(result, 'distribution') : tab === 'hits' ? list(result, 'by_list_source') : tab === 'cycle' ? list(result, 'by_workflow_state') : list(result, 'usage');
    const trend = list(result, 'trend', 'weekly_trend', 'weekly');
    const labels = { outcomes: ['Outcome distribution', 'Top blocked destinations'], hits: ['Hits by list source', 'Weekly hit trend'], cycle: ['Average time by workflow state', 'Cycle time detail'], licence: ['Usage by exception type', 'Exception usage trend'] };
    const [heading, tableHeading] = labels[tab];
    const normalize = (row) => ({ ...row, label: row.label || row.name || row.source || row.outcome || row.state || row.exception_type, value: row.value ?? row.count ?? row.total ?? row.average_hours ?? row.avg_hours });
    const exportPath = CSV_ENDPOINTS[tab] ? `/api/v1/reports/${CSV_ENDPOINTS[tab]}/export?period_start=${period.start}&period_end=${period.end}` : null;
    return <><Period period={period} setPeriod={setPeriod} onApply={() => load(tab)} loading={loading} /><div className="report-two-column"><section className="panel"><div className="section-heading"><div><p className="eyebrow">Period analysis</p><h2>{heading}</h2></div>{exportPath && <button className="button-secondary" onClick={() => download(exportPath, `${CSV_ENDPOINTS[tab]}-${period.end}.csv`)}>Export CSV</button>}</div><BarList rows={rows.map(normalize)} suffix={tab === 'cycle' ? 'h' : ''} /></section><section className="panel"><div className="section-heading"><div><p className="eyebrow">Trend</p><h2>{tableHeading}</h2></div></div><BarList rows={trend.map((row) => normalize({ ...row, label: row.label || row.week || row.period }))} suffix={tab === 'hits' ? '%' : ''} /></section></div><section className="panel"><Table rows={rows} columns={[['name', 'Name'], ['count', 'Count'], ['rate', 'Rate'], ['average_hours', 'Average hours']]} /></section></>;
  }

  if (!canBafa && !isPlatform && role !== 'COMPLIANCE_OFFICER') return <div className="page"><div className="callout callout-danger">Compliance reporting access required.</div></div>;
  return <div className="page"><header className="page-header"><div><p className="eyebrow">{isPlatform ? 'Platform / analytics' : 'Compliance / analytics'}</p><h1>Reports</h1><p className="page-subtitle">Auditable reporting for compliance decisions, programme health, and operational performance.</p></div></header>{error && <div className="callout callout-danger mb-4">{error}</div>}{notice && <div className="callout callout-success mb-4">{notice}</div>}<div className="icp-tabs">{tabItems.map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</div>{tab === 'platform' ? renderPlatform() : tab === 'bafa' ? renderBafa() : renderAnalytics()}</div>;
}