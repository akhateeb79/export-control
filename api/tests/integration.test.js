'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const test = require('node:test');
const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const { writeAudit } = require('../audit');
const { createPool } = require('../db');
const { createApp } = require('../app');
const { activeListVersions, isBlockingConfirmedHit } = require('../sanctions');

const TEST_PASSWORD = 'Slice4-Test-Password!';
const MFA_SECRET = 'JBSWY3DPEHPK3PXP';

function uuid() {
  return crypto.randomUUID();
}

function currentTotp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of secret) bits += alphabet.indexOf(character).toString(2).padStart(5, '0');
  const key = Buffer.from([...Array(Math.floor(bits.length / 8)).keys()]
    .map((index) => Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2)));
  const input = Buffer.alloc(8);
  input.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = crypto.createHmac('sha1', key).update(input).digest();
  const position = digest[digest.length - 1] & 0x0f;
  return ((digest.readUInt32BE(position) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
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

test('screening halts when an active source has no active list version', async () => {
  const client = {
    query: async () => ({
      rows: [
        { code: 'OFAC_SDN', id: uuid(), fetched_at: new Date().toISOString() },
        { code: 'BIS_ENTITY', id: null, fetched_at: null }
      ]
    })
  };
  await assert.rejects(
    activeListVersions(client, 48),
    (error) => error.code === 'STALE_REFERENCE_DATA'
  );
});

test('screening fails closed for empty and missing required sources', async () => {
  const emptyClient = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    activeListVersions(emptyClient, 48),
    (error) => error.code === 'STALE_REFERENCE_DATA'
  );
  const missingClient = {
    query: async () => ({ rows: [{ code: 'OFAC_SDN', id: uuid(), fetched_at: new Date().toISOString(), is_blocking: true }] })
  };
  await assert.rejects(
    activeListVersions(missingClient, 48, ['OFAC_SDN', 'BIS_ENTITY']),
    (error) => error.code === 'STALE_REFERENCE_DATA'
  );
  assert.equal(isBlockingConfirmedHit('CONFIRMED_HIT', { is_blocking: true }), true);
  assert.equal(isBlockingConfirmedHit('CONFIRMED_HIT', { is_blocking: false }), false);
});

test('Slice 4 API protects tenant cases and records screening evidence', async () => {
  const run = uuid();
  const tenantId = uuid();
  const otherTenantId = uuid();
  const initiatorId = uuid();
  const officerId = uuid();
  const otherUserId = uuid();
  const clearPartyId = uuid();
  const confirmedPartyId = uuid();
  const nonBlockingPartyId = uuid();
  const passwordHash = await argon2.hash(TEST_PASSWORD, { type: argon2.argon2id });
  const config = {
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET || process.env.SESSION_SECRET,
    refreshSecret: `${process.env.JWT_SECRET || process.env.SESSION_SECRET}:refresh`,
    matchingServiceUrl: '',
    listFreshnessHours: 24 * 30,
    requiredListSources: ['OFAC_SDN'],
    rateLimitWindowMs: 60_000,
    rateLimitMax: 1_000,
    accessTokenTtl: '15m',
    refreshTokenTtl: '7d'
  };
  assert.ok(config.jwtSecret, 'SESSION_SECRET or JWT_SECRET is required for API tests');
  const pool = createPool(config);
  const reference = await pool.query(
    `SELECT se.id, se.source_code, lv.id AS list_version_id
       FROM sanctions_entries se
       JOIN list_versions lv ON lv.source_code = se.source_code AND lv.status = 'ACTIVE'
      WHERE se.source_code = 'OFAC_SDN' AND se.is_current = TRUE
      LIMIT 1`
  );
  assert.ok(reference.rows[0], 'An active OFAC SDN entry is required');

  const matcher = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    const candidates = ['Confirmed Party', 'Nonblocking Party'].includes(payload.name)
      ? [{
          sanctions_entry_id: reference.rows[0].id,
          score: 99,
          triggering_variant: 'confirmed party',
          triggering_algorithm: 'token_set_ratio',
          matched_name: 'confirmed party',
          source_list: reference.rows[0].source_code
        }]
      : [];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ candidates, max_score: candidates[0]?.score || 0, screening_duration_ms: 1 }));
  });
  const matcherUrl = await startServer(matcher);
  config.matchingServiceUrl = matcherUrl;

  const seed = await pool.connect();
  try {
    await seed.query('BEGIN');
    await seed.query(`INSERT INTO tenants (id, name, status) VALUES ($1, $2, 'ACTIVE'), ($3, $4, 'ACTIVE')`, [
      tenantId, `Slice 4 Test ${run}`, otherTenantId, `Slice 4 Other ${run}`
    ]);
    await seed.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
    await seed.query(
      `INSERT INTO users (id, tenant_id, email, role) VALUES
       ($1, $2, $3, 'INITIATOR'), ($4, $2, $5, 'COMPLIANCE_OFFICER')`,
      [initiatorId, tenantId, `initiator-${run}@example.test`, officerId, `officer-${run}@example.test`]
    );
    await seed.query(
      `INSERT INTO auth_credentials (user_id, tenant_id, email, password_hash, mfa_secret, mfa_enabled) VALUES
       ($1, $2, $3, $4, NULL, FALSE), ($5, $2, $6, $4, $7, TRUE)`,
      [initiatorId, tenantId, `initiator-${run}@example.test`, passwordHash, officerId, `officer-${run}@example.test`, MFA_SECRET]
    );
    await seed.query(
      `INSERT INTO tenant_subscriptions (id, tenant_id, plan_code, status, period_start, period_end)
       VALUES ($1, $2, 'PROFESSIONAL', 'ACTIVE', CURRENT_DATE - 1, CURRENT_DATE + 30)`,
      [uuid(), tenantId]
    );
    await seed.query(
      `INSERT INTO parties (id, tenant_id, legal_name, name_script, country_code) VALUES
       ($1, $2, 'Clear Party', 'LATIN', 'AE'), ($3, $2, 'Confirmed Party', 'LATIN', 'AE'),
       ($4, $2, 'Nonblocking Party', 'LATIN', 'AE')`,
      [clearPartyId, tenantId, confirmedPartyId, nonBlockingPartyId]
    );
    await seed.query('COMMIT');

    await seed.query('BEGIN');
    await seed.query(`SET LOCAL app.tenant_id = '${otherTenantId}'`);
    await seed.query(`INSERT INTO users (id, tenant_id, email, role) VALUES ($1, $2, $3, 'INITIATOR')`, [
      otherUserId, otherTenantId, `other-${run}@example.test`
    ]);
    await seed.query(
      `INSERT INTO auth_credentials (user_id, tenant_id, email, password_hash) VALUES ($1, $2, $3, $4)`,
      [otherUserId, otherTenantId, `other-${run}@example.test`, passwordHash]
    );
    await seed.query(
      `INSERT INTO tenant_subscriptions (id, tenant_id, plan_code, status, period_start, period_end)
       VALUES ($1, $2, 'PROFESSIONAL', 'ACTIVE', CURRENT_DATE - 1, CURRENT_DATE + 30)`,
      [uuid(), otherTenantId]
    );
    await seed.query('COMMIT');
  } catch (error) {
    await seed.query('ROLLBACK');
    throw error;
  } finally {
    seed.release();
  }
  const credentialLookup = await pool.query(
    `SELECT * FROM lookup_auth_credential($1)`,
    [`initiator-${run}@example.test`]
  );
  assert.deepEqual(
    Object.keys(credentialLookup.rows[0]).sort(),
    ['email', 'password_hash', 'tenant_id', 'user_id']
  );

  const app = createApp({ config, pool });
  const apiServer = http.createServer(app);
  const apiUrl = await startServer(apiServer);
  try {
    const initiatorLogin = await request(apiUrl, '/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: `initiator-${run}@example.test`, password: TEST_PASSWORD })
    });
    assert.equal(initiatorLogin.status, 200);
    const initiatorToken = initiatorLogin.body.access_token;
    const refreshAttempts = await Promise.all([
      request(apiUrl, '/api/v1/auth/refresh', {
        method: 'POST', body: JSON.stringify({ refresh_token: initiatorLogin.body.refresh_token })
      }),
      request(apiUrl, '/api/v1/auth/refresh', {
        method: 'POST', body: JSON.stringify({ refresh_token: initiatorLogin.body.refresh_token })
      })
    ]);
    assert.deepEqual(refreshAttempts.map((attempt) => attempt.status).sort(), [200, 401]);

    const officerChallenge = await request(apiUrl, '/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: `officer-${run}@example.test`, password: TEST_PASSWORD })
    });
    assert.equal(officerChallenge.body.mfa_required, true);
    const officerLogin = await request(apiUrl, '/api/v1/auth/mfa/verify', {
      method: 'POST',
      body: JSON.stringify({ mfa_token: officerChallenge.body.mfa_token, code: currentTotp(MFA_SECRET) })
    });
    assert.equal(officerLogin.status, 200);
    const officerToken = officerLogin.body.access_token;

    const createClear = await request(apiUrl, '/api/v1/cases', {
      method: 'POST',
      headers: { authorization: `Bearer ${initiatorToken}` },
      body: JSON.stringify({
        case_ref: `CLEAR-${run}`, destination_country: 'AE', stated_end_use: 'Test end use',
        parties: [{ party_id: clearPartyId, party_role: 'CONSIGNEE' }]
      })
    });
    assert.equal(createClear.status, 201);
    const clearCaseId = createClear.body.case_id;

    const freshApproval = await request(apiUrl, `/api/v1/cases/${clearCaseId}/decision`, {
      method: 'POST', headers: { authorization: `Bearer ${officerToken}` },
      body: JSON.stringify({ decision: 'APPROVE', rationale: 'Verification rule test' })
    });
    assert.equal(freshApproval.status, 409);
    assert.equal(freshApproval.body.error.code, 'IMMUTABLE_RULE');
    assert.equal(freshApproval.body.error.rule, 'RULE_3');

    const submittedClear = await request(apiUrl, `/api/v1/cases/${clearCaseId}/submit`, {
      method: 'POST', headers: { authorization: `Bearer ${initiatorToken}` }, body: '{}'
    });
    assert.equal(submittedClear.status, 202);
    const loadedClear = await request(apiUrl, `/api/v1/cases/${clearCaseId}`, {
      headers: { authorization: `Bearer ${initiatorToken}` }
    });
    assert.equal(loadedClear.status, 200);
    assert.ok(loadedClear.body.screening_results.some((result) => result.status === 'CLEAR'));
    assert.ok(loadedClear.body.screening_results.every((result) => result.list_sync_date));
    const listedCases = await request(apiUrl, '/api/v1/cases?status=SCREENING&page=1&page_size=10', {
      headers: { authorization: `Bearer ${initiatorToken}` }
    });
    assert.equal(listedCases.status, 200);
    assert.ok(listedCases.body.cases.some((entry) => entry.id === clearCaseId));
    const prohibitedHumanBlock = await request(apiUrl, `/api/v1/cases/${clearCaseId}/decision`, {
      method: 'POST', headers: { authorization: `Bearer ${officerToken}` },
      body: JSON.stringify({ decision: 'BLOCK', rationale: 'Must follow persisted workflow' })
    });
    assert.equal(prohibitedHumanBlock.status, 409);
    assert.equal(prohibitedHumanBlock.body.error.rule, 'WORKFLOW_TRANSITION');

    const otherToken = jwt.sign({
      tenant_id: otherTenantId, user_id: otherUserId, role: 'INITIATOR', plan_id: 'PROFESSIONAL'
    }, config.jwtSecret, { algorithm: 'HS256', expiresIn: '15m' });
    const crossTenant = await request(apiUrl, `/api/v1/cases/${clearCaseId}`, {
      headers: { authorization: `Bearer ${otherToken}` }
    });
    assert.equal(crossTenant.status, 404);
    await pool.query(`UPDATE tenants SET status = 'SUSPENDED' WHERE id = $1`, [otherTenantId]);
    const inactiveTenant = await request(apiUrl, `/api/v1/cases/${clearCaseId}`, {
      headers: { authorization: `Bearer ${otherToken}` }
    });
    assert.equal(inactiveTenant.status, 403);
    assert.equal(inactiveTenant.body.error.code, 'TENANT_INACTIVE');
    const inactiveLogin = await request(apiUrl, '/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: `other-${run}@example.test`, password: TEST_PASSWORD })
    });
    assert.equal(inactiveLogin.status, 403);
    assert.equal(inactiveLogin.body.error.code, 'TENANT_INACTIVE');

    const createConfirmed = await request(apiUrl, '/api/v1/cases', {
      method: 'POST',
      headers: { authorization: `Bearer ${initiatorToken}` },
      body: JSON.stringify({
        case_ref: `CONFIRMED-${run}`, destination_country: 'AE', stated_end_use: 'Test end use',
        parties: [{ party_id: confirmedPartyId, party_role: 'CONSIGNEE' }]
      })
    });
    const confirmedCaseId = createConfirmed.body.case_id;
    const submittedConfirmed = await request(apiUrl, `/api/v1/cases/${confirmedCaseId}/submit`, {
      method: 'POST', headers: { authorization: `Bearer ${initiatorToken}` }, body: '{}'
    });
    assert.equal(submittedConfirmed.body.status, 'BLOCKED');
    const confirmedApproval = await request(apiUrl, `/api/v1/cases/${confirmedCaseId}/decision`, {
      method: 'POST', headers: { authorization: `Bearer ${officerToken}` },
      body: JSON.stringify({ decision: 'APPROVE', rationale: 'Attempted prohibited approval' })
    });
    assert.equal(confirmedApproval.status, 409);
    assert.equal(confirmedApproval.body.error.rule, 'RULE_1');

    await pool.query(`UPDATE list_sources SET is_blocking = FALSE WHERE code = 'OFAC_SDN'`);
    try {
      const createNonBlocking = await request(apiUrl, '/api/v1/cases', {
        method: 'POST',
        headers: { authorization: `Bearer ${initiatorToken}` },
        body: JSON.stringify({
          case_ref: `NONBLOCK-${run}`, destination_country: 'AE', stated_end_use: 'Test end use',
          parties: [{ party_id: nonBlockingPartyId, party_role: 'CONSIGNEE' }]
        })
      });
      assert.equal(createNonBlocking.status, 201);
      const submittedNonBlocking = await request(apiUrl, `/api/v1/cases/${createNonBlocking.body.case_id}/submit`, {
        method: 'POST', headers: { authorization: `Bearer ${initiatorToken}` }, body: '{}'
      });
      assert.equal(submittedNonBlocking.status, 202);
      assert.equal(submittedNonBlocking.body.status, 'REVIEW_REQUIRED');
    } finally {
      await pool.query(`UPDATE list_sources SET is_blocking = TRUE WHERE code = 'OFAC_SDN'`);
    }

    const auditCount = await pool.query(`SELECT count(*)::int AS count FROM audit_events WHERE tenant_id = $1`, [tenantId]);
    assert.ok(auditCount.rows[0].count >= 8);

    const rollbackCaseId = uuid();
    const rollbackClient = await pool.connect();
    try {
      await rollbackClient.query('BEGIN');
      await rollbackClient.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
      await rollbackClient.query(
        `INSERT INTO compliance_cases (
           id, tenant_id, case_ref, state, destination_country, stated_end_use, retention_until
         ) VALUES ($1, $2, $3, 'DRAFT', 'AE', 'Audit rollback test', CURRENT_DATE + 365)`,
        [rollbackCaseId, tenantId, `ROLLBACK-${run}`]
      );
      await assert.rejects(
        writeAudit(rollbackClient, {
          tenantId,
          caseId: rollbackCaseId,
          eventType: 'X'.repeat(49),
          actorType: 'SYSTEM',
          afterState: { state: 'DRAFT' }
        })
      );
      await rollbackClient.query('ROLLBACK');
    } finally {
      rollbackClient.release();
    }
    const rolledBack = await pool.query(`SELECT 1 FROM compliance_cases WHERE id = $1`, [rollbackCaseId]);
    assert.equal(rolledBack.rowCount, 0);
  } finally {
    await new Promise((resolve) => apiServer.close(resolve));
    await new Promise((resolve) => matcher.close(resolve));
    await pool.end();
  }
});