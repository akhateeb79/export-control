import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiFetch, apiFetchRaw } from '../lib/api';
import ProductECCN from './admin/ProductECCN';
import DataManagement from './admin/DataManagement';
import UaeControlList from './admin/UaeControlList';
import PlatformMonitor from './PlatformMonitor';

const NAV = [
  { id: 'overview',      label: 'Platform Overview',       icon: 'home',     group: 'Monitor' },
  { id: 'tenants',       label: 'Tenants',                 icon: 'building', group: 'Manage' },
  { id: 'users',         label: 'Users & Access',          icon: 'users',    group: 'Manage' },
  { id: 'cases',         label: 'Case Oversight',          icon: 'briefcase',group: 'Monitor', badge: 'stuck' },
  { id: 'lists',         label: 'Sanctions & Lists',       icon: 'shield',   group: 'Configure', badge: 'lists' },
  { id: 'agents',        label: 'Agents & Classification', icon: 'cpu',      group: 'Configure' },
  { id: 'licence',       label: 'Licence Configuration',   icon: 'key',      group: 'Configure' },
  { id: 'product-eccn',  label: 'Product & ECCN',          icon: 'database', group: 'Configure' },
  { id: 'rules',         label: 'Compliance Rules',        icon: 'scale',    group: 'Configure' },
  { id: 'audit',         label: 'Audit & Reports',         icon: 'chart',    group: 'Govern' },
  { id: 'system',        label: 'System Operations',       icon: 'settings', group: 'Govern', badge: 'health' },
  { id: 'notifications', label: 'Notifications',           icon: 'bell',     group: 'Govern' },
  { id: 'intelligence',  label: 'Intelligence',            icon: 'chart',    group: 'Govern' },
  { id: 'data',          label: 'Data Management',         icon: 'database', group: 'Govern' },
  { id: 'uae-list',      label: 'UAE Control List',        icon: 'shield',   group: 'Configure' },
];

const CASE_TABS = [
  ['all',              'All Cases',        '/api/v1/admin/cases'],
  ['stuck',            'Stuck',            '/api/v1/admin/cases/stuck'],
  ['overrides',        'Overrides',        '/api/v1/admin/cases/overrides'],
  ['sanctions-blocks', 'Sanctions Blocks', '/api/v1/admin/cases/sanctions-blocks'],
];

const REPORT_TABS = [
  ['log',            'Audit Log',       '/api/v1/admin/audit'],
  ['outcomes',       'Outcomes',        '/api/v1/admin/reports/outcomes'],
  ['sanctions',      'Sanctions Hits',  '/api/v1/admin/reports/sanctions-hits'],
  ['workflow',       'Workflow Time',   '/api/v1/admin/reports/workflow-time'],
  ['tenant-summary', 'Tenant Summary',  '/api/v1/admin/reports/tenant-summary'],
];

const SYSTEM_TABS = [
  ['health', 'Health'],
  ['scheduler', 'Scheduler'],
  ['errors', 'Error Log'],
  ['smtp', 'SMTP'],
];

const PIPELINE_STATES = [
  ['DRAFT',          'Draft',          'slate'],
  ['SCREENING',      'Screening',      'violet'],
  ['CLASSIFICATION', 'Classification', 'blue'],
  ['DETERMINATION',  'Determination',  'amber'],
  ['PENDING_REVIEW', 'Pending review', 'orange'],
  ['APPROVED',       'Approved',       'emerald'],
  ['REJECTED',       'Rejected',       'rose'],
  ['BLOCKED',        'Blocked',        'red'],
];

/* ── Icons ── */
function Icon({ name, size = 18, strokeWidth = 1.8 }) {
  const paths = {
    home:      <><path d="m3 10 9-7 9 7" /><path d="M5 9.5V21h14V9.5M9 21v-6h6v6" /></>,
    building:  <><path d="M4 21V5l8-2 8 2v16M2 21h20M8 7h1m6 0h1M8 11h1m6 0h1M8 15h1m6 0h1M10 21v-4h4v4" /></>,
    users:     <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0M16 11a3 3 0 1 0-1-5.8M17 14a5 5 0 0 1 4 5" /></>,
    briefcase: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M8 6V4h8v2M3 11h18M10 11v2h4v-2" /></>,
    shield:    <><path d="M12 3 20 6v5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6l8-3Z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
    cpu:       <><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 9h6v6H9zM9 1v3m6-3v3m0 16v3m-6-3v3M1 9h3m-3 6h3m16-6h3m-3 6h3" /></>,
    key:       <><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M16 5l3 3M13 10l3 3" /></>,
    database:  <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>,
    scale:     <><path d="M12 3v18M5 6h14M5 6l-3 6a4 4 0 0 0 6 0L5 6Zm14 0-3 6a4 4 0 0 0 6 0l-3-6ZM7 21h10" /></>,
    chart:     <><path d="M4 19V5M4 19h17" /><path d="m7 15 3-4 3 2 5-7" /></>,
    settings:  <><path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" /><path d="m19.4 15 .1.1a2 2 0 1 1-2.8 2.8l-.1-.1a2 2 0 0 0-3.4 1.4v.2a2 2 0 1 1-4 0v-.2a2 2 0 0 0-3.4-1.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A2 2 0 0 0 1.6 12a2 2 0 1 1 0-4h.2a2 2 0 0 0 1.4-3.4l-.1-.1A2 2 0 1 1 5.9 1.7l.1.1A2 2 0 0 0 9.4.4V.2a2 2 0 1 1 4 0v.2a2 2 0 0 0 3.4 1.4l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A2 2 0 0 0 21 8h.2a2 2 0 1 1 0 4H21a2 2 0 0 0-1.6 3Z" transform="scale(.78) translate(3.4 3.4)" /></>,
    bell:      <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    search:    <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    menu:      <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    sun:       <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    moon:      <><path d="M20.5 15.3A8.5 8.5 0 0 1 8.7 3.5 8.5 8.5 0 1 0 20.5 15.3Z" /></>,
    arrow:     <><path d="M5 12h14m-6-6 6 6-6 6" /></>,
    close:     <><path d="m6 6 12 12M18 6 6 18" /></>,
    plus:      <><path d="M12 5v14M5 12h14" /></>,
    download:  <><path d="M12 3v12m-5-5 5 5 5-5M5 21h14" /></>,
    refresh:   <><path d="M20 11a8 8 0 1 0 1 4" /><path d="M20 4v7h-7" /></>,
    filter:    <><path d="M4 6h16M7 12h10m-7 6h4" /></>,
    more:      <><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></>,
    check:     <path d="m5 12 4 4L19 6" />,
    external:  <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></>,
    chevron:   <><path d="m9 18 6-6-6-6" /></>,
    zap:       <><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></>,
    layers:    <><path d="m2 7 10-5 10 5-10 5-10-5Z" /><path d="M2 17l10 5 10-5M2 12l10 5 10-5" /></>,
  };
  return (
    <svg className="admin-icon" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name] || paths.more}
    </svg>
  );
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
  return String(value || '—').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (l) => l.toUpperCase());
}

function toneFor(value) {
  const n = String(value || '').toLowerCase();
  if (['active','healthy','approved','published','running','met','delivered','synchronized'].some((w) => n.includes(w))) return 'approved';
  if (['blocked','rejected','failed','error','unhealthy','confirmed_hit','unverifiable'].some((w) => n.includes(w))) return 'blocked';
  if (['pending','review','draft','warning','possible_hit','unmet'].some((w) => n.includes(w))) return 'pending';
  return 'neutral';
}

function Badge({ children, tone }) {
  const resolved = tone === 'success' ? 'approved' : tone === 'danger' ? 'blocked' : tone === 'warning' ? 'pending' : tone === 'indigo' ? 'ai' : tone || toneFor(children);
  return (
    <span className={`cd-badge cd-badge-${resolved}`}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', flexShrink: 0, display: 'inline-block' }} />
      {titleCase(children)}
    </span>
  );
}

function Sparkline({ points = [8, 12, 10, 18, 16, 21, 24], color = '#818cf8' }) {
  const max = Math.max(...points, 1);
  const min = Math.min(...points);
  const range = Math.max(max - min, 1);
  const path = points.map((p, i) => `${i * (100 / (points.length - 1))},${31 - ((p - min) / range) * 25}`).join(' ');
  return (
    <svg className="sparkline" viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true">
      <path d={`M ${path}`} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d={`M ${path} L 100 34 L 0 34 Z`} fill={color} opacity=".08" />
    </svg>
  );
}

function MetricCard({ label, value, detail, delta, points, icon, color = 'indigo' }) {
  const sparkColor = { emerald: '#34d399', amber: '#fbbf24', rose: '#fb7185', blue: '#60a5fa', indigo: '#818cf8' }[color] || '#818cf8';
  return (
    <article className="cd-metric-card">
      <div className="cd-metric-top">
        <div className={`cd-metric-icon cd-metric-icon--${color}`}><Icon name={icon} size={16} /></div>
        <span className="cd-metric-label">{label}</span>
      </div>
      <div className="cd-metric-value">{value}</div>
      <div className="cd-metric-bottom">
        <span className={`cd-metric-delta ${delta?.startsWith('-') ? 'negative' : ''}`}>{delta?.startsWith('-') ? '↓' : '↑'} {delta || '0%'}</span>
        <span className="cd-metric-detail">{detail}</span>
      </div>
      <Sparkline points={points} color={sparkColor} />
    </article>
  );
}

function SectionHeader({ eyebrow, title, description, action }) {
  return (
    <div className="cd-section-header">
      <div>
        <div className="cd-eyebrow">{eyebrow}</div>
        <h2 className="cd-section-title">{title}</h2>
        {description && <p className="cd-section-desc">{description}</p>}
      </div>
      {action && <div className="cd-section-action">{action}</div>}
    </div>
  );
}

function Tabs({ items, active, onChange }) {
  return (
    <div className="cd-tabs" role="tablist">
      {items.map(([id, label]) => (
        <button key={id} className={`cd-tab ${active === id ? 'active' : ''}`} onClick={() => onChange(id)} role="tab" aria-selected={active === id}>
          {label}
        </button>
      ))}
    </div>
  );
}

function EmptyState({ title = 'Nothing here yet', description = 'Records will appear here as the platform becomes active.' }) {
  return (
    <div className="cd-empty">
      <div className="cd-empty-icon"><Icon name="layers" size={18} /></div>
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}

function DataTable({ columns, rows, onRowClick, empty, compact = false }) {
  return (
    <div className={`cd-table-wrap ${compact ? 'cd-table-compact' : ''}`}>
      <table className="cd-table">
        <thead>
          <tr>{columns.map(([key, label]) => <th key={key}>{label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length
            ? rows.map((row, i) => (
                <tr key={row.id || row.code || row.case_ref || row.email || `${i}-${row.status}`}
                  onClick={() => onRowClick?.(row)}
                  className={onRowClick ? 'cd-table-row-clickable' : ''}>
                  {columns.map(([key, , render]) => (
                    <td key={key}>{typeof render === 'function' ? render(row) : row[key] ?? '—'}</td>
                  ))}
                </tr>
              ))
            : <tr><td colSpan={columns.length}><EmptyState title={empty || 'No records found'} /></td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function Drawer({ title, eyebrow, onClose, children, wide = false }) {
  return (
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className={`drawer ${wide ? 'drawer-wide' : ''}`}>
        <div className="drawer-header">
          <div>
            <div className="cd-eyebrow">{eyebrow}</div>
            <h2>{title}</h2>
          </div>
          <button className="cd-icon-btn" onClick={onClose} aria-label="Close drawer"><Icon name="close" /></button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}

function Field({ label, children, hint }) {
  return (
    <label className="admin-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function Button({ children, variant = 'secondary', icon, onClick, type = 'button', disabled = false }) {
  const cls = variant === 'primary' ? 'cd-btn cd-btn-primary' : variant === 'danger' ? 'cd-btn cd-btn-destructive' : 'cd-btn cd-btn-secondary';
  return (
    <button type={type} className={cls} onClick={onClick} disabled={disabled}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </button>
  );
}

function initials(value) {
  return String(value || 'AD').split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

/* ══════════════════════════════════════════════════════════ */

export default function AdminDashboard({ session, onSignOut }) {
  const location  = useLocation();
  const navigate  = useNavigate();
  const isPlatformAdmin    = session?.user?.role === 'SUPER_ADMIN' && session?.user?.tenant_id == null;
  const isComplianceAdmin  = session?.user?.role === 'COMPLIANCE_ADMIN';
  if (location.pathname === '/admin/dashboard/monitor') return <PlatformMonitor />;
  const canAccessDashboard = isPlatformAdmin || isComplianceAdmin;
  const routeSection   = location.pathname.split('/').filter(Boolean).pop();
  const resolvedSection = routeSection === 'products' ? 'product-eccn' : routeSection;
  const [section,     setSection]     = useState(() => NAV.some((i) => i.id === resolvedSection) ? resolvedSection : isComplianceAdmin ? 'intelligence' : 'overview');
  const [collapsed,   setCollapsed]   = useState(false);
  const [theme,       setTheme]       = useState(() => localStorage.getItem('admin-theme') || 'dark');
  const [data,        setData]        = useState({});
  const [openGroups,  setOpenGroups]  = useState({ Monitor: true, Manage: true, Configure: true, Govern: true });
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [notice,      setNotice]      = useState('');
  const [search,      setSearch]      = useState('');
  const [commandOpen, setCommandOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [intelligenceHistoryOpen, setIntelligenceHistoryOpen] = useState(false);
  const [caseTab,         setCaseTab]         = useState('all');
  const [reportTab,       setReportTab]       = useState('log');
  const [systemTab,       setSystemTab]       = useState('health');
  const [userTab,         setUserTab]         = useState('users');
  const [selectedTenant,  setSelectedTenant]  = useState(null);
  const [selectedCase,    setSelectedCase]    = useState(null);
  const [selectedList,    setSelectedList]    = useState(null);
  const [selectedAgent,   setSelectedAgent]   = useState(null);
  const [selectedException, setSelectedException] = useState(null);
  const [drawer,      setDrawer]      = useState(null);
  const [tenantForm,  setTenantForm]  = useState({ name: '', plan_code: 'STARTER' });
  const [ruleForm,    setRuleForm]    = useState({ value_code: '', label_key: '' });
  const [tenantQuery, setTenantQuery] = useState('');
  const [tenantStatus,setTenantStatus]= useState('ALL');

  useEffect(() => {
    if (location.pathname === '/admin/dashboard' || location.pathname === '/admin/dashboard/') {
      navigate(`/admin/dashboard/${isComplianceAdmin ? 'intelligence' : 'overview'}`, { replace: true });
      return;
    }
    if (NAV.some((i) => i.id === resolvedSection)) setSection(resolvedSection);
  }, [location.pathname, isComplianceAdmin]);

  useEffect(() => {
    document.documentElement.dataset.adminTheme = theme;
    localStorage.setItem('admin-theme', theme);
  }, [theme]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCommandOpen((v) => !v); }
      if (e.key === 'Escape') { setCommandOpen(false); setProfileOpen(false); setDrawer(null); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const requestMap = useCallback((target) => ({
    overview:      [['overview', '/api/v1/admin/overview'], ['tenants', '/api/v1/admin/tenants?limit=500'], ['users', '/api/v1/admin/users?limit=500'], ['cases', '/api/v1/admin/cases?limit=500'], ['health', '/api/v1/admin/system/health'], ['audit', '/api/v1/admin/audit?limit=10'], ['lists', '/api/v1/admin/lists']],
    tenants:       [['tenants', `/api/v1/admin/tenants?limit=500${tenantQuery ? `&q=${encodeURIComponent(tenantQuery)}` : ''}${tenantStatus !== 'ALL' ? `&status=${tenantStatus}` : ''}`]],
    users:         userTab === 'sessions' ? [['sessions', '/api/v1/admin/sessions?limit=200']] : [['users', `/api/v1/admin/users?limit=500${search ? `&q=${encodeURIComponent(search)}` : ''}`]],
    cases:         [['cases', `/api/v1/admin/cases/${caseTab === 'all' ? '' : caseTab}?limit=500${search ? `&q=${encodeURIComponent(search)}` : ''}`]],
    lists:         [['lists', '/api/v1/admin/lists'], ['embargoes', '/api/v1/admin/embargoes']],
    agents:        [['agents', '/api/v1/admin/agents'], ['agentStats', '/api/v1/admin/agents/stats']],
    licence:       [['exceptions', '/api/v1/admin/licence-exceptions'], ['licenceStats', '/api/v1/admin/licence-exceptions/stats']],
    rules:         [['thresholds', '/api/v1/admin/thresholds'], ['rules', '/api/v1/admin/red-flag-rules']],
    audit:         [[reportTab, REPORT_TABS.find(([id]) => id === reportTab)?.[2] || '/api/v1/admin/audit']],
    system:        [[systemTab, `/api/v1/admin/system/${systemTab === 'smtp' ? 'health' : systemTab}`]],
    notifications: [['notificationRules', '/api/v1/admin/notification-rules'], ['deliveries', '/api/v1/admin/notification-rules/delivery-log']],
    intelligence:  [['intelligence', '/api/v1/intelligence/latest'], ['intelligenceHistory', '/api/v1/intelligence/history']],
  }[target] || []), [caseTab, reportTab, search, systemTab, tenantQuery, tenantStatus, userTab]);

  const load = useCallback(async (target = section, { quiet = false } = {}) => {
    if (!canAccessDashboard) return;
    if (!quiet) setLoading(true);
    setError('');
    try {
      const result = await Promise.all(requestMap(target).map(async ([key, path]) => [key, await apiFetch(path)]));
      setData((prev) => ({ ...prev, ...Object.fromEntries(result) }));
    } catch (err) {
      setError(err.body?.error?.message || err.body?.error?.code || err.message);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [canAccessDashboard, requestMap, section]);

  useEffect(() => { load(section); }, [load, section]);
  useEffect(() => {
    const interval = window.setInterval(() => load(section, { quiet: true }), section === 'system' ? 10_000 : 30_000);
    return () => window.clearInterval(interval);
  }, [load, section]);

  async function action(cb, message = 'Changes saved.') {
    setError(''); setNotice('');
    try { await cb(); setNotice(message); await load(section); }
    catch (err) { setError(err.body?.error?.message || err.body?.error?.code || err.message); }
  }

  async function generateIntelligence() {
    setLoading(true); setError(''); setNotice('');
    try { await apiFetch('/api/v1/intelligence/generate', { method: 'POST' }); setNotice('Intelligence report generated.'); await load('intelligence'); }
    catch (err) { setError(err.body?.error?.message || err.body?.error?.code || err.message); }
    finally { setLoading(false); }
  }

  async function viewIntelligenceReport(reportId) {
    try { const result = await apiFetch(`/api/v1/intelligence/${reportId}`); setData((prev) => ({ ...prev, intelligence: result })); }
    catch (err) { setError(err.body?.error?.message || err.body?.error?.code || err.message); }
  }

  async function downloadIntelligencePdf(reportId) {
    try {
      const response = await apiFetchRaw(`/api/v1/intelligence/${reportId}/pdf`);
      if (!response.ok) throw new Error(`PDF export failed (${response.status})`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `intelligence-report-${reportId}.pdf`; link.click();
      URL.revokeObjectURL(url);
      setNotice('Intelligence report PDF downloaded.'); await load('intelligence');
    } catch (err) { setError(err.message); }
  }

  async function createTenant(e) {
    e.preventDefault();
    await action(() => apiFetch('/api/v1/admin/tenants', { method: 'POST', body: JSON.stringify(tenantForm) }), 'Tenant created.');
    setTenantForm({ name: '', plan_code: 'STARTER' }); setDrawer(null);
  }

  async function downloadAudit() {
    try {
      const response = await apiFetchRaw('/api/v1/admin/audit/export?limit=20000');
      if (!response.ok) throw new Error(`Export failed (${response.status})`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = 'audit-export.csv'; link.click();
      URL.revokeObjectURL(url); setNotice('Audit CSV downloaded.');
    } catch (err) { setError(err.message); }
  }

  function exportRows(rows, name) {
    const fields = rows.length ? Object.keys(rows[0]) : [];
    const csv = [fields.join(','), ...rows.map((row) => fields.map((f) => `"${String(row[f] ?? '').replaceAll('"', '""')}"`).join(','))].join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    link.download = `${name}.csv`; link.click();
    URL.revokeObjectURL(link.href); setNotice(`${name.replaceAll('-', ' ')} exported.`);
  }

  const overview = useMemo(() => {
    const cases   = data.cases?.cases   || [];
    const tenants = data.tenants?.tenants || [];
    const users   = data.users?.users   || [];
    const live    = data.overview || {};
    const pipeline = Object.fromEntries(PIPELINE_STATES.map(([state]) => [state, live.pipeline?.[state] ?? cases.filter((c) => c.state === state).length]));
    return {
      tenants:     live.kpis?.total_tenants ?? tenants.length,
      cases:       live.kpis?.active_cases  ?? cases.length,
      casesToday:  live.kpis?.cases_today   ?? cases.filter((c) => new Date(c.created_at).toDateString() === new Date().toDateString()).length,
      users:       users.length,
      hits:        live.kpis?.sanctions_hits ?? cases.filter((c) => ['BLOCKED','REJECTED'].includes(c.state)).length,
      pipeline,
      stuck:       data.stuck?.cases?.length || 0,
    };
  }, [data]);

  if (!canAccessDashboard) return <div className="admin-denied">Restricted administrator access required.</div>;

  const tenants     = (data.tenants?.tenants || []).filter((t) => !tenantQuery || t.name.toLowerCase().includes(tenantQuery.toLowerCase()));
  const users       = data.users?.users || [];
  const apiClients  = users.filter((u) => u.role === 'API_CLIENT');
  const cases       = data.cases?.cases || [];
  const listSources = data.lists?.lists || [];

  /* ── RENDER FUNCTIONS ── */

  function renderOverview() {
    const auditEvents = data.audit?.events || [];
    const health      = data.health?.health || {};
    return (
      <div className="cd-page-stack">
        <div className="cd-metrics-grid">
          <MetricCard label="Total tenants"  value={formatNumber(overview.tenants)}    detail="vs. yesterday"        delta="+8.2%"  icon="building"  color="indigo"  points={[12,14,13,17,16,21,24]} />
          <MetricCard label="Active cases"   value={formatNumber(overview.cases)}      detail="across all workspaces" delta="+12.4%" icon="briefcase" color="blue"    points={[11,10,14,13,18,17,23]} />
          <MetricCard label="Cases today"    value={formatNumber(overview.casesToday)} detail="last 24 hours"        delta="live"   icon="chart"     color="emerald" points={[5,7,6,11,10,14,16]} />
          <MetricCard label="Sanctions hits" value={formatNumber(overview.hits)}       detail="requires attention"   delta={overview.hits ? '+2.8%' : '0%'} icon="shield" color="rose" points={[3,4,4,7,5,8,9]} />
        </div>

        <div className="cd-card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div className="cd-eyebrow">BAFA ICP Criterion 8</div>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--cd-text-primary)', margin: '2px 0 4px' }}>Whistleblower channel</h3>
            <p style={{ fontSize: 12, color: 'var(--cd-text-muted)', margin: 0 }}>Confidential public submission form is available for every active organisation.</p>
          </div>
          <Badge tone="success">Active</Badge>
        </div>

        <div className="cd-card" style={{ padding: '20px' }}>
          <SectionHeader eyebrow="Live workflow" title="Case pipeline" description="Real-time view of every case moving through the platform."
            action={<span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--cd-status-approved-text)', fontWeight: 600 }}><span className="cd-pulse" style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />Live · 30s</span>} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 0, marginTop: 12 }}>
            {PIPELINE_STATES.map(([state, label], idx) => (
              <button key={state} onClick={() => { setSection('cases'); setCaseTab('all'); setSearch(state); }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'var(--cd-bg-surface-raised)', border: '1px solid var(--cd-border-default)', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--cd-text-primary)', borderRadius: idx === 0 ? '6px 0 0 6px' : idx === PIPELINE_STATES.length - 1 ? '0 6px 6px 0' : 0, marginLeft: idx ? -1 : 0, transition: 'all 0.12s' }}>
                <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--cd-accent-primary)', minWidth: 28, fontFamily: 'var(--cd-font-mono)', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(overview.pipeline[state])}</span>
                <span>{label}</span>
                {idx < PIPELINE_STATES.length - 1 && <span style={{ color: 'var(--cd-text-muted)', marginLeft: 4 }}>›</span>}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}>
          <div className="cd-card" style={{ padding: 20 }}>
            <SectionHeader eyebrow="Audit stream" title="Recent activity" action={<button className="cd-text-btn" onClick={() => setSection('audit')}>View all <Icon name="arrow" size={12} /></button>} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginTop: 4 }}>
              {auditEvents.length ? auditEvents.slice(0, 6).map((ev, i) => (
                <div key={ev.id || i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--cd-border-subtle)' }}>
                  <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--cd-bg-surface-raised)', border: '1px solid var(--cd-border-default)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--cd-text-muted)' }}><Icon name={ev.event_type?.includes('SCREEN') ? 'shield' : ev.event_type?.includes('USER') ? 'users' : 'chart'} size={13} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}><strong style={{ fontSize: 12, display: 'block', color: 'var(--cd-text-primary)' }}>{titleCase(ev.event_type)}</strong><span style={{ fontSize: 11, color: 'var(--cd-text-muted)' }}>{ev.tenant_name || 'Platform'}{ev.case_id ? ` · ${String(ev.case_id).slice(0, 8)}` : ''}</span></div>
                  <time style={{ fontSize: 10, color: 'var(--cd-text-muted)', fontFamily: 'var(--cd-font-mono)', flexShrink: 0 }}>{formatDate(ev.occurred_at, true)}</time>
                </div>
              )) : <EmptyState title="No recent activity" />}
            </div>
          </div>

          <div className="cd-card" style={{ padding: 20 }}>
            <SectionHeader eyebrow="Infrastructure" title="System health" action={<button className="cd-icon-btn" onClick={() => load('overview')} aria-label="Refresh"><Icon name="refresh" size={15} /></button>} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              {[['API Server', health.api, 'settings'], ['Database', health.database, 'building'], ['Matching Service', health.matching_service, 'cpu'], ['Scheduler', health.scheduler, 'chart']].map(([label, status, icon]) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--cd-bg-surface-raised)', border: '1px solid var(--cd-border-default)', borderRadius: 6 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--cd-accent-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--cd-accent-primary)', flexShrink: 0 }}><Icon name={icon} size={14} /></div>
                  <div style={{ flex: 1 }}><strong style={{ fontSize: 12, color: 'var(--cd-text-primary)', display: 'block' }}>{label}</strong><span style={{ fontSize: 10, color: 'var(--cd-text-muted)' }}>Checked {formatDate(health.checked_at, true)}</span></div>
                  <Badge>{status || 'checking'}</Badge>
                </div>
              ))}
            </div>
          </div>

          <div className="cd-card" style={{ padding: 20 }}>
            <SectionHeader eyebrow="Data freshness" title="Sanctions lists" action={<button className="cd-text-btn" onClick={() => setSection('lists')}>Manage <Icon name="arrow" size={12} /></button>} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {listSources.slice(0, 5).map((src) => (
                <div key={src.code} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--cd-border-subtle)' }}>
                  <div><strong style={{ fontSize: 12, color: 'var(--cd-text-primary)', display: 'block' }}>{src.code}</strong><span style={{ fontSize: 11, color: 'var(--cd-text-muted)' }}>{formatNumber(src.entry_count)} records</span></div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}><Badge tone={src.last_error ? 'danger' : 'success'}>{src.last_error ? 'sync error' : 'synced'}</Badge><span style={{ fontSize: 10, color: 'var(--cd-text-muted)', fontFamily: 'var(--cd-font-mono)' }}>{formatDate(src.last_sync, true)}</span></div>
                </div>
              ))}
              {!listSources.length && <EmptyState title="No sources configured" />}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderTenants() {
    return (
      <div className="cd-page-stack">
        <div className="cd-toolbar">
          <div className="cd-toolbar-search"><Icon name="search" size={15} /><input placeholder="Search tenants..." value={tenantQuery} onChange={(e) => setTenantQuery(e.target.value)} /></div>
          <select className="admin-select" value={tenantStatus} onChange={(e) => setTenantStatus(e.target.value)}><option value="ALL">All statuses</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option></select>
          <div style={{ flex: 1 }} />
          <Button icon="download" onClick={() => exportRows(tenants, 'tenants')}>Export</Button>
          <Button variant="primary" icon="plus" onClick={() => setDrawer('new-tenant')}>Add tenant</Button>
        </div>
        <div className="cd-card" style={{ padding: 20 }}>
          <SectionHeader eyebrow="Tenant portfolio" title="All tenants" description={`${tenants.length} workspaces across the platform`} />
          <DataTable rows={tenants} onRowClick={(row) => { setSelectedTenant(row); setDrawer('tenant'); }}
            columns={[['name','Tenant'],['plan','Plan',(r)=><span className="plan-pill">{r.plan||'—'}</span>],['user_count','Users'],['case_count','Active cases'],['status','Status',(r)=><Badge>{r.status}</Badge>],['created_at','Created',(r)=>formatDate(r.created_at,true)]]} />
        </div>
      </div>
    );
  }

  function renderUsers() {
    const rows = userTab === 'api' ? apiClients : users;
    return (
      <div className="cd-page-stack">
        <div className="cd-toolbar">
          <div className="cd-toolbar-search wide"><Icon name="search" size={15} /><input placeholder="Search by name, email, or tenant..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <div style={{ flex: 1 }} />
          <Button variant="primary" icon="plus" onClick={() => setDrawer('invite-user')}>Invite user</Button>
        </div>
        <div className="cd-card" style={{ padding: 20 }}>
          <Tabs items={[['users','All users'],['sessions','Active sessions'],['api','API clients']]} active={userTab} onChange={setUserTab} />
          {userTab === 'sessions'
            ? <DataTable rows={data.sessions?.sessions||[]} columns={[['email','User'],['tenant_name','Tenant'],['created_at','Started',(r)=>formatDate(r.created_at,true)],['expires_at','Expires',(r)=>formatDate(r.expires_at,true)],['id','Action',(r)=><button className="cd-row-action danger" onClick={(e)=>{e.stopPropagation();action(()=>apiFetch(`/api/v1/admin/users/${r.user_id}/force-logout`,{method:'POST'}),'Session revoked.');}}>Force logout</button>]]} />
            : <DataTable rows={rows.filter((r)=>!search||`${r.email} ${r.tenant_name} ${r.role}`.toLowerCase().includes(search.toLowerCase()))}
                columns={userTab==='api'
                  ? [['email','Client'],['tenant_name','Tenant'],['email','Key preview',(r)=><code>ecp_••••{String(r.email||'').slice(-4)}</code>],['created_at','Created',(r)=>formatDate(r.created_at,true)],['status','Status',(r)=><Badge>{r.status}</Badge>],['id','Action',(r)=><button className="cd-row-action" onClick={(e)=>{e.stopPropagation();action(async()=>{const res=await apiFetch(`/api/v1/admin/api-clients/${r.id}/rotate`,{method:'POST'});setNotice(`New key: ${res.api_key}`);},'API key rotated.');}}>Rotate key</button>]]
                  : [['email','User',(r)=><div style={{display:'flex',alignItems:'center',gap:8}}><span className="cd-avatar" style={{width:28,height:28,fontSize:10}}>{initials(r.email)}</span><span><strong style={{fontSize:12,display:'block',color:'var(--cd-text-primary)'}}>{r.email}</strong><small style={{fontSize:11,color:'var(--cd-text-muted)'}}>{r.tenant_name||'Platform'}</small></span></div>],['role','Role',(r)=><span className={`role-pill ${String(r.role).toLowerCase()}`}>{titleCase(r.role)}</span>],['status','Status',(r)=><Badge>{r.status}</Badge>],['credentials_active','Credentials',(r)=><Badge tone={r.credentials_active?'success':'warning'}>{r.credentials_active?'ready':'not set'}</Badge>],['created_at','Joined',(r)=>formatDate(r.created_at,true)],['id','Actions',(r)=><button className="cd-row-action" onClick={(e)=>{e.stopPropagation();action(()=>apiFetch(`/api/v1/admin/users/${r.id}/force-logout`,{method:'POST'}),'All sessions revoked.');}}>Force logout</button>]]} />}
        </div>
      </div>
    );
  }

  function renderCases() {
    const rows = cases.filter((r) => !search || `${r.case_ref} ${r.tenant_name} ${r.state} ${r.end_user||''} ${r.party_names||''}`.toLowerCase().includes(search.toLowerCase()));
    return (
      <div className="cd-page-stack">
        <div className="cd-toolbar">
          <div className="cd-toolbar-search wide"><Icon name="search" size={15} /><input placeholder="Search case ID, party, or tenant..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <div style={{ flex: 1 }} />
          <Button icon="download" onClick={() => exportRows(rows, 'case-oversight')}>Export</Button>
        </div>
        <div className="cd-card" style={{ padding: 20 }}>
          <Tabs items={CASE_TABS.map(([id, label]) => [id, label])} active={caseTab} onChange={(next) => { setCaseTab(next); setSearch(''); }} />
          <div className="cd-context-banner">
            <Icon name={caseTab === 'sanctions-blocks' ? 'shield' : 'briefcase'} size={14} />
            <span>{caseTab === 'stuck' ? 'Cases exceeding their workflow threshold require immediate attention.' : caseTab === 'sanctions-blocks' ? 'Confirmed sanctions matches are permanently blocked and read-only.' : 'Cross-tenant oversight of the active compliance queue.'}</span>
          </div>
          <DataTable rows={rows.map((r) => ({ ...r, age: r.created_at ? `${Math.max(0, Math.round((Date.now() - new Date(r.created_at).getTime()) / 36e5))}h` : '—' }))}
            onRowClick={(row) => { setSelectedCase(row); setDrawer('case'); }}
            columns={[['case_ref','Case ID',(r)=><strong className="mono-link">{r.case_ref}</strong>],['tenant_name','Tenant'],['end_user','Party'],['destination_country','Destination'],['state','Status',(r)=><Badge>{r.state}</Badge>],['overall_risk','Risk',(r)=><Badge>{r.overall_risk||'—'}</Badge>],['age','Age',(r)=><span className={Number.parseInt(r.age)>48?'age danger':'age'}>{r.age}</span>],['created_at','Created',(r)=>formatDate(r.created_at,true)]]} />
        </div>
      </div>
    );
  }

  function renderLists() {
    return (
      <div className="cd-page-stack">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 12 }}>
          {listSources.map((src) => (
            <article key={src.code} className="cd-card" style={{ padding: 16, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10 }}
              onClick={() => { setSelectedList(src); setDrawer('list'); }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--cd-status-approved-bg)', border: '1px solid var(--cd-status-approved-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--cd-status-approved-text)' }}><Icon name="shield" size={16} /></div>
                <Badge tone={src.last_error ? 'danger' : 'success'}>{src.last_error ? 'error' : 'healthy'}</Badge>
              </div>
              <div><strong style={{ fontSize: 13, color: 'var(--cd-text-primary)', display: 'block', marginBottom: 2 }}>{src.code}</strong><span style={{ fontSize: 11, color: 'var(--cd-text-muted)' }}>{src.authority || src.name || 'Sanctions source'}</span></div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}><b style={{ fontSize: 20, fontWeight: 800, color: 'var(--cd-text-primary)', fontFamily: 'var(--cd-font-mono)', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(src.entry_count)}</b><small style={{ fontSize: 11, color: 'var(--cd-text-muted)' }}>records</small></div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: 'var(--cd-text-muted)' }}>
                <span>Synced {formatDate(src.last_sync, true)}</span>
                <button className="cd-text-btn" onClick={(e) => { e.stopPropagation(); action(() => apiFetch(`/api/v1/admin/lists/${src.code}/sync`, { method: 'POST' }), 'List sync started.'); }}>Sync now</button>
              </div>
            </article>
          ))}
        </div>
        <div className="cd-card" style={{ padding: 20 }}>
          <SectionHeader eyebrow="Embargo programs" title="Country programs" action={<Button icon="download" onClick={() => exportRows(data.embargoes?.embargoes||[], 'embargo-programs')}>Export</Button>} />
          <DataTable rows={data.embargoes?.embargoes||[]} columns={[['code','Program'],['authority','Authority'],['name','Name'],['effective_from','Effective date',(r)=>formatDate(r.effective_from,true)],['country_count','Countries'],['id','Action',(r)=><button className="cd-row-action" onClick={()=>{const date=window.prompt('Effective date (YYYY-MM-DD)',r.effective_from?.slice?.(0,10));if(date)action(()=>apiFetch(`/api/v1/admin/embargoes/${r.code}`,{method:'PATCH',body:JSON.stringify({effective_from:date})}),'Embargo program updated.');}}>Edit date</button>]]} />
        </div>
      </div>
    );
  }

  function renderAgents() {
    const agents = data.agents?.agents || [];
    const stats  = data.agentStats?.stats || [];

    const agentTypeBadge = (agent) => agent.is_deterministic
      ? <span style={{ fontSize: 10, fontFamily: 'var(--cd-font-mono)', padding: '2px 6px', borderRadius: 4, background: 'var(--cd-accent-subtle)', color: 'var(--cd-accent-primary)', border: '1px solid var(--cd-accent-ring)', fontWeight: 700 }}>Deterministic</span>
      : <span style={{ fontSize: 10, fontFamily: 'var(--cd-font-mono)', padding: '2px 6px', borderRadius: 4, background: 'var(--cd-status-ai-bg)', color: 'var(--cd-status-ai-text)', border: '1px solid var(--cd-status-ai-border)', fontWeight: 700 }}>{agent.model_id || 'AI agent'}</span>;

    const selectedStats = selectedAgent ? stats.filter((s) => s.agent_code === selectedAgent.code) : [];
    const totalRuns = selectedStats.reduce((sum, s) => sum + Number(s.total_runs || 0), 0);

    return (
      <div className="cd-page-stack">
        {/* KPI strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1, background: 'var(--cd-border-default)', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--cd-border-default)' }}>
          {[
            ['Active agents',    agents.filter((a) => a.is_active).length,  'var(--cd-status-approved-text)'],
            ['AI-powered',       agents.filter((a) => !a.is_deterministic).length, 'var(--cd-status-ai-text)'],
            ['Deterministic',    agents.filter((a) => a.is_deterministic).length,  'var(--cd-accent-primary)'],
            ['Total versions',   stats.length,                              'var(--cd-text-primary)'],
          ].map(([label, value, color]) => (
            <div key={label} style={{ background: 'var(--cd-bg-surface)', padding: '14px 18px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--cd-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: 'var(--cd-font-mono)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16, alignItems: 'start' }}>
          {/* Left: pipeline stack */}
          <div className="cd-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--cd-border-default)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div className="cd-eyebrow">Classification stack</div>
                <h2 className="cd-section-title" style={{ marginTop: 2 }}>Agents</h2>
              </div>
              <span style={{ fontSize: 11, fontFamily: 'var(--cd-font-mono)', color: 'var(--cd-text-muted)', background: 'var(--cd-bg-surface-raised)', border: '1px solid var(--cd-border-default)', padding: '2px 8px', borderRadius: 4 }}>
                {agents.length} configured
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {agents.length ? agents.map((agent, idx) => {
                const isSelected = selectedAgent?.code === agent.code;
                const agentStats = stats.filter((s) => s.agent_code === agent.code);
                const runs = agentStats.reduce((sum, s) => sum + Number(s.total_runs || 0), 0);
                return (
                  <button key={agent.code} onClick={() => setSelectedAgent(agent)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: isSelected ? 'var(--cd-accent-subtle)' : 'transparent', borderLeft: isSelected ? '3px solid var(--cd-accent-primary)' : '3px solid transparent', borderRight: 'none', borderTop: 'none', borderBottom: '1px solid var(--cd-border-subtle)', cursor: 'pointer', textAlign: 'left', transition: 'all 0.12s', width: '100%' }}>
                    {/* Execution order */}
                    <div style={{ width: 26, height: 26, borderRadius: '50%', background: isSelected ? 'var(--cd-accent-primary)' : 'var(--cd-bg-surface-raised)', border: `1px solid ${isSelected ? 'var(--cd-accent-primary)' : 'var(--cd-border-default)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, fontFamily: 'var(--cd-font-mono)', color: isSelected ? '#fff' : 'var(--cd-text-muted)', flexShrink: 0 }}>
                      {agent.execution_order ?? idx + 1}
                    </div>
                    {/* Icon */}
                    <div style={{ width: 30, height: 30, borderRadius: 7, background: agent.is_deterministic ? 'var(--cd-accent-subtle)' : 'var(--cd-status-ai-bg)', border: `1px solid ${agent.is_deterministic ? 'var(--cd-accent-ring)' : 'var(--cd-status-ai-border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: agent.is_deterministic ? 'var(--cd-accent-primary)' : 'var(--cd-status-ai-text)', flexShrink: 0 }}>
                      <Icon name={agent.is_deterministic ? 'scale' : 'cpu'} size={14} />
                    </div>
                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: isSelected ? 'var(--cd-text-primary)' : 'var(--cd-text-primary)', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{agent.name || agent.code}</div>
                      <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontFamily: 'var(--cd-font-mono)' }}>{runs.toLocaleString()} runs</span>
                      </div>
                    </div>
                    {/* Status */}
                    <Badge tone={agent.is_active ? 'success' : 'neutral'}>{agent.is_active ? 'active' : 'off'}</Badge>
                  </button>
                );
              }) : <EmptyState title="No agents configured" />}
            </div>
          </div>

          {/* Right: agent detail */}
          {selectedAgent ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Header card */}
              <div className="cd-card" style={{ padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 42, height: 42, borderRadius: 10, background: selectedAgent.is_deterministic ? 'var(--cd-accent-subtle)' : 'var(--cd-status-ai-bg)', border: `1px solid ${selectedAgent.is_deterministic ? 'var(--cd-accent-ring)' : 'var(--cd-status-ai-border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: selectedAgent.is_deterministic ? 'var(--cd-accent-primary)' : 'var(--cd-status-ai-text)' }}>
                      <Icon name={selectedAgent.is_deterministic ? 'scale' : 'zap'} size={20} />
                    </div>
                    <div>
                      <div className="cd-eyebrow">Selected agent</div>
                      <h2 className="cd-section-title" style={{ marginTop: 2 }}>{selectedAgent.name || selectedAgent.code}</h2>
                    </div>
                  </div>
                  <Button icon="plus" variant="primary" onClick={() => setDrawer('new-version')}>Publish version</Button>
                </div>

                {/* Stat chips */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
                  {[
                    ['Active version', selectedAgent.active_version || 'None published', 'var(--cd-text-primary)'],
                    ['Mode', selectedAgent.is_deterministic ? 'Deterministic' : 'AI-assisted', selectedAgent.is_deterministic ? 'var(--cd-accent-primary)' : 'var(--cd-status-ai-text)'],
                    ['Execution order', selectedAgent.execution_order ?? '—', 'var(--cd-text-primary)'],
                  ].map(([label, value, color]) => (
                    <div key={label} style={{ background: 'var(--cd-bg-surface-raised)', border: '1px solid var(--cd-border-default)', borderRadius: 8, padding: '10px 14px' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--cd-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color, fontFamily: 'var(--cd-font-mono)' }}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* Model badge */}
                {!selectedAgent.is_deterministic && selectedAgent.model_id && (
                  <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', background: 'var(--cd-status-ai-bg)', border: '1px solid var(--cd-status-ai-border)', borderRadius: 6 }}>
                    <Icon name="cpu" size={13} />
                    <span style={{ fontSize: 11, color: 'var(--cd-status-ai-text)', fontFamily: 'var(--cd-font-mono)', fontWeight: 600 }}>Model: {selectedAgent.model_id}</span>
                    <div style={{ flex: 1 }} />
                    <span style={{ fontSize: 10, color: 'var(--cd-text-muted)' }}>{totalRuns.toLocaleString()} total runs across all versions</span>
                  </div>
                )}
              </div>

              {/* Version table */}
              <div className="cd-card" style={{ padding: 20 }}>
                <SectionHeader eyebrow="Version history" title="Deployed versions" />
                <table className="cd-table" style={{ marginTop: 8 }}>
                  <thead>
                    <tr>
                      <th>Version</th>
                      <th>Status</th>
                      <th>Runs</th>
                      <th>Insufficient info</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedStats.length ? selectedStats.map((row) => {
                      const rate = Math.min(Number(row.insufficient_rate) || 0, 100);
                      return (
                        <tr key={row.id}>
                          <td><span style={{ fontFamily: 'var(--cd-font-mono)', fontWeight: 700, fontSize: 12, color: 'var(--cd-text-primary)' }}>{row.version_label || '—'}</span></td>
                          <td><Badge>{row.status}</Badge></td>
                          <td><span style={{ fontFamily: 'var(--cd-font-mono)', fontSize: 12 }}>{formatNumber(row.total_runs)}</span></td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ flex: 1, height: 4, background: 'var(--cd-border-default)', borderRadius: 2, overflow: 'hidden' }}>
                                <div style={{ width: `${rate}%`, height: '100%', background: rate > 20 ? 'var(--cd-status-blocked-text)' : rate > 10 ? 'var(--cd-status-pending-text)' : 'var(--cd-status-approved-text)', borderRadius: 2 }} />
                              </div>
                              <span style={{ fontSize: 11, fontFamily: 'var(--cd-font-mono)', fontWeight: 700, color: 'var(--cd-text-muted)', minWidth: 36, textAlign: 'right' }}>{rate}%</span>
                            </div>
                          </td>
                          <td>
                            {row.status === 'DRAFT'
                              ? <button className="cd-row-action" onClick={() => action(() => apiFetch(`/api/v1/admin/agents/${selectedAgent.code}/activate`, { method: 'PATCH', body: JSON.stringify({ version_id: row.id }) }), 'Agent version activated.')}>Activate</button>
                              : row.status === 'PUBLISHED'
                                ? <button className="cd-row-action danger" onClick={() => { if (window.confirm('Retire this published agent version? This cannot be undone.')) action(() => apiFetch(`/api/v1/admin/agents/${selectedAgent.code}/retire`, { method: 'PATCH', body: JSON.stringify({ version_id: row.id }) }), 'Agent version retired.'); }}>Retire</button>
                                : null}
                          </td>
                        </tr>
                      );
                    }) : <tr><td colSpan={5}><EmptyState title="No versions published" description="Publish a version to see quality signals here." /></td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="cd-card" style={{ padding: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, minHeight: 320 }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--cd-bg-surface-raised)', border: '1px solid var(--cd-border-default)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--cd-text-muted)' }}><Icon name="cpu" size={22} /></div>
              <strong style={{ fontSize: 14, color: 'var(--cd-text-primary)' }}>Choose an agent</strong>
              <span style={{ fontSize: 12, color: 'var(--cd-text-muted)', textAlign: 'center', maxWidth: 260 }}>Select an agent from the pipeline stack to inspect version history and quality signals.</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderLicence() {
    const licStats = data.licenceStats?.stats || [];
    return (
      <div className="cd-page-stack">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}>
          {['MET','UNMET','UNVERIFIABLE'].map((status) => {
            const value = licStats.find((s) => s.status === status)?.count || 0;
            const total = licStats.reduce((sum, s) => sum + Number(s.count || 0), 0) || 1;
            const pct = Math.round((Number(value) / total) * 100);
            const color = status === 'MET' ? 'var(--cd-status-approved-text)' : status === 'UNMET' ? 'var(--cd-status-blocked-text)' : 'var(--cd-status-pending-text)';
            return (
              <div key={status} className="cd-card" style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 64, height: 64, borderRadius: '50%', background: `conic-gradient(${color} ${pct}%, var(--cd-border-default) 0%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative' }}>
                  <div style={{ position: 'absolute', inset: 10, borderRadius: '50%', background: 'var(--cd-bg-surface)' }} />
                  <strong style={{ fontSize: 13, fontWeight: 800, color: 'var(--cd-text-primary)', position: 'relative', zIndex: 1 }}>{pct}%</strong>
                </div>
                <div><span style={{ fontSize: 11, color: 'var(--cd-text-muted)', display: 'block', marginBottom: 2 }}>{titleCase(status)}</span><b style={{ fontSize: 15, fontWeight: 700, color: 'var(--cd-text-primary)' }}>{formatNumber(value)}</b><small style={{ fontSize: 11, color: 'var(--cd-text-muted)', display: 'block' }}>evaluations</small></div>
              </div>
            );
          })}
        </div>
        <div className="cd-card" style={{ padding: 20 }}>
          <SectionHeader eyebrow="Licence engine" title="Exceptions & conditions" description="Manage the rules that determine licence outcomes." action={<Button variant="primary" icon="plus" onClick={() => setDrawer('new-exception')}>Add exception</Button>} />
          <DataTable rows={data.exceptions?.exceptions||[]} onRowClick={(row)=>{setSelectedException(row);setDrawer('exception');}} columns={[['code','Code',(r)=><strong className="mono-link">{r.code}</strong>],['regime','Regime'],['name','Description'],['conditions','Conditions',(r)=><span className="number-chip">{r.conditions?.length||0}</span>],['status','Status',(r)=><Badge>{r.status||'active'}</Badge>],['effective_from','Effective',(r)=>formatDate(r.effective_from,true)]]} />
        </div>
      </div>
    );
  }

  function renderProductEccn() { return <ProductECCN />; }

  async function addRule(e) {
    e.preventDefault();
    await action(() => apiFetch('/api/v1/admin/red-flag-rules', { method: 'POST', body: JSON.stringify(ruleForm) }), 'Red flag rule added.');
    setRuleForm({ value_code: '', label_key: '' });
  }

  function renderRules() {
    return (
      <div className="cd-page-stack">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="cd-card" style={{ padding: 20 }}>
            <SectionHeader eyebrow="Platform controls" title="Thresholds" description="Global defaults applied when tenants do not override them." />
            <DataTable rows={data.thresholds?.thresholds||[]} columns={[['code','Rule'],['label_key','Description'],['platform_default','Current value',(r)=><button className="inline-edit" onClick={()=>{const v=window.prompt('New platform default',r.platform_default);if(v!==null)action(()=>apiFetch(`/api/v1/admin/thresholds/${r.code}`,{method:'PATCH',body:JSON.stringify({value:v})}),'Threshold updated.');}}>{r.platform_default}</button>],['tenant_override_count','Overrides'],['updated_at','Last changed',(r)=>formatDate(r.updated_at,true)]]} />
          </div>
          <div className="cd-card" style={{ padding: 20 }}>
            <SectionHeader eyebrow="Detection catalog" title="Red flag rules" action={<span style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'var(--cd-status-approved-text)',fontWeight:600}}><span className="cd-pulse" style={{width:6,height:6,borderRadius:'50%',background:'currentColor',display:'inline-block'}} />Active rules</span>} />
            <form style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }} onSubmit={addRule}>
              <input className="cd-input" style={{ maxWidth: 160 }} required placeholder="RULE_CODE" value={ruleForm.value_code} onChange={(e) => setRuleForm({ ...ruleForm, value_code: e.target.value })} />
              <input className="cd-input" style={{ maxWidth: 220 }} required placeholder="Label key" value={ruleForm.label_key} onChange={(e) => setRuleForm({ ...ruleForm, label_key: e.target.value })} />
              <Button variant="primary" type="submit" icon="plus">Add</Button>
            </form>
            <DataTable rows={data.rules?.rules||[]} columns={[['value_code','Rule'],['label_key','Description'],['is_active','Status',(r)=><button className="toggle" aria-label={`Toggle ${r.value_code}`} onClick={()=>action(()=>apiFetch(`/api/v1/admin/red-flag-rules/${r.id}`,{method:'PATCH',body:JSON.stringify({is_active:!r.is_active})}),'Rule status updated.')}><i className={r.is_active?'on':''} /></button>],['metadata','Triggered',(r)=>r.metadata?.triggered_count||0]]} />
          </div>
        </div>
      </div>
    );
  }

  function renderAudit() {
    const result = data[reportTab] || {};
    const rows = reportTab === 'log' ? result.events||[] : reportTab === 'outcomes' ? result.outcomes||[] : reportTab === 'sanctions' ? result.hits||[] : reportTab === 'workflow' ? result.workflow_time||[] : result.tenants||[];
    if (reportTab === 'outcomes') {
      const total = rows.reduce((sum, r) => sum + Number(r.count||0), 0) || 1;
      return (
        <div className="cd-page-stack">
          <Tabs items={REPORT_TABS.map(([id,label])=>[id,label])} active={reportTab} onChange={setReportTab} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}>
            {[['Approved','APPROVED','var(--cd-status-approved-text)'],['Rejected','REJECTED','var(--cd-status-blocked-text)'],['Referred','REFERRED','var(--cd-status-pending-text)']].map(([label,key,color])=>{
              const value=rows.find((r)=>r.outcome===key)?.count||0;
              return (
                <div key={key} className="cd-card" style={{padding:16}}>
                  <span style={{fontSize:10,color:'var(--cd-text-muted)',textTransform:'uppercase',letterSpacing:'0.07em',fontWeight:700,display:'block',marginBottom:4}}>{label}</span>
                  <strong style={{fontSize:24,fontWeight:800,color,fontFamily:'var(--cd-font-mono)',display:'block'}}>{formatNumber(value)}</strong>
                  <small style={{fontSize:11,color:'var(--cd-text-muted)'}}>{Math.round((value/total)*100)}% of all outcomes</small>
                  <div style={{height:4,background:'var(--cd-border-default)',borderRadius:2,overflow:'hidden',marginTop:8}}><div style={{width:`${(value/total)*100}%`,height:'100%',background:color,borderRadius:2}} /></div>
                </div>
              );
            })}
          </div>
          <div className="cd-card" style={{padding:20}}>
            <SectionHeader eyebrow="Outcome distribution" title="All outcomes" action={<Button icon="download" onClick={downloadAudit}>Export report</Button>} />
            <DataTable rows={rows} columns={[['outcome','Outcome',(r)=><Badge>{r.outcome}</Badge>],['count','Cases'],['percentage','Share',(r)=>`${Math.round((r.count/total)*100)}%`]]} />
          </div>
        </div>
      );
    }
    return (
      <div className="cd-page-stack">
        <div className="cd-toolbar"><div style={{flex:1}}/><Button icon="download" onClick={downloadAudit}>Export CSV</Button></div>
        <div className="cd-card" style={{padding:20}}>
          <Tabs items={REPORT_TABS.map(([id,label])=>[id,label])} active={reportTab} onChange={setReportTab} />
          {reportTab==='log'&&<div className="cd-context-banner"><Icon name="shield" size={14}/><span>Append-only audit records. Platform events are read-only and cannot be edited.</span></div>}
          <DataTable rows={rows} columns={reportTab==='log'?[['occurred_at','Timestamp',(r)=>formatDate(r.occurred_at,true)],['event_type','Event type',(r)=><span className="event-type">{titleCase(r.event_type)}</span>],['tenant_name','Tenant'],['case_id','Case',(r)=>r.case_id?String(r.case_id).slice(0,8):'—'],['actor_type','Actor'],['rationale','Description']]:reportTab==='sanctions'?[['source_code','List source'],['screened','Screened'],['hits','Hits'],['hit_rate','Hit rate',(r)=>`${r.screened?Math.round((r.hits/r.screened)*100):0}%`]]:reportTab==='workflow'?[['stage','Workflow stage',(r)=>titleCase(r.stage)],['average_hours','Average hours'],['cases','Cases']]:[['name','Tenant'],['cases','Cases'],['approved','Approved'],['rejected','Rejected'],['referred','Referred']]} />
        </div>
      </div>
    );
  }

  function renderSystem() {
    const sys = data[systemTab] || {};
    return (
      <div className="cd-page-stack">
        <Tabs items={SYSTEM_TABS} active={systemTab} onChange={setSystemTab} />
        {systemTab === 'health' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
            {[['API Server',sys.health?.api,'settings'],['Database',sys.health?.database,'building'],['Matching Service',sys.health?.matching_service,'cpu'],['Scheduler',sys.health?.scheduler,'chart']].map(([label,status,icon])=>(
              <div key={label} className="cd-card" style={{padding:18,display:'flex',flexDirection:'column',gap:10}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}><div style={{width:36,height:36,borderRadius:8,background:'var(--cd-accent-subtle)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--cd-accent-primary)'}}><Icon name={icon} size={18}/></div><Badge>{status||'checking'}</Badge></div>
                <div><strong style={{fontSize:13,color:'var(--cd-text-primary)',display:'block'}}>{label}</strong><span style={{fontSize:11,color:'var(--cd-text-muted)'}}>Last checked {formatDate(sys.health?.checked_at,true)}</span></div>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',fontSize:11,color:'var(--cd-text-muted)'}}><span>Uptime</span><b style={{color:'var(--cd-status-approved-text)',fontFamily:'var(--cd-font-mono)'}}>99.98%</b></div>
              </div>
            ))}
          </div>
        )}
        {systemTab === 'scheduler' && <div className="cd-card" style={{padding:20}}><SectionHeader eyebrow="Automation" title="Scheduled jobs" description="Manage recurring ingestion and platform jobs." /><DataTable rows={sys.jobs||[]} columns={[['code','Job'],['sync_cron','Schedule'],['last_run','Last run',(r)=>formatDate(r.last_run,true)],['last_status','Status',(r)=><Badge>{r.last_status||'pending'}</Badge>],['id','Action',(r)=><button className="cd-row-action" onClick={()=>action(()=>apiFetch(`/api/v1/admin/system/scheduler/${r.code}/run`,{method:'POST'}),'Job started.')}><Icon name="arrow" size={12}/> Run now</button>]]} /></div>}
        {systemTab === 'errors'    && <div className="cd-card" style={{padding:20}}><SectionHeader eyebrow="Observability" title="Error log" description="Recent system failures and degraded operations." /><DataTable rows={sys.errors||[]} columns={[['occurred_at','Timestamp',(r)=>formatDate(r.occurred_at,true)],['type','Service'],['message','Error message'],['detail','Details']]} /></div>}
        {systemTab === 'smtp'      && <div className="cd-card" style={{padding:20,maxWidth:480}}><SectionHeader eyebrow="Outbound email" title="SMTP test" description="Send a test notification to the signed-in platform administrator." /><Button variant="primary" icon="external" onClick={()=>action(()=>apiFetch('/api/v1/admin/system/smtp/test',{method:'POST',body:JSON.stringify({email:session.user.email})}),'SMTP test completed.')}>Send test email</Button></div>}
      </div>
    );
  }

  function renderNotifications() {
    return (
      <div className="cd-page-stack">
        <div className="cd-card" style={{padding:20}}><SectionHeader eyebrow="Message routing" title="Notification rules" description="Events, recipients, and delivery channels configured for the platform." /><DataTable rows={data.notificationRules?.rules||[]} columns={[['event_code','Event'],['recipient_rule','Recipients'],['channels','Channels',(r)=>Array.isArray(r.channels)?r.channels.join(', '):r.channels],['template_key','Template'],['is_urgent','Priority',(r)=>r.is_urgent?<Badge tone="warning">Urgent</Badge>:<span style={{color:'var(--cd-text-muted)',fontSize:12}}>Normal</span>],['is_active','Status',(r)=><Badge>{r.is_active?'active':'inactive'}</Badge>]]} /></div>
        <div className="cd-card" style={{padding:20}}><SectionHeader eyebrow="Delivery telemetry" title="Recent deliveries" /><DataTable rows={data.deliveries?.deliveries||[]} columns={[['created_at','Timestamp',(r)=>formatDate(r.created_at,true)],['event_code','Event'],['channel','Channel'],['recipient','Recipient'],['status','Status',(r)=><Badge>{r.status}</Badge>]]} /></div>
      </div>
    );
  }

  function renderIntelligence() {
    const report = data.intelligence?.report;
    const body   = report?.report_json || {};
    const history = data.intelligenceHistory?.reports || [];
    const generatedAt = report?.generated_at ? new Date(report.generated_at) : null;
    const cooldown    = generatedAt && Date.now() - generatedAt.getTime() < 6 * 60 * 60 * 1000;
    const riskTone    = body.risk_trend === 'IMPROVING' ? 'success' : body.risk_trend === 'DETERIORATING' ? 'danger' : 'neutral';
    const riskIcon    = body.risk_trend === 'IMPROVING' ? '↑' : body.risk_trend === 'DETERIORATING' ? '↓' : '—';
    return (
      <div className="cd-page-stack intelligence-page">
        <div className="cd-card" style={{padding:20}}>
          <SectionHeader eyebrow="AI decision support" title="BAFA Compliance Intelligence Report" description="AI-generated portfolio analysis. Updated on demand."
            action={<div style={{display:'flex',gap:8}}><Button variant="primary" icon="chart" onClick={generateIntelligence} disabled={loading||!!cooldown}>{loading?'Generating…':'Generate new report'}</Button>{report&&<Button icon="download" onClick={()=>downloadIntelligencePdf(report.id)}>Export PDF</Button>}</div>} />
          {cooldown&&<p className="intelligence-cooldown">Generation available again after {new Date(generatedAt.getTime()+6*60*60*1000).toLocaleString()}.</p>}
          {!report?<EmptyState title="No intelligence report yet" description="Generate a 90-day portfolio analysis for the CECO." />:(
            <div className="intelligence-report">
              <div className="intelligence-meta">
                <div className={`risk-trend ${riskTone}`}><span className="risk-trend-icon">{riskIcon}</span><div><small>Risk trend</small><strong>{body.risk_trend||'—'}</strong></div></div>
                <div><small>Period covered</small><strong>Last 90 days</strong><span>{body.period_start} → {body.period_end}</span></div>
                <div><small>Generated</small><strong>{formatDate(report.generated_at,true)}</strong><span>by {report.generated_by_name||'Compliance Administrator'}</span></div>
                <Badge tone="indigo">AI-generated</Badge>
              </div>
              <div className="intelligence-section"><h3>Executive summary</h3><div className="intelligence-prose">{String(body.executive_summary||'').split(/\n{2,}/).map((p,i)=><p key={i}>{p}</p>)}</div></div>
              <div className="intelligence-section"><h3>Top recommendations</h3><div className="recommendation-grid">{(body.top_recommendations||[]).map((rec)=><article className="recommendation-card" key={rec.priority}><span className="recommendation-priority">{rec.priority}</span><div><strong>{rec.action}</strong><Badge tone="indigo">{rec.responsible_role}</Badge><p>{rec.rationale}</p></div></article>)}</div></div>
              <div className="intelligence-section"><h3>ICP commentary</h3><p className="intelligence-prose">{body.icp_commentary}</p></div>
              <p className="intelligence-disclaimer">{body.executive_summary?.includes('Decision-support disclaimer:') ? body.executive_summary.slice(body.executive_summary.indexOf('Decision-support disclaimer:')) : 'Decision-support disclaimer: This report is AI-generated decision support. The CECO and Compliance Officer are solely responsible for all compliance decisions and regulatory submissions.'}</p>
            </div>
          )}
        </div>
        <div className="cd-card" style={{padding:20}}>
          <button className="history-toggle" onClick={()=>setIntelligenceHistoryOpen((v)=>!v)}><span>Previous reports ({history.length})</span><span>{intelligenceHistoryOpen?'⌃':'⌄'}</span></button>
          {intelligenceHistoryOpen&&<div className="intelligence-history">{history.map((item)=><div className="history-row" key={item.id}><span>{formatDate(item.generated_at,true)}</span><Badge tone={item.risk_trend==='DETERIORATING'?'danger':item.risk_trend==='IMPROVING'?'success':'neutral'}>{item.risk_trend}</Badge><Button onClick={()=>viewIntelligenceReport(item.id)}>View</Button></div>)}</div>}
        </div>
      </div>
    );
  }

  const renderers = {
    overview, tenants: renderTenants, users: renderUsers, cases: renderCases, lists: renderLists,
    agents: renderAgents, licence: renderLicence, 'product-eccn': renderProductEccn, rules: renderRules,
    audit: renderAudit, system: renderSystem, notifications: renderNotifications, intelligence: renderIntelligence,
    data: () => <DataManagement />, 'uae-list': () => <UaeControlList />,
  };
  // fix: ensure overview is the function
  renderers.overview = renderOverview;

  const currentNav  = NAV.find((i) => i.id === section) || NAV[0];
  const groupedNav  = ['Monitor', 'Manage', 'Configure', 'Govern'];
  const visibleNav  = isComplianceAdmin ? NAV.filter((i) => i.id === 'intelligence') : NAV;

  function goToSection(next) {
    setSection(next); setSearch('');
    navigate(`/admin/dashboard/${next === 'product-eccn' ? 'products' : next}`);
  }

  /* ── SHELL ── */
  return (
    <div className={`admin-dashboard ${collapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Sidebar */}
      <aside className="admin-sidebar" style={{ background: 'var(--cd-bg-panel-aside)', borderRight: '1px solid var(--cd-border-subtle)', display: 'flex', flexDirection: 'column' }}>
        {/* Brand */}
        <div className="brand-lockup" style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--cd-border-subtle)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="brand-mark"><span /></div>
          <div className="brand-copy"><strong>Aegis</strong><small>Compliance OS</small></div>
          <button className="sidebar-toggle" onClick={() => setCollapsed((v) => !v)} aria-label="Toggle sidebar"><Icon name="menu" size={16} /></button>
        </div>

        {/* Workspace chip */}
        <div className="workspace-switcher" style={{ margin: '12px 10px', padding: '8px 10px', background: 'var(--cd-bg-surface)', border: '1px solid var(--cd-border-default)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="workspace-avatar" style={{ width: 28, height: 28, fontSize: 11 }}>{initials(session.user.email)}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ fontSize: 11, display: 'block', color: 'var(--cd-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{isComplianceAdmin ? 'Tenant workspace' : 'Platform workspace'}</strong>
            <small style={{ fontSize: 10, color: 'var(--cd-text-muted)' }}>{isComplianceAdmin ? 'Compliance intelligence' : 'Global operations'}</small>
          </span>
          <Icon name="more" size={14} />
        </div>

        {/* Nav */}
        <nav className="admin-nav" aria-label="Platform navigation" style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {groupedNav.map((group) => {
            const items = visibleNav.filter((i) => i.group === group);
            return items.length ? (
              <div className="nav-group" key={group}>
                <button className="group-toggle" onClick={() => setOpenGroups((prev) => ({ ...prev, [group]: !prev[group] }))} aria-expanded={openGroups[group]}>
                  <span className="nav-group-label" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--cd-text-muted)', textTransform: 'uppercase' }}>{group}</span>
                  <Icon name="chevron" size={12} />
                </button>
                {openGroups[group] && (
                  <div className="nav-children">
                    {items.map((item) => (
                      <button key={item.id} className={`admin-nav-item ${section === item.id ? 'active' : ''}`} onClick={() => goToSection(item.id)} title={item.label}>
                        <Icon name={item.icon} size={15} />
                        <span>{item.label}</span>
                        {item.badge === 'stuck' && overview.stuck > 0 && <b className="nav-badge amber">{overview.stuck}</b>}
                        {item.badge === 'health' && data.health?.health?.api !== 'healthy' && <b className="nav-badge red">!</b>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null;
          })}
        </nav>

        {/* Bottom user row */}
        <div className="sidebar-bottom" style={{ borderTop: '1px solid var(--cd-border-subtle)', padding: '10px 12px' }}>
          <div className="sidebar-user">
            <span className="avatar">{initials(session.user.email)}</span>
            <span>
              <strong>{session.user.email?.split('@')[0]}</strong>
              <small>{isComplianceAdmin ? 'Compliance administrator' : 'Super administrator'}</small>
            </span>
            <button className="cd-icon-btn" onClick={onSignOut} aria-label="Sign out"><Icon name="external" size={14} /></button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="admin-main">
        {/* Topbar */}
        <header className="admin-topbar" style={{ borderBottom: '1px solid var(--cd-border-default)', background: 'var(--cd-bg-surface)' }}>
          <div className="breadcrumb" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--cd-text-muted)' }}>
            <span style={{ fontWeight: 600, color: 'var(--cd-text-muted)' }}>Control Center</span>
            <Icon name="chevron" size={12} />
            <strong style={{ color: 'var(--cd-text-primary)' }}>{currentNav.label}</strong>
          </div>
          <div className="topbar-actions">
            <button className="global-search" onClick={() => setCommandOpen(true)}>
              <Icon name="search" size={14} />
              <span>Search anything...</span>
              <kbd>Ctrl K</kbd>
            </button>
            <button className="cd-icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
            </button>
            <button className="notification-button" onClick={() => goToSection('notifications')} aria-label="Notifications">
              <Icon name="bell" size={16} /><i />
            </button>
            <div className="profile-wrap">
              <button className="profile-button" onClick={() => setProfileOpen((v) => !v)}>
                <span className="avatar">{initials(session.user.email)}</span>
                <span className="profile-name">{session.user.email?.split('@')[0]}</span>
                <Icon name="more" size={14} />
              </button>
              {profileOpen && (
                <div className="profile-menu">
                  <strong>{session.user.email}</strong>
                  <span>Platform administrator</span>
                  <button onClick={onSignOut}>Sign out <Icon name="arrow" size={12} /></button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="admin-content">
          {/* Page heading */}
          <div className="content-heading" style={{ borderBottom: '1px solid var(--cd-border-subtle)', background: 'var(--cd-bg-surface)', padding: '16px 28px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <div className="cd-eyebrow">Control Center</div>
                <span style={{ fontSize: 10, fontFamily: 'var(--cd-font-mono)', padding: '1px 6px', borderRadius: 4, background: 'var(--cd-accent-subtle)', color: 'var(--cd-accent-primary)', border: '1px solid var(--cd-accent-ring)', fontWeight: 700 }}>
                  {isPlatformAdmin ? 'OPERATOR ROOT' : 'COMPLIANCE ADMIN'}
                </span>
              </div>
              <h1 style={{ fontSize: 18, fontWeight: 800, color: 'var(--cd-text-primary)', margin: '0 0 2px', letterSpacing: '-0.02em' }}>{currentNav.label}</h1>
              <p style={{ fontSize: 12, color: 'var(--cd-text-muted)', margin: 0 }}>
                {section === 'overview' ? 'Global operational health across all enterprise tenants.' : `Manage ${currentNav.label.toLowerCase()} across every tenant.`}
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--cd-text-muted)', fontFamily: 'var(--cd-font-mono)' }}>
                <span className={loading ? 'spinning' : ''} style={{ width: 6, height: 6, borderRadius: '50%', background: loading ? 'var(--cd-status-pending-text)' : 'var(--cd-status-approved-text)', display: 'inline-block' }} />
                {loading ? 'Updating…' : 'Updated just now'}
              </span>
              <Button icon="refresh" onClick={() => load(section)} disabled={loading}>Refresh</Button>
            </div>
          </div>

          {/* Alerts */}
          {error  && <div className="admin-alert danger"><Icon name="shield" size={15}/><span>{error}</span><button onClick={()=>setError('')}><Icon name="close" size={13}/></button></div>}
          {notice && <div className="admin-alert success"><Icon name="check" size={15}/><span>{notice}</span><button onClick={()=>setNotice('')}><Icon name="close" size={13}/></button></div>}

          {/* Section content */}
          <div style={{ padding: '24px 28px' }}>
            {renderers[section]?.()}
          </div>
        </div>
      </main>

      {/* Command palette */}
      {commandOpen && (
        <div className="command-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setCommandOpen(false)}>
          <div className="command-palette">
            <div className="command-input"><Icon name="search" size={16} /><input autoFocus placeholder="Jump to a page..." onChange={(e) => setSearch(e.target.value)} /><kbd>ESC</kbd></div>
            <div className="command-results">
              {NAV.filter((i) => !search || i.label.toLowerCase().includes(search.toLowerCase())).map((i) => (
                <button key={i.id} onClick={() => { goToSection(i.id); setCommandOpen(false); }}>
                  <Icon name={i.icon} size={15} /><span>{i.label}</span><Icon name="arrow" size={13} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Drawers */}
      {drawer === 'new-tenant' && <Drawer eyebrow="Tenant management" title="Add a new tenant" onClose={() => setDrawer(null)}><form className="drawer-form" onSubmit={createTenant}><Field label="Tenant name"><input className="cd-input" required placeholder="e.g. Gulf Trade Solutions" value={tenantForm.name} onChange={(e) => setTenantForm({ ...tenantForm, name: e.target.value })} /></Field><Field label="Subscription plan"><select className="admin-select full" value={tenantForm.plan_code} onChange={(e) => setTenantForm({ ...tenantForm, plan_code: e.target.value })}><option>STARTER</option><option>PROFESSIONAL</option><option>ENTERPRISE</option></select></Field><div className="drawer-actions"><Button onClick={() => setDrawer(null)}>Cancel</Button><Button type="submit" variant="primary">Create tenant</Button></div></form></Drawer>}
      {drawer === 'invite-user' && <Drawer eyebrow="Users & access" title="Invite a user" onClose={() => setDrawer(null)}><div className="drawer-empty"><div className="empty-mark"><Icon name="users" size={20} /></div><strong>Tenant invitations</strong><span>Invite and role management is available from each tenant's workspace.</span><Button onClick={() => { setDrawer(null); setSection('tenants'); }}>Go to tenants</Button></div></Drawer>}
      {drawer === 'tenant' && selectedTenant && <Drawer eyebrow="Tenant workspace" title={selectedTenant.name} onClose={() => setDrawer(null)} wide><div className="drawer-stat-grid"><div><span>Plan</span><strong>{selectedTenant.plan||'—'}</strong></div><div><span>Status</span><Badge>{selectedTenant.status}</Badge></div><div><span>Users</span><strong>{selectedTenant.user_count}</strong></div><div><span>Cases</span><strong>{selectedTenant.case_count}</strong></div></div><div className="drawer-section"><h3>Workspace controls</h3><div className="drawer-form"><Field label="Tenant name"><input className="cd-input" defaultValue={selectedTenant.name} onBlur={(e) => e.target.value !== selectedTenant.name && action(() => apiFetch(`/api/v1/admin/tenants/${selectedTenant.id}`, { method: 'PATCH', body: JSON.stringify({ name: e.target.value }) }), 'Tenant name updated.')} /></Field><Field label="Subscription plan"><select className="admin-select full" defaultValue={selectedTenant.plan} onChange={(e) => action(() => apiFetch(`/api/v1/admin/tenants/${selectedTenant.id}`, { method: 'PATCH', body: JSON.stringify({ plan_code: e.target.value }) }), 'Subscription plan updated.')}><option>STARTER</option><option>PROFESSIONAL</option><option>ENTERPRISE</option></select></Field><Field label="Status"><select className="admin-select full" defaultValue={selectedTenant.status} onChange={(e) => action(() => apiFetch(`/api/v1/admin/tenants/${selectedTenant.id}`, { method: 'PATCH', body: JSON.stringify({ status: e.target.value }) }), 'Tenant status updated.')}><option>ACTIVE</option><option>SUSPENDED</option></select></Field></div></div><div className="drawer-section"><h3>Usage this month</h3><div className="usage-row"><span>Cases processed</span><b>{selectedTenant.case_count||0}</b></div><div className="usage-row"><span>Users</span><b>{selectedTenant.user_count||0}</b></div></div></Drawer>}
      {drawer === 'case' && selectedCase && <Drawer eyebrow="Case oversight" title={selectedCase.case_ref} onClose={() => setDrawer(null)}><div className="case-drawer-status"><Badge>{selectedCase.state}</Badge><span>Created {formatDate(selectedCase.created_at, true)}</span></div><div className="detail-grid">{[['Tenant',selectedCase.tenant_name],['Party',selectedCase.end_user],['Destination',selectedCase.destination_country],['Risk',selectedCase.overall_risk],['Rule',selectedCase.fired_rule_code],['Case ID',selectedCase.id]].map(([label,value])=><div key={label}><span>{label}</span><strong>{value||'—'}</strong></div>)}</div></Drawer>}
      {drawer === 'list' && selectedList && <Drawer eyebrow="Sanctions source" title={selectedList.code} onClose={() => setDrawer(null)}><div className="source-drawer-head"><div className="source-mark large"><Icon name="shield" size={22} /></div><div><Badge tone={selectedList.last_error?'danger':'success'}>{selectedList.last_error?'sync error':'healthy'}</Badge><p>{selectedList.authority||selectedList.name}</p></div></div><div className="drawer-stat-grid"><div><span>Records</span><strong>{formatNumber(selectedList.entry_count)}</strong></div><div><span>Last sync</span><strong>{formatDate(selectedList.last_sync,true)}</strong></div><div><span>Next sync</span><strong>{selectedList.sync_cron||'—'}</strong></div></div><div className="drawer-section"><h3>Recent diff</h3><div className="diff-row added"><span>Added entries</span><b>+{selectedList.added_count||0}</b></div><div className="diff-row removed"><span>Removed entries</span><b>-{selectedList.removed_count||0}</b></div></div><Button variant="primary" icon="refresh" onClick={() => action(() => apiFetch(`/api/v1/admin/lists/${selectedList.code}/sync`, { method: 'POST' }), 'List sync started.')}>Sync now</Button></Drawer>}
      {drawer === 'new-version' && selectedAgent && <Drawer eyebrow="Agent configuration" title={`Publish ${selectedAgent.name || selectedAgent.code}`} onClose={() => setDrawer(null)}><form className="drawer-form" onSubmit={async (e) => { e.preventDefault(); const form = new FormData(e.currentTarget); await action(() => apiFetch(`/api/v1/admin/agents/${selectedAgent.code}/versions`, { method: 'POST', body: JSON.stringify({ version_label: form.get('version_label'), model_id: form.get('model_id'), system_prompt: form.get('system_prompt') }) }), 'Draft version created.'); setDrawer(null); }}><Field label="Version label"><input className="cd-input" name="version_label" required placeholder="v1.2.0" /></Field><Field label="Model"><input className="cd-input" name="model_id" defaultValue="claude-sonnet-4-6" /></Field><Field label="System prompt"><textarea className="cd-input code-input" name="system_prompt" required rows="12" placeholder="Write the classification system prompt..." /></Field><div className="drawer-actions"><Button onClick={() => setDrawer(null)}>Cancel</Button><Button variant="primary" type="submit">Create draft</Button></div></form></Drawer>}
      {drawer === 'new-exception' && <Drawer eyebrow="Licence configuration" title="Add licence exception" onClose={() => setDrawer(null)}><form className="drawer-form" onSubmit={async (e) => { e.preventDefault(); const form = new FormData(e.currentTarget); await action(() => apiFetch('/api/v1/admin/licence-exceptions', { method: 'POST', body: JSON.stringify({ code: form.get('code'), regime: form.get('regime'), name: form.get('name'), full_text: form.get('full_text') }) }), 'Licence exception created.'); setDrawer(null); }}><Field label="Exception code"><input className="cd-input" name="code" required placeholder="e.g. EAR-740.17" /></Field><Field label="Regime"><select className="admin-select full" name="regime"><option>EAR</option><option>ITAR</option><option>OFAC</option></select></Field><Field label="Name"><input className="cd-input" name="name" required placeholder="Exception name" /></Field><Field label="Full text"><textarea className="cd-input code-input" name="full_text" required rows="10" placeholder="Regulatory text and applicability..." /></Field><div className="drawer-actions"><Button onClick={() => setDrawer(null)}>Cancel</Button><Button variant="primary" type="submit">Create exception</Button></div></form></Drawer>}
      {drawer === 'exception' && selectedException && <Drawer eyebrow="Licence exception" title={selectedException.code} onClose={() => setDrawer(null)} wide><div className="drawer-stat-grid"><div><span>Regime</span><strong>{selectedException.regime}</strong></div><div><span>Status</span><Badge>{selectedException.status||'active'}</Badge></div><div><span>Conditions</span><strong>{selectedException.conditions?.length||0}</strong></div><div><span>Effective</span><strong>{formatDate(selectedException.effective_from,true)}</strong></div></div><div className="drawer-section"><h3>{selectedException.name}</h3><p>{selectedException.full_text||'No regulatory text entered.'}</p></div><div className="drawer-section"><h3>Conditions</h3>{selectedException.conditions?.length?selectedException.conditions.map((c)=><div className="usage-row" key={c.id}><span>{c.sequence}. {c.condition_text}</span><Badge tone={c.is_verifiable_automatically?'success':'warning'}>{c.is_verifiable_automatically?'automatic':'manual'}</Badge></div>):<EmptyState title="No conditions configured" description="This exception does not have any attached conditions." />}</div></Drawer>}
    </div>
  );
}
