'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createPool } = require('../repository');
const { ingestSource } = require('../index');

const SOURCE_CODE = 'TEST_INGEST';
const TENANT_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const OPEN_PARTY_ID = '44444444-4444-4444-4444-444444444444';
const APPROVED_PARTY_ID = '55555555-5555-5555-5555-555555555555';
const OPEN_CASE_ID = '66666666-6666-6666-6666-666666666666';
const APPROVED_CASE_ID = '77777777-7777-7777-7777-777777777777';

async function removeFixtureData(client) {
  await client.query('DELETE FROM screening_results WHERE case_id IN ($1, $2)', [OPEN_CASE_ID, APPROVED_CASE_ID]);
  await client.query(
    'UPDATE compliance_cases SET retention_until = CURRENT_DATE - 1 WHERE id IN ($1, $2)',
    [OPEN_CASE_ID, APPROVED_CASE_ID]
  );
  await client.query('DELETE FROM compliance_cases WHERE id IN ($1, $2)', [OPEN_CASE_ID, APPROVED_CASE_ID]);
  await client.query('DELETE FROM parties WHERE id IN ($1, $2)', [OPEN_PARTY_ID, APPROVED_PARTY_ID]);
  await client.query('DELETE FROM tenants WHERE id = $1', [TENANT_ID]);
  await client.query('DELETE FROM sanctions_entries WHERE source_code = $1', [SOURCE_CODE]);
  await client.query('DELETE FROM list_versions WHERE source_code = $1', [SOURCE_CODE]);
  await client.query('DELETE FROM list_sources WHERE code = $1', [SOURCE_CODE]);
}

async function source(client) {
  const { rows } = await client.query(
    'SELECT code, authority, name, source_url, format FROM list_sources WHERE code = $1',
    [SOURCE_CODE]
  );
  return rows[0];
}

async function createCascadeCases(client, versionId, entryId) {
  await client.query('BEGIN');
  try {
    await client.query('INSERT INTO tenants (id, name) VALUES ($1, $2)', [TENANT_ID, 'Ingestion cascade test tenant']);
    await client.query(`SET LOCAL app.tenant_id = '${TENANT_ID}'`);
    await client.query(
      `INSERT INTO parties (id, tenant_id, legal_name, country_code)
       VALUES ($1, $3, 'Open fixture party', 'AE'), ($2, $3, 'Approved fixture party', 'AE')`,
      [OPEN_PARTY_ID, APPROVED_PARTY_ID, TENANT_ID]
    );
    await client.query(
      `INSERT INTO compliance_cases (
         id, tenant_id, case_ref, state, destination_country, stated_end_use, retention_until
       ) VALUES
         ($1, $3, 'CASCADE-OPEN', 'DRAFT', 'AE', 'Fixture validation', CURRENT_DATE - 1),
         ($2, $3, 'CASCADE-APPROVED', 'APPROVED', 'AE', 'Fixture validation', CURRENT_DATE + 365)`,
      [OPEN_CASE_ID, APPROVED_CASE_ID, TENANT_ID]
    );
    await client.query(
      `INSERT INTO screening_results (
         id, tenant_id, case_id, party_id, source_code, list_version_id, status, top_score, matched_entry_id
       ) VALUES
         ('88888888-8888-8888-8888-888888888888', $1, $2, $4, $5, $6, 'POSSIBLE_HIT', 88, $7),
         ('99999999-9999-9999-9999-999999999999', $1, $3, $4, $5, $6, 'POSSIBLE_HIT', 88, $7)`,
      [TENANT_ID, OPEN_CASE_ID, APPROVED_CASE_ID, OPEN_PARTY_ID, SOURCE_CODE, versionId, entryId]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  process.env.INGEST_TEST_MODE = 'true';
  const pool = createPool();
  const client = await pool.connect();
  const fixturePath = path.join(os.tmpdir(), `ingest-fixture-${Date.now()}.csv`);
  try {
    await removeFixtureData(client);
    await fs.copyFile(path.join(__dirname, 'fixtures', 'sample.csv'), fixturePath);
    const fixtureUrl = pathToFileURL(fixturePath).href;
    await client.query(
      `INSERT INTO list_sources (
         code, authority, name, source_url, format, is_blocking, sync_cron, is_active
       ) VALUES ($1, 'TEST', 'Fixture ingestion source', $2, 'CSV', FALSE, '0 0 * * *', TRUE)`,
      [SOURCE_CODE, fixtureUrl]
    );

    const first = await ingestSource(client, await source(client));
    const second = await ingestSource(client, await source(client));
    const countResult = await client.query(
      `SELECT count(*)::int AS versions
       FROM list_versions WHERE source_code = $1 AND status <> 'FAILED'`,
      [SOURCE_CODE]
    );

    const entryResult = await client.query(
      'SELECT id FROM sanctions_entries WHERE source_code = $1 AND source_ref = $2',
      [SOURCE_CODE, 'fixture-001']
    );
    await createCascadeCases(client, first.versionId, entryResult.rows[0].id);
    await fs.writeFile(
      fixturePath,
      'source_ref,entity_type,name,country_code,programs,remarks,registration_no\nfixture-001,ENTITY,Example Trading FZE,AE,TEST_PROGRAM,Changed fixture entry,REG-001\n'
    );
    const changed = await ingestSource(client, await source(client));
    const cascadeResult = await client.query(
      `SELECT case_ref, state, requires_rescreen
       FROM compliance_cases
       WHERE id IN ($1, $2)
       ORDER BY case_ref`,
      [OPEN_CASE_ID, APPROVED_CASE_ID]
    );

    await client.query(
      'UPDATE list_sources SET source_url = $1 WHERE code = $2',
      [pathToFileURL(path.join(os.tmpdir(), `missing-ingest-fixture-${Date.now()}.csv`)).href, SOURCE_CODE]
    );
    const failure = await ingestSource(client, await source(client));
    const statusResult = await client.query(
      `SELECT
         count(*) FILTER (WHERE status = 'ACTIVE')::int AS active_versions,
         count(*) FILTER (WHERE status = 'FAILED')::int AS failed_versions
       FROM list_versions WHERE source_code = $1`,
      [SOURCE_CODE]
    );

    const cascadeByCase = Object.fromEntries(cascadeResult.rows.map((row) => [row.case_ref, row]));
    if (first.outcome !== 'UPDATED' || second.outcome !== 'UNCHANGED' || countResult.rows[0].versions !== 1) {
      throw new Error('Unchanged-payload verification failed');
    }
    if (
      changed.outcome !== 'UPDATED'
      || changed.changed !== 1
      || cascadeByCase['CASCADE-OPEN'].state !== 'SCREENING'
      || cascadeByCase['CASCADE-APPROVED'].requires_rescreen !== true
    ) {
      throw new Error('Re-screening cascade verification failed');
    }
    if (failure.outcome !== 'FAILED' || statusResult.rows[0].active_versions !== 1 || statusResult.rows[0].failed_versions !== 1) {
      throw new Error('Failure handling verification failed');
    }
    process.stdout.write(`${JSON.stringify({
      first,
      second,
      nonFailedVersions: countResult.rows[0].versions,
      changed,
      cascade: cascadeResult.rows,
      failure,
      statuses: statusResult.rows[0]
    }, null, 2)}\n`);
  } finally {
    try {
      await removeFixtureData(client);
      await fs.rm(fixturePath, { force: true });
    } finally {
      client.release();
      await pool.end();
    }
  }
}

main().catch((error) => {
  process.stderr.write(`Ingestion integration test failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});