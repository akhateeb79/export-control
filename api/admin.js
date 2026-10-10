'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { ApiError, asyncHandler } = require('./errors');
const { writeAudit } = require('./audit');
const { createAuditViewer } = require('../src/admin/audit-viewer');
const { createUserManagement } = require('../src/admin/user-management');
const { run: runIngestion } = require('../jobs/ingest');
const { createNotificationDelivery, smtpOptions } = require('../src/services/notification-delivery');
const {
  createAuditMonitorScheduler,
  createDailyDigestScheduler,
  createRetentionScheduler
} = require('../src/services/scheduler');

const ADMIN_ROLES = ['CLIENT_ADMIN', 'SUPER_ADMIN'];

function limit(value, fallback = 100, max = 500) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), max) : fallback;
}

function csv(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

const ECCN_REASONS = new Set(['NS', 'MT', 'AT', 'RS', 'CC', 'EI', 'SI', 'NP', 'CB']);
const ECCN_OPERATORS = new Set(['GT', 'GTE', 'LT', 'LTE', 'EQ', 'RANGE']);
const ECCN_STATUSES = new Set(['ACTIVE', 'RETIRED']);
const PRODUCT_CLASSIFICATION_STATUSES = new Set([
  'UNCLASSIFIED', 'PENDING', 'CLASSIFIED', 'EAR99', 'INSUFFICIENT_INFORMATION',
  'CANDIDATE_SET_INADEQUATE', 'NEEDS_HUMAN_REVIEW', 'FAILED'
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BIGINT = 9223372036854775807n;

function parseCsvText(value) {
  const text = String(value || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some((part) => String(part).trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some((part) => String(part).trim() !== '')) rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows.shift().map((header) => String(header).trim().toLowerCase());
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, String(values[index] ?? '').trim()])));
}

function normalizeReasons(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(/[|;,]/);
  return [...new Set(values.map((reason) => String(reason).trim().toUpperCase()).filter(Boolean))];
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function optionalCategory(value) {
  if (value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 9) throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['category'] });
  return parsed;
}

function optionalGroup(value) {
  if (value === undefined || value === '') return null;
  const parsed = String(value).toUpperCase();
  if (!/^[A-E]$/.test(parsed)) throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['group'] });
  return parsed;
}

function optionalStatus(value, allowed, field = 'status') {
  if (value === undefined || value === '') return null;
  const parsed = String(value).toUpperCase();
  if (!allowed.has(parsed)) throw new ApiError(400, 'VALIDATION_FAILED', { fields: [field] });
  return parsed;
}

function optionalUuid(value, field) {
  if (value === undefined || value === '') return null;
  const parsed = String(value);
  if (!UUID_PATTERN.test(parsed)) throw new ApiError(400, 'VALIDATION_FAILED', { fields: [field] });
  return parsed;
}

function parameterId(value) {
  if (!/^\d+$/.test(value) || BigInt(value) < 1n || BigInt(value) > MAX_BIGINT) {
    throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['pid'] });
  }
  return value;
}

function validateEccnFields(body, { partial = false } = {}) {
  const fields = {};
  if (!partial || body.eccn_code !== undefined || body.eccn !== undefined) {
    const eccn = String(body.eccn_code ?? body.eccn ?? '').trim().toUpperCase();
    if (!/^[0-9][A-Z][0-9]{3}$/.test(eccn)) throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['eccn_code'] });
    fields.eccn = eccn;
  }
  if (!partial || body.description !== undefined || body.heading !== undefined) {
    const description = String(body.description ?? body.heading ?? '').trim();
    if (!description) throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['description'] });
    fields.heading = description;
  }
  if (!partial || body.category !== undefined) {
    const category = Number(body.category);
    if (!Number.isInteger(category) || category < 0 || category > 9) throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['category'] });
    fields.category = category;
  }
  if (!partial || body.group !== undefined || body.product_group !== undefined) {
    const group = String(body.group ?? body.product_group ?? '').trim().toUpperCase();
    if (!/^[A-E]$/.test(group)) throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['group'] });
    fields.product_group = group;
  }
  if (!partial || body.reasons_for_control !== undefined) {
    const reasons = normalizeReasons(body.reasons_for_control);
    if (!reasons.length || reasons.some((reason) => !ECCN_REASONS.has(reason))) throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['reasons_for_control'] });
    fields.reasons_for_control = reasons;
  }
  if (body.full_text !== undefined) {
    fields.full_text = String(body.full_text || '').trim();
    if (!fields.full_text) throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['full_text'] });
  }
  if (!partial || body.effective_date !== undefined) {
    const effectiveDate = String(body.effective_date || '').trim();
    if (!validDate(effectiveDate)) throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['effective_date'] });
    fields.effective_date = effectiveDate;
  }
  if (body.status !== undefined) {
    const status = String(body.status).trim().toUpperCase();
    if (!['ACTIVE', 'RETIRED'].includes(status)) throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['status'] });
    fields.status = status;
  }
  return fields;
}

function validateParameterFields(body, { partial = false } = {}) {
  const fields = {};
  if (!partial || body.name !== undefined || body.parameter_key !== undefined) {
    const name = String(body.name ?? body.parameter_key ?? '').trim();
    if (!name || name.length > 48) throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['name'] });
    fields.parameter_key = name;
  }
  if (!partial || body.operator !== undefined) {
    const operator = String(body.operator || '').trim().toUpperCase();
    if (!ECCN_OPERATORS.has(operator)) throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['operator'] });
    fields.operator = operator;
  }
  if (!partial || body.value !== undefined || body.threshold_value !== undefined) {
    const value = body.value ?? body.threshold_value;
    if (value === '' || value === null || value === undefined || !Number.isFinite(Number(value))) throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['value'] });
    fields.threshold_value = Number(value);
  }
  if (!partial || body.unit !== undefined) fields.unit = body.unit ? String(body.unit).trim().toUpperCase() : null;
  if (!partial || body.notes !== undefined) fields.notes = body.notes ? String(body.notes).trim() : null;
  if (body.status !== undefined) {
    const status = String(body.status).trim().toUpperCase();
    if (!['ACTIVE', 'RETIRED'].includes(status)) throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['status'] });
    fields.status = status;
  }
  return fields;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function adminRouter({ middleware, userManagement = createUserManagement(), auditViewer = createAuditViewer() }) {
  const router = express.Router();
  const chain = [
    middleware.authenticate,
    middleware.resolveTenant,
    middleware.requireRoles(ADMIN_ROLES),
    middleware.openTransaction
  ];
  const platformChain = [
    middleware.authenticate,
    middleware.requirePlatformAdmin,
    middleware.openPlatformTransaction
  ];

  async function complete(request, response, operation, status = 200) {
    const client = response.locals.dbClient;
    try {
      const result = await operation(client);
      await client.query('COMMIT');
      client.release();
      response.locals.dbClient = null;
      response.status(status).json(result);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      response.locals.dbClient = null;
      throw error;
    }
  }

  async function activeControlVersion(client, { lock = false } = {}) {
    const result = await client.query(
      `SELECT id, regime, version_label, effective_from
         FROM control_list_versions
        WHERE regime = 'EAR' AND status = 'ACTIVE' AND is_current = TRUE
        ORDER BY loaded_at DESC
        LIMIT 1`
        + (lock ? ' FOR UPDATE' : '')
    );
    if (!result.rows[0]) throw new ApiError(409, 'ACTIVE_CONTROL_LIST_REQUIRED');
    return result.rows[0];
  }

  async function forkControlVersion(client, rationale) {
    const current = await activeControlVersion(client, { lock: true });
    const id = crypto.randomUUID();
    const versionLabel = `${current.version_label}-ADMIN-${id.slice(0, 8).toUpperCase()}`;
    await client.query(
      `INSERT INTO control_list_versions (
         id, regime, version_label, effective_from, is_current, source, loaded_at, status
       ) VALUES ($1, $2, $3, $4, FALSE, $5, now(), 'SUPERSEDED')`,
      [id, current.regime, versionLabel, current.effective_from, `Platform administration: ${rationale}`]
    );
    await client.query(
      `INSERT INTO eccn_entries (
         version_id, eccn, category, product_group, heading, full_text,
         reasons_for_control, is_current, status, effective_date, created_at, updated_at
       )
       SELECT $2, eccn, category, product_group, heading, full_text,
              reasons_for_control, is_current, status, effective_date, now(), now()
         FROM eccn_entries
        WHERE version_id = $1`,
      [current.id, id]
    );
    await client.query(
      `INSERT INTO eccn_parameters (
         version_id, eccn, parameter_key, operator, threshold_value, unit, notes,
         status, created_at, updated_at
       )
       SELECT $2, eccn, parameter_key, operator, threshold_value, unit, notes,
              status, now(), now()
         FROM eccn_parameters
        WHERE version_id = $1`,
      [current.id, id]
    );
    return { current, next: { ...current, id, version_label: versionLabel } };
  }

  async function activateControlVersion(client, versionId) {
    await client.query('SELECT activate_control_list_version($1)', [versionId]);
  }

  async function managedEntry(client, eccn, { lock = false } = {}) {
    const result = await client.query(
      `SELECT e.*, v.version_label, v.regime
         FROM eccn_entries e
         JOIN control_list_versions v ON v.id = e.version_id
        WHERE e.eccn = $1 AND v.regime = 'EAR' AND v.status = 'ACTIVE' AND v.is_current = TRUE
        ${lock ? 'FOR UPDATE OF e' : ''}`,
      [String(eccn || '').trim().toUpperCase()]
    );
    if (!result.rows[0]) throw new ApiError(404, 'NOT_FOUND');
    return result.rows[0];
  }

  function importRows(value, version) {
    const rawRows = parseCsvText(value);
    const seen = new Set();
    return rawRows.map((row, index) => {
      try {
        const entry = validateEccnFields({
          eccn_code: row.eccn_code,
          description: row.description,
          category: row.category,
          group: row.group,
          reasons_for_control: row.reasons_for_control,
          effective_date: row.effective_date || version.effective_from?.toISOString?.().slice(0, 10) || String(version.effective_from).slice(0, 10),
          status: 'ACTIVE'
        });
        if (seen.has(entry.eccn)) return { row_number: index + 2, ...entry, import_status: 'SKIPPED', error: 'Duplicate ECCN in file' };
        seen.add(entry.eccn);
        return { row_number: index + 2, ...entry };
      } catch {
        return {
          row_number: index + 2,
          eccn: String(row.eccn_code || '').trim().toUpperCase(),
          heading: String(row.description || '').trim(),
          import_status: 'SKIPPED',
          error: 'Invalid or missing required values'
        };
      }
    });
  }

  router.get('/users', ...chain, asyncHandler(async (request, response) => {
    if (request.auth.role === 'SUPER_ADMIN' && request.auth.tenant_id == null) {
      await response.locals.dbClient.query('SET LOCAL ROLE platform_admin');
      return complete(request, response, async (client) => {
        const result = await client.query(
          `SELECT u.id, u.tenant_id, t.name AS tenant_name, u.email, u.role, u.status,
                  u.created_at, c.user_id IS NOT NULL AS credentials_active
             FROM users u
             JOIN tenants t ON t.id = u.tenant_id
             LEFT JOIN auth_credentials c ON c.user_id = u.id
            WHERE ($1::text IS NULL OR u.role = $1)
              AND ($2::text IS NULL OR u.status = $2)
              AND ($3::text IS NULL OR u.email ILIKE '%' || $3 || '%' OR t.name ILIKE '%' || $3 || '%')
            ORDER BY t.name, u.email
            LIMIT $4 OFFSET $5`,
          [request.query.role || null, request.query.status || null, request.query.q || null,
            limit(request.query.limit), Math.max(Number.parseInt(request.query.offset, 10) || 0, 0)]
        );
        return { users: result.rows };
      });
    }
    await complete(request, response, (client) => userManagement.listUsers(client, {
      tenantId: request.auth.tenant_id,
      actor: request.auth,
      limit: request.query.limit,
      offset: request.query.offset
    }).then((users) => ({ users })));
  }));

  router.post('/users', ...chain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => ({
      user: await userManagement.createUser(client, {
        tenantId: request.auth.tenant_id,
        actor: request.auth,
        email: request.body?.email,
        role: request.body?.role
      })
    }), 201);
  }));

  router.patch('/users/:id', ...chain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => ({
      user: await userManagement.updateUser(client, {
        tenantId: request.auth.tenant_id,
        actor: request.auth,
        userId: request.params.id,
        email: request.body?.email,
        role: request.body?.role,
        status: request.body?.status
      })
    }));
  }));

  router.post('/users/:id/invite', ...chain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const userResult = await client.query(
        `SELECT id, email, role, status
           FROM users
          WHERE tenant_id = $1 AND id = $2
          FOR UPDATE`,
        [request.auth.tenant_id, request.params.id]
      );
      const user = userResult.rows[0];
      if (!user) throw new ApiError(404, 'NOT_FOUND');
      const token = crypto.randomBytes(32).toString('base64url');
      const tokenId = crypto.randomUUID();
      await client.query(
        `UPDATE user_setup_tokens
            SET used_at = now()
          WHERE tenant_id = $1 AND user_id = $2 AND used_at IS NULL`,
        [request.auth.tenant_id, user.id]
      );
      await client.query(
        `INSERT INTO user_setup_tokens (
           id, tenant_id, user_id, token_hash, expires_at, created_by
         ) VALUES ($1, $2, $3, $4, now() + interval '24 hours', $5)`,
        [tokenId, request.auth.tenant_id, user.id, hashToken(token), request.auth.user_id]
      );
      await writeAudit(client, {
        tenantId: request.auth.tenant_id,
        eventType: 'ADMIN_USER_INVITED',
        actorType: 'USER',
        actorId: request.auth.user_id,
        afterState: { user_id: user.id, token_id: tokenId, expires_in_hours: 24 }
      });
      return {
        user: { id: user.id, email: user.email, role: user.role, status: user.status },
        setup_link: `/setup?token=${encodeURIComponent(token)}`,
        expires_in: 86400
      };
    }, 201);
  }));

  router.post('/api-clients', ...chain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const user = await userManagement.createUser(client, {
        tenantId: request.auth.tenant_id,
        actor: request.auth,
        email: request.body?.email,
        role: 'API_CLIENT'
      });
      const secret = crypto.randomBytes(32).toString('base64url');
      const keyId = crypto.randomUUID();
      const apiKey = `ecp_${keyId.slice(0, 8)}_${secret}`;
      await client.query(
        `INSERT INTO api_client_keys (
           id, tenant_id, user_id, key_hash, key_prefix, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          keyId,
          request.auth.tenant_id,
          user.id,
          hashToken(apiKey),
          apiKey.slice(0, 20),
          request.auth.user_id
        ]
      );
      await writeAudit(client, {
        tenantId: request.auth.tenant_id,
        eventType: 'API_CLIENT_CREATED',
        actorType: 'USER',
        actorId: request.auth.user_id,
        afterState: { user_id: user.id, key_id: keyId, key_prefix: apiKey.slice(0, 20) }
      });
      return { user, api_key: apiKey };
    }, 201);
  }));

  router.post('/users/:id/deactivate', ...chain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => ({
      user: await userManagement.deactivateUser(client, {
        tenantId: request.auth.tenant_id,
        actor: request.auth,
        userId: request.params.id
      })
    }));
  }));

  router.get('/audit-events', ...chain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => ({
      events: await auditViewer.list(client, {
        tenantId: request.auth.tenant_id,
        actor: request.auth,
        caseId: request.query.case_id,
        eventType: request.query.event_type,
        limit: request.query.limit,
        beforeSequence: request.query.before_sequence
      })
    }));
  }));

  // Platform-wide business control endpoints. This chain is deliberately
  // separate from tenant-admin routes and can only be entered by SUPER_ADMIN.
  router.get('/tenants', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(
        `SELECT t.id, t.name, t.status, t.created_at, t.updated_at,
                COUNT(DISTINCT u.id)::int AS user_count,
                COUNT(DISTINCT c.id)::int AS case_count,
                COALESCE(s.plan_code, '—') AS plan,
                COALESCE(s.status, 'UNSUBSCRIBED') AS subscription_status
           FROM tenants t
           LEFT JOIN users u ON u.tenant_id = t.id
           LEFT JOIN compliance_cases c ON c.tenant_id = t.id
           LEFT JOIN LATERAL (
             SELECT plan_code, status FROM tenant_subscriptions
              WHERE tenant_id = t.id ORDER BY period_end DESC LIMIT 1
           ) s ON TRUE
          WHERE ($1::text IS NULL OR t.status = $1)
            AND ($2::text IS NULL OR t.name ILIKE '%' || $2 || '%')
          GROUP BY t.id, s.plan_code, s.status
          ORDER BY t.created_at DESC
          LIMIT $3 OFFSET $4`,
        [request.query.status || null, request.query.q || null, limit(request.query.limit),
          Math.max(Number.parseInt(request.query.offset, 10) || 0, 0)]
      );
      return { tenants: result.rows };
    });
  }));

  router.get('/overview', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const [kpis, pipeline] = await Promise.all([
        client.query(`
          SELECT
            (SELECT COUNT(*)::int FROM tenants WHERE status = 'ACTIVE') AS total_tenants,
            (SELECT COUNT(*)::int FROM compliance_cases
              WHERE state NOT IN ('APPROVED', 'BLOCKED', 'REJECTED', 'CLOSED')) AS active_cases,
            (SELECT COUNT(*)::int FROM compliance_cases
              WHERE created_at >= now() - interval '24 hours') AS cases_today,
            (SELECT COUNT(*)::int FROM screening_results
              WHERE status = 'CONFIRMED_HIT'
                AND screened_at >= now() - interval '30 days') AS sanctions_hits
        `),
        client.query(`
          SELECT state, COUNT(*)::int AS count
            FROM compliance_cases
           GROUP BY state
           ORDER BY state
        `)
      ]);
      return {
        kpis: kpis.rows[0],
        pipeline: Object.fromEntries(pipeline.rows.map((row) => [row.state, row.count]))
      };
    });
  }));

  router.post('/tenants', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const name = String(request.body?.name || '').trim();
      const plan = String(request.body?.plan_code || 'STARTER').trim();
      if (!name) throw new ApiError(400, 'TENANT_NAME_REQUIRED');
      const tenantResult = await client.query(
        `INSERT INTO tenants (id, name, status) VALUES (gen_random_uuid(), $1, 'ACTIVE') RETURNING *`,
        [name]
      );
      const tenant = tenantResult.rows[0];
      await client.query(
        `INSERT INTO tenant_subscriptions (id, tenant_id, plan_code, status, period_start, period_end)
         VALUES (gen_random_uuid(), $1, $2, 'ACTIVE', CURRENT_DATE, CURRENT_DATE + 365)`,
        [tenant.id, plan]
      );
      await writeAudit(client, {
        tenantId: request.auth.tenant_id,
        actorType: 'USER',
        actorId: request.auth.user_id,
        eventType: 'PLATFORM_TENANT_CREATED',
        afterState: { tenant_id: tenant.id, name, plan_code: plan }
      });
      return { tenant };
    }, 201);
  }));

  router.patch('/tenants/:id', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const tenantResult = await client.query(
        `UPDATE tenants SET name = COALESCE($2, name), status = COALESCE($3, status), updated_at = now()
          WHERE id = $1 RETURNING *`,
        [request.params.id, request.body?.name || null, request.body?.status || null]
      );
      if (!tenantResult.rows[0]) throw new ApiError(404, 'NOT_FOUND');
      if (request.body?.plan_code || request.body?.subscription_status) {
        await client.query(
          `UPDATE tenant_subscriptions
              SET plan_code = COALESCE($2, plan_code), status = COALESCE($3, status)
            WHERE tenant_id = $1
              AND id = (SELECT id FROM tenant_subscriptions WHERE tenant_id = $1 ORDER BY period_end DESC LIMIT 1)`,
          [request.params.id, request.body.plan_code || null, request.body.subscription_status || null]
        );
      }
      if (request.body?.thresholds && typeof request.body.thresholds === 'object') {
        for (const [code, value] of Object.entries(request.body.thresholds)) {
          await client.query(
            `INSERT INTO tenant_thresholds (tenant_id, code, value) VALUES ($1, $2, $3)
             ON CONFLICT (tenant_id, code) DO UPDATE SET value = EXCLUDED.value`,
            [request.params.id, code, value]
          );
        }
      }
      await writeAudit(client, {
        tenantId: request.auth.tenant_id, actorType: 'USER', actorId: request.auth.user_id,
        eventType: 'PLATFORM_TENANT_UPDATED', afterState: { tenant_id: request.params.id, changes: request.body }
      });
      return { tenant: tenantResult.rows[0] };
    });
  }));

  router.get('/tenants/:id/usage', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(
        `SELECT
          (SELECT count(*)::int FROM compliance_cases WHERE tenant_id = $1 AND created_at >= date_trunc('month', CURRENT_DATE)) AS cases_this_month,
          (SELECT count(*)::int FROM compliance_cases WHERE tenant_id = $1) AS cases_total,
          (SELECT count(*)::int FROM users WHERE tenant_id = $1) AS users_total,
          (SELECT count(*)::int FROM audit_events WHERE tenant_id = $1 AND occurred_at >= date_trunc('month', CURRENT_DATE)) AS api_calls_this_month`,
        [request.params.id]
      );
      return { usage: result.rows[0] };
    });
  }));

  router.post('/users/:id/force-logout', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(
        `UPDATE refresh_sessions SET revoked_at = COALESCE(revoked_at, now())
          WHERE user_id = $1 AND revoked_at IS NULL RETURNING id`,
        [request.params.id]
      );
      await client.query(`UPDATE users SET access_revoked_at = now(), updated_at = now() WHERE id = $1`, [request.params.id]);
      await writeAudit(client, {
        tenantId: request.auth.tenant_id, actorType: 'USER', actorId: request.auth.user_id,
        eventType: 'PLATFORM_USER_FORCE_LOGOUT', afterState: { user_id: request.params.id, sessions: result.rowCount }
      });
      return { revoked_sessions: result.rowCount };
    });
  }));

  router.get('/sessions', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(
        `SELECT rs.id, rs.tenant_id, t.name AS tenant_name, rs.user_id, u.email,
                rs.created_at, rs.expires_at, rs.revoked_at
           FROM refresh_sessions rs JOIN users u ON u.id = rs.user_id JOIN tenants t ON t.id = rs.tenant_id
          WHERE rs.revoked_at IS NULL AND rs.expires_at > now()
          ORDER BY rs.created_at DESC LIMIT $1`,
        [limit(request.query.limit)]
      );
      return { sessions: result.rows };
    });
  }));

  router.post('/api-clients/:id/rotate', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const user = await client.query(`SELECT id, tenant_id, email FROM users WHERE id = $1 AND role = 'API_CLIENT'`, [request.params.id]);
      if (!user.rows[0]) throw new ApiError(404, 'NOT_FOUND');
      const secret = crypto.randomBytes(32).toString('base64url');
      const keyId = crypto.randomUUID();
      const apiKey = `ecp_${keyId.slice(0, 8)}_${secret}`;
      await client.query(`UPDATE api_client_keys SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = $1 AND revoked_at IS NULL`, [request.params.id]);
      await client.query(
        `INSERT INTO api_client_keys (id, tenant_id, user_id, key_hash, key_prefix, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [keyId, user.rows[0].tenant_id, request.params.id, hashToken(apiKey), apiKey.slice(0, 20), request.auth.user_id]
      );
      await writeAudit(client, {
        tenantId: request.auth.tenant_id, actorType: 'USER', actorId: request.auth.user_id,
        eventType: 'PLATFORM_API_CLIENT_ROTATED', afterState: { user_id: request.params.id, key_id: keyId }
      });
      return { api_key: apiKey, key_prefix: apiKey.slice(0, 20) };
    });
  }));

  async function listCases(request, client, extra = '') {
    const result = await client.query(
      `SELECT c.id, c.tenant_id, t.name AS tenant_name, c.case_ref, c.state,
              c.destination_country, c.overall_risk, c.fired_rule_code, c.created_at,
               c.decided_at, p.legal_name AS end_user,
               (SELECT string_agg(DISTINCT all_party.legal_name, ', ' ORDER BY all_party.legal_name)
                  FROM case_parties all_cp
                  JOIN parties all_party ON all_party.id = all_cp.party_id
                 WHERE all_cp.case_id = c.id
                   AND all_cp.tenant_id = c.tenant_id) AS party_names
         FROM compliance_cases c
         JOIN tenants t ON t.id = c.tenant_id
         LEFT JOIN case_parties cp ON cp.case_id = c.id AND cp.party_role = 'END_USER'
         LEFT JOIN parties p ON p.id = cp.party_id
        WHERE ($1::text IS NULL OR c.state = $1)
          AND ($2::uuid IS NULL OR c.tenant_id = $2)
          AND ($3::date IS NULL OR c.created_at::date >= $3)
          AND ($4::date IS NULL OR c.created_at::date <= $4)
           AND ($5::text IS NULL OR c.case_ref ILIKE '%' || $5 || '%'
                OR t.name ILIKE '%' || $5 || '%'
                OR EXISTS (
                  SELECT 1
                    FROM case_parties search_cp
                    JOIN parties search_party ON search_party.id = search_cp.party_id
                   WHERE search_cp.case_id = c.id
                     AND search_cp.tenant_id = c.tenant_id
                     AND (
                       search_party.legal_name ILIKE '%' || $5 || '%'
                       OR regexp_replace(lower(search_party.legal_name), '[^a-z0-9]', '', 'g')
                          LIKE '%' || regexp_replace(lower($5), '[^a-z0-9]', '', 'g') || '%'
                     )
                ))
          ${extra}
           ORDER BY c.created_at DESC LIMIT $6 OFFSET $7`,
      [request.query.status || null, request.query.tenant_id || null, request.query.from || null,
        request.query.to || null, request.query.q || null, limit(request.query.limit), Math.max(Number.parseInt(request.query.offset, 10) || 0, 0)]
    );
    return result.rows;
  }

  router.get('/cases', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => ({ cases: await listCases(request, client) }));
  }));

  router.get('/cases/stuck', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => ({
      cases: await listCases(request, client, `AND c.created_at < now() - (
        CASE c.state
          WHEN 'DRAFT' THEN interval '72 hours'
          WHEN 'SCREENING' THEN interval '12 hours'
          WHEN 'CLASSIFICATION' THEN interval '24 hours'
          WHEN 'DETERMINATION' THEN interval '24 hours'
          WHEN 'PENDING_REVIEW' THEN interval '48 hours'
          WHEN 'REVIEW_REQUIRED' THEN interval '48 hours'
          WHEN 'SCREENING_REVIEW' THEN interval '24 hours'
          ELSE interval '168 hours'
        END
      )`)
    }));
  }));

  router.get('/cases/overrides', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(
        `SELECT c.id, c.tenant_id, t.name AS tenant_name, c.case_ref, c.state,
                o.system_recommendation, o.human_decision, o.rationale, o.actor_id, o.created_at
           FROM override_records o JOIN compliance_cases c ON c.id = o.case_id JOIN tenants t ON t.id = c.tenant_id
          ORDER BY o.created_at DESC LIMIT $1`,
        [limit(request.query.limit)]
      );
      return { cases: result.rows };
    });
  }));

  router.get('/cases/sanctions-blocks', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(
        `SELECT DISTINCT c.id, c.tenant_id, t.name AS tenant_name, c.case_ref, c.state,
                c.created_at, c.fired_rule_code, p.legal_name AS matched_party
           FROM compliance_cases c
           JOIN tenants t ON t.id = c.tenant_id
           JOIN screening_results sr ON sr.case_id = c.id AND sr.status = 'CONFIRMED_HIT'
           LEFT JOIN parties p ON p.id = sr.party_id
          WHERE c.state IN ('BLOCKED', 'REJECTED')
          ORDER BY c.created_at DESC LIMIT $1`,
        [limit(request.query.limit)]
      );
      return { cases: result.rows };
    });
  }));

  router.get('/lists', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(
        `SELECT ls.code, ls.authority, ls.name, ls.source_url, ls.sync_cron, ls.is_active,
                lv.id AS last_version_id, lv.fetched_at AS last_sync, lv.entry_count,
                lv.added_count, lv.removed_count, lv.changed_count,
                failed.fetched_at AS failed_at, failed.error_summary AS last_error
           FROM list_sources ls
           LEFT JOIN LATERAL (SELECT * FROM list_versions WHERE source_code = ls.code AND status = 'ACTIVE' ORDER BY fetched_at DESC LIMIT 1) lv ON TRUE
           LEFT JOIN LATERAL (SELECT fetched_at, NULL::text AS error_summary FROM list_versions WHERE source_code = ls.code AND status = 'FAILED' ORDER BY fetched_at DESC LIMIT 1) failed ON TRUE
          ORDER BY ls.code`
      );
      return { lists: result.rows };
    });
  }));

  router.post('/lists/:id/sync', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async () => ({ results: await runIngestion({ sourceCode: request.params.id }) }));
  }));

  router.get('/lists/:id/diff', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(
        `SELECT id, fetched_at, added_count, removed_count, changed_count, entry_count
           FROM list_versions WHERE source_code = $1 ORDER BY fetched_at DESC LIMIT 2`,
        [request.params.id]
      );
      return { source: request.params.id, versions: result.rows, added: result.rows[0]?.added_count || 0, removed: result.rows[0]?.removed_count || 0, changed: result.rows[0]?.changed_count || 0 };
    });
  }));

  router.get('/eccn', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const category = optionalCategory(request.query.category);
      const group = optionalGroup(request.query.group);
      const status = optionalStatus(request.query.status, ECCN_STATUSES);
      const result = await client.query(
        `SELECT e.eccn AS id, e.eccn AS eccn_code, e.version_id, v.version_label,
                e.category, e.product_group AS "group", e.heading AS description,
                e.full_text, e.reasons_for_control, e.effective_date, e.status,
                e.created_at, e.updated_at AS last_updated,
                COUNT(p.id) FILTER (WHERE p.status = 'ACTIVE')::int AS parameters_count
           FROM eccn_entries e
           JOIN control_list_versions v ON v.id = e.version_id
           LEFT JOIN eccn_parameters p ON p.version_id = e.version_id AND p.eccn = e.eccn
          WHERE v.regime = 'EAR' AND v.status = 'ACTIVE' AND v.is_current = TRUE
            AND ($1::smallint IS NULL OR e.category = $1)
            AND ($2::char(1) IS NULL OR e.product_group = $2)
            AND ($3::text IS NULL OR e.status = $3)
            AND ($4::text IS NULL OR e.eccn ILIKE '%' || $4 || '%' OR e.heading ILIKE '%' || $4 || '%' OR e.full_text ILIKE '%' || $4 || '%')
          GROUP BY e.version_id, e.eccn, v.version_label
          ORDER BY e.category, e.product_group, e.eccn
          LIMIT $5 OFFSET $6`,
        [
          category,
          group,
          status,
          request.query.q || null,
          limit(request.query.limit, 500, 5000),
          Math.max(Number.parseInt(request.query.offset, 10) || 0, 0)
        ]
      );
      return { entries: result.rows };
    });
  }));

  router.get('/eccn/export', ...platformChain, asyncHandler(async (request, response) => {
    const client = response.locals.dbClient;
    try {
      const result = await client.query(
        `SELECT e.eccn, e.heading AS description, e.category, e.product_group,
                array_to_string(e.reasons_for_control, '|') AS reasons_for_control,
                e.status, e.effective_date, e.updated_at
           FROM eccn_entries e
           JOIN control_list_versions v ON v.id = e.version_id
          WHERE v.regime = 'EAR' AND v.status = 'ACTIVE' AND v.is_current = TRUE
          ORDER BY e.eccn`
      );
      const header = 'eccn_code,description,category,group,reasons_for_control,status,effective_date,last_updated';
      const body = result.rows.map((row) => [
        row.eccn, row.description, row.category, row.product_group, row.reasons_for_control,
        row.status, row.effective_date, row.updated_at?.toISOString?.() || row.updated_at
      ].map(csv).join(','));
      await client.query('COMMIT');
      client.release();
      response.locals.dbClient = null;
      response.setHeader('Content-Type', 'text/csv; charset=utf-8');
      response.setHeader('Content-Disposition', 'attachment; filename="eccn-knowledge-base.csv"');
      response.send([header, ...body].join('\n'));
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      response.locals.dbClient = null;
      throw error;
    }
  }));

  router.post('/eccn/import/preview', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const version = await activeControlVersion(client);
      const rows = importRows(request.body?.csv, version);
      if (!rows.length) throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['csv'] });
      const validCodes = rows.filter((row) => !row.error).map((row) => row.eccn);
      const existing = validCodes.length ? await client.query(
        `SELECT eccn, heading, category, product_group, reasons_for_control, status
           FROM eccn_entries
          WHERE version_id = $1 AND eccn = ANY($2::text[])`,
        [version.id, validCodes]
      ) : { rows: [] };
      const existingByCode = new Map(existing.rows.map((entry) => [entry.eccn, entry]));
      const preview = rows.map((row) => {
        if (row.error) return row;
        const current = existingByCode.get(row.eccn);
        const unchanged = current
          && current.heading === row.heading
          && Number(current.category) === row.category
          && current.product_group === row.product_group
          && JSON.stringify([...current.reasons_for_control].sort()) === JSON.stringify([...row.reasons_for_control].sort())
          && current.status === 'ACTIVE';
        return { ...row, import_status: current ? (unchanged ? 'SKIPPED' : 'UPDATED') : 'ADDED' };
      });
      return {
        version,
        preview,
        counts: {
          added: preview.filter((row) => row.import_status === 'ADDED').length,
          updated: preview.filter((row) => row.import_status === 'UPDATED').length,
          skipped: preview.filter((row) => row.import_status === 'SKIPPED').length
        }
      };
    });
  }));

  router.post('/eccn/import', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const version = await activeControlVersion(client);
      const rows = importRows(request.body?.csv, version);
      if (!rows.length) throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['csv'] });
      const counts = { added: 0, updated: 0, skipped: 0 };
      const changes = [];
      for (const row of rows) {
        if (row.error) {
          counts.skipped += 1;
          continue;
        }
        const currentResult = await client.query(
          `SELECT * FROM eccn_entries WHERE version_id = $1 AND eccn = $2 FOR UPDATE`,
          [version.id, row.eccn]
        );
        const current = currentResult.rows[0];
        const unchanged = current
          && current.heading === row.heading
          && Number(current.category) === row.category
          && current.product_group === row.product_group
          && JSON.stringify([...current.reasons_for_control].sort()) === JSON.stringify([...row.reasons_for_control].sort())
          && current.status === 'ACTIVE';
        if (unchanged) {
          counts.skipped += 1;
          continue;
        }
        if (current) {
          counts.updated += 1;
          changes.push({ type: 'UPDATED', row, before: current });
        } else {
          counts.added += 1;
          changes.push({ type: 'ADDED', row, before: null });
        }
      }
      if (!changes.length) return { version, counts };
      const fork = await forkControlVersion(client, 'CCL CSV import');
      for (const change of changes) {
        if (change.type === 'UPDATED') {
          const updated = await client.query(
            `UPDATE eccn_entries
                SET heading = $3, category = $4, product_group = $5, reasons_for_control = $6,
                    status = 'ACTIVE', is_current = TRUE, updated_at = now()
              WHERE version_id = $1 AND eccn = $2
              RETURNING *`,
            [fork.next.id, change.row.eccn, change.row.heading, change.row.category, change.row.product_group, change.row.reasons_for_control]
          );
          await writeAudit(client, { tenantId: null, actorType: 'USER', actorId: request.auth.user_id, eventType: 'PLATFORM_ECCN_UPDATED', beforeState: change.before, afterState: updated.rows[0], rationale: 'CCL CSV import' });
        } else {
          const inserted = await client.query(
            `INSERT INTO eccn_entries (
               version_id, eccn, category, product_group, heading, full_text,
               reasons_for_control, is_current, status, effective_date
             ) VALUES ($1, $2, $3, $4, $5, $5, $6, TRUE, 'ACTIVE', $7)
             RETURNING *`,
            [fork.next.id, change.row.eccn, change.row.category, change.row.product_group, change.row.heading, change.row.reasons_for_control, change.row.effective_date]
          );
          await writeAudit(client, { tenantId: null, actorType: 'USER', actorId: request.auth.user_id, eventType: 'PLATFORM_ECCN_CREATED', afterState: inserted.rows[0], rationale: 'CCL CSV import' });
        }
      }
      await activateControlVersion(client, fork.next.id);
      return { version: fork.next, counts };
    });
  }));

  router.post('/eccn', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const fields = validateEccnFields(request.body || {});
      const fork = await forkControlVersion(client, `Create ECCN ${fields.eccn}`);
      const result = await client.query(
        `INSERT INTO eccn_entries (
           version_id, eccn, category, product_group, heading, full_text,
           reasons_for_control, is_current, status, effective_date
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          fork.next.id, fields.eccn, fields.category, fields.product_group, fields.heading,
          fields.full_text || fields.heading, fields.reasons_for_control,
          fields.status !== 'RETIRED', fields.status || 'ACTIVE', fields.effective_date
        ]
      );
      await writeAudit(client, { tenantId: null, actorType: 'USER', actorId: request.auth.user_id, eventType: 'PLATFORM_ECCN_CREATED', afterState: result.rows[0] });
      await activateControlVersion(client, fork.next.id);
      return { entry: result.rows[0] };
    }, 201);
  }));

  router.patch('/eccn/:id', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const before = await managedEntry(client, request.params.id, { lock: true });
      const fields = validateEccnFields(request.body || {}, { partial: true });
      const nextStatus = fields.status || before.status;
      const fork = await forkControlVersion(client, `Update ECCN ${before.eccn}`);
      const result = await client.query(
        `UPDATE eccn_entries
            SET eccn = COALESCE($3, eccn),
                heading = COALESCE($4, heading),
                full_text = COALESCE($5, full_text),
                category = COALESCE($6, category),
                product_group = COALESCE($7, product_group),
                reasons_for_control = COALESCE($8, reasons_for_control),
                effective_date = COALESCE($9, effective_date),
                status = $10,
                is_current = ($10 = 'ACTIVE'),
                updated_at = now()
          WHERE version_id = $1 AND eccn = $2
          RETURNING *`,
        [
          fork.next.id, before.eccn, fields.eccn || null, fields.heading || null,
          fields.full_text || null, fields.category ?? null, fields.product_group || null,
          fields.reasons_for_control || null, fields.effective_date || null, nextStatus
        ]
      );
      await writeAudit(client, { tenantId: null, actorType: 'USER', actorId: request.auth.user_id, eventType: nextStatus === 'RETIRED' && before.status !== 'RETIRED' ? 'PLATFORM_ECCN_RETIRED' : 'PLATFORM_ECCN_UPDATED', beforeState: before, afterState: result.rows[0] });
      await activateControlVersion(client, fork.next.id);
      return { entry: result.rows[0] };
    });
  }));

  router.delete('/eccn/:id', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const before = await managedEntry(client, request.params.id, { lock: true });
      const fork = await forkControlVersion(client, `Retire ECCN ${before.eccn}`);
      const result = await client.query(
        `UPDATE eccn_entries SET status = 'RETIRED', is_current = FALSE, updated_at = now()
          WHERE version_id = $1 AND eccn = $2 RETURNING *`,
        [fork.next.id, before.eccn]
      );
      await writeAudit(client, { tenantId: null, actorType: 'USER', actorId: request.auth.user_id, eventType: 'PLATFORM_ECCN_RETIRED', beforeState: before, afterState: result.rows[0] });
      await activateControlVersion(client, fork.next.id);
      return { entry: result.rows[0] };
    });
  }));

  router.get('/eccn/:id/parameters', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const entry = await managedEntry(client, request.params.id);
      const result = await client.query(
        `SELECT id, version_id, eccn, parameter_key AS name, operator,
                threshold_value AS value, unit, notes, status, created_at, updated_at
           FROM eccn_parameters
          WHERE version_id = $1 AND eccn = $2
          ORDER BY status, parameter_key`,
        [entry.version_id, entry.eccn]
      );
      return { parameters: result.rows };
    });
  }));

  router.post('/eccn/:id/parameters', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const entry = await managedEntry(client, request.params.id);
      const fields = validateParameterFields(request.body || {});
      const fork = await forkControlVersion(client, `Add parameter to ${entry.eccn}`);
      const result = await client.query(
        `INSERT INTO eccn_parameters (
           version_id, eccn, parameter_key, operator, threshold_value, unit, notes, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE')
         RETURNING id, version_id, eccn, parameter_key AS name, operator,
                   threshold_value AS value, unit, notes, status, created_at, updated_at`,
        [fork.next.id, entry.eccn, fields.parameter_key, fields.operator, fields.threshold_value, fields.unit, fields.notes]
      );
      await writeAudit(client, { tenantId: null, actorType: 'USER', actorId: request.auth.user_id, eventType: 'PLATFORM_ECCN_PARAMETER_CREATED', afterState: result.rows[0] });
      await activateControlVersion(client, fork.next.id);
      return { parameter: result.rows[0] };
    }, 201);
  }));

  router.patch('/eccn/:id/parameters/:pid', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const pid = parameterId(request.params.pid);
      const entry = await managedEntry(client, request.params.id);
      const beforeResult = await client.query(
        `SELECT * FROM eccn_parameters WHERE id = $1 AND version_id = $2 AND eccn = $3 FOR UPDATE`,
        [pid, entry.version_id, entry.eccn]
      );
      if (!beforeResult.rows[0]) throw new ApiError(404, 'NOT_FOUND');
      const fields = validateParameterFields(request.body || {}, { partial: true });
      const fork = await forkControlVersion(client, `Update parameter on ${entry.eccn}`);
      const result = await client.query(
        `UPDATE eccn_parameters
            SET parameter_key = COALESCE($3, parameter_key),
                operator = COALESCE($4, operator),
                threshold_value = COALESCE($5, threshold_value),
                unit = CASE WHEN $6::boolean THEN $7 ELSE unit END,
                notes = CASE WHEN $8::boolean THEN $9 ELSE notes END,
                status = COALESCE($10, status),
                updated_at = now()
          WHERE version_id = $1 AND eccn = $2 AND parameter_key = $11
          RETURNING id, version_id, eccn, parameter_key AS name, operator,
                    threshold_value AS value, unit, notes, status, created_at, updated_at`,
        [
          fork.next.id, entry.eccn, fields.parameter_key || null,
          fields.operator || null, fields.threshold_value ?? null,
          Object.prototype.hasOwnProperty.call(fields, 'unit'), fields.unit ?? null,
          Object.prototype.hasOwnProperty.call(fields, 'notes'), fields.notes ?? null,
          fields.status || null, beforeResult.rows[0].parameter_key
        ]
      );
      await writeAudit(client, { tenantId: null, actorType: 'USER', actorId: request.auth.user_id, eventType: fields.status === 'RETIRED' ? 'PLATFORM_ECCN_PARAMETER_RETIRED' : 'PLATFORM_ECCN_PARAMETER_UPDATED', beforeState: beforeResult.rows[0], afterState: result.rows[0] });
      await activateControlVersion(client, fork.next.id);
      return { parameter: result.rows[0] };
    });
  }));

  router.delete('/eccn/:id/parameters/:pid', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const pid = parameterId(request.params.pid);
      const entry = await managedEntry(client, request.params.id);
      const beforeResult = await client.query(
        `SELECT * FROM eccn_parameters WHERE id = $1 AND version_id = $2 AND eccn = $3 FOR UPDATE`,
        [pid, entry.version_id, entry.eccn]
      );
      if (!beforeResult.rows[0]) throw new ApiError(404, 'NOT_FOUND');
      const fork = await forkControlVersion(client, `Retire parameter on ${entry.eccn}`);
      const result = await client.query(
        `UPDATE eccn_parameters SET status = 'RETIRED', updated_at = now()
          WHERE version_id = $1 AND eccn = $2 AND parameter_key = $3
          RETURNING id, version_id, eccn, parameter_key AS name, operator,
                    threshold_value AS value, unit, notes, status, created_at, updated_at`,
        [fork.next.id, entry.eccn, beforeResult.rows[0].parameter_key]
      );
      await writeAudit(client, { tenantId: null, actorType: 'USER', actorId: request.auth.user_id, eventType: 'PLATFORM_ECCN_PARAMETER_RETIRED', beforeState: beforeResult.rows[0], afterState: result.rows[0] });
      await activateControlVersion(client, fork.next.id);
      return { parameter: result.rows[0] };
    });
  }));

  router.get('/products', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const tenantId = optionalUuid(request.query.tenant_id, 'tenant_id');
      const status = optionalStatus(request.query.status, PRODUCT_CLASSIFICATION_STATUSES);
      const result = await client.query(
        `SELECT p.id, p.tenant_id, t.name AS tenant_name, p.part_number, p.name,
                p.description, p.origin_country, latest.eccn,
                latest.confidence AS classification_confidence,
                latest.created_at AS last_classified,
                COALESCE(latest.status, 'UNCLASSIFIED') AS status,
                COUNT(DISTINCT cp.case_id)::int AS linked_cases_count
           FROM products p
           JOIN tenants t ON t.id = p.tenant_id
           LEFT JOIN LATERAL (
             SELECT cr.eccn, cr.confidence, cr.status, cr.created_at
               FROM classification_results cr
              WHERE cr.tenant_id = p.tenant_id AND cr.product_id = p.id
              ORDER BY cr.created_at DESC LIMIT 1
           ) latest ON TRUE
           LEFT JOIN case_products cp ON cp.tenant_id = p.tenant_id AND cp.product_id = p.id
          WHERE ($1::uuid IS NULL OR p.tenant_id = $1)
            AND ($2::text IS NULL OR COALESCE(latest.status, 'UNCLASSIFIED') = $2)
            AND ($3::text IS NULL OR p.name ILIKE '%' || $3 || '%' OR latest.eccn ILIKE '%' || $3 || '%')
          GROUP BY p.id, t.name, latest.eccn, latest.confidence, latest.created_at, latest.status
          ORDER BY latest.created_at DESC NULLS LAST, p.name
          LIMIT $4 OFFSET $5`,
        [
          tenantId,
          status,
          request.query.q || null,
          limit(request.query.limit, 500, 5000),
          Math.max(Number.parseInt(request.query.offset, 10) || 0, 0)
        ]
      );
      return { products: result.rows };
    });
  }));

  router.get('/products/:id', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      if (!UUID_PATTERN.test(request.params.id)) throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['id'] });
      const productResult = await client.query(
        `SELECT p.*, t.name AS tenant_name, COUNT(DISTINCT cp.case_id)::int AS linked_cases_count
           FROM products p
           JOIN tenants t ON t.id = p.tenant_id
           LEFT JOIN case_products cp ON cp.tenant_id = p.tenant_id AND cp.product_id = p.id
          WHERE p.id = $1
          GROUP BY p.id, t.name`,
        [request.params.id]
      );
      if (!productResult.rows[0]) throw new ApiError(404, 'NOT_FOUND');
      const history = await client.query(
        `SELECT cr.id, cr.created_at, cr.completed_at, cr.status, cr.eccn, cr.is_ear99,
                cr.confidence, cr.reasoning, cr.requires_human_review, cr.requires_revalidation,
                av.id AS agent_version_id, av.agent_code, av.version_label AS agent_version,
                clv.version_label AS control_list_version
           FROM classification_results cr
           JOIN agent_versions av ON av.id = cr.agent_version_id
           JOIN control_list_versions clv ON clv.id = cr.control_list_version_id
          WHERE cr.tenant_id = $1 AND cr.product_id = $2
          ORDER BY cr.created_at DESC`,
        [productResult.rows[0].tenant_id, request.params.id]
      );
      return { product: productResult.rows[0], classification_history: history.rows };
    });
  }));

  router.get('/embargoes', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(
        `SELECT ep.*, COUNT(cep.country_code)::int AS country_count
           FROM embargo_programs ep LEFT JOIN country_embargo_programs cep ON cep.program_code = ep.code
          GROUP BY ep.code ORDER BY ep.effective_from DESC`
      );
      return { embargoes: result.rows };
    });
  }));

  router.post('/embargoes', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const code = String(request.body?.code || '').trim().toUpperCase();
      const authority = String(request.body?.authority || '').trim();
      const name = String(request.body?.program_name || request.body?.name || '').trim();
      const effectiveFrom = String(request.body?.effective_date || request.body?.effective_from || '').trim();
      if (!code || !authority || !name || !validDate(effectiveFrom)) {
        throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['code', 'authority', 'program_name', 'effective_date'] });
      }
      const result = await client.query(
        `INSERT INTO embargo_programs (code, authority, name, is_comprehensive, effective_from)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [code, authority, name, String(request.body?.restriction_level || '').toUpperCase() === 'COMPREHENSIVE', effectiveFrom]
      );
      return { embargo: result.rows[0] };
    }, 201);
  }));

  router.patch('/embargoes/:id', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(
        `UPDATE embargo_programs
            SET authority = COALESCE($2, authority),
                name = COALESCE($3, name),
                is_comprehensive = COALESCE($4, is_comprehensive),
                effective_from = COALESCE($5, effective_from)
          WHERE code = $1 RETURNING *`,
        [request.params.id, request.body?.authority || null, request.body?.program_name || request.body?.name || null,
          request.body?.restriction_level ? String(request.body.restriction_level).toUpperCase() === 'COMPREHENSIVE' : null,
          request.body?.effective_date || request.body?.effective_from || null]
      );
      if (!result.rows[0]) throw new ApiError(404, 'NOT_FOUND');
      await writeAudit(client, { tenantId: request.auth.tenant_id, actorType: 'USER', actorId: request.auth.user_id, eventType: 'PLATFORM_EMBARGO_UPDATED', afterState: result.rows[0] });
      return { embargo: result.rows[0] };
    });
  }));

  router.get('/agents/stats', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(
        `SELECT av.id, av.agent_code, av.version_label, av.status,
                COUNT(cr.id)::int AS total_runs,
                COUNT(cr.id) FILTER (WHERE cr.status = 'INSUFFICIENT_INFORMATION')::int AS insufficient_information,
                ROUND(100.0 * COUNT(cr.id) FILTER (WHERE cr.status = 'INSUFFICIENT_INFORMATION') / NULLIF(COUNT(cr.id), 0), 2) AS insufficient_rate
           FROM agent_versions av LEFT JOIN classification_results cr ON cr.agent_version_id = av.id
          GROUP BY av.id ORDER BY av.agent_code, av.version_label`
      );
      return { stats: result.rows };
    });
  }));

  router.get('/agents', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(
        `SELECT a.*, av.id AS active_version_id, av.version_label AS active_version, av.model_id
           FROM agents a
           LEFT JOIN LATERAL (SELECT * FROM agent_versions WHERE agent_code = a.code AND status = 'PUBLISHED' ORDER BY published_at DESC NULLS LAST LIMIT 1) av ON TRUE
          ORDER BY a.execution_order`
      );
      return { agents: result.rows };
    });
  }));

  router.get('/agents/:id/versions', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(`SELECT * FROM agent_versions WHERE agent_code = $1 ORDER BY version_label DESC`, [request.params.id]);
      return { versions: result.rows };
    });
  }));

  router.post('/agents/:id/versions', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const version = await client.query(
        `INSERT INTO agent_versions (id, agent_code, version_label, model_id, system_prompt, max_tokens, status)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'DRAFT') RETURNING *`,
        [request.params.id, request.body?.version_label, request.body?.model_id || 'claude-sonnet-4-6', request.body?.system_prompt, request.body?.max_tokens || 4096]
      );
      return { version: version.rows[0] };
    }, 201);
  }));

  router.patch('/agents/:id/versions/:vid/activate', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(`UPDATE agent_versions SET status = 'PUBLISHED', published_at = now() WHERE id = $1 AND agent_code = $2 AND status = 'DRAFT' RETURNING *`, [request.params.vid, request.params.id]);
      if (!result.rows[0]) throw new ApiError(409, 'VERSION_NOT_ACTIVATABLE');
      return { version: result.rows[0] };
    });
  }));

  router.patch('/agents/:id/versions/:vid/retire', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(`UPDATE agent_versions SET status = 'ROLLED_BACK' WHERE id = $1 AND agent_code = $2 AND status IN ('DRAFT', 'PUBLISHED') RETURNING *`, [request.params.vid, request.params.id]);
      if (!result.rows[0]) throw new ApiError(409, 'VERSION_NOT_RETIRABLE');
      return { version: result.rows[0] };
    });
  }));

  router.patch('/agents/:id/activate', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const versionId = request.body?.version_id || request.body?.versionId;
      if (!versionId) throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['version_id'] });
      const result = await client.query(
        `UPDATE agent_versions
            SET status = 'PUBLISHED', published_at = now()
          WHERE id = $1 AND agent_code = $2 AND status = 'DRAFT'
          RETURNING *`,
        [versionId, request.params.id]
      );
      if (!result.rows[0]) throw new ApiError(409, 'VERSION_NOT_ACTIVATABLE');
      return { version: result.rows[0] };
    });
  }));

  router.patch('/agents/:id/retire', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const versionId = request.body?.version_id || request.body?.versionId;
      if (!versionId) throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['version_id'] });
      const result = await client.query(
        `UPDATE agent_versions
            SET status = 'ROLLED_BACK'
          WHERE id = $1 AND agent_code = $2 AND status IN ('DRAFT', 'PUBLISHED')
          RETURNING *`,
        [versionId, request.params.id]
      );
      if (!result.rows[0]) throw new ApiError(409, 'VERSION_NOT_RETIRABLE');
      return { version: result.rows[0] };
    });
  }));

  router.get('/licence-exceptions/stats', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(
        `SELECT lce.status, COUNT(*)::int AS count FROM licence_condition_evaluations lce GROUP BY lce.status ORDER BY lce.status`
      );
      return { stats: result.rows };
    });
  }));

  router.get('/licence-exceptions', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(
        `SELECT le.*, COALESCE(json_agg(json_build_object('id', lec.id, 'sequence', lec.sequence, 'condition_text', lec.condition_text, 'is_verifiable_automatically', lec.is_verifiable_automatically) ORDER BY lec.sequence) FILTER (WHERE lec.id IS NOT NULL), '[]') AS conditions
           FROM licence_exceptions le LEFT JOIN licence_exception_conditions lec ON lec.exception_code = le.code
          GROUP BY le.code ORDER BY le.code`
      );
      return { exceptions: result.rows };
    });
  }));

  router.post('/licence-exceptions', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(
        `INSERT INTO licence_exceptions (
           code, regime, name, full_text, description, eligible_eccn_prefixes,
           max_uses_per_month, requires_document
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          request.body?.exception_code || request.body?.code,
          request.body?.regime || 'EAR',
          request.body?.name || request.body?.description,
          request.body?.full_text || request.body?.description,
          request.body?.description || request.body?.name,
          request.body?.eligible_eccn_prefixes || [],
          request.body?.max_uses_per_month || null,
          Boolean(request.body?.requires_document)
        ]
      );
      return { exception: result.rows[0] };
    }, 201);
  }));

  router.patch('/licence-exceptions/:id', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(
        `UPDATE licence_exceptions
            SET name = COALESCE($2, name),
                full_text = COALESCE($3, full_text),
                description = COALESCE($4, description),
                eligible_eccn_prefixes = COALESCE($5, eligible_eccn_prefixes),
                max_uses_per_month = COALESCE($6, max_uses_per_month),
                requires_document = COALESCE($7, requires_document),
                is_active = COALESCE($8, is_active)
          WHERE code = $1 RETURNING *`,
        [request.params.id, request.body?.name || null, request.body?.full_text || null,
          request.body?.description || null, request.body?.eligible_eccn_prefixes || null,
          request.body?.max_uses_per_month || null, request.body?.requires_document, request.body?.is_active]
      );
      if (!result.rows[0]) throw new ApiError(404, 'NOT_FOUND');
      return { exception: result.rows[0] };
    });
  }));

  router.get('/thresholds', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(
        `SELECT td.*, COUNT(tt.tenant_id)::int AS tenant_override_count
           FROM threshold_definitions td LEFT JOIN tenant_thresholds tt ON tt.code = td.code
          GROUP BY td.code ORDER BY td.code`
      );
      return { thresholds: result.rows };
    });
  }));

  router.patch('/thresholds/:id', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(`UPDATE threshold_definitions SET platform_default = $2 WHERE code = $1 RETURNING *`, [request.params.id, request.body?.value]);
      if (!result.rows[0]) throw new ApiError(404, 'NOT_FOUND');
      await writeAudit(client, { tenantId: request.auth.tenant_id, actorType: 'USER', actorId: request.auth.user_id, eventType: 'PLATFORM_THRESHOLD_UPDATED', afterState: result.rows[0] });
      return { threshold: result.rows[0] };
    });
  }));

  router.get('/red-flag-rules', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(`SELECT * FROM lookup_values WHERE type_code = 'RED_FLAG' ORDER BY sort_order`);
      return { rules: result.rows };
    });
  }));

  router.post('/red-flag-rules', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(`INSERT INTO lookup_values (type_code, value_code, label_key, sort_order, metadata) VALUES ('RED_FLAG', $1, $2, $3, $4) RETURNING *`, [request.body?.value_code, request.body?.label_key || request.body?.value_code, request.body?.sort_order || 0, request.body?.metadata || {}]);
      return { rule: result.rows[0] };
    }, 201);
  }));

  router.patch('/red-flag-rules/:id', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(`UPDATE lookup_values SET label_key = COALESCE($2, label_key), metadata = COALESCE($3, metadata), is_active = COALESCE($4, is_active) WHERE id = $1 AND type_code = 'RED_FLAG' RETURNING *`, [request.params.id, request.body?.label_key || null, request.body?.metadata || null, request.body?.is_active]);
      if (!result.rows[0]) throw new ApiError(404, 'NOT_FOUND');
      return { rule: result.rows[0] };
    });
  }));

  router.get('/audit', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(
        `SELECT ae.id, ae.sequence_no, ae.tenant_id, t.name AS tenant_name, ae.case_id,
                ae.event_type, ae.actor_type, ae.actor_id, ae.occurred_at, ae.rationale
           FROM audit_events ae JOIN tenants t ON t.id = ae.tenant_id
          WHERE ($1::uuid IS NULL OR ae.tenant_id = $1)
            AND ($2::uuid IS NULL OR ae.actor_id = $2)
            AND ($3::uuid IS NULL OR ae.case_id = $3)
            AND ($4::text IS NULL OR ae.event_type = $4)
            AND ($5::date IS NULL OR ae.occurred_at::date >= $5)
            AND ($6::date IS NULL OR ae.occurred_at::date <= $6)
          ORDER BY ae.sequence_no DESC LIMIT $7 OFFSET $8`,
        [request.query.tenant_id || null, request.query.actor_id || null, request.query.case_id || null,
          request.query.event_type || null, request.query.from || null, request.query.to || null,
          limit(request.query.limit), Math.max(Number.parseInt(request.query.offset, 10) || 0, 0)]
      );
      return { events: result.rows };
    });
  }));

  router.get('/audit/export', ...platformChain, asyncHandler(async (request, response) => {
    const client = response.locals.dbClient;
    try {
      const result = await client.query(`SELECT sequence_no, tenant_id, case_id, event_type, actor_type, actor_id, occurred_at, rationale FROM audit_events ORDER BY sequence_no DESC LIMIT $1`, [limit(request.query.limit, 5000, 20000)]);
      const header = 'sequence_no,tenant_id,case_id,event_type,actor_type,actor_id,occurred_at,rationale';
      const body = result.rows.map((row) => [row.sequence_no, row.tenant_id, row.case_id, row.event_type, row.actor_type, row.actor_id, row.occurred_at?.toISOString?.() || row.occurred_at, row.rationale].map(csv).join(','));
      await client.query('COMMIT');
      client.release();
      response.locals.dbClient = null;
      response.setHeader('Content-Type', 'text/csv; charset=utf-8');
      response.setHeader('Content-Disposition', 'attachment; filename="audit-export.csv"');
      response.send([header, ...body].join('\n'));
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      response.locals.dbClient = null;
      throw error;
    }
  }));

  router.get('/reports/outcomes', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(`SELECT state AS outcome, COUNT(*)::int AS count FROM compliance_cases GROUP BY state ORDER BY state`);
      return { outcomes: result.rows };
    });
  }));

  router.get('/reports/sanctions-hits', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(`SELECT source_code, COUNT(*)::int AS screened, COUNT(*) FILTER (WHERE status IN ('POSSIBLE_HIT', 'POTENTIAL_HIT', 'CONFIRMED_HIT'))::int AS hits FROM screening_results GROUP BY source_code ORDER BY source_code`);
      return { hits: result.rows };
    });
  }));

  router.get('/reports/workflow-time', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(`SELECT state AS stage, ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(decided_at, now()) - created_at)) / 3600.0), 2) AS average_hours, COUNT(*)::int AS cases FROM compliance_cases GROUP BY state ORDER BY state`);
      return { workflow_time: result.rows };
    });
  }));

  router.get('/reports/tenant-summary', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(`SELECT t.id, t.name, t.status, COUNT(c.id)::int AS cases, COUNT(c.id) FILTER (WHERE c.state = 'APPROVED')::int AS approved, COUNT(c.id) FILTER (WHERE c.state IN ('REJECTED', 'BLOCKED'))::int AS rejected, COUNT(c.id) FILTER (WHERE c.state IN ('REFERRED', 'PENDING_REVIEW', 'REVIEW_REQUIRED', 'SCREENING_REVIEW'))::int AS referred FROM tenants t LEFT JOIN compliance_cases c ON c.tenant_id = t.id GROUP BY t.id ORDER BY t.name`);
      return { tenants: result.rows };
    });
  }));

  router.get('/reports/cross-tenant', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(
        `WITH latest_audit AS (
           SELECT DISTINCT ON (tenant_id) tenant_id, criteria_scores, conducted_date, overall_result
             FROM icp_audit_logs
            ORDER BY tenant_id, conducted_date DESC, created_at DESC
         ), scores AS (
           SELECT la.tenant_id,
                  round(avg(value::numeric), 2) AS icp_score
             FROM latest_audit la
             CROSS JOIN LATERAL jsonb_each_text(COALESCE(la.criteria_scores, '{}'::jsonb))
            GROUP BY la.tenant_id
         )
         SELECT 'tenant-' || substr(md5(t.id::text), 1, 10) AS tenant_ref,
                t.name AS tenant_name,
                t.status,
                COALESCE(s.icp_score, 0) AS icp_score,
                COALESCE((
                  SELECT count(*)::int FROM compliance_cases c
                   WHERE c.tenant_id = t.id
                ), 0) AS total_cases,
                COALESCE((
                  SELECT count(*)::int FROM compliance_cases c
                   WHERE c.tenant_id = t.id AND c.state IN ('PENDING_REVIEW', 'REVIEW_REQUIRED', 'SCREENING_REVIEW', 'REFERRED')
                ), 0) AS open_cases,
                COALESCE((
                  SELECT count(*)::int FROM icp_corrective_actions ca
                   WHERE ca.tenant_id = t.id AND ca.status IN ('OPEN', 'IN_PROGRESS')
                ), 0) AS open_corrective_actions,
                la.conducted_date AS last_icp_audit_date,
                la.overall_result AS last_icp_audit_result
           FROM tenants t
           LEFT JOIN scores s ON s.tenant_id = t.id
           LEFT JOIN latest_audit la ON la.tenant_id = t.id
          ORDER BY t.id`
      );
      return { tenants: result.rows };
    });
  }));

  router.get('/reports/agent-performance', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(
        `SELECT av.agent_code, av.version_label, av.model_id,
                count(car.id)::int AS run_count,
                count(*) FILTER (WHERE car.status = 'COMPLETED')::int AS completed_count,
                count(*) FILTER (WHERE car.status = 'FAILED')::int AS failed_count,
                round(avg(EXTRACT(epoch FROM (COALESCE(car.completed_at, car.created_at) - car.created_at))), 2) AS average_runtime_seconds,
                round(avg(cr.confidence), 2) AS average_confidence,
                max(car.created_at) AS last_run_at
           FROM classification_agent_runs car
           JOIN agent_versions av ON av.id = car.agent_version_id
           LEFT JOIN classification_results cr ON cr.id = car.classification_result_id
          GROUP BY av.agent_code, av.version_label, av.model_id
          ORDER BY run_count DESC, av.agent_code, av.version_label`
      );
      return { agents: result.rows };
    });
  }));

  router.get('/reports/list-freshness', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(
        `SELECT ls.code, ls.authority, ls.name, ls.source_url, ls.sync_cron,
                ls.is_active, lv.id AS latest_version_id, lv.published_at,
                lv.fetched_at, lv.entry_count, lv.status,
                CASE WHEN lv.fetched_at IS NULL THEN NULL
                     ELSE floor(EXTRACT(epoch FROM (now() - lv.fetched_at)) / 86400)::int
                END AS age_days
           FROM list_sources ls
           LEFT JOIN LATERAL (
             SELECT * FROM list_versions
              WHERE source_code = ls.code
              ORDER BY fetched_at DESC NULLS LAST
              LIMIT 1
           ) lv ON TRUE
          ORDER BY ls.code`
      );
      return { sources: result.rows };
    });
  }));

  router.get('/retention', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(
        `SELECT arl.*, 'tenant-' || substr(md5(arl.tenant_id::text), 1, 10) AS tenant_ref
           FROM audit_retention_log arl
          ORDER BY checked_at DESC, tenant_id, table_name
          LIMIT $1`,
        [limit(request.query.limit, 500, 5000)]
      );
      return { entries: result.rows };
    });
  }));

  router.get('/system/health', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const started = Date.now();
      await client.query('SELECT 1');
      return { health: { api: 'healthy', database: 'healthy', database_latency_ms: Date.now() - started, matching_service: 'configured', scheduler: 'running', checked_at: new Date().toISOString() } };
    });
  }));

  router.get('/system/scheduler', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(`SELECT ls.code, ls.name, ls.sync_cron, ls.is_active, lv.fetched_at AS last_run, lv.status AS last_status, lv.entry_count FROM list_sources ls LEFT JOIN LATERAL (SELECT * FROM list_versions WHERE source_code = ls.code ORDER BY fetched_at DESC LIMIT 1) lv ON TRUE ORDER BY ls.code`);
      const jobs = [
        ...result.rows.map((row) => ({ ...row, job_name: row.code === 'BIS_ENTITY' ? 'BIS_INGESTION' : 'SANCTIONS_REFRESH' })),
        {
          code: 'AUDIT_MONITOR',
          job_name: 'AUDIT_MONITOR',
          name: 'Portfolio audit monitor',
          sync_cron: request.app.locals.config?.auditMonitorCron || '0 */6 * * *',
          is_active: request.app.locals.config?.schedulersEnabled !== false
            && request.app.locals.config?.auditMonitorEnabled !== false,
          last_run: null,
          last_status: 'scheduled'
        },
        {
          code: 'DAILY_DIGEST',
          job_name: 'DAILY_DIGEST',
          name: 'SUPER_ADMIN daily digest',
          sync_cron: request.app.locals.config?.dailyDigestCron || '0 8 * * *',
          is_active: request.app.locals.config?.schedulersEnabled !== false,
          last_run: null,
          last_status: 'scheduled'
         },
         {
           code: 'RETENTION_CHECK',
           job_name: 'RETENTION_CHECK',
           name: 'Retention boundary check',
           sync_cron: request.app.locals.config?.retentionCheckCron || '0 2 * * *',
           is_active: request.app.locals.config?.schedulersEnabled !== false,
           last_run: null,
           last_status: 'scheduled'
        }
      ];
      return { jobs };
    });
  }));

  router.post('/system/scheduler/:id/run', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async () => {
      if (request.params.id === 'AUDIT_MONITOR') {
        if (request.app.locals.config?.auditMonitorEnabled === false) {
          throw new ApiError(409, 'SCHEDULER_DISABLED', { job: 'AUDIT_MONITOR' });
        }
        const scheduler = createAuditMonitorScheduler({
          pool: request.app.locals.pool,
          config: request.app.locals.config,
          modelClient: request.app.locals.modelClient,
          notification: request.app.locals.notification
        });
        const tenantId = request.body?.tenant_id || null;
        if (tenantId && !UUID_PATTERN.test(tenantId)) {
          throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['tenant_id'] });
        }
        return { job: request.params.id, results: await scheduler.execute({ tenantId }) };
      }
      if (request.params.id === 'DAILY_DIGEST') {
        if (request.app.locals.config?.schedulersEnabled === false) {
          throw new ApiError(409, 'SCHEDULER_DISABLED', { job: 'DAILY_DIGEST' });
        }
        const scheduler = createDailyDigestScheduler({
          pool: request.app.locals.pool,
          config: request.app.locals.config,
          notification: request.app.locals.notification
        });
        return { job: request.params.id, results: await scheduler.execute() };
      }
      if (request.params.id === 'RETENTION_CHECK') {
        if (request.app.locals.config?.schedulersEnabled === false) {
          throw new ApiError(409, 'SCHEDULER_DISABLED', { job: 'RETENTION_CHECK' });
        }
        const scheduler = createRetentionScheduler({
          pool: request.app.locals.pool,
          config: request.app.locals.config,
          notification: request.app.locals.notification
        });
        return { job: request.params.id, results: await scheduler.execute() };
      }
      const sourceCode = request.params.id === 'BIS_INGESTION' ? undefined : request.params.id;
      return {
        job: request.params.id,
        results: await runIngestion({ sourceCode })
      };
    });
  }));

  router.get('/system/errors', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(
        `SELECT id, tenant_id, event_type AS type, rationale AS message, after_state AS detail, occurred_at
           FROM audit_events
          WHERE event_type LIKE '%FAILED%' OR event_type LIKE '%ERROR%'
          ORDER BY sequence_no DESC LIMIT $1`,
        [limit(request.query.limit)]
      );
      return { errors: result.rows };
    });
  }));

  router.post('/system/smtp/test', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const configured = Boolean(smtpOptions());
      let result = { delivered: false, fallback: true };
      if (configured && request.body?.email) {
        const delivery = createNotificationDelivery();
        result = await delivery.deliver({ recipients: [request.body.email], recipient_rule: 'PLATFORM_OPS', template_key: 'smtp.test', to_state: 'SMTP_TEST', case_id: 'system' }, client) || { delivered: false, fallback: true, disabled: true };
      }
      return { sent: Boolean(result.delivered), configured, fallback: Boolean(result.fallback) };
    });
  }));

  router.get('/notification-rules', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(`SELECT * FROM notification_rules ORDER BY id`);
      return { rules: result.rows };
    });
  }));

  router.post('/notification-rules', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(`INSERT INTO notification_rules (event_code, recipient_rule, channels, template_key, is_urgent) VALUES ($1, $2, $3, $4, $5) RETURNING *`, [request.body?.event_code, request.body?.recipient_rule, request.body?.channels || ['IN_APP'], request.body?.template_key, Boolean(request.body?.is_urgent)]);
      return { rule: result.rows[0] };
    }, 201);
  }));

  router.patch('/notification-rules/:id', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(`UPDATE notification_rules SET event_code = COALESCE($2, event_code), recipient_rule = COALESCE($3, recipient_rule), channels = COALESCE($4, channels), template_key = COALESCE($5, template_key), is_urgent = COALESCE($6, is_urgent), is_active = COALESCE($7, is_active) WHERE id = $1 RETURNING *`, [request.params.id, request.body?.event_code || null, request.body?.recipient_rule || null, request.body?.channels || null, request.body?.template_key || null, request.body?.is_urgent, request.body?.is_active]);
      if (!result.rows[0]) throw new ApiError(404, 'NOT_FOUND');
      return { rule: result.rows[0] };
    });
  }));

  router.get('/notification-rules/delivery-log', ...platformChain, asyncHandler(async (request, response) => {
    await complete(request, response, async (client) => {
      const result = await client.query(
        `SELECT id, tenant_id,
                after_state->>'channel' AS channel,
                after_state->>'status' AS status,
                after_state->>'recipients' AS recipient,
                after_state->>'event_code' AS event_code,
                occurred_at AS created_at
           FROM audit_events
          WHERE event_type = 'NOTIFICATION_DELIVERY'
          ORDER BY sequence_no DESC LIMIT $1`,
        [limit(request.query.limit)]
      );
      return { deliveries: result.rows };
    });
  }));

  // UAE National Control List — admin read endpoints (OCP: new routes, existing unchanged)
  router.get('/uae-control-list/stats', ...platformChain, asyncHandler(async (request, response) => {
    const client = response.locals.dbClient;
    const [statsResult, lastImportResult] = await Promise.all([
      client.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE controlled_good)::int AS controlled,
           COUNT(*) FILTER (WHERE needs_declaration)::int AS needs_declaration,
           COUNT(*) FILTER (WHERE good_type = 'Chemical')::int AS chemicals,
           COUNT(*) FILTER (WHERE good_type != 'Chemical')::int AS strategic_goods
         FROM uae_control_list_entries`
      ),
      client.query(
        `SELECT imported_at FROM uae_control_list_entries ORDER BY imported_at DESC LIMIT 1`
      )
    ]);
    return {
      stats: statsResult.rows[0],
      last_imported_at: lastImportResult.rows[0]?.imported_at || null
    };
  }));

  router.get('/uae-control-list/search', ...platformChain, asyncHandler(async (request, response) => {
    const client = response.locals.dbClient;
    const q = String(request.query.q || '').trim();
    const type = request.query.type || null;
    const page = Math.max(1, Number(request.query.page) || 1);
    const pageSize = 50;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    const params = [];

    if (q) {
      params.push(q);
      conditions.push(`(scientific_name ILIKE '%' || $${params.length} || '%'
                         OR product_name ILIKE '%' || $${params.length} || '%'
                         OR cas_number = $${params.length}
                         OR hs_code = $${params.length})`);
    }
    if (type) {
      params.push(type);
      conditions.push(`good_type = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows, countResult] = await Promise.all([
      client.query(
        `SELECT id, seq_no, good_type, cas_number, hs_code, scientific_name, product_name,
                controlled_good, needs_declaration, under_list_of, imported_at
           FROM uae_control_list_entries ${where}
          ORDER BY seq_no
          LIMIT ${pageSize} OFFSET ${offset}`,
        params
      ),
      client.query(`SELECT COUNT(*)::int AS total FROM uae_control_list_entries ${where}`, params)
    ]);
    return { entries: rows.rows, total: countResult.rows[0].total, page, page_size: pageSize };
  }));

  return router;
}

module.exports = { adminRouter };