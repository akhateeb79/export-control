'use strict';

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { writeAudit } = require('./audit');
const { ApiError, asyncHandler } = require('./errors');
const { beginTenantTransaction } = require('./db');

function createRateLimiter(config) {
  const buckets = new Map();
  function consume(key) {
    const now = Date.now();
    const bucket = buckets.get(key) || { startedAt: now, count: 0 };
    if (now - bucket.startedAt >= config.rateLimitWindowMs) {
      bucket.startedAt = now;
      bucket.count = 0;
    }
    bucket.count += 1;
    buckets.set(key, bucket);
    if (bucket.count > config.rateLimitMax) throw new ApiError(429, 'RATE_LIMITED');
  }
  return (request, response, next) => {
    try {
      consume(`ip:${request.ip}`);
      const authorization = request.get('authorization');
      const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
      const tenantId = token ? jwt.decode(token)?.tenant_id : null;
      if (tenantId) consume(`tenant:${tenantId}`);
      next();
    } catch (error) {
      next(error);
    }
  };
}

function requestId(request, response, next) {
  response.locals.requestId = crypto.randomUUID();
  response.setHeader('X-Request-ID', response.locals.requestId);
  next();
}

function createProtectedMiddleware({ pool, config }) {
  const rateLimit = createRateLimiter(config);

  const authenticate = asyncHandler(async (request, response, next) => {
    const authorization = request.get('authorization');
    if (!authorization?.startsWith('Bearer ')) throw new ApiError(401, 'AUTHENTICATION_FAILED');
    try {
      const claims = jwt.verify(authorization.slice(7), config.jwtSecret, { algorithms: ['HS256'] });
      if (!claims.tenant_id || !claims.user_id || !claims.role || !claims.plan_id) {
        throw new Error('Missing required claims');
      }
      request.auth = claims;
    } catch {
      throw new ApiError(401, 'AUTHENTICATION_FAILED');
    }
    next();
  });

  const resolveTenant = asyncHandler(async (request, response, next) => {
    const tenant = await pool.query(
      `SELECT id, status FROM tenants WHERE id = $1`,
      [request.auth.tenant_id]
    );
    if (!tenant.rows[0]) throw new ApiError(401, 'AUTHENTICATION_FAILED');
    if (tenant.rows[0].status !== 'ACTIVE') throw new ApiError(403, 'TENANT_INACTIVE');
    response.locals.tenant = tenant.rows[0];
    next();
  });

  const openTransaction = asyncHandler(async (request, response, next) => {
    const client = await pool.connect();
    try {
      await beginTenantTransaction(client, request.auth.tenant_id);
      response.locals.dbClient = client;
      next();
    } catch (error) {
      client.release();
      throw error;
    }
  });

  const entitlement = asyncHandler(async (request, response, next) => {
    const client = response.locals.dbClient;
    const subscriptionResult = await client.query(
      `SELECT s.plan_code, s.status, p.api_enabled, p.retention_years
         FROM tenant_subscriptions s
         JOIN plans p ON p.code = s.plan_code
        WHERE s.tenant_id = $1 AND s.period_end >= CURRENT_DATE
        ORDER BY s.period_end DESC
        LIMIT 1`,
      [request.auth.tenant_id]
    );
    const subscription = subscriptionResult.rows[0];
    if (!subscription || subscription.status !== 'ACTIVE') {
      if (request.method !== 'GET') throw new ApiError(402, 'SUBSCRIPTION_SUSPENDED');
    }
    if (!subscription?.api_enabled) throw new ApiError(403, 'ENTITLEMENT_DENIED');
    if (request.requiredAgent) {
      const agent = await client.query(
        `SELECT 1 FROM plan_agents WHERE plan_code = $1 AND agent_code = $2`,
        [subscription.plan_code, request.requiredAgent]
      );
      if (!agent.rows[0]) throw new ApiError(403, 'ENTITLEMENT_DENIED');
    }
    response.locals.subscription = subscription;
    next();
  });

  function requireRoles(roles) {
    return (request, response, next) => {
      if (roles && !roles.includes(request.auth.role)) {
        return next(new ApiError(403, 'PERMISSION_DENIED'));
      }
      next();
    };
  }

  const finalize = asyncHandler(async (request, response, next) => {
    const client = response.locals.dbClient;
    if (!client) throw new Error('Missing transaction client');
    if (!response.locals.result || !response.locals.auditEvent) {
      throw new Error('Handler did not provide a response and audit event');
    }
    await writeAudit(client, {
      tenantId: request.auth.tenant_id,
      actorType: 'USER',
      actorId: request.auth.user_id,
      ...response.locals.auditEvent
    });
    await client.query('COMMIT');
    client.release();
    response.locals.dbClient = null;
    const result = response.locals.result;
    response.status(result.status).json({ ...result.body, request_id: response.locals.requestId });
  });

  return {
    rateLimit,
    requestId,
    authenticate,
    resolveTenant,
    openTransaction,
    entitlement,
    requireRoles,
    finalize
  };
}

module.exports = { createProtectedMiddleware, requestId };