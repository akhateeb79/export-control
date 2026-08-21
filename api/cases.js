'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { productFingerprint } = require('./classification');
const { hasComprehensiveEmbargo, hasLicenceRecord, screenCase } = require('./sanctions');
const { ApiError, asyncHandler } = require('./errors');
const { assertSystemTransition, findTransition, guardPasses } = require('./workflow');

const CASE_ROLES = ['INITIATOR', 'REVIEWER', 'COMPLIANCE_OFFICER', 'CLIENT_ADMIN', 'API_CLIENT'];

function caseRouter({ middleware, config, classifier }) {
  const router = express.Router();
  const chain = (roles, agentCode) => [
    middleware.authenticate,
    middleware.resolveTenant,
    middleware.openTransaction,
    (request, response, next) => {
      request.requiredAgent = agentCode;
      next();
    },
    middleware.entitlement,
    middleware.requireRoles(roles)
  ];

  router.post('/', ...chain(CASE_ROLES), asyncHandler(async (request, response, next) => {
    const {
      case_ref: caseRef,
      destination_country: destinationCountry,
      stated_end_use: statedEndUse,
      incoterms,
      planned_ship_date: plannedShipDate,
      parties,
      products = []
    } = request.body || {};
    if (!caseRef || !destinationCountry || !statedEndUse || !Array.isArray(parties) || !parties.length) {
      throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['case_ref', 'destination_country', 'stated_end_use', 'parties'] });
    }
    const client = response.locals.dbClient;
    const country = await client.query(`SELECT 1 FROM countries WHERE code = $1 AND is_active = TRUE`, [destinationCountry]);
    if (!country.rows[0]) throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['destination_country'] });
    const partyIds = [...new Set(parties.map((party) => party.party_id))];
    if (partyIds.length !== parties.length || partyIds.some((id) => !id) || parties.some((party) => !party.party_role)) {
      throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['parties'] });
    }
    const existingParties = await client.query(`SELECT id FROM parties WHERE id = ANY($1::uuid[])`, [partyIds]);
    if (existingParties.rowCount !== partyIds.length) throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['parties'] });

    if (!Array.isArray(products)) throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['products'] });
    const caseId = crypto.randomUUID();
    const retentionYears = response.locals.subscription.retention_years;
    await client.query(
      `INSERT INTO compliance_cases (
         id, tenant_id, case_ref, state, destination_country, stated_end_use,
         incoterms, planned_ship_date, retention_until
       ) VALUES ($1, $2, $3, 'DRAFT', $4, $5, $6, $7, (CURRENT_DATE + make_interval(years => $8::int))::date)`,
      [caseId, request.auth.tenant_id, caseRef, destinationCountry, statedEndUse, incoterms || null, plannedShipDate || null, retentionYears]
    );
    for (const party of parties) {
      await client.query(
        `INSERT INTO case_parties (id, tenant_id, case_id, party_id, party_role)
         VALUES ($1, $2, $3, $4, $5)`,
        [crypto.randomUUID(), request.auth.tenant_id, caseId, party.party_id, party.party_role]
      );
    }
    const productIds = [];
    for (const product of products) {
      if (!product?.name || !product?.description) {
        throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['products.name', 'products.description'] });
      }
      const fingerprint = productFingerprint(product);
      const productId = crypto.randomUUID();
      const catalogueProduct = await client.query(
        `INSERT INTO products (
           id, tenant_id, part_number, name, description, specifications,
           origin_country, us_content_pct, product_fingerprint
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (tenant_id, product_fingerprint) WHERE product_fingerprint IS NOT NULL
         DO UPDATE SET name = products.name
         RETURNING id`,
        [
          productId, request.auth.tenant_id, product.part_number || null, product.name, product.description,
          JSON.stringify(product.specifications || {}), product.origin_country || null,
          product.us_content_pct ?? null, fingerprint
        ]
      );
      const resolvedProductId = catalogueProduct.rows[0].id;
      await client.query(
        `INSERT INTO case_products (id, tenant_id, case_id, product_id, product_snapshot)
         VALUES ($1, $2, $3, $4, $5)`,
        [crypto.randomUUID(), request.auth.tenant_id, caseId, resolvedProductId, JSON.stringify({
          name: product.name,
          description: product.description,
          specifications: product.specifications || {},
          origin_country: product.origin_country || null,
          us_content_pct: product.us_content_pct ?? null
        })]
      );
      productIds.push(resolvedProductId);
    }
    response.locals.result = { status: 201, body: { case_id: caseId, status: 'DRAFT', product_ids: productIds } };
    response.locals.auditEvent = {
      caseId, eventType: 'CASE_CREATED',
      afterState: { state: 'DRAFT', party_count: parties.length, product_count: productIds.length }
    };
    next();
  }), middleware.finalize);

  router.post('/:id/classify', ...chain(CASE_ROLES, 'CLASSIFIER_EXTRACTION'), asyncHandler(async (request, response, next) => {
    const client = response.locals.dbClient;
    const caseResult = await client.query(
      `SELECT * FROM compliance_cases WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [request.params.id, request.auth.tenant_id]
    );
    const caseRecord = caseResult.rows[0];
    if (!caseRecord) throw new ApiError(404, 'NOT_FOUND');
    if (!['SCREENING', 'REVIEW_REQUIRED', 'ESCALATED'].includes(caseRecord.state)) {
      throw new ApiError(409, 'VALIDATION_FAILED', { state: caseRecord.state });
    }
    const requestProductId = request.body?.product_id || null;
    const queued = await classifier.enqueue(client, {
      tenantId: request.auth.tenant_id,
      caseId: caseRecord.id,
      requestedBy: request.auth.user_id,
      productId: requestProductId
    });
    const allCached = queued.outcomes.every((outcome) => outcome.cached);
    response.locals.result = {
      status: allCached ? 200 : 202,
      body: {
        case_id: caseRecord.id,
        control_list_version_id: queued.controlListVersion.id,
        cached: allCached,
        classifications: queued.outcomes
      }
    };
    response.locals.auditEvent = {
      caseId: caseRecord.id,
      eventType: 'CLASSIFICATION_REQUESTED',
      afterState: {
        control_list_version_id: queued.controlListVersion.id,
        classifications: queued.outcomes.map((outcome) => ({
          product_id: outcome.product_id,
          job_id: outcome.job_id || null,
          cached: outcome.cached
        }))
      }
    };
    next();
  }), middleware.finalize);

  router.get('/:id/classification', ...chain(CASE_ROLES), asyncHandler(async (request, response, next) => {
    const client = response.locals.dbClient;
    const caseResult = await client.query(
      `SELECT id FROM compliance_cases WHERE id = $1 AND tenant_id = $2`,
      [request.params.id, request.auth.tenant_id]
    );
    if (!caseResult.rows[0]) throw new ApiError(404, 'NOT_FOUND');
    const classifications = await classifier.getCaseResults(client, {
      tenantId: request.auth.tenant_id,
      caseId: request.params.id
    });
    response.locals.result = { status: 200, body: { case_id: request.params.id, classifications } };
    response.locals.auditEvent = {
      caseId: request.params.id,
      eventType: 'CLASSIFICATION_VIEWED',
      afterState: { classification_count: classifications.length }
    };
    next();
  }), middleware.finalize);

  router.post('/:id/submit', ...chain(CASE_ROLES, 'SANCTIONS'), asyncHandler(async (request, response, next) => {
    const client = response.locals.dbClient;
    const result = await client.query(
      `SELECT * FROM compliance_cases WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [request.params.id, request.auth.tenant_id]
    );
    const caseRecord = result.rows[0];
    if (!caseRecord) throw new ApiError(404, 'NOT_FOUND');
    if (caseRecord.state !== 'DRAFT') throw new ApiError(409, 'VALIDATION_FAILED', { state: caseRecord.state });
    await assertSystemTransition(client, caseRecord, 'SCREENING');
    await client.query(`UPDATE compliance_cases SET state = 'SCREENING' WHERE id = $1`, [caseRecord.id]);
    const screening = await screenCase(client, config, { tenantId: request.auth.tenant_id, caseRecord });
    response.locals.result = {
      status: 202,
      body: { case_id: caseRecord.id, status: screening.state, screening_results_recorded: screening.results }
    };
    response.locals.auditEvent = {
      caseId: caseRecord.id, eventType: 'CASE_SUBMITTED',
      beforeState: { state: 'DRAFT' },
      afterState: { state: screening.state, fired_rule_code: screening.firedRule }
    };
    next();
  }), middleware.finalize);

  router.get('/:id', ...chain(CASE_ROLES), asyncHandler(async (request, response, next) => {
    const client = response.locals.dbClient;
    const caseResult = await client.query(
      `SELECT * FROM compliance_cases WHERE id = $1 AND tenant_id = $2`,
      [request.params.id, request.auth.tenant_id]
    );
    const caseRecord = caseResult.rows[0];
    if (!caseRecord) throw new ApiError(404, 'NOT_FOUND');
    const screenings = await client.query(
      `SELECT sr.*, lv.fetched_at AS list_sync_date
         FROM screening_results sr
         JOIN list_versions lv ON lv.id = sr.list_version_id
        WHERE sr.case_id = $1 AND sr.tenant_id = $2
        ORDER BY sr.screened_at, sr.id`,
      [caseRecord.id, request.auth.tenant_id]
    );
    const classifications = await classifier.getCaseResults(client, {
      tenantId: request.auth.tenant_id,
      caseId: caseRecord.id
    });
    response.locals.result = {
      status: 200,
      body: {
        case: caseRecord,
        screening_results: screenings.rows,
        classifications,
        stale_warning: false
      }
    };
    response.locals.auditEvent = { caseId: caseRecord.id, eventType: 'CASE_VIEWED', afterState: { case_id: caseRecord.id } };
    next();
  }), middleware.finalize);

  router.get('/', ...chain(CASE_ROLES), asyncHandler(async (request, response, next) => {
    const client = response.locals.dbClient;
    const page = Math.max(1, Number.parseInt(request.query.page || '1', 10));
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(request.query.page_size || '25', 10)));
    const clauses = ['tenant_id = $1'];
    const params = [request.auth.tenant_id];
    for (const [column, operator, value] of [
      ['state', '=', request.query.status],
      ['created_at', '>=', request.query.date_from],
      ['created_at', '<', request.query.date_to],
      ['decided_by', '=', request.query.assigned_to]
    ]) {
      if (!value) continue;
      params.push(value);
      clauses.push(`${column} ${operator} $${params.length}`);
    }
    const where = `WHERE ${clauses.join(' AND ')}`;
    params.push(pageSize, (page - 1) * pageSize);
    const result = await client.query(
      `SELECT id, case_ref, state, destination_country, overall_risk, requires_rescreen, created_at
         FROM compliance_cases
         ${where}
        ORDER BY created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    response.locals.result = { status: 200, body: { page, page_size: pageSize, cases: result.rows } };
    response.locals.auditEvent = { eventType: 'CASE_LIST_VIEWED', afterState: { filters: request.query } };
    next();
  }), middleware.finalize);

  router.post('/:id/decision', ...chain(['COMPLIANCE_OFFICER']), asyncHandler(async (request, response, next) => {
    const decision = String(request.body?.decision || '').toUpperCase();
    const rationale = String(request.body?.rationale || '').trim();
    if (!['APPROVE', 'BLOCK'].includes(decision)) throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['decision'] });
    if (!rationale) throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['rationale'] });
    const client = response.locals.dbClient;
    const result = await client.query(
      `SELECT * FROM compliance_cases WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [request.params.id, request.auth.tenant_id]
    );
    const caseRecord = result.rows[0];
    if (!caseRecord) throw new ApiError(404, 'NOT_FOUND');

    let rejection = null;
    if (decision === 'APPROVE') {
      const confirmed = await client.query(
        `SELECT EXISTS (
           SELECT 1
             FROM screening_results sr
             JOIN list_sources ls ON ls.code = sr.source_code
            WHERE sr.case_id = $1 AND sr.tenant_id = $2
              AND sr.status = 'CONFIRMED_HIT' AND ls.is_blocking = TRUE
         ) AS exists`,
        [caseRecord.id, request.auth.tenant_id]
      );
      if (confirmed.rows[0].exists) rejection = 'RULE_1';
      else if (await hasComprehensiveEmbargo(client, caseRecord.destination_country)
        && !(await hasLicenceRecord(client, caseRecord.id))) rejection = 'RULE_2';
      else {
        const screening = await client.query(
          `SELECT 1 FROM screening_results WHERE case_id = $1 AND tenant_id = $2 LIMIT 1`,
          [caseRecord.id, request.auth.tenant_id]
        );
        if (!screening.rows[0]) rejection = 'RULE_3';
        else {
          const classification = await client.query(
            `SELECT
               EXISTS (
                 SELECT 1 FROM case_products
                  WHERE case_id = $1 AND tenant_id = $2
               )
               AND NOT EXISTS (
                 SELECT 1
                   FROM case_products cp
                  WHERE cp.case_id = $1
                    AND cp.tenant_id = $2
                    AND NOT EXISTS (
                      SELECT 1
                        FROM classification_results cr
                       WHERE cr.case_id = cp.case_id
                         AND cr.product_id = cp.product_id
                         AND cr.tenant_id = cp.tenant_id
                         AND cr.status IN ('CLASSIFIED', 'EAR99')
                         AND cr.requires_revalidation = FALSE
                         AND cr.requires_human_review = FALSE
                    )
               ) AS complete`,
            [caseRecord.id, request.auth.tenant_id]
          );
          if (!classification.rows[0].complete) rejection = 'CLASSIFICATION_REQUIRED';
        }
      }
    }
    const newState = decision === 'APPROVE' ? 'APPROVED' : 'BLOCKED';
    const transition = await findTransition(client, caseRecord.state, newState);
    if (!rejection) {
      if (!transition || transition.required_role !== request.auth.role
        || (transition.requires_rationale && !rationale)) {
        rejection = 'WORKFLOW_TRANSITION';
      } else if (!(await guardPasses(client, transition, caseRecord, {
        rationale,
        planPermitsAutoClear: false
      }))) {
        rejection = 'WORKFLOW_GUARD';
      }
    }

    if (rejection) {
      if (rejection === 'RULE_1' || rejection === 'RULE_2') {
        await client.query(
          `UPDATE compliance_cases SET state = 'BLOCKED', overall_risk = 'BLOCKED', fired_rule_code = $2 WHERE id = $1`,
          [caseRecord.id, rejection]
        );
      }
      response.locals.result = {
        status: 409,
        body: { error: { code: 'IMMUTABLE_RULE', rule: rejection } }
      };
      response.locals.auditEvent = {
        caseId: caseRecord.id, eventType: 'DECISION_REJECTED',
        beforeState: { state: caseRecord.state },
        afterState: { state: rejection === 'RULE_1' || rejection === 'RULE_2' ? 'BLOCKED' : caseRecord.state },
        rationale
      };
      return next();
    }

    await client.query(
      `UPDATE compliance_cases
          SET state = $2, decided_by = $3, decided_at = now(), decision_rationale = $4,
              overall_risk = CASE WHEN $2 = 'BLOCKED' THEN 'BLOCKED' ELSE overall_risk END
        WHERE id = $1`,
      [caseRecord.id, newState, request.auth.user_id, rationale]
    );
    response.locals.result = { status: 200, body: { case_id: caseRecord.id, status: newState } };
    response.locals.auditEvent = {
      caseId: caseRecord.id, eventType: 'CASE_DECIDED',
      beforeState: { state: caseRecord.state }, afterState: { state: newState }, rationale
    };
    next();
  }), middleware.finalize);

  return router;
}

module.exports = { caseRouter };