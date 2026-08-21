'use strict';

const { Pool } = require('pg');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createPool(config) {
  return new Pool({ connectionString: config.databaseUrl });
}

function assertUuid(value, label) {
  if (!UUID_PATTERN.test(String(value || ''))) {
    throw new Error(`${label} must be a UUID`);
  }
  return value;
}

async function beginTenantTransaction(client, tenantId) {
  const safeTenantId = assertUuid(tenantId, 'tenant_id');
  await client.query('BEGIN');
  await client.query(`SET LOCAL app.tenant_id = '${safeTenantId}'`);
}

function uuidV7() {
  const bytes = require('node:crypto').randomBytes(16);
  const timestamp = BigInt(Date.now());
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number((timestamp >> BigInt((5 - index) * 8)) & 0xffn);
  }
  bytes[6] = 0x70 | (bytes[6] & 0x0f);
  bytes[8] = 0x80 | (bytes[8] & 0x3f);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

module.exports = { assertUuid, beginTenantTransaction, createPool, uuidV7 };