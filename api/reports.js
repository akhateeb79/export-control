'use strict';

const express = require('express');
const { ApiError, asyncHandler } = require('./errors');
const { writeAudit } = require('./audit');
const { loadCaseDossier } = require('../src/services/caseDossierService');
const PDFDocument = require('pdfkit');
const {
  caseOutcomesReport,
  cycleTimeReport,
  fetchBafaHistory,
  fetchBafaReport,
  generateBafaIcpReport,
  licenceExceptionsReport,
  renderBafaIcpPdf,
  screeningHitsReport,
  toCsv
} = require('../src/services/reportingService');

const READ_ROLES = ['COMPLIANCE_OFFICER', 'COMPLIANCE_ADMIN', 'COMPLIANCE_VIEWER'];
const ADMIN_ROLES = ['COMPLIANCE_ADMIN'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function period(request) {
  const periodStart = request.query.period_start || request.body?.period_start;
  const periodEnd = request.query.period_end || request.body?.period_end;
  const start = periodStart || new Date(Date.now() - 89 * 86400000).toISOString().slice(0, 10);
  const end = periodEnd || new Date().toISOString().slice(0, 10);
  if (!DATE_PATTERN.test(start) || !DATE_PATTERN.test(end) || start > end) {
    throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['period_start', 'period_end'] });
  }
  return { periodStart: start, periodEnd: end };
}

function reportsRouter({ middleware, pool }) {
  const router = express.Router();
  const tenantChain = [
    middleware.authenticate,
    middleware.resolveTenant,
    middleware.requireRoles(READ_ROLES),
    middleware.openTransaction
  ];
  const adminChain = [
    middleware.authenticate,
    middleware.resolveTenant,
    middleware.requireRoles(ADMIN_ROLES),
    middleware.openTransaction
  ];

  async function roleContext(request, response, next) {
    await response.locals.dbClient.query(`SELECT set_config('app.user_role', $1, true)`, [request.auth.role]);
    next();
  }

  async function complete(request, response, body, status = 200) {
    const client = response.locals.dbClient;
    try {
      await client.query('COMMIT');
      client.release();
      response.locals.dbClient = null;
      response.status(status).json({ ...body, request_id: response.locals.requestId });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      response.locals.dbClient = null;
      throw error;
    }
  }

  router.post('/bafa-icp', ...adminChain, roleContext, asyncHandler(async (request, response) => {
    const { periodStart, periodEnd } = period(request);
    const result = await generateBafaIcpReport({
      client: response.locals.dbClient,
      tenantId: request.auth.tenant_id,
      generatedBy: request.auth.user_id,
      periodStart,
      periodEnd
    });
    await writeAudit(response.locals.dbClient, {
      tenantId: request.auth.tenant_id,
      actorType: 'USER',
      actorId: request.auth.user_id,
      eventType: 'COMPLIANCE_REPORT_GENERATED',
      afterState: { report_id: result.report.id, report_type: 'BAFA_ICP', period_start: periodStart, period_end: periodEnd }
    });
    await complete(request, response, result, 201);
  }));

  router.get('/bafa-icp/latest', ...tenantChain, roleContext, asyncHandler(async (request, response) => {
    const report = await fetchBafaReport(response.locals.dbClient, request.auth.tenant_id);
    await complete(request, response, { report });
  }));

  router.get('/bafa-icp/history', ...tenantChain, roleContext, asyncHandler(async (request, response) => {
    const reports = await fetchBafaHistory(response.locals.dbClient, request.auth.tenant_id);
    await complete(request, response, { reports });
  }));

  router.get('/bafa-icp/:id/pdf', ...tenantChain, roleContext, asyncHandler(async (request, response) => {
    if (!UUID_PATTERN.test(request.params.id)) throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['id'] });
    const client = response.locals.dbClient;
    const report = await fetchBafaReport(client, request.auth.tenant_id, request.params.id);
    if (!report) throw new ApiError(404, 'NOT_FOUND');
    const pdf = await renderBafaIcpPdf({ report, tenantName: report.tenant_name });
    await client.query(
      `UPDATE compliance_reports SET pdf_path = $1 WHERE id = $2 AND tenant_id = $3`,
      [`generated:reports/${report.id}.pdf`, report.id, request.auth.tenant_id]
    );
    await writeAudit(client, {
      tenantId: request.auth.tenant_id,
      actorType: 'USER',
      actorId: request.auth.user_id,
      eventType: 'COMPLIANCE_REPORT_EXPORTED',
      afterState: { report_id: report.id, report_type: 'BAFA_ICP', pdf_path: `generated:reports/${report.id}.pdf` }
    });
    await client.query('COMMIT');
    client.release();
    response.locals.dbClient = null;
    response.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="bafa-icp-report-${report.period_end}.pdf"`
    });
    response.send(pdf);
  }));

  router.get('/case-outcomes', ...tenantChain, roleContext, asyncHandler(async (request, response) => {
    const { periodStart, periodEnd } = period(request);
    await complete(request, response, await caseOutcomesReport(response.locals.dbClient, request.auth.tenant_id, periodStart, periodEnd));
  }));

  router.get('/screening-hits', ...tenantChain, roleContext, asyncHandler(async (request, response) => {
    const { periodStart, periodEnd } = period(request);
    await complete(request, response, await screeningHitsReport(response.locals.dbClient, request.auth.tenant_id, periodStart, periodEnd));
  }));

  router.get('/cycle-time', ...tenantChain, roleContext, asyncHandler(async (request, response) => {
    const { periodStart, periodEnd } = period(request);
    await complete(request, response, await cycleTimeReport(response.locals.dbClient, request.auth.tenant_id, periodStart, periodEnd));
  }));

  router.get('/licence-exceptions', ...tenantChain, roleContext, asyncHandler(async (request, response) => {
    const { periodStart, periodEnd } = period(request);
    await complete(request, response, await licenceExceptionsReport(response.locals.dbClient, request.auth.tenant_id, periodStart, periodEnd));
  }));

  // CSV export endpoints — OCP: extend by addition, existing JSON routes unchanged.
  function sendCsv(response, filename, rows) {
    response.setHeader('Content-Type', 'text/csv');
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    response.send(toCsv(rows));
  }

  router.get('/case-outcomes/export', ...tenantChain, roleContext, asyncHandler(async (request, response) => {
    const { periodStart, periodEnd } = period(request);
    const client = response.locals.dbClient;
    const data = await caseOutcomesReport(client, request.auth.tenant_id, periodStart, periodEnd);
    await client.query('COMMIT');
    client.release();
    response.locals.dbClient = null;
    sendCsv(response, `case-outcomes-${periodEnd}.csv`, data.distribution.map((row) => ({ ...row, period_start: periodStart, period_end: periodEnd })));
  }));

  router.get('/screening-hits/export', ...tenantChain, roleContext, asyncHandler(async (request, response) => {
    const { periodStart, periodEnd } = period(request);
    const client = response.locals.dbClient;
    const data = await screeningHitsReport(client, request.auth.tenant_id, periodStart, periodEnd);
    await client.query('COMMIT');
    client.release();
    response.locals.dbClient = null;
    sendCsv(response, `screening-hits-${periodEnd}.csv`, data.by_list_source.map((row) => ({ ...row, period_start: periodStart, period_end: periodEnd })));
  }));

  router.get('/cycle-time/export', ...tenantChain, roleContext, asyncHandler(async (request, response) => {
    const { periodStart, periodEnd } = period(request);
    const client = response.locals.dbClient;
    const data = await cycleTimeReport(client, request.auth.tenant_id, periodStart, periodEnd);
    await client.query('COMMIT');
    client.release();
    response.locals.dbClient = null;
    sendCsv(response, `cycle-time-${periodEnd}.csv`, data.by_workflow_state.map((row) => ({ ...row, period_start: periodStart, period_end: periodEnd })));
  }));

  router.get('/licence-exceptions/export', ...tenantChain, roleContext, asyncHandler(async (request, response) => {
    const { periodStart, periodEnd } = period(request);
    const client = response.locals.dbClient;
    const data = await licenceExceptionsReport(client, request.auth.tenant_id, periodStart, periodEnd);
    await client.query('COMMIT');
    client.release();
    response.locals.dbClient = null;
    sendCsv(response, `licence-exceptions-${periodEnd}.csv`, data.usage.map((row) => ({ ...row, period_start: periodStart, period_end: periodEnd })));
  }));

  router.get('/shipment-summary/:caseId', ...tenantChain, roleContext, asyncHandler(async (request, response) => {
    const dossier = await loadCaseDossier(response.locals.dbClient, {
      tenantId: request.auth.tenant_id,
      caseId: request.params.caseId
    });
    if (!dossier) throw new ApiError(404, 'NOT_FOUND');
    const doc = new PDFDocument({ size: 'A4', margin: 42 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    const finished = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
    const record = dossier.case;
    const text = (label, value) => doc.fontSize(9).fillColor('#172033').text(`${label}: ${value == null || value === '' ? '—' : value}`);
    doc.fillColor('#0f766e').fontSize(19).text('Shipment compliance summary');
    doc.moveDown(0.25).fillColor('#536079').fontSize(9).text('One-page operational summary — retain with the shipment record');
    doc.moveDown(1).fillColor('#172033').fontSize(15).text(record.case_ref);
    doc.moveDown(0.6);
    text('Status', record.state);
    text('Destination', record.destination_country);
    text('Planned ship date', record.planned_ship_date);
    text('Declared end use', record.declared_end_use || record.stated_end_use);
    text('Product', record.product_description);
    text('Part number', record.product_part_number);
    text('Quantity', record.quantity);
    doc.moveDown(0.7).fontSize(11).text('Parties');
    dossier.parties.slice(0, 5).forEach((party) => text(party.party_role, `${party.legal_name} (${party.country_code || '—'})`));
    doc.moveDown(0.7).fontSize(11).text('Products / classification');
    dossier.products.slice(0, 4).forEach((product) => text('Product', `${product.name} — ${product.part_number || 'no part number'}`));
    text('ECCN', dossier.classifications[0]?.eccn || (dossier.classifications[0]?.is_ear99 ? 'EAR99' : null));
    doc.moveDown(0.7).fontSize(11).text('Compliance result');
    text('Licence outcome', dossier.determination?.outcome);
    text('Screening', dossier.screenings.some((item) => item.status === 'CONFIRMED_HIT') ? 'BLOCKED — confirmed sanctions match' : dossier.screenings.some((item) => ['POTENTIAL_HIT', 'POSSIBLE_HIT'].includes(item.status)) ? 'Review required' : 'Clear');
    doc.moveDown(1).fillColor('#9b1c31').fontSize(8).text('AI-assisted output. Compliance Officer and CECO review remains required. This summary does not replace the full dossier.');
    doc.end();
    const pdf = await finished;
    await response.locals.dbClient.query('COMMIT');
    response.locals.dbClient.release();
    response.locals.dbClient = null;
    response.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="shipment-summary-${record.case_ref}.pdf"` }).send(pdf);
  }));

  router.get('/bafa-export', ...adminChain, roleContext, asyncHandler(async (request, response) => {
    const { periodStart, periodEnd } = period(request);
    const client = response.locals.dbClient;
    const tenant = await client.query(`SELECT id, name FROM tenants WHERE id = $1`, [request.auth.tenant_id]);
    const programme = await client.query(
      `SELECT ceco_name, ceco_title, appointment_date, bafa_form_reference
         FROM icp_programme WHERE tenant_id = $1`,
      [request.auth.tenant_id]
    );
    const cases = await client.query(
      `SELECT c.case_ref, c.created_at AS submitted_at, c.state,
              CASE WHEN c.state = 'APPROVED' THEN 'APPROVED'
                   WHEN c.state IN ('BLOCKED', 'REJECTED') THEN c.state
                   ELSE 'PENDING' END AS outcome,
              c.overall_risk AS risk_score,
              c.ceco_reviewed_by IS NOT NULL AS ceco_reviewed,
              c.ceco_reviewed_at,
              c.decided_at,
              round(EXTRACT(epoch FROM (COALESCE(c.decided_at, now()) - c.created_at)) / 3600.0, 2) AS cycle_time_hours,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object('source_code', sr.source_code, 'status', sr.status))
                  FROM screening_results sr
                 WHERE sr.case_id = c.id AND sr.tenant_id = c.tenant_id
              ), '[]'::jsonb) AS screening_result,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object('eccn', cr.eccn, 'status', cr.status, 'confidence', cr.confidence))
                  FROM classification_results cr
                 WHERE cr.case_id = c.id AND cr.tenant_id = c.tenant_id
              ), '[]'::jsonb) AS classification_eccn,
              COALESCE((
                SELECT jsonb_build_object('outcome', ld.outcome, 'exception_code', ld.exception_code)
                  FROM licence_determinations ld
                 WHERE ld.case_id = c.id AND ld.tenant_id = c.tenant_id
                 ORDER BY c.created_at DESC LIMIT 1
              ), '{}'::jsonb) AS licence_determination
         FROM compliance_cases c
        WHERE c.tenant_id = $1 AND c.created_at >= $2::date AND c.created_at < ($3::date + 1)
        ORDER BY c.created_at, c.case_ref`,
      [request.auth.tenant_id, periodStart, periodEnd]
    );
    const exportBody = {
      export_metadata: {
        tenant_name: tenant.rows[0]?.name,
        ceco_name: programme.rows[0]?.ceco_name || null,
        ceco_title: programme.rows[0]?.ceco_title || null,
        appointment_date: programme.rows[0]?.appointment_date || null,
        bafa_form_reference: programme.rows[0]?.bafa_form_reference || null,
        period_start: periodStart,
        period_end: periodEnd,
        generated_at: new Date().toISOString(),
        record_count: cases.rowCount,
        disclaimer: 'Regulator-readable BAFA export. No party names or direct party identifiers are included.'
      },
      cases: cases.rows
    };
    await writeAudit(client, {
      tenantId: request.auth.tenant_id,
      actorType: 'USER',
      actorId: request.auth.user_id,
      eventType: 'BAFA_EXPORT_GENERATED',
      afterState: { period_start: periodStart, period_end: periodEnd, record_count: cases.rowCount }
    });
    await complete(request, response, exportBody);
  }));

  return router;
}

module.exports = { reportsRouter };