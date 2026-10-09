'use strict';

const crypto = require('node:crypto');
const PDFDocument = require('pdfkit');

const BAFA_CRITERIA = [
  'Management Commitment',
  'Risk Analysis',
  'Organisation & Responsibilities',
  'Human Resources & Reliability',
  'Workflow Management',
  'Record Keeping & Monitoring',
  'Staff Training',
  'ICP Audit',
  'Physical Security & IT Security'
];

const REPORT_DISCLAIMER = (reportId) =>
  `AI-assisted report. The CECO is solely responsible for all regulatory submissions and compliance decisions. Reference: ${reportId}`;

function percent(numerator, denominator) {
  return denominator ? Number((Number(numerator || 0) * 100 / Number(denominator)).toFixed(2)) : 0;
}

function dateOnly(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function safe(value) {
  return value == null || value === '' ? '—' : String(value);
}

function criterionScore(parts) {
  const values = parts.filter((value) => value !== null && value !== undefined);
  return values.length ? Math.round(values.reduce((sum, value) => sum + Number(value), 0) / values.length) : 0;
}

async function generateBafaIcpReport({ client, tenantId, generatedBy, periodStart, periodEnd }) {
  const [
    tenant,
    programme,
    risk,
    staff,
    deputy,
    documents,
    training,
    trainingExpiries,
    audits,
    actions,
    auditEvents,
    regulatorySubmissions,
    cases,
    screening,
    exceptions,
    mfaResult
  ] = await Promise.all([
    client.query(`SELECT id, name FROM tenants WHERE id = $1`, [tenantId]),
    client.query(`SELECT * FROM icp_programme WHERE tenant_id = $1`, [tenantId]),
    client.query(
      `SELECT * FROM icp_risk_profiles WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [tenantId]
    ),
    client.query(
      `SELECT count(*)::int AS staff_count,
              count(*) FILTER (WHERE qualification_verified)::int AS qualified_count,
              count(*) FILTER (WHERE reliability_confirmed)::int AS reliable_count
         FROM icp_staff_records
        WHERE tenant_id = $1 AND is_active = TRUE`,
      [tenantId]
    ),
    client.query(
      `SELECT full_name, title FROM icp_staff_records
        WHERE tenant_id = $1 AND role_in_icp = 'DEPUTY_CECO' AND is_active = TRUE
        ORDER BY created_at DESC LIMIT 1`,
      [tenantId]
    ),
    client.query(
      `SELECT id, document_type, version, status, title, file_path, effective_date
         FROM icp_documents
        WHERE tenant_id = $1
        ORDER BY created_at DESC`,
      [tenantId]
    ),
    client.query(
      `SELECT count(*)::int AS training_count,
              count(DISTINCT staff_record_id)::int AS trained_staff
         FROM icp_training_records
        WHERE tenant_id = $1
          AND completed_date >= $2::date
          AND completed_date < ($3::date + 1)`,
      [tenantId, periodStart, periodEnd]
    ),
    client.query(
      `SELECT tr.id, s.full_name, tr.topic, tr.expiry_date,
              (tr.expiry_date - CURRENT_DATE)::int AS days_remaining
         FROM icp_training_records tr
         JOIN icp_staff_records s ON s.id = tr.staff_record_id
        WHERE tr.tenant_id = $1
          AND tr.expiry_date >= CURRENT_DATE
          AND tr.expiry_date <= CURRENT_DATE + 90
        ORDER BY tr.expiry_date, s.full_name`,
      [tenantId]
    ),
    client.query(
      `SELECT id, conducted_date, overall_result, criteria_scores, report_doc_id
         FROM icp_audit_logs
        WHERE tenant_id = $1
        ORDER BY conducted_date DESC, created_at DESC`,
      [tenantId]
    ),
    client.query(
      `SELECT ca.id, ca.criterion_reference, ca.severity, ca.finding_description,
              ca.due_date, ca.status
         FROM icp_corrective_actions ca
        WHERE ca.tenant_id = $1 AND ca.status IN ('OPEN', 'IN_PROGRESS')
        ORDER BY CASE ca.severity WHEN 'CRITICAL' THEN 1 WHEN 'MAJOR' THEN 2 ELSE 3 END,
                 ca.due_date, ca.id`,
      [tenantId]
    ),
    client.query(
      `SELECT count(*)::int AS event_count
         FROM audit_events
        WHERE tenant_id = $1
          AND occurred_at >= $2::date
          AND occurred_at < ($3::date + 1)`,
      [tenantId, periodStart, periodEnd]
    ),
    client.query(
      `SELECT count(*)::int AS submission_count
         FROM icp_documents
        WHERE tenant_id = $1 AND document_type = 'REGULATORY_SUBMISSION'
          AND created_at >= $2::date AND created_at < ($3::date + 1)`,
      [tenantId, periodStart, periodEnd]
    ),
    client.query(
      `WITH outcome_rows AS (
         SELECT CASE
                  WHEN state = 'APPROVED' THEN 'APPROVED'
                  WHEN state IN ('BLOCKED', 'REJECTED') THEN 'BLOCKED'
                  ELSE 'PENDING'
                END AS outcome,
                count(*)::int AS count,
                round(avg(EXTRACT(epoch FROM (COALESCE(decided_at, now()) - created_at)) / 3600.0), 2) AS average_cycle_time_hours
           FROM compliance_cases
          WHERE tenant_id = $1 AND created_at >= $2::date AND created_at < ($3::date + 1)
          GROUP BY 1
       )
       SELECT * FROM outcome_rows ORDER BY outcome`,
      [tenantId, periodStart, periodEnd]
    ),
    client.query(
      `SELECT count(DISTINCT party_id)::int AS parties_screened,
              count(*) FILTER (WHERE status IN ('POSSIBLE_HIT', 'CONFIRMED_HIT'))::int AS hits,
              count(*) FILTER (WHERE status IN ('POSSIBLE_HIT', 'CONFIRMED_HIT') AND case_id IN (
                SELECT id FROM compliance_cases WHERE tenant_id = $1 AND state = 'APPROVED'
              ))::int AS approved_hits
         FROM screening_results
        WHERE tenant_id = $1
          AND screened_at >= $2::date AND screened_at < ($3::date + 1)`,
      [tenantId, periodStart, periodEnd]
    ),
    client.query(
      `SELECT COALESCE(ld.exception_code, 'NONE') AS exception_code,
              count(*)::int AS usage_count
         FROM licence_determinations ld
         JOIN compliance_cases c ON c.id = ld.case_id AND c.tenant_id = ld.tenant_id
        WHERE ld.tenant_id = $1
          AND c.created_at >= $2::date AND c.created_at < ($3::date + 1)
        GROUP BY 1 ORDER BY usage_count DESC, exception_code`,
      [tenantId, periodStart, periodEnd]
    ),
    client.query(
      `SELECT count(*)::int AS active_users,
              count(*) FILTER (WHERE mfa_enabled = TRUE)::int AS mfa_users
         FROM users
        WHERE tenant_id = $1 AND is_active = TRUE`,
      [tenantId]
    )
  ]);

  const tenantRow = tenant.rows[0];
  if (!tenantRow) throw Object.assign(new Error('Tenant not found'), { code: 'NOT_FOUND' });
  const programmeRow = programme.rows[0] || {};
  const riskRow = risk.rows[0] || {};
  const staffRow = staff.rows[0] || { staff_count: 0, qualified_count: 0, reliable_count: 0 };
  const latestDocuments = new Map();
  for (const document of documents.rows) {
    if (!latestDocuments.has(document.document_type)) latestDocuments.set(document.document_type, document);
  }
  const orgChart = latestDocuments.get('ORG_CHART');
  const processManual = latestDocuments.get('PROCESS_MANUAL');
  const commitment = latestDocuments.get('COMMITMENT_LETTER');
  const latestAudit = audits.rows[0] || {};
  const staffCount = Number(staffRow.staff_count || 0);
  const trainedStaff = Number(training.rows[0]?.trained_staff || 0);
  const outcomes = cases.rows;
  const totalCases = outcomes.reduce((sum, row) => sum + Number(row.count || 0), 0);
  const approved = Number(outcomes.find((row) => row.outcome === 'APPROVED')?.count || 0);
  const blocked = Number(outcomes.find((row) => row.outcome === 'BLOCKED')?.count || 0);
  const pending = Number(outcomes.find((row) => row.outcome === 'PENDING')?.count || 0);
  const cecoReview = await client.query(
    `SELECT count(*)::int AS count
       FROM compliance_cases
      WHERE tenant_id = $1 AND ceco_review_required = TRUE
        AND created_at >= $2::date AND created_at < ($3::date + 1)`,
    [tenantId, periodStart, periodEnd]
  );
  const cycle = await client.query(
    `SELECT round(avg(EXTRACT(epoch FROM (COALESCE(decided_at, now()) - created_at)) / 3600.0), 2) AS average_hours
       FROM compliance_cases
      WHERE tenant_id = $1 AND created_at >= $2::date AND created_at < ($3::date + 1)`,
    [tenantId, periodStart, periodEnd]
  );

  const criteria = [
    {
      number: 1,
      name: BAFA_CRITERIA[0],
      score: criterionScore([programmeRow.management_commitment_date ? 100 : 0, commitment ? 100 : 0]),
      evidence: {
        management_commitment_date: programmeRow.management_commitment_date,
        document_reference: commitment?.title || null
      },
      gap: programmeRow.management_commitment_date && commitment ? null : 'Management commitment date and current commitment evidence are incomplete.',
      supporting_documents: commitment ? [commitment.title] : []
    },
    {
      number: 2,
      name: BAFA_CRITERIA[1],
      score: criterionScore([riskRow.id ? 50 : 0, riskRow.approved_by_ceco ? 50 : 0]),
      evidence: {
        profile_version: riskRow.profile_version || null,
        review_date: riskRow.next_review_due || null,
        ceco_approval_date: riskRow.approved_at || null
      },
      gap: riskRow.id && riskRow.approved_by_ceco ? null : 'A current CECO-approved risk profile is required.',
      supporting_documents: latestDocuments.get('RISK_METHODOLOGY')?.title ? [latestDocuments.get('RISK_METHODOLOGY').title] : []
    },
    {
      number: 3,
      name: BAFA_CRITERIA[2],
      score: criterionScore([programmeRow.ceco_name ? 40 : 0, deputy.rows[0] ? 30 : 0, orgChart ? 30 : 0]),
      evidence: {
        ceco_name: programmeRow.ceco_name || null,
        deputy_ceco_name: deputy.rows[0]?.full_name || null,
        org_chart_document_reference: orgChart?.title || null
      },
      gap: programmeRow.ceco_name && deputy.rows[0] && orgChart ? null : 'CECO, deputy CECO, and organisation chart evidence must be complete.',
      supporting_documents: orgChart ? [orgChart.title] : []
    },
    {
      number: 4,
      name: BAFA_CRITERIA[3],
      score: criterionScore([staffCount ? 100 : 0, percent(staffRow.qualified_count, staffCount), percent(staffRow.reliable_count, staffCount)]),
      evidence: {
        staff_count: staffCount,
        qualification_rate_percent: percent(staffRow.qualified_count, staffCount),
        reliability_rate_percent: percent(staffRow.reliable_count, staffCount)
      },
      gap: staffCount && Number(staffRow.qualified_count) === staffCount && Number(staffRow.reliable_count) === staffCount ? null : 'Active staff qualification and reliability records are incomplete.',
      supporting_documents: []
    },
    {
      number: 5,
      name: BAFA_CRITERIA[4],
      score: processManual ? 100 : 0,
      evidence: {
        process_manual_version: processManual?.version || null,
        last_review_date: processManual?.effective_date || null
      },
      gap: processManual ? null : 'A current process manual is not recorded.',
      supporting_documents: processManual ? [processManual.title] : []
    },
    {
      number: 6,
      name: BAFA_CRITERIA[5],
      score: criterionScore([Number(auditEvents.rows[0]?.event_count || 0) > 0 ? 50 : 0, Number(regulatorySubmissions.rows[0]?.submission_count || 0) > 0 ? 50 : 0]),
      evidence: {
        audit_event_count: Number(auditEvents.rows[0]?.event_count || 0),
        regulatory_submissions_count: Number(regulatorySubmissions.rows[0]?.submission_count || 0)
      },
      gap: Number(auditEvents.rows[0]?.event_count || 0) && Number(regulatorySubmissions.rows[0]?.submission_count || 0) ? null : 'Audit evidence and regulatory submission records need strengthening.',
      supporting_documents: []
    },
    {
      number: 7,
      name: BAFA_CRITERIA[6],
      score: criterionScore([percent(trainedStaff, staffCount), Number(training.rows[0]?.training_count || 0) > 0 ? 100 : 0]),
      evidence: {
        training_completion_rate_percent: percent(trainedStaff, staffCount),
        expiring_within_90_days_count: trainingExpiries.rowCount
      },
      gap: trainedStaff === staffCount && staffCount > 0 ? null : 'Training coverage is incomplete for active ICP staff.',
      supporting_documents: []
    },
    {
      number: 8,
      name: BAFA_CRITERIA[7],
      score: criterionScore([latestAudit.id ? 50 : 0, actions.rowCount === 0 ? 50 : 0]),
      evidence: {
        last_audit_date: latestAudit.conducted_date || null,
        result: latestAudit.overall_result || null,
        open_corrective_actions_count: actions.rowCount
      },
      gap: latestAudit.id && actions.rowCount === 0 ? null : 'The latest audit or corrective-action closure evidence is incomplete.',
      supporting_documents: latestAudit.report_doc_id ? [latestAudit.report_doc_id] : []
    }
  ];

  const mfaActiveUsers = Number(mfaResult.rows[0]?.active_users || 0);
  const mfaEnabledUsers = Number(mfaResult.rows[0]?.mfa_users || 0);
  const mfaRate = percent(mfaEnabledUsers, mfaActiveUsers);
  criteria.push({
    number: 9,
    name: BAFA_CRITERIA[8],
    score: criterionScore([mfaRate]),
    evidence: {
      active_users: mfaActiveUsers,
      mfa_enabled_users: mfaEnabledUsers,
      mfa_adoption_rate_percent: mfaRate
    },
    gap: mfaRate >= 100 ? null : `MFA is enabled for ${mfaEnabledUsers} of ${mfaActiveUsers} active users (${mfaRate}%). Full adoption is required.`,
    supporting_documents: []
  });

  const report = {
    report_type: 'BAFA_ICP',
    tenant: { id: tenantRow.id, name: tenantRow.name },
    period_start: periodStart,
    period_end: periodEnd,
    programme: {
      ceco_name: programmeRow.ceco_name || null,
      ceco_title: programmeRow.ceco_title || null,
      appointment_date: programmeRow.appointment_date || null,
      programme_status: programmeRow.programme_status || 'DRAFT',
      bafa_form_reference: programmeRow.bafa_form_reference || null
    },
    criteria,
    overall_score: Math.round(criteria.reduce((sum, criterion) => sum + criterion.score, 0) / criteria.length),
    transaction_summary: {
      total_cases_submitted: totalCases,
      approved_count: approved,
      approved_percent: percent(approved, totalCases),
      blocked_count: blocked,
      blocked_percent: percent(blocked, totalCases),
      pending_count: pending,
      ceco_review_cases_count: Number(cecoReview.rows[0]?.count || 0),
      average_cycle_time_hours: cycle.rows[0]?.average_hours == null ? null : Number(cycle.rows[0].average_hours)
    },
    screening_summary: {
      total_parties_screened: Number(screening.rows[0]?.parties_screened || 0),
      hits_count: Number(screening.rows[0]?.hits || 0),
      false_positive_rate: percent(screening.rows[0]?.approved_hits, screening.rows[0]?.hits)
    },
    licence_exception_usage: exceptions.rows,
    open_corrective_actions: actions.rows,
    upcoming_training_expiries: trainingExpiries.rows,
    generated_at: new Date().toISOString()
  };
  const inserted = await client.query(
    `INSERT INTO compliance_reports
       (tenant_id, report_type, period_start, period_end, generated_by, parameters, result_json)
     VALUES ($1, 'BAFA_ICP', $2, $3, $4, $5::jsonb, $6::jsonb)
     RETURNING id, tenant_id, report_type, period_start, period_end, generated_by, generated_at, parameters, result_json, pdf_path`,
    [tenantId, periodStart, periodEnd, generatedBy, JSON.stringify({ period_start: periodStart, period_end: periodEnd }), JSON.stringify(report)]
  );
  return { report: { ...inserted.rows[0], result_json: report } };
}

async function fetchBafaReport(client, tenantId, reportId = null) {
  const result = await client.query(
    `SELECT cr.*, t.name AS tenant_name,
            COALESCE(NULLIF(to_jsonb(u)->>'display_name', ''), u.email) AS generated_by_name
       FROM compliance_reports cr
       JOIN tenants t ON t.id = cr.tenant_id
       JOIN users u ON u.id = cr.generated_by
      WHERE cr.tenant_id = $1 AND cr.report_type = 'BAFA_ICP'
        AND ($2::uuid IS NULL OR cr.id = $2::uuid)
      ORDER BY cr.generated_at DESC
      LIMIT 1`,
    [tenantId, reportId]
  );
  return result.rows[0] || null;
}

async function fetchBafaHistory(client, tenantId) {
  const result = await client.query(
    `SELECT id, report_type, period_start, period_end, generated_at, pdf_path,
            result_json->>'overall_score' AS overall_score
       FROM compliance_reports
      WHERE tenant_id = $1 AND report_type = 'BAFA_ICP'
      ORDER BY generated_at DESC`,
    [tenantId]
  );
  return result.rows;
}

async function caseOutcomesReport(client, tenantId, periodStart, periodEnd) {
  const [distribution, weekly, destinations, parties, cycle] = await Promise.all([
    client.query(
      `SELECT CASE WHEN state = 'APPROVED' THEN 'APPROVED'
                  WHEN state IN ('BLOCKED', 'REJECTED') THEN state
                  ELSE 'PENDING' END AS outcome, count(*)::int AS count
         FROM compliance_cases
        WHERE tenant_id = $1 AND created_at >= $2::date AND created_at < ($3::date + 1)
        GROUP BY 1 ORDER BY 1`,
      [tenantId, periodStart, periodEnd]
    ),
    client.query(
      `SELECT to_char(date_trunc('week', created_at), 'YYYY-MM-DD') AS week,
              CASE WHEN state = 'APPROVED' THEN 'APPROVED'
                   WHEN state IN ('BLOCKED', 'REJECTED') THEN state
                   ELSE 'PENDING' END AS outcome,
              count(*)::int AS count
         FROM compliance_cases
        WHERE tenant_id = $1 AND created_at >= $2::date AND created_at < ($3::date + 1)
        GROUP BY 1, 2 ORDER BY 1, 2`,
      [tenantId, periodStart, periodEnd]
    ),
    client.query(
      `SELECT destination_country, count(*)::int AS count
         FROM compliance_cases
        WHERE tenant_id = $1 AND state IN ('BLOCKED', 'REJECTED')
          AND created_at >= $2::date AND created_at < ($3::date + 1)
        GROUP BY destination_country ORDER BY count DESC, destination_country LIMIT 5`,
      [tenantId, periodStart, periodEnd]
    ),
    client.query(
      `SELECT 'party-' || substr(md5(p.id::text), 1, 10) AS anonymised_party_ref,
              count(*)::int AS count
         FROM compliance_cases c
         JOIN case_parties cp ON cp.case_id = c.id AND cp.tenant_id = c.tenant_id
         JOIN parties p ON p.id = cp.party_id AND p.tenant_id = c.tenant_id
        WHERE c.tenant_id = $1 AND c.state IN ('BLOCKED', 'REJECTED')
          AND c.created_at >= $2::date AND c.created_at < ($3::date + 1)
        GROUP BY p.id ORDER BY count DESC LIMIT 5`,
      [tenantId, periodStart, periodEnd]
    ),
    client.query(
      `SELECT CASE WHEN state = 'APPROVED' THEN 'APPROVED'
                  WHEN state IN ('BLOCKED', 'REJECTED') THEN state
                  ELSE 'PENDING' END AS outcome,
              round(avg(EXTRACT(epoch FROM (COALESCE(decided_at, now()) - created_at)) / 3600.0), 2) AS average_cycle_time_hours
         FROM compliance_cases
        WHERE tenant_id = $1 AND created_at >= $2::date AND created_at < ($3::date + 1)
        GROUP BY 1 ORDER BY 1`,
      [tenantId, periodStart, periodEnd]
    )
  ]);
  return {
    report_type: 'CASE_OUTCOMES',
    period_start: periodStart,
    period_end: periodEnd,
    distribution: distribution.rows,
    weekly_trend: weekly.rows,
    top_blocked_destinations: destinations.rows,
    top_blocked_parties: parties.rows,
    average_cycle_time_by_outcome: cycle.rows
  };
}

async function screeningHitsReport(client, tenantId, periodStart, periodEnd) {
  const [sources, weekly, conversion] = await Promise.all([
    client.query(
      `SELECT source_code, count(*)::int AS screened,
              count(*) FILTER (WHERE status IN ('POSSIBLE_HIT', 'CONFIRMED_HIT'))::int AS hits
         FROM screening_results
        WHERE tenant_id = $1 AND screened_at >= $2::date AND screened_at < ($3::date + 1)
        GROUP BY source_code ORDER BY source_code`,
      [tenantId, periodStart, periodEnd]
    ),
    client.query(
      `SELECT to_char(date_trunc('week', screened_at), 'YYYY-MM-DD') AS week,
              count(*)::int AS screened,
              count(*) FILTER (WHERE status IN ('POSSIBLE_HIT', 'CONFIRMED_HIT'))::int AS hits
         FROM screening_results
        WHERE tenant_id = $1 AND screened_at >= $2::date AND screened_at < ($3::date + 1)
        GROUP BY 1 ORDER BY 1`,
      [tenantId, periodStart, periodEnd]
    ),
    client.query(
      `SELECT count(*) FILTER (WHERE sr.status IN ('POSSIBLE_HIT', 'CONFIRMED_HIT'))::int AS hits,
              count(*) FILTER (WHERE sr.status IN ('POSSIBLE_HIT', 'CONFIRMED_HIT') AND c.state IN ('BLOCKED', 'REJECTED'))::int AS converted_to_block,
              count(*) FILTER (WHERE sr.status IN ('POSSIBLE_HIT', 'CONFIRMED_HIT') AND c.state = 'APPROVED')::int AS false_positives
         FROM screening_results sr
         JOIN compliance_cases c ON c.id = sr.case_id AND c.tenant_id = sr.tenant_id
        WHERE sr.tenant_id = $1 AND sr.screened_at >= $2::date AND sr.screened_at < ($3::date + 1)`,
      [tenantId, periodStart, periodEnd]
    )
  ]);
  const totals = conversion.rows[0] || {};
  return {
    report_type: 'SCREENING_HITS',
    period_start: periodStart,
    period_end: periodEnd,
    by_list_source: sources.rows.map((row) => ({ ...row, hit_rate: percent(row.hits, row.screened) })),
    weekly_trend: weekly.rows.map((row) => ({ ...row, hit_rate: percent(row.hits, row.screened) })),
    hit_to_block_conversion_rate: percent(totals.converted_to_block, totals.hits),
    false_positive_rate: percent(totals.false_positives, totals.hits)
  };
}

async function cycleTimeReport(client, tenantId, periodStart, periodEnd) {
  const [states, ceco, threshold] = await Promise.all([
    client.query(
      `SELECT state,
              round(avg(EXTRACT(epoch FROM (COALESCE(decided_at, now()) - created_at)) / 3600.0), 2) AS average_hours,
              count(*)::int AS cases
         FROM compliance_cases
        WHERE tenant_id = $1 AND created_at >= $2::date AND created_at < ($3::date + 1)
        GROUP BY state ORDER BY average_hours DESC NULLS LAST`,
      [tenantId, periodStart, periodEnd]
    ),
    client.query(
      `WITH entered AS (
         SELECT case_id, min(occurred_at) AS entered_at
           FROM audit_events
          WHERE tenant_id = $1 AND after_state->>'state' = 'AWAITING_CECO_REVIEW'
          GROUP BY case_id
       ), resolved AS (
         SELECT e.case_id, e.entered_at, min(a.occurred_at) AS resolved_at
           FROM entered e JOIN audit_events a ON a.tenant_id = $1 AND a.case_id = e.case_id
            AND a.occurred_at > e.entered_at
            AND COALESCE(a.after_state->>'state', '') <> 'AWAITING_CECO_REVIEW'
          GROUP BY e.case_id, e.entered_at
       )
       SELECT round(avg(EXTRACT(epoch FROM (resolved_at - entered_at)) / 3600.0), 2) AS average_hours,
              count(*) FILTER (WHERE resolved_at IS NULL)::int AS open_cases
         FROM resolved`,
      [tenantId]
    ),
    client.query(`SELECT COALESCE(tt.value, td.platform_default)::numeric AS hours
                    FROM threshold_definitions td
                    LEFT JOIN tenant_thresholds tt ON tt.tenant_id = $1 AND tt.code = td.code
                   WHERE td.code = 'CASE_STUCK_HOURS'`, [tenantId])
  ]);
  const bottleneck = states.rows[0] || null;
  const thresholdHours = Number(threshold.rows[0]?.hours || 72);
  const exceeding = states.rows.reduce((sum, row) => sum + (Number(row.average_hours || 0) > thresholdHours ? Number(row.cases || 0) : 0), 0);
  return {
    report_type: 'CYCLE_TIME',
    period_start: periodStart,
    period_end: periodEnd,
    by_workflow_state: states.rows,
    bottleneck: bottleneck ? { state: bottleneck.state, average_hours: Number(bottleneck.average_hours || 0) } : null,
    ceco_review: ceco.rows[0] || { average_hours: null, open_cases: 0 },
    threshold_hours: thresholdHours,
    cases_exceeding_threshold: exceeding
  };
}

async function licenceExceptionsReport(client, tenantId, periodStart, periodEnd) {
  const result = await client.query(
    `SELECT COALESCE(ld.exception_code, 'NONE') AS exception_code,
            count(*)::int AS usage_count,
            le.max_uses_per_month,
            round(
              100.0 * count(*) FILTER (WHERE c.created_at >= date_trunc('month', CURRENT_DATE))
              / NULLIF(le.max_uses_per_month, 0), 2
            ) AS monthly_cap_utilisation
       FROM licence_determinations ld
       JOIN compliance_cases c ON c.id = ld.case_id AND c.tenant_id = ld.tenant_id
       LEFT JOIN licence_exceptions le ON le.code = ld.exception_code
      WHERE ld.tenant_id = $1 AND c.created_at >= $2::date AND c.created_at < ($3::date + 1)
      GROUP BY ld.exception_code, le.max_uses_per_month
      ORDER BY usage_count DESC, exception_code`,
    [tenantId, periodStart, periodEnd]
  );
  return {
    report_type: 'LICENCE_EXCEPTIONS',
    period_start: periodStart,
    period_end: periodEnd,
    usage: result.rows.map((row) => ({
      ...row,
      monthly_cap_utilisation: row.monthly_cap_utilisation == null ? null : Number(row.monthly_cap_utilisation),
      utilisation_status: row.monthly_cap_utilisation == null ? 'UNCAPPED'
        : Number(row.monthly_cap_utilisation) >= 100 ? 'OVER_CAP'
          : Number(row.monthly_cap_utilisation) >= 80 ? 'WARNING' : 'HEALTHY'
    }))
  };
}

async function renderBafaIcpPdf({ report, tenantName }) {
  const body = report.result_json || report;
  const reportId = report.id || 'unsaved';
  const document = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
  const buffers = [];
  document.on('data', (chunk) => buffers.push(chunk));
  const done = new Promise((resolve) => document.on('end', () => resolve(Buffer.concat(buffers))));
  const addHeading = (text, subtitle) => {
    document.fillColor('#172033').fontSize(18).text(text);
    if (subtitle) document.moveDown(0.4).fillColor('#536079').fontSize(9).text(subtitle);
    document.moveDown(1);
  };
  const addLine = (label, value) => {
    document.fillColor('#172033').fontSize(10).text(`${label}: ${safe(value)}`);
  };
  const addTable = (headers, rows) => {
    document.fillColor('#172033').fontSize(8).text(headers.join(' | '));
    document.moveDown(0.25);
    for (const row of rows) {
      document.fillColor('#536079').fontSize(8).text(row.map(safe).join(' | '));
      document.moveDown(0.2);
    }
  };

  addHeading('BAFA Internal Compliance Programme Report', 'Regulator-facing compliance evidence');
  addLine('Company', tenantName || body.tenant?.name);
  addLine('Reporting period', `${body.period_start} to ${body.period_end}`);
  addLine('CECO', `${safe(body.programme?.ceco_name)}, ${safe(body.programme?.ceco_title)}`);
  addLine('Appointed', body.programme?.appointment_date);
  addLine('BAFA Form Reference', body.programme?.bafa_form_reference);
  addLine('Generated', body.generated_at || report.generated_at);
  document.moveDown(2).fillColor('#9b1c31').fontSize(10).text('CONFIDENTIAL — For regulatory submission only');

  document.addPage();
  addHeading('Programme status', 'BAFA Internal Compliance Programme');
  addLine('Programme status', body.programme?.programme_status);
  addLine('Overall BAFA 9-Criteria Score', `${body.overall_score}%`);
  document.moveDown();
  for (const criterion of body.criteria || []) {
    const color = criterion.score >= 80 ? '#238636' : criterion.score >= 60 ? '#b7791f' : '#b42318';
    document.fillColor('#172033').fontSize(9).text(`Criterion ${criterion.number} — ${criterion.name}: ${criterion.score}%`);
    document.fillColor(color).rect(48, document.y, Math.max(1, criterion.score * 4.9), 7).fill();
    document.moveDown(0.8);
  }

  for (const criterion of body.criteria || []) {
    document.addPage();
    addHeading(`BAFA Criterion ${criterion.number} — ${criterion.name}`, `Score: ${criterion.score}%`);
    addLine('Score', `${criterion.score}%`);
    document.moveDown().fillColor('#172033').fontSize(11).text('Evidence summary');
    document.moveDown(0.4);
    for (const [key, value] of Object.entries(criterion.evidence || {})) addLine(key.replaceAll('_', ' '), value);
    document.moveDown().fillColor('#172033').fontSize(11).text('Gap description');
    document.moveDown(0.4).fillColor('#536079').fontSize(9).text(criterion.gap || 'No gap recorded.');
    document.moveDown().fillColor('#172033').fontSize(11).text('Supporting documents');
    document.moveDown(0.4).fillColor('#536079').fontSize(9).text((criterion.supporting_documents || []).join(', ') || 'None recorded.');
  }

  document.addPage();
  addHeading('Transaction audit summary', `${body.period_start} to ${body.period_end}`);
  addTable(
    ['Measure', 'Value'],
    Object.entries(body.transaction_summary || {}).map(([key, value]) => [key.replaceAll('_', ' '), value])
  );
  document.moveDown();
  document.fontSize(11).fillColor('#172033').text('Screening summary');
  document.moveDown(0.4);
  addTable(['Measure', 'Value'], Object.entries(body.screening_summary || {}).map(([key, value]) => [key.replaceAll('_', ' '), value]));
  document.moveDown();
  document.fontSize(11).fillColor('#172033').text('Licence exception usage');
  document.moveDown(0.4);
  addTable(['Exception', 'Count'], (body.licence_exception_usage || []).map((row) => [row.exception_code, row.usage_count]));

  document.addPage();
  addHeading('Open items', 'Actions and training evidence requiring attention');
  document.fontSize(11).fillColor('#172033').text('Open corrective actions');
  document.moveDown(0.4);
  addTable(['Criterion', 'Severity', 'Due date', 'Status'], (body.open_corrective_actions || []).map((row) => [
    row.criterion_reference ? `C${row.criterion_reference}` : '—', row.severity, row.due_date, row.status
  ]));
  document.moveDown();
  document.fontSize(11).fillColor('#172033').text('Upcoming training expiries');
  document.moveDown(0.4);
  addTable(['Staff', 'Topic', 'Expiry', 'Days'], (body.upcoming_training_expiries || []).map((row) => [
    row.full_name, row.topic, row.expiry_date, row.days_remaining
  ]));

  const pages = document.bufferedPageRange();
  for (let index = 0; index < pages.count; index += 1) {
    document.switchToPage(index);
    document.fontSize(7).fillColor('#65708a')
      .text(`BAFA ICP Report | ${tenantName || body.tenant?.name || 'Tenant'} | CECO: ${body.programme?.ceco_name || '—'} | ${dateOnly(new Date())} | Page ${index + 1} of ${pages.count}`,
        48, document.page.height - 75, { width: document.page.width - 96, align: 'center', lineBreak: false });
    document.fontSize(5.5).fillColor('#65708a').text(REPORT_DISCLAIMER(reportId), 48, document.page.height - 62, {
      width: document.page.width - 96, align: 'center', lineBreak: false
    });
  }
  document.end();
  return done;
}

function anonymise(value) {
  return `tenant-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 10)}`;
}

// SRP: CSV serialization isolated here so routes stay thin.
function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (value) => {
    const str = value == null ? '' : String(value);
    return str.includes(',') || str.includes('"') || str.includes('\n')
      ? `"${str.replace(/"/g, '""')}"`
      : str;
  };
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escape(row[header])).join(','))
  ].join('\r\n');
}

module.exports = {
  BAFA_CRITERIA,
  REPORT_DISCLAIMER,
  anonymise,
  toCsv,
  caseOutcomesReport,
  cycleTimeReport,
  fetchBafaHistory,
  fetchBafaReport,
  generateBafaIcpReport,
  licenceExceptionsReport,
  renderBafaIcpPdf,
  screeningHitsReport
};