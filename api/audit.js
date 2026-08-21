'use strict';

const crypto = require('node:crypto');
const { uuidV7 } = require('./db');

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value ?? null;
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function writeAudit(client, event) {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
    [event.tenantId]
  );
  const previous = await client.query(
    `SELECT entry_hash
       FROM audit_events
      WHERE tenant_id = $1
      ORDER BY sequence_no DESC, occurred_at DESC
      LIMIT 1`,
    [event.tenantId]
  );
  const prevHash = previous.rows[0]?.entry_hash || null;
  const canonical = JSON.stringify(stable({
    tenantId: event.tenantId,
    caseId: event.caseId || null,
    eventType: event.eventType,
    actorType: event.actorType,
    actorId: event.actorId || null,
    agentVersionId: event.agentVersionId || null,
    beforeState: event.beforeState || null,
    afterState: event.afterState || null,
    rationale: event.rationale || null
  }));
  const entryHash = hash(`${prevHash || ''}|${canonical}`);

  await client.query(
    `INSERT INTO audit_events (
       id, tenant_id, case_id, event_type, actor_type, actor_id, agent_version_id,
       before_state, after_state, rationale, prev_hash, entry_hash
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      uuidV7(),
      event.tenantId,
      event.caseId || null,
      event.eventType,
      event.actorType,
      event.actorId || null,
      event.agentVersionId || null,
      event.beforeState ? JSON.stringify(event.beforeState) : null,
      event.afterState ? JSON.stringify(event.afterState) : null,
      event.rationale || null,
      prevHash,
      entryHash
    ]
  );
}

module.exports = { writeAudit };