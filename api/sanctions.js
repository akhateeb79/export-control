'use strict';

const { writeAudit } = require('./audit');
const { ApiError } = require('./errors');
const { uuidV7 } = require('./db');
const { assertSystemTransition } = require('./workflow');

async function activeListVersions(client, freshnessHours, requiredSourceCodes) {
  const sourceFilter = requiredSourceCodes?.length
    ? 'AND s.code = ANY($1::varchar[])'
    : '';
  const result = await client.query(
    `WITH latest_active AS (
       SELECT DISTINCT ON (source_code) source_code, id, fetched_at
         FROM list_versions
        WHERE status = 'ACTIVE'
        ORDER BY source_code, fetched_at DESC
     )
     SELECT s.code, latest_active.id, latest_active.fetched_at
            , s.is_blocking
       FROM list_sources s
       LEFT JOIN latest_active ON latest_active.source_code = s.code
      WHERE s.is_active = TRUE
        ${sourceFilter}
      ORDER BY s.code`
    ,
    requiredSourceCodes?.length ? [requiredSourceCodes] : []
  );
  const missingRequiredSources = (requiredSourceCodes || [])
    .filter((code) => !result.rows.some((row) => row.code === code));
  const cutoff = Date.now() - freshnessHours * 60 * 60 * 1000;
  const stale = result.rows
    .filter((row) => !row.id || new Date(row.fetched_at).getTime() < cutoff)
    .map((row) => ({ source_code: row.code, fetched_at: row.fetched_at }));
  if (!result.rows.length || missingRequiredSources.length || stale.length) {
    throw new ApiError(503, 'STALE_REFERENCE_DATA', {
      sources: [...stale, ...missingRequiredSources.map((source_code) => ({ source_code, fetched_at: null }))]
    });
  }
  return new Map(result.rows.map((row) => [row.code, row]));
}

async function thresholds(client, tenantId) {
  const result = await client.query(
    `SELECT d.code, COALESCE(t.value, d.platform_default) AS value
       FROM threshold_definitions d
       LEFT JOIN tenant_thresholds t
         ON t.code = d.code AND t.tenant_id = $1
      WHERE d.code LIKE 'SANCTIONS_%'`,
    [tenantId]
  );
  const confirmed = result.rows.find((row) => row.code.includes('CONFIRMED'));
  const possible = result.rows.find((row) => row.code.includes('POSSIBLE'));
  if (!confirmed || !possible) throw new ApiError(500, 'CONFIGURATION_ERROR');
  return {
    confirmed: Number(confirmed.value),
    possible: Number(possible.value)
  };
}

async function hasComprehensiveEmbargo(client, countryCode) {
  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1
         FROM country_embargo_programs cep
         JOIN embargo_programs ep ON ep.code = cep.program_code
        WHERE cep.country_code = $1 AND ep.is_comprehensive = TRUE
     ) AS blocked`,
    [countryCode]
  );
  return result.rows[0].blocked;
}

async function hasLicenceRecord(client, caseId) {
  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM licence_determinations
        WHERE case_id = $1 AND outcome IN ('EXCEPTION', 'REQUIRED')
     ) AS exists`,
    [caseId]
  );
  return result.rows[0].exists;
}

async function loadScreeningSubjects(client, caseId) {
  const parties = await client.query(
    `SELECT cp.party_id, p.legal_name, p.name_script, p.country_code, NULL::text AS owner_name
       FROM case_parties cp
       JOIN parties p ON p.id = cp.party_id
      WHERE cp.case_id = $1
     UNION ALL
     SELECT cp.party_id, p.legal_name, p.name_script, p.country_code, po.owner_name
       FROM case_parties cp
       JOIN parties p ON p.id = cp.party_id
       JOIN party_owners po ON po.party_id = p.id
      WHERE cp.case_id = $1
      ORDER BY party_id, owner_name NULLS FIRST`,
    [caseId]
  );
  return parties.rows.map((row) => ({
    partyId: row.party_id,
    name: row.owner_name || row.legal_name,
    script: String(row.name_script || 'LATIN').toLowerCase(),
    country: row.country_code,
    ownerName: row.owner_name
  }));
}

async function requestMatch(config, subject) {
  let response;
  try {
    response = await fetch(`${config.matchingServiceUrl}/screen`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: subject.name, script: subject.script, country: subject.country }),
      signal: AbortSignal.timeout(10_000)
    });
  } catch {
    throw new ApiError(503, 'AGENT_UNAVAILABLE');
  }
  if (!response.ok) throw new ApiError(503, 'AGENT_UNAVAILABLE');
  const payload = await response.json();
  if (!Array.isArray(payload.candidates)) throw new ApiError(503, 'AGENT_UNAVAILABLE');
  return payload.candidates;
}

function statusFor(score, values) {
  if (score >= values.confirmed) return 'CONFIRMED_HIT';
  if (score >= values.possible) return 'POSSIBLE_HIT';
  return 'CLEAR';
}

function isBlockingConfirmedHit(status, source) {
  return status === 'CONFIRMED_HIT' && Boolean(source.is_blocking);
}

async function insertScreeningResult(client, { tenantId, caseId, partyId, sourceCode, versionId, status, score, candidate, subject }) {
  const id = uuidV7();
  await client.query(
    `INSERT INTO screening_results (
       id, tenant_id, case_id, party_id, source_code, list_version_id, status,
       top_score, matched_entry_id, triggering_variant
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id, tenantId, caseId, partyId, sourceCode, versionId, status, score,
      candidate?.sanctions_entry_id || null, candidate?.triggering_variant || null
    ]
  );
  await writeAudit(client, {
    tenantId,
    caseId,
    eventType: 'SCREENING_RESULT_RECORDED',
    actorType: 'AGENT',
    afterState: {
      screening_result_id: id,
      status,
      score,
      source_code: sourceCode,
      list_version_id: versionId,
      screened_name: subject.name,
      beneficial_owner: Boolean(subject.ownerName)
    }
  });
  return status;
}

async function screenCase(client, config, { tenantId, caseRecord }) {
  if (await hasComprehensiveEmbargo(client, caseRecord.destination_country)
    && !(await hasLicenceRecord(client, caseRecord.id))) {
    await assertSystemTransition(client, { ...caseRecord, state: 'SCREENING' }, 'BLOCKED');
    await client.query(
      `UPDATE compliance_cases
          SET state = 'BLOCKED', overall_risk = 'BLOCKED', fired_rule_code = 'RULE_2'
        WHERE id = $1`,
      [caseRecord.id]
    );
    return { state: 'BLOCKED', firedRule: 'RULE_2', results: 0 };
  }

  const versions = await activeListVersions(client, config.listFreshnessHours, config.requiredListSources);
  const defaultVersion = versions.values().next().value;
  const values = await thresholds(client, tenantId);
  const subjects = await loadScreeningSubjects(client, caseRecord.id);
  if (!subjects.length) throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['parties'] });

  let confirmed = false;
  let possible = false;
  let resultCount = 0;
  for (const subject of subjects) {
    const candidates = await requestMatch(config, subject);
    if (!candidates.length) {
      await insertScreeningResult(client, {
        tenantId, caseId: caseRecord.id, partyId: subject.partyId,
        sourceCode: defaultVersion.code, versionId: defaultVersion.id,
        status: 'CLEAR', score: 0, candidate: null, subject
      });
      resultCount += 1;
      continue;
    }
    for (const candidate of candidates) {
      const version = versions.get(candidate.source_list);
      if (!version) continue;
      const score = Number(candidate.score);
      const status = statusFor(score, values);
      confirmed ||= isBlockingConfirmedHit(status, version);
      possible ||= status === 'POSSIBLE_HIT' || (status === 'CONFIRMED_HIT' && !version.is_blocking);
      await insertScreeningResult(client, {
        tenantId, caseId: caseRecord.id, partyId: subject.partyId,
        sourceCode: version.code, versionId: version.id, status, score, candidate, subject
      });
      resultCount += 1;
    }
  }

  const state = confirmed ? 'BLOCKED' : possible ? 'REVIEW_REQUIRED' : 'SCREENING';
  if (state !== 'SCREENING') await assertSystemTransition(client, { ...caseRecord, state: 'SCREENING' }, state);
  await client.query(
    `UPDATE compliance_cases
        SET state = $2::varchar(24),
            overall_risk = CASE WHEN $2::varchar(24) = 'BLOCKED' THEN 'BLOCKED' ELSE overall_risk END,
            fired_rule_code = CASE WHEN $2::varchar(24) = 'BLOCKED' THEN 'RULE_1' ELSE NULL END
      WHERE id = $1`,
    [caseRecord.id, state]
  );
  return { state, firedRule: confirmed ? 'RULE_1' : null, results: resultCount };
}

module.exports = {
  activeListVersions,
  hasComprehensiveEmbargo,
  hasLicenceRecord,
  isBlockingConfirmedHit,
  screenCase
};