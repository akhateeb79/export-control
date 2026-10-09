import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { getSession } from '../lib/auth';
import RedFlagPanel from '../components/RedFlagPanel';
import CatchAllPanel from '../components/CatchAllPanel';
import StatusBadge from '../components/StatusBadge';
import ScreeningResult from '../components/ScreeningResult';
import ClassificationResult from '../components/ClassificationResult';
import AssessmentResult from '../components/AssessmentResult';
import DeterminationResult from '../components/DeterminationResult';
import DocumentUpload from '../components/DocumentUpload';
import CaseEvaluation from '../components/CaseEvaluation';
import RecommendedActionsPanel from '../components/RecommendedActionsPanel';

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

export default function CaseDetail() {
  const { id } = useParams();
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState('');
  const [actionState, setActionState] = useState({ busy: '', error: '' });
  const [rationale, setRationale] = useState('');
  const [reviewerName, setReviewerName] = useState(getSession()?.user?.display_name || getSession()?.user?.email || '');
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [cecoUserId, setCecoUserId] = useState(null);
  const [recommendedActions, setRecommendedActions] = useState([]);

  async function loadCase() {
    try {
      setPayload(await apiFetch(`/api/v1/cases/${id}`));
      setError('');
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  useEffect(() => { loadCase(); }, [id]);
  async function loadRecommendedActions() {
    try {
      const result = await apiFetch(`/api/v1/cases/${id}/recommended-actions`);
      setRecommendedActions(result.actions || []);
    } catch {
      setRecommendedActions([]);
    }
  }
  useEffect(() => { loadRecommendedActions(); }, [id]);

  useEffect(() => {
    if (getSession()?.user?.role !== 'COMPLIANCE_ADMIN') return undefined;
    let active = true;
    apiFetch('/api/v1/icp/programme').then((response) => {
      if (active) setCecoUserId(response.programme?.ceco_user_id || null);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const state = payload?.case?.state;
    if (!state || ['DRAFT', 'APPROVED', 'BLOCKED', 'CLOSED', 'FAILED'].includes(state)) return undefined;
    const timer = setInterval(loadCase, 3000);
    return () => clearInterval(timer);
  }, [id, payload?.case?.state]);

  useEffect(() => {
    if (payload && window.location.hash === '#ceco-review') {
      window.setTimeout(() => document.getElementById('ceco-review')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
    }
  }, [payload]);

  async function runAction(action, path, options) {
    setActionState({ busy: action, error: '' });
    try {
      await apiFetch(path, options);
      await loadCase();
    } catch (requestError) {
      setActionState({ busy: '', error: requestError.body?.error?.code || requestError.message });
      return;
    }
    setActionState({ busy: '', error: '' });
  }

  const caseRecord = payload?.case;
  const screening = payload?.screening_results || [];
  const sanctionsBlocked = useMemo(() => caseRecord?.fired_rule_code === 'RULE_1' || caseRecord?.overall_risk === 'BLOCKED' || screening.some((item) => item.status === 'CONFIRMED_HIT'), [caseRecord, screening]);
  const potentialSanctions = useMemo(() => screening.filter((item) => item.status === 'POTENTIAL_HIT'), [screening]);
  const assessments = payload?.licence?.assessments || [];
  const role = getSession()?.user?.role;
  const canDecide = role === 'COMPLIANCE_OFFICER';
  const canEdit = !['COMPLIANCE_VIEWER'].includes(role);
  const awaitingCeco = caseRecord?.state === 'AWAITING_CECO_REVIEW';
  const canReviewCeco = role === 'COMPLIANCE_ADMIN' && awaitingCeco && (!cecoUserId || cecoUserId === getSession()?.user?.user_id);
  const recommendation = caseRecord?.unified_recommendation;
  const classifications = Array.isArray(payload?.classifications)
    ? payload.classifications
    : payload?.classifications?.results || [];
  const orchestrationStages = [
    ['Sanctions screening', screening.length > 0],
    ['Product classification', classifications.length > 0],
    ['End-user and end-use assessment', assessments.length >= 2],
    ['Risk and licence recommendation', Boolean(recommendation)]
  ];
  const actionButton = (action, label, path, options) => (
    <div className="flex flex-col items-start gap-2">
      <button
        className="button-primary"
        disabled={Boolean(actionState.busy)}
        onClick={() => runAction(action, path, options)}
      >
        {actionState.busy === action ? `${label}…` : label}
      </button>
      {actionState.busy !== action && actionState.error && <p className="text-sm text-rose-300">{actionState.error}</p>}
    </div>
  );
  async function amendCase() {
    const reason = window.prompt('Why is this case being amended?');
    if (!reason) return;
    const destination = window.prompt('Destination country (leave blank to keep current)', caseRecord.destination_country || '');
    try {
      await apiFetch(`/api/v1/cases/${id}/amend`, {
        method: 'PATCH',
        body: JSON.stringify({ reason, ...(destination ? { destination_country: destination.toUpperCase() } : {}) })
      });
      await loadCase();
    } catch (requestError) {
      setActionState({ busy: '', error: requestError.body?.error?.code || requestError.message });
    }
  }
  async function cloneCase() {
    try {
      const result = await apiFetch(`/api/v1/cases/${id}/clone`, { method: 'POST', body: JSON.stringify({}) });
      window.location.assign(`/cases/${result.case.id}`);
    } catch (requestError) {
      setActionState({ busy: '', error: requestError.body?.error?.code || requestError.message });
    }
  }

  if (error) return <div className="page"><Link className="text-cyan-200" to="/">← Back to cases</Link><div className="callout callout-danger mt-6">{error}</div></div>;
  if (!payload) return <div className="page"><div className="empty-state">Loading case record…</div></div>;

  return (
    <div className="page">
      <div className="mb-7 flex items-center gap-3 text-sm text-slate-500"><Link className="hover:text-cyan-200" to="/">Cases</Link><span>/</span><span className="text-slate-300">{caseRecord.case_ref}</span></div>
      <header className="page-header">
         <div><p className="eyebrow">Case dossier / {caseRecord.id}</p><div className="mt-3 flex flex-wrap items-center gap-3"><h1>{caseRecord.case_ref}</h1><StatusBadge status={caseRecord.state} /></div><p className="page-subtitle">Created {formatDate(caseRecord.created_at)} · Destination {caseRecord.destination_country || '—'}</p></div>
         {['COMPLIANCE_OFFICER', 'COMPLIANCE_ADMIN', 'SUPER_ADMIN'].includes(getSession()?.user?.role) && <Link className="button-primary" to={`/cases/${id}/monitor`}>Open live monitor →</Link>}
        <div className="text-right"><p className="eyebrow">Overall risk</p><p className={`mt-2 text-2xl font-semibold ${caseRecord.overall_risk === 'BLOCKED' ? 'text-rose-300' : 'text-white'}`}>{caseRecord.overall_risk || 'Pending'}</p>{canEdit && <div className="mt-4 flex justify-end gap-2"><button className="button-secondary" onClick={amendCase}>Amend</button><button className="button-quiet" onClick={cloneCase}>Clone</button></div>}</div>
      </header>
      {sanctionsBlocked && <div className="callout callout-danger mb-6"><strong>Case action locked</strong><span>Confirmed sanctions matches are permanent blocks. No override or approval action is available.</span></div>}
       {caseRecord.state === 'SCREENING_REVIEW' && canDecide && potentialSanctions.length > 0 && <section className="panel mb-6 border-amber-400/30">
         <p className="eyebrow">Sanctions review required</p>
         <h2 className="mt-2 text-lg font-semibold text-white">Corroborate or clear the potential hit</h2>
         <p className="mt-2 text-sm leading-6 text-slate-400">The name score alone is not sufficient for an automatic block. Review the matched entry and party evidence, then record whether this is a false positive or a real sanctions match.</p>
         <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm text-slate-300">
           <strong>{potentialSanctions.length} potential hit{potentialSanctions.length === 1 ? '' : 's'}</strong>
           <span className="ml-2 text-slate-500">The highest-scoring result is selected for this review action.</span>
         </div>
         <textarea className="field mt-4 min-h-24" placeholder="Record the review rationale" value={rationale} onChange={(event) => setRationale(event.target.value)} />
         <div className="mt-4 flex flex-wrap gap-3">
           <button className="button-secondary" disabled={Boolean(actionState.busy) || !rationale.trim()} onClick={() => runAction('false-positive', `/api/v1/cases/${id}/sanctions-review`, { method: 'POST', body: JSON.stringify({ decision: 'FALSE_POSITIVE_CONFIRMED', rationale }) })}>
             {actionState.busy === 'false-positive' ? 'Clearing…' : 'Confirm false positive and rescreen'}
           </button>
           <button className="button-primary" disabled={Boolean(actionState.busy) || !rationale.trim()} onClick={() => runAction('sanctions-hit', `/api/v1/cases/${id}/sanctions-review`, { method: 'POST', body: JSON.stringify({ decision: 'SANCTIONS_HIT_CONFIRMED', rationale }) })}>
             {actionState.busy === 'sanctions-hit' ? 'Blocking…' : 'Confirm sanctions hit and block'}
           </button>
         </div>
         {!['false-positive', 'sanctions-hit'].includes(actionState.busy) && actionState.error && <p className="mt-3 text-sm text-rose-300">{actionState.error}</p>}
       </section>}
       <section className="mb-6 grid gap-3 sm:grid-cols-3"><div className="metric"><span className="data-label">Destination</span><strong>{caseRecord.destination_country || '—'}</strong></div><div className="metric"><span className="data-label">Planned ship date</span><strong>{formatDate(caseRecord.planned_ship_date)}</strong></div><div className="metric"><span className="data-label">Declared end use</span><strong>{caseRecord.declared_end_use || caseRecord.stated_end_use || '—'}</strong></div><div className="metric"><span className="data-label">Product</span><strong>{caseRecord.product_description || '—'}</strong></div><div className="metric"><span className="data-label">Part number</span><strong>{caseRecord.product_part_number || '—'}</strong></div><div className="metric"><span className="data-label">Quantity</span><strong>{caseRecord.quantity || '—'}</strong></div></section>
      {!sanctionsBlocked && <section className="mb-6 flex flex-wrap items-start gap-3">
        {caseRecord.state === 'DRAFT' && actionButton('submit', 'Submit', `/api/v1/cases/${id}/submit`)}
        {['PENDING_DECISION', 'AWAITING_CECO_REVIEW'].includes(caseRecord.state) && canDecide && <div className="flex flex-col items-start gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <input className="field min-w-72" required placeholder="Decision rationale" value={rationale} onChange={(event) => setRationale(event.target.value)} />
            <button
              className="button-primary"
              title={awaitingCeco ? 'CECO review is required before approval' : undefined}
              disabled={Boolean(actionState.busy) || !rationale.trim() || awaitingCeco}
              onClick={() => runAction('approve', `/api/v1/cases/${id}/decision`, {
                method: 'POST',
                body: JSON.stringify({ decision: 'APPROVE', rationale })
              })}
            >
              {actionState.busy === 'approve' ? 'Approving…' : 'Approve'}
            </button>
            <button
              className="button-secondary"
              disabled={Boolean(actionState.busy) || !rationale.trim()}
              onClick={() => runAction('block', `/api/v1/cases/${id}/decision`, {
                method: 'POST',
                body: JSON.stringify({ decision: 'BLOCK', rationale })
              })}
            >
              {actionState.busy === 'block' ? 'Blocking…' : 'Block'}
            </button>
          </div>
          {!['approve', 'block'].includes(actionState.busy) && actionState.error && <p className="text-sm text-rose-300">{actionState.error}</p>}
        </div>}
        {canReviewCeco && <div id="ceco-review" className="panel w-full max-w-2xl">
          <p className="eyebrow">CECO review</p>
           <h2 className="mt-2 text-lg font-semibold text-white">CECO Sign-off Required</h2>
             <p className="mt-2 text-sm text-slate-400">Review the case, agent assessments, and unified recommendation before releasing it for officer decision.</p>
          <div className="mt-4 grid gap-3">
            <label className="field-label">Reviewer full name
              <input className="field" value={reviewerName} onChange={(event) => setReviewerName(event.target.value)} placeholder="Enter your display name" />
            </label>
            <label className="field-label">Review notes
              <textarea className="field min-h-24" value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} placeholder="Record the CECO review rationale" />
            </label>
            <label className="flex items-start gap-3 text-sm text-slate-300">
              <input type="checkbox" checked={reviewConfirmed} onChange={(event) => setReviewConfirmed(event.target.checked)} />
               <span>I have reviewed this case, the agent assessments, and the unified recommendation, and I authorise this case to proceed to officer decision.</span>
            </label>
            <button
              className="button-primary w-fit"
              disabled={Boolean(actionState.busy) || !reviewerName.trim() || !reviewNotes.trim() || !reviewConfirmed}
              onClick={() => runAction('ceco-review', `/api/v1/cases/${id}/ceco-review`, {
                method: 'POST',
                 body: JSON.stringify({ confirmed: reviewConfirmed, reviewer_name: reviewerName, notes: reviewNotes })
              })}
            >
              {actionState.busy === 'ceco-review' ? 'Submitting review…' : 'Complete CECO review'}
            </button>
            {actionState.busy !== 'ceco-review' && actionState.error && <p className="text-sm text-rose-300">{actionState.error}</p>}
          </div>
        </div>}
      </section>}
      {['SCREENING', 'PENDING_DECISION', 'AWAITING_CECO_REVIEW'].includes(caseRecord.state) && <section className="panel mb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="eyebrow">Automated orchestration</p><h2 className="mt-2 text-lg font-semibold text-white">Running case analysis</h2></div>
          <span className="text-xs text-slate-500">Updates automatically</span>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {orchestrationStages.map(([label, complete]) => (
            <div key={label} className={`rounded-xl border p-3 ${complete ? 'border-emerald-400/30 bg-emerald-400/5' : 'border-white/10 bg-white/[0.02]'}`}>
              <p className={`text-xs font-semibold ${complete ? 'text-emerald-300' : 'text-slate-500'}`}>{complete ? 'Complete' : 'In progress'}</p>
              <p className="mt-2 text-sm text-slate-200">{label}</p>
            </div>
          ))}
        </div>
      </section>}
       {awaitingCeco && <div className="callout callout-warning mb-5"><strong>Awaiting CECO Review</strong><span>This case requires CECO review before a decision can be made.</span></div>}
      {recommendation && <section className="panel mb-5">
        <p className="eyebrow">Unified recommendation</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="metric"><span className="data-label">Risk score</span><strong>{recommendation.risk_score ?? '—'}</strong></div>
          <div className="metric"><span className="data-label">Risk level</span><strong>{recommendation.risk_level || '—'}</strong></div>
          <div className="metric"><span className="data-label">Licence outcome</span><strong>{recommendation.licence_outcome || '—'}</strong></div>
        </div>
        {recommendation.reasoning && <p className="mt-4 text-sm leading-6 text-slate-400">{recommendation.reasoning}</p>}
      </section>}
       <CaseEvaluation evaluation={payload.evaluation} />
       <RecommendedActionsPanel actions={recommendedActions} canEdit={canEdit} onRefresh={loadRecommendedActions} />
      {canEdit && <DocumentUpload caseId={id} onApplied={loadCase} />}
       {canEdit && <RedFlagPanel caseId={id} caseState={caseRecord.state} />}
       {canEdit && <CatchAllPanel caseId={id} initialAssessment={caseRecord.catch_all_assessment} caseRecord={caseRecord} />}
       <div className="grid gap-5"><ScreeningResult results={screening} blocked={sanctionsBlocked} /><ClassificationResult classifications={payload.classifications} /><AssessmentResult assessments={assessments} /><DeterminationResult licence={payload.licence} /></div>
    </div>
  );
}