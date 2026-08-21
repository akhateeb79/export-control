'use strict';

const crypto = require('node:crypto');
const { Pool } = require('pg');

const SYSTEM_TENANT_ID = '00000000-0000-0000-0000-000000000000';

function createPool() {
  const connectionString = process.env.INGEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('INGEST_DATABASE_URL or DATABASE_URL is required for list ingestion');
  }
  return new Pool({ connectionString });
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable).sort();
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value ?? null;
}

function entryFingerprint(entry) {
  return JSON.stringify(stable({
    entityType: entry.entityType,
    programs: entry.programs,
    countryCode: entry.countryCode,
    remarks: entry.remarks,
    names: entry.names.map((name) => ({
      nameType: name.nameType,
      script: name.script,
      rawName: name.rawName,
      normalisedName: name.normalisedName,
      nameTokens: name.nameTokens
    })),
    identifiers: entry.identifiers
  }));
}

function databaseEntryFingerprint(entry) {
  return entryFingerprint({
    entityType: entry.entityType,
    programs: entry.programs || [],
    countryCode: entry.countryCode,
    remarks: entry.remarks,
    names: entry.names,
    identifiers: entry.identifiers
  });
}

async function loadSources(client, sourceCode) {
  const params = sourceCode ? [sourceCode] : [];
  const query = sourceCode
    ? 'SELECT code, authority, name, source_url, format FROM list_sources WHERE is_active AND code = $1 ORDER BY code'
    : 'SELECT code, authority, name, source_url, format FROM list_sources WHERE is_active ORDER BY code';
  const { rows } = await client.query(query, params);
  if (sourceCode && !rows.length) throw new Error(`Active list source not found: ${sourceCode}`);
  return rows;
}

async function latestActiveVersion(client, sourceCode) {
  const { rows } = await client.query(
    `SELECT id, source_code, fetched_at, content_hash, entry_count, status
     FROM list_versions
     WHERE source_code = $1 AND status = 'ACTIVE'
     ORDER BY fetched_at DESC, id DESC
     LIMIT 1`,
    [sourceCode]
  );
  return rows[0] || null;
}

async function markUnchangedCheck(client, versionId) {
  await client.query('UPDATE list_versions SET fetched_at = now() WHERE id = $1', [versionId]);
}

async function loadCurrentEntries(client, sourceCode) {
  const entriesResult = await client.query(
    `SELECT id, source_code, source_ref, entity_type, programs, country_code, remarks
     FROM sanctions_entries
     WHERE source_code = $1 AND is_current = TRUE
     ORDER BY source_ref`,
    [sourceCode]
  );
  if (!entriesResult.rows.length) return new Map();

  const ids = entriesResult.rows.map((entry) => entry.id);
  const [namesResult, identifiersResult] = await Promise.all([
    client.query(
      `SELECT entry_id, name_type, script, raw_name, normalised_name, name_tokens
       FROM sanctions_entry_names
       WHERE entry_id = ANY($1::uuid[])
       ORDER BY entry_id, id`,
      [ids]
    ),
    client.query(
      `SELECT entry_id, id_type, id_value, country_code
       FROM sanctions_entry_identifiers
       WHERE entry_id = ANY($1::uuid[])
       ORDER BY entry_id, id`,
      [ids]
    )
  ]);

  const byId = new Map(entriesResult.rows.map((entry) => [entry.id, {
    id: entry.id,
    sourceRef: entry.source_ref,
    entityType: entry.entity_type,
    programs: entry.programs || [],
    countryCode: entry.country_code,
    remarks: entry.remarks,
    names: [],
    identifiers: []
  }]));
  for (const name of namesResult.rows) {
    byId.get(name.entry_id).names.push({
      nameType: name.name_type,
      script: name.script,
      rawName: name.raw_name,
      normalisedName: name.normalised_name,
      nameTokens: name.name_tokens
    });
  }
  for (const identifier of identifiersResult.rows) {
    byId.get(identifier.entry_id).identifiers.push({
      idType: identifier.id_type,
      idValue: identifier.id_value,
      countryCode: identifier.country_code
    });
  }
  return new Map([...byId.values()].map((entry) => [entry.sourceRef, entry]));
}

function diffEntries(currentEntries, incomingEntries) {
  const incoming = new Map(incomingEntries.map((entry) => [entry.sourceRef, entry]));
  const added = [];
  const changed = [];
  const removed = [];

  for (const [sourceRef, entry] of incoming) {
    const existing = currentEntries.get(sourceRef);
    if (!existing) added.push(entry);
    else if (databaseEntryFingerprint(existing) !== entryFingerprint(entry)) changed.push(entry);
  }
  for (const [sourceRef, entry] of currentEntries) {
    if (!incoming.has(sourceRef)) removed.push(entry);
  }
  return { added, changed, removed };
}

function assertUuid(value) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`Invalid tenant identifier while setting local context: ${value}`);
  }
  return value;
}

async function setLocalTenant(client, tenantId) {
  const id = assertUuid(tenantId);
  await client.query(`SET LOCAL app.tenant_id = '${id}'`);
}

async function insertOrReactivateVersion(client, sourceCode, payloadHash, entryCount, diff) {
  const versionId = crypto.randomUUID();
  const { rows } = await client.query(
    `INSERT INTO list_versions (
       id, source_code, fetched_at, content_hash, entry_count,
       added_count, removed_count, changed_count, status
     ) VALUES ($1, $2, now(), $3, $4, $5, $6, $7, 'ACTIVE')
     ON CONFLICT (source_code, content_hash) DO UPDATE SET
       fetched_at = EXCLUDED.fetched_at,
       entry_count = EXCLUDED.entry_count,
       added_count = EXCLUDED.added_count,
       removed_count = EXCLUDED.removed_count,
       changed_count = EXCLUDED.changed_count,
       status = 'ACTIVE'
     RETURNING id`,
    [
      versionId,
      sourceCode,
      payloadHash,
      entryCount,
      diff.added.length,
      diff.removed.length,
      diff.changed.length
    ]
  );
  return rows[0].id;
}

async function writeEntry(client, sourceCode, versionId, entry) {
  const { rows } = await client.query(
    `INSERT INTO sanctions_entries (
       id, source_code, source_ref, entity_type, programs, country_code, remarks,
       first_seen_version, last_seen_version, is_current
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, TRUE)
     ON CONFLICT (source_code, source_ref) DO UPDATE SET
       entity_type = EXCLUDED.entity_type,
       programs = EXCLUDED.programs,
       country_code = EXCLUDED.country_code,
       remarks = EXCLUDED.remarks,
       last_seen_version = EXCLUDED.last_seen_version,
       is_current = TRUE
     RETURNING id`,
    [
      crypto.randomUUID(),
      sourceCode,
      entry.sourceRef,
      entry.entityType,
      entry.programs,
      entry.countryCode,
      entry.remarks || null,
      versionId
    ]
  );
  const entryId = rows[0].id;
  await client.query('DELETE FROM sanctions_entry_names WHERE entry_id = $1', [entryId]);
  await client.query('DELETE FROM sanctions_entry_identifiers WHERE entry_id = $1', [entryId]);

  for (const name of entry.names) {
    await client.query(
      `INSERT INTO sanctions_entry_names (
         entry_id, name_type, script, raw_name, normalised_name, name_tokens
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [entryId, name.nameType, name.script, name.rawName, name.normalisedName, name.nameTokens]
    );
  }
  for (const identifier of entry.identifiers) {
    await client.query(
      `INSERT INTO sanctions_entry_identifiers (entry_id, id_type, id_value, country_code)
       VALUES ($1, $2, $3, $4)`,
      [entryId, identifier.idType, identifier.idValue, identifier.countryCode]
    );
  }
  return entryId;
}

async function cascadeRescreening(client, sourceCode, previousVersionId) {
  if (!previousVersionId) return { openCases: 0, approvedCases: 0 };
  const permissionResult = await client.query(
    `SELECT rolsuper, rolbypassrls
     FROM pg_roles
     WHERE rolname = current_user`
  );
  const permissions = permissionResult.rows[0];
  if (!permissions?.rolsuper && !permissions?.rolbypassrls) {
    throw new Error(
      'Cross-tenant re-screening requires INGEST_DATABASE_URL to use a dedicated service role with BYPASSRLS'
    );
  }
  const { rows } = await client.query(
    `SELECT DISTINCT c.id, c.tenant_id, c.state
     FROM compliance_cases c
     JOIN screening_results sr ON sr.case_id = c.id
     WHERE sr.source_code = $1
       AND sr.list_version_id = $2`,
    [sourceCode, previousVersionId]
  );
  const tenantCases = new Map();
  for (const row of rows) {
    if (!tenantCases.has(row.tenant_id)) tenantCases.set(row.tenant_id, []);
    tenantCases.get(row.tenant_id).push(row.id);
  }

  let openCases = 0;
  let approvedCases = 0;
  for (const [tenantId, caseIds] of tenantCases) {
    await setLocalTenant(client, tenantId);
    const openResult = await client.query(
      `UPDATE compliance_cases SET state = 'SCREENING'
       WHERE id = ANY($1::uuid[])
         AND state NOT IN (SELECT code FROM workflow_states WHERE is_terminal)
       RETURNING id`,
      [caseIds]
    );
    const approvedResult = await client.query(
      `UPDATE compliance_cases SET requires_rescreen = TRUE
       WHERE id = ANY($1::uuid[])
         AND state = 'APPROVED'
         AND retention_until >= CURRENT_DATE
       RETURNING id`,
      [caseIds]
    );
    openCases += openResult.rowCount;
    approvedCases += approvedResult.rowCount;
  }
  return { openCases, approvedCases };
}

async function applyChangedSource(client, source, payloadHash, entries) {
  await client.query('BEGIN');
  try {
    await setLocalTenant(client, SYSTEM_TENANT_ID);
    const previousVersion = await latestActiveVersion(client, source.code);
    const currentEntries = await loadCurrentEntries(client, source.code);
    const diff = diffEntries(currentEntries, entries);
    const versionId = await insertOrReactivateVersion(
      client,
      source.code,
      payloadHash,
      entries.length,
      diff
    );

    if (previousVersion) {
      await client.query(
        `UPDATE list_versions SET status = 'SUPERSEDED'
         WHERE id = $1 AND id <> $2`,
        [previousVersion.id, versionId]
      );
    }

    const affectedIds = [];
    for (const entry of entries) affectedIds.push(await writeEntry(client, source.code, versionId, entry));
    if (diff.removed.length) {
      const removedRefs = diff.removed.map((entry) => entry.sourceRef);
      const { rows } = await client.query(
        `UPDATE sanctions_entries SET is_current = FALSE
         WHERE source_code = $1
           AND is_current = TRUE
           AND source_ref = ANY($2::text[])
         RETURNING id`,
        [source.code, removedRefs]
      );
      affectedIds.push(...rows.map((row) => row.id));
    }

    const cascade = await cascadeRescreening(client, source.code, previousVersion?.id);
    await client.query('COMMIT');
    return {
      outcome: 'UPDATED',
      versionId,
      added: diff.added.length,
      removed: diff.removed.length,
      changed: diff.changed.length,
      affectedEntries: affectedIds.length,
      ...cascade
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function recordFailure(client, source, previousVersion, error) {
  const failureHash = crypto.createHash('sha256')
    .update(`${source.code}|${Date.now()}|${error.message}`)
    .digest('hex');
  await client.query('BEGIN');
  try {
    await setLocalTenant(client, SYSTEM_TENANT_ID);
    await client.query(
      `INSERT INTO list_versions (
         id, source_code, fetched_at, content_hash, entry_count,
         added_count, removed_count, changed_count, status
       ) VALUES ($1, $2, now(), $3, $4, 0, 0, 0, 'FAILED')`,
      [crypto.randomUUID(), source.code, failureHash, previousVersion?.entry_count || 0]
    );
    await client.query('COMMIT');
  } catch (recordingError) {
    await client.query('ROLLBACK');
    throw new Error(`Failed to record ingestion failure for ${source.code}: ${recordingError.message}`, {
      cause: error
    });
  }
}

module.exports = {
  SYSTEM_TENANT_ID,
  applyChangedSource,
  createPool,
  databaseEntryFingerprint,
  diffEntries,
  entryFingerprint,
  latestActiveVersion,
  loadSources,
  markUnchangedCheck,
  recordFailure
};