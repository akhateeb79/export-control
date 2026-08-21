'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const test = require('node:test');
const { createApp } = require('../app');
const { createPool } = require('../db');
const { productFingerprint } = require('../classification');

function uuid() {
  return crypto.randomUUID();
}

async function startServer(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  return { status: response.status, body: await response.json() };
}

test('Slice 5 classification routes missing inputs, avoids empty candidate reasoning, caches, and invalidates', async () => {
  const run = uuid();
  const tenantId = uuid();
  const userId = uuid();
  const config = {
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET || process.env.SESSION_SECRET,
    refreshSecret: `${process.env.JWT_SECRET || process.env.SESSION_SECRET}:refresh`,
    matchingServiceUrl: '',
    anthropicApiKey: null,
    anthropicBaseUrl: '',
    classificationWorkerEnabled: false,
    classificationWorkerPollMs: 100,
    listFreshnessHours: 24,
    requiredListSources: ['OFAC_SDN'],
    rateLimitWindowMs: 60_000,
    rateLimitMax: 1_000,
    accessTokenTtl: '15m',
    refreshTokenTtl: '7d'
  };
  assert.ok(config.jwtSecret, 'SESSION_SECRET or JWT_SECRET is required for API tests');
  const modelCalls = [];
  const modelClient = async ({ agent, input }) => {
    modelCalls.push({ stage: agent.agent_code, input });
    if (agent.agent_code === 'CLASSIFIER_EXTRACTION') {
      const name = input.product_name.toLowerCase();
      if (name.includes('missing laser')) {
        return {
          category: 6, product_group: 'A', technical_parameters: [],
          insufficient_detail: true, missing_for_classification: ['laser_output_power_w']
        };
      }
      if (name.includes('excluded laser')) {
        return {
          category: 6, product_group: 'A',
          technical_parameters: [{ parameter: 'laser_output_power_w', value: 2, unit: 'W' }],
          insufficient_detail: false, missing_for_classification: []
        };
      }
      return {
        category: null, product_group: null, technical_parameters: [],
        insufficient_detail: false, missing_for_classification: []
      };
    }
    assert.ok(input.candidates.length > 0, 'Stage 3 must never receive an empty candidate set');
    return {
      outcome: 'EAR99',
      eccn: null,
      confidence: 95,
      reasoning: 'The described wooden office chair does not match the supplied candidate control entries.',
      rejected_candidates: input.candidates.map((candidate) => ({
        eccn: candidate.eccn,
        reason: 'The entry technical criteria do not describe a wooden office chair.'
      }))
    };
  };
  const pool = createPool(config);
  const seed = await pool.connect();
  const originalVersion = '00000000-0000-0000-0000-000000000501';
  let newVersionId;
  try {
    await seed.query('BEGIN');
    await seed.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
    await seed.query(`INSERT INTO tenants (id, name, status) VALUES ($1, $2, 'ACTIVE')`, [tenantId, `Slice 5 ${run}`]);
    await seed.query(`INSERT INTO users (id, tenant_id, email, role) VALUES ($1, $2, $3, 'COMPLIANCE_OFFICER')`, [
      userId, tenantId, `slice5-${run}@example.test`
    ]);
    await seed.query(
      `INSERT INTO tenant_subscriptions (id, tenant_id, plan_code, status, period_start, period_end)
       VALUES ($1, $2, 'PROFESSIONAL', 'ACTIVE', CURRENT_DATE - 1, CURRENT_DATE + 30)`,
      [uuid(), tenantId]
    );
    await seed.query('COMMIT');

    const makeCase = async (product) => {
      const caseId = uuid();
      const productId = uuid();
      const fingerprint = productFingerprint(product);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
        await client.query(
          `INSERT INTO compliance_cases (
             id, tenant_id, case_ref, state, destination_country, stated_end_use, retention_until
           ) VALUES ($1, $2, $3, 'SCREENING', 'AE', 'Classification test', CURRENT_DATE + 365)`,
          [caseId, tenantId, `CLASS-${uuid()}`]
        );
        await client.query(
          `INSERT INTO products (
             id, tenant_id, name, description, specifications, product_fingerprint
           ) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (tenant_id, product_fingerprint) WHERE product_fingerprint IS NOT NULL
           DO UPDATE SET name = products.name
           RETURNING id`,
          [productId, tenantId, product.name, product.description, JSON.stringify(product.specifications || {}), fingerprint]
        );
        const resolved = await client.query(
          `SELECT id FROM products WHERE tenant_id = $1 AND product_fingerprint = $2`,
          [tenantId, fingerprint]
        );
        await client.query(
          `INSERT INTO case_products (id, tenant_id, case_id, product_id, product_snapshot)
           VALUES ($1, $2, $3, $4, $5)`,
          [uuid(), tenantId, caseId, resolved.rows[0].id, JSON.stringify(product)]
        );
        await client.query('COMMIT');
        return caseId;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    };

    const app = createApp({ config, pool, modelClient });
    const server = http.createServer(app);
    const apiUrl = await startServer(server);
    const token = jwt.sign({
      tenant_id: tenantId, user_id: userId, role: 'COMPLIANCE_OFFICER', plan_id: 'PROFESSIONAL'
    }, config.jwtSecret, { algorithm: 'HS256', expiresIn: '15m' });
    const headers = { authorization: `Bearer ${token}` };

    try {
      const missingCase = await makeCase({
        name: 'Missing laser', description: 'Laboratory laser with no output power provided.', specifications: {}
      });
      const missingQueued = await request(apiUrl, `/api/v1/cases/${missingCase}/classify`, { method: 'POST', headers, body: '{}' });
      assert.equal(missingQueued.status, 202);
      const missingDone = await app.locals.classifier.processNext();
      assert.equal(missingDone.status, 'INSUFFICIENT_INFORMATION');
      assert.equal(modelCalls.filter((call) => call.stage === 'CLASSIFIER_REASONING').length, 0);
      const missingResult = await request(apiUrl, `/api/v1/cases/${missingCase}/classification`, { headers });
      assert.equal(missingResult.status, 200);
      assert.equal(missingResult.body.classifications[0].status, 'INSUFFICIENT_INFORMATION');

      const deactivate = await pool.query(
        `UPDATE eccn_entries
            SET is_current = FALSE
          WHERE version_id = $1 AND eccn = '6A005'
        RETURNING eccn`,
        [originalVersion]
      );
      assert.equal(deactivate.rowCount, 1);
      const excludedCase = await makeCase({
        name: 'Excluded laser', description: 'Laser with documented output power.', specifications: { laser_output_power_w: 2 }
      });
      const excludedQueued = await request(apiUrl, `/api/v1/cases/${excludedCase}/classify`, { method: 'POST', headers, body: '{}' });
      assert.equal(excludedQueued.status, 202);
      const excludedDone = await app.locals.classifier.processNext();
      assert.equal(excludedDone.status, 'CANDIDATE_SET_INADEQUATE');
      assert.equal(modelCalls.filter((call) => call.stage === 'CLASSIFIER_REASONING').length, 0);
      await pool.query(`UPDATE eccn_entries SET is_current = TRUE WHERE version_id = $1 AND eccn = '6A005'`, [originalVersion]);

      const chair = {
        name: 'Standard wooden office chair',
        description: 'Standard wooden office chair, no electronic components.',
        specifications: {}
      };
      const chairCase = await makeCase(chair);
      const chairQueued = await request(apiUrl, `/api/v1/cases/${chairCase}/classify`, { method: 'POST', headers, body: '{}' });
      assert.equal(chairQueued.status, 202);
      const chairDone = await app.locals.classifier.processNext();
      assert.equal(chairDone.status, 'EAR99');
      const chairResult = await request(apiUrl, `/api/v1/cases/${chairCase}/classification`, { headers });
      assert.equal(chairResult.body.classifications[0].status, 'EAR99');

      const cachedCase = await makeCase(chair);
      const cached = await request(apiUrl, `/api/v1/cases/${cachedCase}/classify`, { method: 'POST', headers, body: '{}' });
      assert.equal(cached.status, 200);
      assert.equal(cached.body.cached, true);

      newVersionId = uuid();
      await pool.query(
        `INSERT INTO control_list_versions (
           id, regime, version_label, effective_from, is_current, source, loaded_at, status
         ) VALUES ($1, 'EAR', $2, CURRENT_DATE, FALSE, 'test', now(), 'SUPERSEDED')`,
        [newVersionId, `TEST-${run}`]
      );
      await pool.query(`SELECT activate_control_list_version($1)`, [newVersionId]);
      const stale = await request(apiUrl, `/api/v1/cases/${chairCase}/classification`, { headers });
      assert.equal(stale.body.classifications[0].requires_revalidation, true);

      const provenance = await pool.query(
        `SELECT count(*)::int AS count
           FROM classification_results
          WHERE agent_version_id IS NULL OR control_list_version_id IS NULL`
      );
      assert.equal(provenance.rows[0].count, 0);
    } finally {
      await pool.query(`UPDATE eccn_entries SET is_current = TRUE WHERE version_id = $1 AND eccn = '6A005'`, [originalVersion]);
      if (newVersionId) await pool.query(`SELECT activate_control_list_version($1)`, [originalVersion]);
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    seed.release();
    await pool.end();
  }
});