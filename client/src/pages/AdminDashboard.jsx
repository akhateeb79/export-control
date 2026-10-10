import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiFetch, apiFetchRaw } from '../lib/api';
import ProductECCN from './admin/ProductECCN';
import DataManagement from './admin/DataManagement';
import UaeControlList from './admin/UaeControlList';
import PlatformMonitor from './PlatformMonitor';

const NAV = [
  { id: 'overview', label: 'Platform Overview', icon: 'home', group: 'Monitor' },
  { id: 'tenants', label: 'Tenants', icon: 'building', group: 'Manage' },
  { id: 'users', label: 'Users & Access', icon: 'users', group: 'Manage' },
  { id: 'cases', label: 'Case Oversight', icon: 'briefcase', group: 'Monitor', badge: 'stuck' },
  { id: 'lists', label: 'Sanctions & Lists', icon: 'shield', group: 'Configure', badge: 'lists' },
  { id: 'agents', label: 'Agents & Classification', icon: 'cpu', group: 'Configure' },
  { id: 'licence', label: 'Licence Configuration', icon: 'key', group: 'Configure' },
  { id: 'product-eccn', label: 'Product & ECCN', icon: 'database', group: 'Configure' },
  { id: 'rules', label: 'Compliance Rules', icon: 'scale', group: 'Configure' },
  { id: 'audit', label: 'Audit & Reports', icon: 'chart', group: 'Govern' },
  { id: 'system', label: 'System Operations', icon: 'settings', group: 'Govern', badge: 'health' },
  { id: 'notifications', label: 'Notifications', icon: 'bell', group: 'Govern' },
  { id: 'intelligence', label: 'Intelligence', icon: 'chart', group: 'Govern' },
  { id: 'data', label: 'Data Management', icon: 'database', group: 'Govern' },
  { id: 'uae-list', label: 'UAE Control List', icon: 'shield', group: 'Configure' },
];

const CASE_TABS = [
  ['all', 'All Cases', '/api/v1/admin/cases'],
  ['stuck', 'Stuck', '/api/v1/admin/cases/stuck'],
  ['overrides', 'Overrides', '/api/v1/admin/cases/overrides'],
  ['sanctions-blocks', 'Sanctions Blocks', '/api/v1/admin/cases/sanctions-blocks'],
];

const REPORT_TABS = [
  ['log', 'Audit Log', '/api/v1/admin/audit'],
  ['outcomes', 'Outcomes', '/api/v1/admin/reports/outcomes'],
  ['sanctions', 'Sanctions Hits', '/api/v1/admin/reports/sanctions-hits'],
  ['workflow', 'Workflow Time', '/api/v1/admin/reports/workflow-time'],
  ['tenant-summary', 'Tenant Summary', '/api/v1/admin/reports/tenant-summary'],
];

const SYSTEM_TABS = [
  ['health', 'Health'],
  ['scheduler', 'Scheduler'],
  ['errors', 'Error Log'],
  ['smtp', 'SMTP'],
];

const PIPELINE_STATES = [
  ['DRAFT', 'Draft', 'slate'],
  ['SCREENING', 'Screening', 'violet'],
  ['CLASSIFICATION', 'Classification', 'blue'],
  ['DETERMINATION', 'Determination', 'amber'],
  ['PENDING_REVIEW', 'Pending review', 'orange'],
  ['APPROVED', 'Approved', 'emerald'],
  ['REJECTED', 'Rejected', 'rose'],
  ['BLOCKED', 'Blocked', 'red'],
];

function Icon({ name, size = 18, strokeWidth = 1.8 }) {
  const paths = {
    home: <><path d="m3 10 9-7 9 7" /><path d="M5 9.5V21h14V9.5M9 21v-6h6v6" /></>,
    building: <><path d="M4 21V5l8-2 8 2v16M2 21h20M8 7h1m6 0h1M8 11h1m6 0h1M8 15h1m6 0h1M10 21v-4h4v4" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0M16 11a3 3 0 1 0-1-5.8M17 14a5 5 0 0 1 4 5" /></>,
    briefcase: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M8 6V4h8v2M3 11h18M10 11v2h4v-2" /></>,
    shield: <><path d="M12 3 20 6v5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6l8-3Z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
    cpu: <><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 9h6v6H9zM9 1v3m6-3v3m0 16v3m-6-3v3M1 9h3m-3 6h3m16-6h3m-3 6h3" /></>,
    key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M16 5l3 3M13 10l3 3" /></>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>,
    scale: <><path d="M12 3v18M5 6h14M5 6l-3 6a4 4 0 0 0 6 0L5 6Zm14 0-3 6a4 4 0 0 0 6 0l-3-6ZM7 21h10" /></>,
    chart: <><path d="M4 19V5M4 19h17" /><path d="m7 15 3-4 3 2 5-7" /></>,
    settings: <><path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" /><path d="m19.4 15 .1.1a2 2 0 1 1-2.8 2.8l-.1-.1a2 2 0 0 0-3.4 1.4v.2a2 2 0 1 1-4 0v-.2a2 2 0 0 0-3.4-1.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A2 2 0 0 0 1.6 12a2 2 0 1 1 0-4h.2a2 2 0 0 0 1.4-3.4l-.1-.1A2 2 0 1 1 5.9 1.7l.1.1A2 2 0 0 0 9.4.4V.2a2 2 0 1 1 4 0v.2a2 2 0 0 0 3.4 1.4l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A2 2 0 0 0 21 8h.2a2 2 0 1 1 0 4H21a2 2 0 0 0-1.6 3Z" transform="scale(.78) translate(3.4 3.4)" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    moon: <><path d="M20.5 15.3A8.5 8.5 0 0 1 8.7 3.5 8.5 8.5 0 1 0 20.5 15.3Z" /></>,
    arrow: <><path d="M5 12h14m-6-6 6 6-6 6" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M5 21h14" /></>,
    refresh: <><path d="M20 11a8 8 0 1 0 1 4" /><path d="M20 4v7h-7" /></>,
    filter: <><path d="M4 6h16M7 12h10m-7 6h4" /></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></>,
  };
  return <svg className="admin-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.more}</svg>;
}

function formatDate(value, compact = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString([], compact ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : undefined);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function titleCase(value) {
  return String(value || '—').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toneFor(value) {
  const normalized = String(value || '').toLowerCase();
  if (['active', 'healthy', 'approved', 'published', 'running', 'met', 'delivered'].some((word) => normalized.includes(word))) return 'success';
  if (['blocked', 'rejected', 'failed', 'error', 'unhealthy', 'confirmed_hit', 'unverifiable'].some((word) => normalized.includes(word))) return 'danger';
  if (['pending', 'review', 'draft', 'warning', 'possible_hit', 'unmet'].some((word) => normalized.includes(word))) return 'warning';
  return 'neutral';
}

function Badge({ children, tone }) {
  return <span className={`status-badge ${tone || toneFor(children)}`}><span className="status-dot" />{titleCase(children)}</span>;
}

function Sparkline({ points = [8, 12, 10, 18, 16, 21, 24], color = '#818cf8' }) {
  const max = Math.max(...points, 1);
  const min = Math.min(...points);
  const range = Math.max(max - min, 1);
  const path = points.map((point, index) => `${index * (100 / (points.length - 1))},${31 - ((point - min) / range) * 25}`).join(' ');
  return <svg className="sparkline" viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true"><path d={`M ${path}`} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /><path d={`M ${path} L 100 34 L 0 34 Z`} fill={color} opacity=".08" /></svg>;
}

function MetricCard({ label, value, detail, delta, points, icon, color = 'indigo' }) {
  return <article className="metric-card">
    <div className="metric-card-top"><div className={`metric-icon ${color}`}><Icon name={icon} size={18} /></div><span className="metric-label">{label}</span><button className="icon-button metric-more" aria-label={`${label} options`}><Icon name="more" size={18} /></button></div>
    <div className="metric-value">{value}</div>
    <div className="metric-card-bottom"><span className={`metric-delta ${delta?.startsWith('-') ? 'negative' : ''}`}>{delta?.startsWith('-') ? '↓' : '↑'} {delta || '0%'}</span><span className="metric-detail">{detail}</span></div>
    <Sparkline points={points} color={color === 'emerald' ? '#34d399' : color === 'amber' ? '#fbbf24' : color === 'rose' ? '#fb7185' : '#818cf8'} />
  </article>;
}

function SectionHeader({ eyebrow, title, description, action }) {
  return <div className="section-header"><div><div className="section-eyebrow">{eyebrow}</div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>;
}

function Tabs({ items, active, onChange }) {
  return <div className="tabs" role="tablist">{items.map(([id, label]) => <button key={id} className={active === id ? 'tab active' : 'tab'} onClick={() => onChange(id)} role="tab" aria-selected={active === id}>{label}</button>)}</div>;
}

function EmptyState({ title = 'Nothing here yet', description = 'Records will appear here as the platform becomes active.' }) {
  return <div className="empty-state"><div className="empty-mark"><Icon name="chart" size={20} /></div><strong>{title}</strong><span>{description}</span></div>;
}

function DataTable({ columns, rows, onRowClick, empty, compact = false }) {
  return <div className={`table-wrap ${compact ? 'table-compact' : ''}`}><table className="admin-table"><thead><tr>{columns.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={row.id || row.code || row.case_ref || row.email || `${index}-${row.status}`} onClick={() => onRowClick?.(row)} className={onRowClick ? 'clickable-row' : ''}>{columns.map(([key, , render]) => <td key={key}>{typeof render === 'function' ? render(row) : row[key] ?? '—'}</td>)}</tr>) : <tr><td colSpan={columns.length}><EmptyState title={empty || 'No records found'} /></td></tr>}</tbody></table></div>;
}

function Drawer({ title, eyebrow, onClose, children, wide = false }) {
  return <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className={`drawer ${wide ? 'drawer-wide' : ''}`}><div className="drawer-header"><div><div className="section-eyebrow">{eyebrow}</div><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close drawer"><Icon name="close" /></button></div><div className="drawer-body">{children}</div></aside></div>;
}

function Field({ label, children, hint }) {
  return <label className="admin-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function Button({ children, variant = 'secondary', icon, onClick, type = 'button', disabled = false }) {
  return <button type={type} className={`admin-button ${variant}`} onClick={onClick} disabled={disabled}>{icon && <Icon name={icon} size={15} />}{children}</button>;
}

function initials(value) {
  return String(value || 'AD').split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

export default function AdminDashboard({ session, onSignOut }) {
  const location = useLocation();
  const navigate = useNavigate();
  const isPlatformAdmin = session?.user?.role === 'SUPER_ADMIN' && session?.user?.tenant_id == null;
  const isComplianceAdmin = session?.user?.role === 'COMPLIANCE_ADMIN';
  if (location.pathname === '/admin/dashboard/monitor') return <PlatformMonitor />;
  const canAccessDashboard = isPlatformAdmin || isComplianceAdmin;
  const routeSection = location.pathname.split('/').filter(Boolean).pop();
  const resolvedSection = routeSection === 'products' ? 'product-eccn' : routeSection;
  const [section, setSection] = useState(() => NAV.some((item) => item.id === resolvedSection) ? resolvedSection : isComplianceAdmin ? 'intelligence' : 'overview');
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('admin-theme') || 'dark');
  const [data, setData] = useState({});
  const [openGroups, setOpenGroups] = useState({ Monitor: true, Manage: true, Configure: true, Govern: true });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [commandOpen, setCommandOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [intelligenceHistoryOpen, setIntelligenceHistoryOpen] = useState(false);
  const [caseTab, setCaseTab] = useState('all');
  const [reportTab, setReportTab] = useState('log');
  const [systemTab, setSystemTab] = useState('health');
  const [userTab, setUserTab] = useState('users');
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [selectedCase, setSelectedCase] = useState(null);
  const [selectedList, setSelectedList] = useState(null);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [selectedException, setSelectedException] = useState(null);
  const [drawer, setDrawer] = useState(null);
  const [tenantForm, setTenantForm] = useState({ name: '', plan_code: 'STARTER' });
  const [ruleForm, setRuleForm] = useState({ value_code: '', label_key: '' });
  const [tenantQuery, setTenantQuery] = useState('');
  const [tenantStatus, setTenantStatus] = useState('ALL');

  useEffect(() => {
    if (location.pathname === '/admin/dashboard' || location.pathname === '/admin/dashboard/') {
      navigate(`/admin/dashboard/${isComplianceAdmin ? 'intelligence' : 'overview'}`, { replace: true });
      return;
    }
    if (NAV.some((item) => item.id === resolvedSection)) setSection(resolvedSection);
  }, [location.pathname, isComplianceAdmin]);

  useEffect(() => {
    document.documentElement.dataset.adminTheme = theme;
    localStorage.setItem('admin-theme', theme);
  }, [theme]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((current) => !current);
      }
      if (event.key === 'Escape') {
        setCommandOpen(false);
        setProfileOpen(false);
        setDrawer(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const requestMap = useCallback((target) => ({
    overview: [
      ['overview', '/api/v1/admin/overview'],
      ['tenants', '/api/v1/admin/tenants?limit=500'],
      ['users', '/api/v1/admin/users?limit=500'],
      ['cases', '/api/v1/admin/cases?limit=500'],
      ['health', '/api/v1/admin/system/health'],
      ['audit', '/api/v1/admin/audit?limit=10'],
      ['lists', '/api/v1/admin/lists'],
    ],
    tenants: [['tenants', `/api/v1/admin/tenants?limit=500${tenantQuery ? `&q=${encodeURIComponent(tenantQuery)}` : ''}${tenantStatus !== 'ALL' ? `&status=${tenantStatus}` : ''}`]],
    users: userTab === 'sessions'
      ? [['sessions', '/api/v1/admin/sessions?limit=200']]
      : [['users', `/api/v1/admin/users?limit=500${search ? `&q=${encodeURIComponent(search)}` : ''}`]],
    cases: [['cases', `/api/v1/admin/cases/${caseTab === 'all' ? '' : caseTab}?limit=500${search ? `&q=${encodeURIComponent(search)}` : ''}`]],
    lists: [['lists', '/api/v1/admin/lists'], ['embargoes', '/api/v1/admin/embargoes']],
    agents: [['agents', '/api/v1/admin/agents'], ['agentStats', '/api/v1/admin/agents/stats']],
    licence: [['exceptions', '/api/v1/admin/licence-exceptions'], ['licenceStats', '/api/v1/admin/licence-exceptions/stats']],
    rules: [['thresholds', '/api/v1/admin/thresholds'], ['rules', '/api/v1/admin/red-flag-rules']],
    audit: [[reportTab, REPORT_TABS.find(([id]) => id === reportTab)?.[2] || '/api/v1/admin/audit']],
    system: [[systemTab, `/api/v1/admin/system/${systemTab === 'smtp' ? 'health' : systemTab}`]],
    notifications: [['notificationRules', '/api/v1/admin/notification-rules'], ['deliveries', '/api/v1/admin/notification-rules/delivery-log']],
    intelligence: [['intelligence', '/api/v1/intelligence/latest'], ['intelligenceHistory', '/api/v1/intelligence/history']],
  }[target] || []), [caseTab, reportTab, search, systemTab, tenantQuery, tenantStatus, userTab]);

  const load = useCallback(async (target = section, { quiet = false } = {}) => {
    if (!canAccessDashboard) return;
    if (!quiet) setLoading(true);
    setError('');
    try {
      const result = await Promise.all(requestMap(target).map(async ([key, path]) => [key, await apiFetch(path)]));
      setData((current) => ({ ...current, ...Object.fromEntries(result) }));
    } catch (requestError) {
      setError(requestError.body?.error?.message || requestError.body?.error?.code || requestError.message);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [canAccessDashboard, requestMap, section]);

  useEffect(() => { load(section); }, [load, section]);
  useEffect(() => {
    const interval = window.setInterval(() => load(section, { quiet: true }), section === 'system' ? 10_000 : 30_000);
    return () => window.clearInterval(interval);
  }, [load, section]);

  async function action(callback, message = 'Changes saved.') {
    setError('');
    setNotice('');
    try {
      await callback();
      setNotice(message);
      await load(section);
    } catch (requestError) {
      setError(requestError.body?.error?.message || requestError.body?.error?.code || requestError.message);
    }
  }

  async function generateIntelligence() {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      await apiFetch('/api/v1/intelligence/generate', { method: 'POST' });
      setNotice('Intelligence report generated.');
      await load('intelligence');
    } catch (requestError) {
      setError(requestError.body?.error?.message || requestError.body?.error?.code || requestError.message);
    } finally {
      setLoading(false);
    }
  }

  async function viewIntelligenceReport(reportId) {
    try {
      const result = await apiFetch(`/api/v1/intelligence/${reportId}`);
      setData((current) => ({ ...current, intelligence: result }));
    } catch (requestError) {
      setError(requestError.body?.error?.message || requestError.body?.error?.code || requestError.message);
    }
  }

  async function downloadIntelligencePdf(reportId) {
    try {
      const response = await apiFetchRaw(`/api/v1/intelligence/${reportId}/pdf`);
      if (!response.ok) throw new Error(`PDF export failed (${response.status})`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `intelligence-report-${reportId}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice('Intelligence report PDF downloaded.');
      await load('intelligence');
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function createTenant(event) {
    event.preventDefault();
    await action(() => apiFetch('/api/v1/admin/tenants', { method: 'POST', body: JSON.stringify(tenantForm) }), 'Tenant created.');
    setTenantForm({ name: '', plan_code: 'STARTER' });
    setDrawer(null);
  }

  async function downloadAudit() {
    try {
      const response = await apiFetchRaw('/api/v1/admin/audit/export?limit=20000');
      if (!response.ok) throw new Error(`Export failed (${response.status})`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'audit-export.csv';
      link.click();
      URL.revokeObjectURL(url);
      setNotice('Audit CSV downloaded.');
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  function exportRows(rows, name) {
    const fields = rows.length ? Object.keys(rows[0]) : [];
    const csv = [fields.join(','), ...rows.map((row) => fields.map((field) => `"${String(row[field] ?? '').replaceAll('"', '""')}"`).join(','))].join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    link.download = `${name}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    setNotice(`${name.replaceAll('-', ' ')} exported.`);
  }

  const overview = useMemo(() => {
    const cases = data.cases?.cases || [];
    const tenants = data.tenants?.tenants || [];
    const users = data.users?.users || [];
    const live = data.overview || {};
    const pipeline = Object.fromEntries(PIPELINE_STATES.map(([state]) => [state, live.pipeline?.[state] ?? cases.filter((item) => item.state === state).length]));
    return {
      tenants: live.kpis?.total_tenants ?? tenants.length,
      cases: live.kpis?.active_cases ?? cases.length,
      casesToday: live.kpis?.cases_today ?? cases.filter((item) => new Date(item.created_at).toDateString() === new Date().toDateString()).length,
      users: users.length,
      hits: live.kpis?.sanctions_hits ?? cases.filter((item) => ['BLOCKED', 'REJECTED'].includes(item.state)).length,
      pipeline,
      stuck: data.stuck?.cases?.length || 0,
    };
  }, [data]);

  if (!canAccessDashboard) return <div className="admin-denied">Restricted administrator access required.</div>;

  const tenants = (data.tenants?.tenants || []).filter((tenant) => !tenantQuery || tenant.name.toLowerCase().includes(tenantQuery.toLowerCase()));
  const users = data.users?.users || [];
  const apiClients = users.filter((user) => user.role === 'API_CLIENT');
  const cases = data.cases?.cases || [];
  const listSources = data.lists?.lists || [];

  function renderOverview() {
    const auditEvents = data.audit?.events || [];
    const health = data.health?.health || {};
    return <div className="page-stack">
      <div className="metrics-grid">
        <MetricCard label="Total tenants" value={formatNumber(overview.tenants)} detail="vs. yesterday" delta="+8.2%" icon="building" color="indigo" points={[12, 14, 13, 17, 16, 21, 24]} />
        <MetricCard label="Active cases" value={formatNumber(overview.cases)} detail="across all workspaces" delta="+12.4%" icon="briefcase" color="blue" points={[11, 10, 14, 13, 18, 17, 23]} />
        <MetricCard label="Cases today" value={formatNumber(overview.casesToday)} detail="last 24 hours" delta="live" icon="chart" color="emerald" points={[5, 7, 6, 11, 10, 14, 16]} />
        <MetricCard label="Sanctions hits" value={formatNumber(overview.hits)} detail="requires attention" delta={overview.hits ? '+2.8%' : '0%'} icon="shield" color="rose" points={[3, 4, 4, 7, 5, 8, 9]} />
      </div>
      <section className="dashboard-panel whistleblower-status"><div><div className="section-eyebrow">BAFA ICP Criterion 8</div><h3>Whistleblower channel</h3><p>Confidential public submission form is available for every active organisation.</p></div><Badge tone="success">Active</Badge></section>
      <section className="dashboard-panel pipeline-panel">
        <SectionHeader eyebrow="Live workflow" title="Case pipeline" description="A real-time view of every case moving through the platform." action={<span className="live-indicator"><i /> Live · 30s</span>} />
        <div className="pipeline">{PIPELINE_STATES.map(([state, label, color], index) => <button key={state} className={`pipeline-step ${color}`} onClick={() => { setSection('cases'); setCaseTab('all'); setSearch(state); }}><span className="pipeline-number">{formatNumber(overview.pipeline[state])}</span><span>{label}</span>{index < PIPELINE_STATES.length - 1 && <span className="pipeline-arrow">›</span>}</button>)}</div>
      </section>
      <div className="three-column-grid">
        <section className="dashboard-panel activity-panel"><SectionHeader eyebrow="Audit stream" title="Recent activity" action={<button className="text-button" onClick={() => setSection('audit')}>View all <Icon name="arrow" size={13} /></button>} /><div className="activity-list">{auditEvents.length ? auditEvents.slice(0, 6).map((event, index) => <div className="activity-item" key={event.id || index}><div className="activity-marker"><Icon name={event.event_type?.includes('SCREEN') ? 'shield' : event.event_type?.includes('USER') ? 'users' : 'chart'} size={14} /></div><div className="activity-copy"><strong>{titleCase(event.event_type)}</strong><span>{event.tenant_name || 'Platform'}{event.case_id ? ` · ${String(event.case_id).slice(0, 8)}` : ''}</span></div><time>{formatDate(event.occurred_at, true)}</time></div>) : <EmptyState title="No recent activity" />}</div></section>
        <section className="dashboard-panel health-panel"><SectionHeader eyebrow="Infrastructure" title="System health" action={<button className="icon-button" onClick={() => load('overview')} aria-label="Refresh health"><Icon name="refresh" size={16} /></button>} /><div className="health-list">{[['API Server', health.api, 'settings'], ['Database', health.database, 'building'], ['Matching Service', health.matching_service, 'cpu'], ['Scheduler', health.scheduler, 'chart']].map(([label, status, icon]) => <div className="health-item" key={label}><div className="health-icon"><Icon name={icon} size={15} /></div><div><strong>{label}</strong><span>Checked {formatDate(health.checked_at, true)}</span></div><Badge>{status || 'checking'}</Badge></div>)}</div><div className="health-footer"><span>All systems operational</span><span className="health-uptime"><i />99.98% uptime</span></div></section>
        <section className="dashboard-panel list-panel"><SectionHeader eyebrow="Data freshness" title="Sanctions lists" action={<button className="text-button" onClick={() => setSection('lists')}>Manage <Icon name="arrow" size={13} /></button>} /><div className="list-statuses">{listSources.slice(0, 5).map((source) => <div className="list-status-item" key={source.code}><div className="list-status-copy"><strong>{source.code}</strong><span>{formatNumber(source.entry_count)} records</span></div><div className="list-status-meta"><Badge tone={source.last_error ? 'danger' : 'success'}>{source.last_error ? 'sync error' : 'synced'}</Badge><span>{formatDate(source.last_sync, true)}</span></div></div>)}</div>{!listSources.length && <EmptyState title="No sources configured" />}</section>
      </div>
    </div>;
  }

  function renderTenants() {
    return <div className="page-stack"><div className="toolbar"><div className="toolbar-search"><Icon name="search" size={16} /><input placeholder="Search tenants..." value={tenantQuery} onChange={(event) => setTenantQuery(event.target.value)} /></div><select className="admin-select" value={tenantStatus} onChange={(event) => setTenantStatus(event.target.value)}><option value="ALL">All statuses</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option></select><div className="toolbar-spacer" /><Button icon="download" onClick={() => exportRows(tenants, 'tenants')}>Export</Button><Button variant="primary" icon="plus" onClick={() => setDrawer('new-tenant')}>Add tenant</Button></div><section className="dashboard-panel"><SectionHeader eyebrow="Tenant portfolio" title="All tenants" description={`${tenants.length} workspaces across the platform`} /><DataTable rows={tenants} onRowClick={(row) => { setSelectedTenant(row); setDrawer('tenant'); }} columns={[['name', 'Tenant'], ['plan', 'Plan'], ['user_count', 'Users'], ['case_count', 'Active cases'], ['status', 'Status', (row) => <Badge>{row.status}</Badge>], ['created_at', 'Created', (row) => formatDate(row.created_at, true)], ['id', '']].map(([key, label, render]) => [key, label || '', render || (key === 'status' ? (row) => <Badge>{row.status}</Badge> : key === 'plan' ? (row) => <span className="plan-pill">{row.plan || '—'}</span> : undefined)])} /></section></div>;
  }

  function renderUsers() {
    const rows = userTab === 'api' ? apiClients : users;
    return <div className="page-stack"><div className="toolbar"><div className="toolbar-search wide"><Icon name="search" size={16} /><input placeholder="Search by name, email, or tenant..." value={search} onChange={(event) => setSearch(event.target.value)} /></div><div className="toolbar-spacer" /><Button variant="primary" icon="plus" onClick={() => setDrawer('invite-user')}>Invite user</Button></div><section className="dashboard-panel"><Tabs items={[['users', 'All users'], ['sessions', 'Active sessions'], ['api', 'API clients']]} active={userTab} onChange={setUserTab} />{userTab === 'sessions' ? <DataTable rows={data.sessions?.sessions || []} columns={[['email', 'User'], ['tenant_name', 'Tenant'], ['created_at', 'Started', (row) => formatDate(row.created_at, true)], ['expires_at', 'Expires', (row) => formatDate(row.expires_at, true)], ['id', 'Action', (row) => <button className="row-action danger" onClick={(event) => { event.stopPropagation(); action(() => apiFetch(`/api/v1/admin/users/${row.user_id}/force-logout`, { method: 'POST' }), 'Session revoked.'); }}>Force logout</button>]]} /> : <DataTable rows={rows.filter((row) => !search || `${row.email} ${row.tenant_name} ${row.role}`.toLowerCase().includes(search.toLowerCase()))} columns={userTab === 'api' ? [['email', 'Client'], ['tenant_name', 'Tenant'], ['email', 'Key preview', (row) => <code>ecp_••••{String(row.email || '').slice(-4)}</code>], ['created_at', 'Created', (row) => formatDate(row.created_at, true)], ['status', 'Status', (row) => <Badge>{row.status}</Badge>], ['id', 'Action', (row) => <button className="row-action" onClick={(event) => { event.stopPropagation(); action(async () => { const result = await apiFetch(`/api/v1/admin/api-clients/${row.id}/rotate`, { method: 'POST' }); setNotice(`New key: ${result.api_key}`); }, 'API key rotated. Copy it from the notice.'); }}>Rotate key</button>]] : [['email', 'User', (row) => <div className="user-cell"><span className="avatar small">{initials(row.email)}</span><span><strong>{row.email}</strong><small>{row.tenant_name || 'Platform'}</small></span></div>], ['role', 'Role', (row) => <span className={`role-pill ${String(row.role).toLowerCase()}`}>{titleCase(row.role)}</span>], ['status', 'Status', (row) => <Badge>{row.status}</Badge>], ['credentials_active', 'Credentials', (row) => <Badge tone={row.credentials_active ? 'success' : 'warning'}>{row.credentials_active ? 'ready' : 'not set'}</Badge>], ['created_at', 'Joined', (row) => formatDate(row.created_at, true)], ['id', 'Actions', (row) => <div className="row-actions"><button className="row-action" onClick={(event) => { event.stopPropagation(); action(() => apiFetch(`/api/v1/admin/users/${row.id}/force-logout`, { method: 'POST' }), 'All sessions revoked.'); }}>Force logout</button></div>]]} />}</section></div>;
  }

  function renderCases() {
    const rows = cases.filter((row) => !search || `${row.case_ref} ${row.tenant_name} ${row.state} ${row.end_user || ''} ${row.party_names || ''}`.toLowerCase().includes(search.toLowerCase()));
    return <div className="page-stack"><div className="toolbar"><div className="toolbar-search wide"><Icon name="search" size={16} /><input placeholder="Search case ID, party, or tenant..." value={search} onChange={(event) => setSearch(event.target.value)} /></div><Button icon="filter">Filters <span className="button-count">0</span></Button><div className="toolbar-spacer" /><Button icon="download" onClick={() => exportRows(rows, 'case-oversight')}>Export</Button></div><section className="dashboard-panel"><Tabs items={CASE_TABS.map(([id, label]) => [id, label])} active={caseTab} onChange={(next) => { setCaseTab(next); setSearch(''); }} /><div className="context-banner"><Icon name={caseTab === 'sanctions-blocks' ? 'shield' : 'briefcase'} size={16} /><span>{caseTab === 'stuck' ? 'Cases exceeding their workflow threshold require immediate attention.' : caseTab === 'sanctions-blocks' ? 'Confirmed sanctions matches are permanently blocked and read-only.' : 'Cross-tenant oversight of the active compliance queue.'}</span></div><DataTable rows={rows.map((row) => ({ ...row, age: row.created_at ? `${Math.max(0, Math.round((Date.now() - new Date(row.created_at).getTime()) / 36e5))}h` : '—' }))} onRowClick={(row) => { setSelectedCase(row); setDrawer('case'); }} columns={[['case_ref', 'Case ID', (row) => <strong className="mono-link">{row.case_ref}</strong>], ['tenant_name', 'Tenant'], ['end_user', 'Party'], ['destination_country', 'Destination'], ['state', 'Status', (row) => <Badge>{row.state}</Badge>], ['overall_risk', 'Risk', (row) => <Badge>{row.overall_risk || '—'}</Badge>], ['age', 'Age', (row) => <span className={Number.parseInt(row.age) > 48 ? 'age danger' : 'age'}>{row.age}</span>], ['created_at', 'Created', (row) => formatDate(row.created_at, true)]]} /></section></div>;
  }

  function renderLists() {
    return <div className="page-stack"><div className="source-grid">{listSources.map((source) => <article className="source-card" key={source.code} onClick={() => { setSelectedList(source); setDrawer('list'); }}><div className="source-card-head"><div className="source-mark"><Icon name="shield" size={17} /></div><Badge tone={source.last_error ? 'danger' : 'success'}>{source.last_error ? 'error' : 'healthy'}</Badge></div><strong>{source.code}</strong><span>{source.authority || source.name || 'Sanctions source'}</span><div className="source-stat"><b>{formatNumber(source.entry_count)}</b><small>records</small></div><div className="source-footer"><span>Last sync {formatDate(source.last_sync, true)}</span><button className="text-button" onClick={(event) => { event.stopPropagation(); action(() => apiFetch(`/api/v1/admin/lists/${source.code}/sync`, { method: 'POST' }), 'List sync started.'); }}>Sync now</button></div></article>)}</div><section className="dashboard-panel"><SectionHeader eyebrow="Embargo programs" title="Country programs" action={<Button icon="download" onClick={() => exportRows(data.embargoes?.embargoes || [], 'embargo-programs')}>Export</Button>} /><DataTable rows={data.embargoes?.embargoes || []} columns={[['code', 'Program'], ['authority', 'Authority'], ['name', 'Name'], ['effective_from', 'Effective date', (row) => formatDate(row.effective_from, true)], ['country_count', 'Countries'], ['id', 'Action', (row) => <button className="row-action" onClick={() => { const date = window.prompt('Effective date (YYYY-MM-DD)', row.effective_from?.slice?.(0, 10)); if (date) action(() => apiFetch(`/api/v1/admin/embargoes/${row.code}`, { method: 'PATCH', body: JSON.stringify({ effective_from: date }) }), 'Embargo program updated.'); }}>Edit date</button>]]} /></section></div>;
  }

   function renderAgents() {
    const agents = data.agents?.agents || [];
    const stats = data.agentStats?.stats || [];
     return <div className="page-stack"><div className="split-layout"><section className="dashboard-panel agent-list"><SectionHeader eyebrow="Classification stack" title="Agents" /><div className="agent-items">{agents.map((agent) => <button key={agent.code} className={`agent-item ${selectedAgent?.code === agent.code ? 'active' : ''}`} onClick={() => setSelectedAgent(agent)}><span className="agent-symbol"><Icon name={agent.is_deterministic ? 'scale' : 'cpu'} size={16} /></span><span><strong>{agent.name || agent.code}</strong><small>{agent.is_deterministic ? 'Deterministic' : agent.model_id || 'AI agent'}</small></span><Badge tone={agent.is_active ? 'success' : 'neutral'}>{agent.is_active ? 'active' : 'inactive'}</Badge></button>)}</div>{!agents.length && <EmptyState title="No agents configured" />}</section><section className="dashboard-panel"><SectionHeader eyebrow="Selected agent" title={selectedAgent?.name || 'Select an agent'} action={selectedAgent && <Button icon="plus" variant="primary" onClick={() => setDrawer('new-version')}>Publish version</Button>} />{selectedAgent ? <><div className="agent-summary"><div><span>Active version</span><strong>{selectedAgent.active_version || 'None published'}</strong></div><div><span>Mode</span><strong>{selectedAgent.is_deterministic ? 'Deterministic' : 'AI-assisted'}</strong></div><div><span>Execution order</span><strong>{selectedAgent.execution_order ?? '—'}</strong></div></div><DataTable rows={stats.filter((stat) => stat.agent_code === selectedAgent.code)} columns={[['version_label', 'Version'], ['status', 'Status', (row) => <Badge>{row.status}</Badge>], ['total_runs', 'Runs'], ['insufficient_rate', 'Insufficient info', (row) => <div className="bar-value"><span>{row.insufficient_rate || 0}%</span><i><b style={{ width: `${Math.min(Number(row.insufficient_rate) || 0, 100)}%` }} /></i></div>], ['id', 'Action', (row) => row.status === 'DRAFT' ? <button className="row-action" onClick={() => action(() => apiFetch(`/api/v1/admin/agents/${selectedAgent.code}/activate`, { method: 'PATCH', body: JSON.stringify({ version_id: row.id }) }), 'Agent version activated.')}>Activate</button> : row.status === 'PUBLISHED' ? <button className="row-action danger" onClick={() => { if (window.confirm('Retire this published agent version? This cannot be undone.')) action(() => apiFetch(`/api/v1/admin/agents/${selectedAgent.code}/retire`, { method: 'PATCH', body: JSON.stringify({ version_id: row.id }) }), 'Agent version retired.'); }}>Retire</button> : null]]} /></> : <EmptyState title="Choose an agent" description="Select an agent to inspect versions and quality signals." />}</section></div></div>;
  }

  function renderLicence() {
    const stats = data.licenceStats?.stats || [];
    return <div className="page-stack"><div className="donut-grid">{['MET', 'UNMET', 'UNVERIFIABLE'].map((status) => { const value = stats.find((item) => item.status === status)?.count || 0; const total = stats.reduce((sum, item) => sum + Number(item.count || 0), 0) || 1; return <div className="donut-card" key={status}><div className={`donut ${status.toLowerCase()}`} style={{ '--donut-value': `${(Number(value) / total) * 100}%` }}><strong>{Math.round((Number(value) / total) * 100)}%</strong></div><div><span>{titleCase(status)}</span><b>{formatNumber(value)} evaluations</b></div></div>; })}</div><section className="dashboard-panel"><SectionHeader eyebrow="Licence engine" title="Exceptions & conditions" description="Manage the rules that determine licence outcomes." action={<Button variant="primary" icon="plus" onClick={() => setDrawer('new-exception')}>Add exception</Button>} /><DataTable rows={data.exceptions?.exceptions || []} onRowClick={(row) => { setSelectedException(row); setDrawer('exception'); }} columns={[['code', 'Code', (row) => <strong className="mono-link">{row.code}</strong>], ['regime', 'Regime'], ['name', 'Description'], ['conditions', 'Conditions', (row) => <span className="number-chip">{row.conditions?.length || 0}</span>], ['status', 'Status', (row) => <Badge>{row.status || 'active'}</Badge>], ['effective_from', 'Effective', (row) => formatDate(row.effective_from, true)]]} /></section></div>;
  }

  function renderProductEccn() {
    return <ProductECCN />;
  }

  async function addRule(event) {
    event.preventDefault();
    await action(() => apiFetch('/api/v1/admin/red-flag-rules', { method: 'POST', body: JSON.stringify(ruleForm) }), 'Red flag rule added.');
    setRuleForm({ value_code: '', label_key: '' });
  }

  function renderRules() {
    return <div className="page-stack"><div className="split-layout rules-layout"><section className="dashboard-panel"><SectionHeader eyebrow="Platform controls" title="Thresholds" description="Global defaults applied when tenants do not override them." /><DataTable rows={data.thresholds?.thresholds || []} columns={[['code', 'Rule'], ['label_key', 'Description'], ['platform_default', 'Current value', (row) => <button className="inline-edit" onClick={() => { const value = window.prompt('New platform default', row.platform_default); if (value !== null) action(() => apiFetch(`/api/v1/admin/thresholds/${row.code}`, { method: 'PATCH', body: JSON.stringify({ value }) }), 'Threshold updated.'); }}>{row.platform_default}</button>], ['tenant_override_count', 'Overrides'], ['updated_at', 'Last changed', (row) => formatDate(row.updated_at, true)]]} /></section><section className="dashboard-panel"><SectionHeader eyebrow="Detection catalog" title="Red flag rules" action={<span className="live-indicator"><i /> Active rules</span>} /><form className="inline-form" onSubmit={addRule}><input className="admin-input" required placeholder="RULE_CODE" value={ruleForm.value_code} onChange={(event) => setRuleForm({ ...ruleForm, value_code: event.target.value })} /><input className="admin-input" required placeholder="Label key" value={ruleForm.label_key} onChange={(event) => setRuleForm({ ...ruleForm, label_key: event.target.value })} /><Button variant="primary" type="submit" icon="plus">Add</Button></form><DataTable rows={data.rules?.rules || []} columns={[['value_code', 'Rule'], ['label_key', 'Description'], ['is_active', 'Status', (row) => <button className="toggle" aria-label={`Toggle ${row.value_code}`} onClick={() => action(() => apiFetch(`/api/v1/admin/red-flag-rules/${row.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: !row.is_active }) }), 'Rule status updated.')}><i className={row.is_active ? 'on' : ''} /></button>], ['metadata', 'Triggered', (row) => row.metadata?.triggered_count || 0]]} /></section></div></div>;
  }

  function renderAudit() {
    const result = data[reportTab] || {};
    const rows = reportTab === 'log' ? result.events || [] : reportTab === 'outcomes' ? result.outcomes || [] : reportTab === 'sanctions' ? result.hits || [] : reportTab === 'workflow' ? result.workflow_time || [] : result.tenants || [];
    if (reportTab === 'outcomes') {
      const total = rows.reduce((sum, row) => sum + Number(row.count || 0), 0) || 1;
      return <div className="page-stack"><Tabs items={REPORT_TABS.map(([id, label]) => [id, label])} active={reportTab} onChange={setReportTab} /><div className="report-metrics">{[['Approved', 'APPROVED', 'emerald'], ['Rejected', 'REJECTED', 'rose'], ['Referred', 'REFERRED', 'amber']].map(([label, key, color]) => { const value = rows.find((row) => row.outcome === key)?.count || 0; return <div className="report-metric" key={key}><span>{label}</span><strong>{formatNumber(value)}</strong><small>{Math.round((value / total) * 100)}% of all outcomes</small><div className={`progress ${color}`}><i style={{ width: `${(value / total) * 100}%` }} /></div></div>; })}</div><section className="dashboard-panel"><SectionHeader eyebrow="Outcome distribution" title="All outcomes" action={<Button icon="download" onClick={downloadAudit}>Export report</Button>} /><DataTable rows={rows} columns={[['outcome', 'Outcome', (row) => <Badge>{row.outcome}</Badge>], ['count', 'Cases'], ['percentage', 'Share', (row) => `${Math.round((row.count / total) * 100)}%`]]} /></section></div>;
    }
    return <div className="page-stack"><div className="toolbar"><div className="toolbar-spacer" /><Button icon="download" onClick={downloadAudit}>Export CSV</Button></div><section className="dashboard-panel"><Tabs items={REPORT_TABS.map(([id, label]) => [id, label])} active={reportTab} onChange={setReportTab} />{reportTab === 'log' && <div className="context-banner"><Icon name="shield" size={16} /><span>Append-only audit records. Platform events are read-only and cannot be edited.</span></div>}<DataTable rows={rows} columns={reportTab === 'log' ? [['occurred_at', 'Timestamp', (row) => formatDate(row.occurred_at, true)], ['event_type', 'Event type', (row) => <span className="event-type">{titleCase(row.event_type)}</span>], ['tenant_name', 'Tenant'], ['case_id', 'Case', (row) => row.case_id ? String(row.case_id).slice(0, 8) : '—'], ['actor_type', 'Actor'], ['rationale', 'Description']] : reportTab === 'sanctions' ? [['source_code', 'List source'], ['screened', 'Screened'], ['hits', 'Hits'], ['hit_rate', 'Hit rate', (row) => `${row.screened ? Math.round((row.hits / row.screened) * 100) : 0}%`]] : reportTab === 'workflow' ? [['stage', 'Workflow stage', (row) => titleCase(row.stage)], ['average_hours', 'Average hours'], ['cases', 'Cases']] : [['name', 'Tenant'], ['cases', 'Cases'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['referred', 'Referred']]} /></section></div>;
  }

  function renderSystem() {
    const system = data[systemTab] || {};
    return <div className="page-stack"><Tabs items={SYSTEM_TABS} active={systemTab} onChange={setSystemTab} />{systemTab === 'health' && <div className="system-health-grid">{[['API Server', system.health?.api, 'settings'], ['Database', system.health?.database, 'building'], ['Matching Service', system.health?.matching_service, 'cpu'], ['Scheduler', system.health?.scheduler, 'chart']].map(([label, status, icon]) => <div className="system-card" key={label}><div className="system-card-head"><div className="metric-icon indigo"><Icon name={icon} size={18} /></div><Badge>{status || 'checking'}</Badge></div><strong>{label}</strong><span>Last checked {formatDate(system.health?.checked_at, true)}</span><div className="system-card-foot"><span>Uptime</span><b>99.98%</b></div></div>)}</div>}{systemTab === 'scheduler' && <section className="dashboard-panel"><SectionHeader eyebrow="Automation" title="Scheduled jobs" description="Manage recurring ingestion and platform jobs." /><DataTable rows={system.jobs || []} columns={[['code', 'Job'], ['sync_cron', 'Schedule'], ['last_run', 'Last run', (row) => formatDate(row.last_run, true)], ['last_status', 'Status', (row) => <Badge>{row.last_status || 'pending'}</Badge>], ['id', 'Action', (row) => <button className="row-action" onClick={() => action(() => apiFetch(`/api/v1/admin/system/scheduler/${row.code}/run`, { method: 'POST' }), 'Job started.')}><Icon name="arrow" size={13} /> Run now</button>]]} /></section>}{systemTab === 'errors' && <section className="dashboard-panel"><SectionHeader eyebrow="Observability" title="Error log" description="Recent system failures and degraded operations." /><DataTable rows={system.errors || []} columns={[['occurred_at', 'Timestamp', (row) => formatDate(row.occurred_at, true)], ['type', 'Service'], ['message', 'Error message'], ['detail', 'Details']]} /></section>}{systemTab === 'smtp' && <section className="dashboard-panel narrow-panel"><SectionHeader eyebrow="Outbound email" title="SMTP test" description="Send a test notification to the signed-in platform administrator." /><Button variant="primary" icon="external" onClick={() => action(() => apiFetch('/api/v1/admin/system/smtp/test', { method: 'POST', body: JSON.stringify({ email: session.user.email }) }), 'SMTP test completed.')}>Send test email</Button></section>}</div>;
  }

  function renderNotifications() {
    return <div className="page-stack"><section className="dashboard-panel"><SectionHeader eyebrow="Message routing" title="Notification rules" description="Events, recipients, and delivery channels configured for the platform." /><DataTable rows={data.notificationRules?.rules || []} columns={[['event_code', 'Event'], ['recipient_rule', 'Recipients'], ['channels', 'Channels', (row) => Array.isArray(row.channels) ? row.channels.join(', ') : row.channels], ['template_key', 'Template'], ['is_urgent', 'Priority', (row) => row.is_urgent ? <Badge tone="warning">Urgent</Badge> : <span className="muted-text">Normal</span>], ['is_active', 'Status', (row) => <Badge>{row.is_active ? 'active' : 'inactive'}</Badge>]]} /></section><section className="dashboard-panel"><SectionHeader eyebrow="Delivery telemetry" title="Recent deliveries" /><DataTable rows={data.deliveries?.deliveries || []} columns={[['created_at', 'Timestamp', (row) => formatDate(row.created_at, true)], ['event_code', 'Event'], ['channel', 'Channel'], ['recipient', 'Recipient'], ['status', 'Status', (row) => <Badge>{row.status}</Badge>]]} /></section></div>;
  }

  function renderIntelligence() {
    const report = data.intelligence?.report;
    const body = report?.report_json || {};
    const history = data.intelligenceHistory?.reports || [];
    const generatedAt = report?.generated_at ? new Date(report.generated_at) : null;
    const cooldown = generatedAt && Date.now() - generatedAt.getTime() < 6 * 60 * 60 * 1000;
    const riskTone = body.risk_trend === 'IMPROVING' ? 'success' : body.risk_trend === 'DETERIORATING' ? 'danger' : 'neutral';
    const riskIcon = body.risk_trend === 'IMPROVING' ? '↑' : body.risk_trend === 'DETERIORATING' ? '↓' : '—';
    return <div className="page-stack intelligence-page">
      <section className="dashboard-panel">
         <SectionHeader eyebrow="AI decision support" title="BAFA Compliance Intelligence Report" description="AI-generated portfolio analysis. Updated on demand." action={<div className="intelligence-actions"><Button variant="primary" icon="chart" onClick={generateIntelligence} disabled={loading || cooldown}>{loading ? 'Generating intelligence report...' : 'Generate new report'}</Button>{report && <Button icon="download" onClick={() => downloadIntelligencePdf(report.id)}>Export as PDF</Button>}</div>} />
        {cooldown && <p className="intelligence-cooldown">Generation is available again after {new Date(generatedAt.getTime() + 6 * 60 * 60 * 1000).toLocaleString()}.</p>}
        {!report ? <EmptyState title="No intelligence report yet" description="Generate a 90-day portfolio analysis for the CECO." /> : <div className="intelligence-report">
          <div className="intelligence-meta">
            <div className={`risk-trend ${riskTone}`}><span className="risk-trend-icon">{riskIcon}</span><div><small>Risk trend</small><strong>{body.risk_trend || '—'}</strong></div></div>
            <div><small>Period covered</small><strong>Last 90 days</strong><span>{body.period_start} → {body.period_end}</span></div>
            <div><small>Generated</small><strong>{formatDate(report.generated_at, true)}</strong><span>by {report.generated_by_name || 'Compliance Administrator'}</span></div>
            <Badge tone="indigo">AI-generated</Badge>
          </div>
          <div className="intelligence-section"><h3>Executive summary</h3><div className="intelligence-prose">{String(body.executive_summary || '').split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div></div>
          <div className="intelligence-section"><h3>Top recommendations</h3><div className="recommendation-grid">{(body.top_recommendations || []).map((recommendation) => <article className="recommendation-card" key={recommendation.priority}><span className="recommendation-priority">{recommendation.priority}</span><div><strong>{recommendation.action}</strong><Badge tone="indigo">{recommendation.responsible_role}</Badge><p>{recommendation.rationale}</p></div></article>)}</div></div>
          <div className="intelligence-section"><h3>ICP commentary</h3><p className="intelligence-prose">{body.icp_commentary}</p></div>
          <p className="intelligence-disclaimer">{body.executive_summary?.includes('Decision-support disclaimer:') ? body.executive_summary.slice(body.executive_summary.indexOf('Decision-support disclaimer:')) : 'Decision-support disclaimer: This report is AI-generated decision support. The CECO and Compliance Officer are solely responsible for all compliance decisions and regulatory submissions.'}</p>
        </div>}
      </section>
      <section className="dashboard-panel">
        <button className="history-toggle" onClick={() => setIntelligenceHistoryOpen((value) => !value)}><span>Previous reports ({history.length})</span><span>{intelligenceHistoryOpen ? '⌃' : '⌄'}</span></button>
        {intelligenceHistoryOpen && <div className="intelligence-history">{history.map((item) => <div className="history-row" key={item.id}><span>{formatDate(item.generated_at, true)}</span><Badge tone={item.risk_trend === 'DETERIORATING' ? 'danger' : item.risk_trend === 'IMPROVING' ? 'success' : 'neutral'}>{item.risk_trend}</Badge><Button onClick={() => viewIntelligenceReport(item.id)}>View</Button></div>)}</div>}
      </section>
    </div>;
  }

  const renderers = { overview: renderOverview, tenants: renderTenants, users: renderUsers, cases: renderCases, lists: renderLists, agents: renderAgents, licence: renderLicence, 'product-eccn': renderProductEccn, rules: renderRules, audit: renderAudit, system: renderSystem, notifications: renderNotifications, intelligence: renderIntelligence, data: () => <DataManagement />, 'uae-list': () => <UaeControlList /> };
  const currentNav = NAV.find((item) => item.id === section) || NAV[0];
  const groupedNav = ['Monitor', 'Manage', 'Configure', 'Govern'];
  const visibleNav = isComplianceAdmin ? NAV.filter((item) => item.id === 'intelligence') : NAV;
  function goToSection(nextSection) {
    setSection(nextSection);
    setSearch('');
    navigate(`/admin/dashboard/${nextSection === 'product-eccn' ? 'products' : nextSection}`);
  }

  return <div className={`admin-dashboard ${collapsed ? 'sidebar-collapsed' : ''}`}>
    <aside className="admin-sidebar">
      <div className="brand-lockup"><div className="brand-mark"><span /></div><div className="brand-copy"><strong>Aegis</strong><small>Compliance OS</small></div><button className="sidebar-toggle" onClick={() => setCollapsed((value) => !value)} aria-label="Toggle sidebar"><Icon name="menu" size={17} /></button></div>
      <div className="workspace-switcher"><span className="workspace-avatar">{initials(session.user.email)}</span><span><strong>{isComplianceAdmin ? 'Tenant workspace' : 'Platform workspace'}</strong><small>{isComplianceAdmin ? 'Compliance intelligence' : 'Global operations'}</small></span><Icon name="more" size={16} /></div>
      <nav className="admin-nav" aria-label="Platform navigation">{groupedNav.map((group) => { const items = visibleNav.filter((item) => item.group === group); return items.length ? <div className="nav-group" key={group}><button className="group-toggle" onClick={() => setOpenGroups((current) => ({ ...current, [group]: !current[group] }))} aria-expanded={openGroups[group]}><span className="nav-group-label">{group}</span><Icon name="arrow" size={13} /></button>{openGroups[group] && <div className="nav-children">{items.map((item) => <button key={item.id} className={`admin-nav-item ${section === item.id ? 'active' : ''}`} onClick={() => goToSection(item.id)} title={item.label}><Icon name={item.icon} size={17} /><span>{item.label}</span>{item.badge === 'stuck' && overview.stuck > 0 && <b className="nav-badge amber">{overview.stuck}</b>}{item.badge === 'health' && data.health?.health?.api !== 'healthy' && <b className="nav-badge red">!</b>}</button>)}</div>}</div> : null; })}</nav>
      <div className="sidebar-bottom"><div className="sidebar-user"><span className="avatar">{initials(session.user.email)}</span><span><strong>{session.user.email?.split('@')[0]}</strong><small>{isComplianceAdmin ? 'Compliance administrator' : 'Super administrator'}</small></span><button className="icon-button" onClick={onSignOut} aria-label="Sign out"><Icon name="external" size={15} /></button></div></div>
    </aside>
    <main className="admin-main">
      <header className="admin-topbar"><div className="breadcrumb"><span>Platform</span><Icon name="arrow" size={12} /><strong>{currentNav.label}</strong></div><div className="topbar-actions"><button className="global-search" onClick={() => setCommandOpen(true)}><Icon name="search" size={16} /><span>Search anything...</span><kbd>Ctrl K</kbd></button><button className="icon-button topbar-icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme"><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} /></button><button className="notification-button" onClick={() => goToSection('notifications')} aria-label="Notifications"><Icon name="bell" size={17} /><i /></button><div className="profile-wrap"><button className="profile-button" onClick={() => setProfileOpen((value) => !value)}><span className="avatar">{initials(session.user.email)}</span><span className="profile-name">{session.user.email?.split('@')[0]}</span><Icon name="more" size={16} /></button>{profileOpen && <div className="profile-menu"><strong>{session.user.email}</strong><span>Platform administrator</span><button onClick={onSignOut}>Sign out <Icon name="arrow" size={13} /></button></div>}</div></div></header>
      <div className="admin-content"><div className="content-heading"><div><div className="section-eyebrow">Control center</div><h1>{currentNav.label}</h1><p>{section === 'overview' ? 'See the pulse of your global compliance operation.' : `Manage ${currentNav.label.toLowerCase()} across every tenant.`}</p></div><div className="heading-actions"><span className="last-updated"><i className={loading ? 'spinning' : ''} /><span>{loading ? 'Updating' : 'Updated just now'}</span></span><Button icon="refresh" onClick={() => load(section)} disabled={loading}>Refresh</Button></div></div>{error && <div className="admin-alert danger"><Icon name="shield" size={17} /><span>{error}</span><button onClick={() => setError('')}><Icon name="close" size={14} /></button></div>}{notice && <div className="admin-alert success"><Icon name="check" size={17} /><span>{notice}</span><button onClick={() => setNotice('')}><Icon name="close" size={14} /></button></div>}{renderers[section]()}</div>
    </main>
    {commandOpen && <div className="command-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setCommandOpen(false)}><div className="command-palette"><div className="command-input"><Icon name="search" size={17} /><input autoFocus placeholder="Jump to a page..." onChange={(event) => setSearch(event.target.value)} /><kbd>ESC</kbd></div><div className="command-results">{NAV.filter((item) => !search || item.label.toLowerCase().includes(search.toLowerCase())).map((item) => <button key={item.id} onClick={() => { goToSection(item.id); setCommandOpen(false); }}><Icon name={item.icon} size={16} /><span>{item.label}</span><Icon name="arrow" size={14} /></button>)}</div></div></div>}
    {drawer === 'new-tenant' && <Drawer eyebrow="Tenant management" title="Add a new tenant" onClose={() => setDrawer(null)}><form className="drawer-form" onSubmit={createTenant}><Field label="Tenant name"><input className="admin-input" required placeholder="e.g. Gulf Trade Solutions" value={tenantForm.name} onChange={(event) => setTenantForm({ ...tenantForm, name: event.target.value })} /></Field><Field label="Subscription plan"><select className="admin-select full" value={tenantForm.plan_code} onChange={(event) => setTenantForm({ ...tenantForm, plan_code: event.target.value })}><option>STARTER</option><option>PROFESSIONAL</option><option>ENTERPRISE</option></select></Field><div className="drawer-actions"><Button onClick={() => setDrawer(null)}>Cancel</Button><Button type="submit" variant="primary">Create tenant</Button></div></form></Drawer>}
    {drawer === 'invite-user' && <Drawer eyebrow="Users & access" title="Invite a user" onClose={() => setDrawer(null)}><div className="drawer-empty"><div className="empty-mark"><Icon name="users" size={20} /></div><strong>Tenant invitations</strong><span>Invite and role management is available from each tenant's workspace. Platform-wide user visibility is read-only here.</span><Button onClick={() => { setDrawer(null); setSection('tenants'); }}>Go to tenants</Button></div></Drawer>}
    {drawer === 'tenant' && selectedTenant && <Drawer eyebrow="Tenant workspace" title={selectedTenant.name} onClose={() => setDrawer(null)} wide><div className="drawer-stat-grid"><div><span>Plan</span><strong>{selectedTenant.plan || '—'}</strong></div><div><span>Status</span><Badge>{selectedTenant.status}</Badge></div><div><span>Users</span><strong>{selectedTenant.user_count}</strong></div><div><span>Cases</span><strong>{selectedTenant.case_count}</strong></div></div><div className="drawer-section"><h3>Workspace controls</h3><p>Update the tenant's commercial status or subscription plan.</p><div className="drawer-form"><Field label="Tenant name"><input className="admin-input" defaultValue={selectedTenant.name} onBlur={(event) => event.target.value !== selectedTenant.name && action(() => apiFetch(`/api/v1/admin/tenants/${selectedTenant.id}`, { method: 'PATCH', body: JSON.stringify({ name: event.target.value }) }), 'Tenant name updated.')} /></Field><Field label="Subscription plan"><select className="admin-select full" defaultValue={selectedTenant.plan} onChange={(event) => action(() => apiFetch(`/api/v1/admin/tenants/${selectedTenant.id}`, { method: 'PATCH', body: JSON.stringify({ plan_code: event.target.value }) }), 'Subscription plan updated.')}><option>STARTER</option><option>PROFESSIONAL</option><option>ENTERPRISE</option></select></Field><Field label="Workspace status"><select className="admin-select full" defaultValue={selectedTenant.status} onChange={(event) => action(() => apiFetch(`/api/v1/admin/tenants/${selectedTenant.id}`, { method: 'PATCH', body: JSON.stringify({ status: event.target.value }) }), 'Tenant status updated.')}><option>ACTIVE</option><option>SUSPENDED</option></select></Field></div></div><div className="drawer-section"><h3>Usage this month</h3><div className="usage-row"><span>Cases processed</span><b>{selectedTenant.case_count || 0}</b></div><div className="usage-row"><span>API calls</span><b>—</b></div><div className="usage-row"><span>Users</span><b>{selectedTenant.user_count || 0}</b></div></div></Drawer>}
    {drawer === 'case' && selectedCase && <Drawer eyebrow="Case oversight" title={selectedCase.case_ref} onClose={() => setDrawer(null)}><div className="case-drawer-status"><Badge>{selectedCase.state}</Badge><span>Created {formatDate(selectedCase.created_at, true)}</span></div><div className="detail-grid">{[['Tenant', selectedCase.tenant_name], ['Party', selectedCase.end_user], ['Destination', selectedCase.destination_country], ['Risk', selectedCase.overall_risk], ['Rule', selectedCase.fired_rule_code], ['Case ID', selectedCase.id]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value || '—'}</strong></div>)}</div><div className="drawer-section"><h3>Access policy</h3><p>Platform administrators can inspect all case evidence. Confirmed sanctions matches remain permanently blocked and cannot be overridden.</p></div></Drawer>}
    {drawer === 'list' && selectedList && <Drawer eyebrow="Sanctions source" title={selectedList.code} onClose={() => setDrawer(null)}><div className="source-drawer-head"><div className="source-mark large"><Icon name="shield" size={22} /></div><div><Badge tone={selectedList.last_error ? 'danger' : 'success'}>{selectedList.last_error ? 'sync error' : 'healthy'}</Badge><p>{selectedList.authority || selectedList.name}</p></div></div><div className="drawer-stat-grid"><div><span>Records</span><strong>{formatNumber(selectedList.entry_count)}</strong></div><div><span>Last sync</span><strong>{formatDate(selectedList.last_sync, true)}</strong></div><div><span>Next sync</span><strong>{selectedList.sync_cron || '—'}</strong></div></div><div className="drawer-section"><h3>Recent diff</h3><div className="diff-row added"><span>Added entries</span><b>+{selectedList.added_count || 0}</b></div><div className="diff-row removed"><span>Removed entries</span><b>-{selectedList.removed_count || 0}</b></div><div className="diff-row"><span>Changed entries</span><b>{selectedList.changed_count || 0}</b></div></div><Button variant="primary" icon="refresh" onClick={() => action(() => apiFetch(`/api/v1/admin/lists/${selectedList.code}/sync`, { method: 'POST' }), 'List sync started.')}>Sync now</Button></Drawer>}
    {drawer === 'new-version' && selectedAgent && <Drawer eyebrow="Agent configuration" title={`Publish ${selectedAgent.name || selectedAgent.code}`} onClose={() => setDrawer(null)}><form className="drawer-form" onSubmit={async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); await action(() => apiFetch(`/api/v1/admin/agents/${selectedAgent.code}/versions`, { method: 'POST', body: JSON.stringify({ version_label: form.get('version_label'), model_id: form.get('model_id'), system_prompt: form.get('system_prompt') }) }), 'Draft version created.'); setDrawer(null); }}><Field label="Version label"><input className="admin-input" name="version_label" required placeholder="v1.2.0" /></Field><Field label="Model"><input className="admin-input" name="model_id" defaultValue="claude-sonnet-4-6" /></Field><Field label="System prompt"><textarea className="admin-input code-input" name="system_prompt" required rows="12" placeholder="Write the classification system prompt..." /></Field><div className="drawer-actions"><Button onClick={() => setDrawer(null)}>Cancel</Button><Button variant="primary" type="submit">Create draft</Button></div></form></Drawer>}
    {drawer === 'new-exception' && <Drawer eyebrow="Licence configuration" title="Add licence exception" onClose={() => setDrawer(null)}><form className="drawer-form" onSubmit={async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); await action(() => apiFetch('/api/v1/admin/licence-exceptions', { method: 'POST', body: JSON.stringify({ code: form.get('code'), regime: form.get('regime'), name: form.get('name'), full_text: form.get('full_text') }) }), 'Licence exception created.'); setDrawer(null); }}><Field label="Exception code"><input className="admin-input" name="code" required placeholder="e.g. EAR-740.17" /></Field><Field label="Regime"><select className="admin-select full" name="regime"><option>EAR</option><option>ITAR</option><option>OFAC</option></select></Field><Field label="Name"><input className="admin-input" name="name" required placeholder="Exception name" /></Field><Field label="Full text"><textarea className="admin-input code-input" name="full_text" required rows="10" placeholder="Regulatory text and applicability..." /></Field><div className="drawer-actions"><Button onClick={() => setDrawer(null)}>Cancel</Button><Button variant="primary" type="submit">Create exception</Button></div></form></Drawer>}
    {drawer === 'exception' && selectedException && <Drawer eyebrow="Licence exception" title={selectedException.code} onClose={() => setDrawer(null)} wide><div className="drawer-stat-grid"><div><span>Regime</span><strong>{selectedException.regime}</strong></div><div><span>Status</span><Badge>{selectedException.status || 'active'}</Badge></div><div><span>Conditions</span><strong>{selectedException.conditions?.length || 0}</strong></div><div><span>Effective</span><strong>{formatDate(selectedException.effective_from, true)}</strong></div></div><div className="drawer-section"><h3>{selectedException.name}</h3><p>{selectedException.full_text || 'No full regulatory text has been entered.'}</p></div><div className="drawer-section"><h3>Conditions</h3>{selectedException.conditions?.length ? selectedException.conditions.map((condition) => <div className="usage-row" key={condition.id}><span>{condition.sequence}. {condition.condition_text}</span><Badge tone={condition.is_verifiable_automatically ? 'success' : 'warning'}>{condition.is_verifiable_automatically ? 'automatic' : 'manual'}</Badge></div>) : <EmptyState title="No conditions configured" description="This exception does not have any attached conditions." />}</div></Drawer>}
  </div>;
}