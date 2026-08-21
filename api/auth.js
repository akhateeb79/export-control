'use strict';

const crypto = require('node:crypto');
const argon2 = require('argon2');
const express = require('express');
const jwt = require('jsonwebtoken');
const { writeAudit } = require('./audit');
const { ApiError, asyncHandler } = require('./errors');
const { beginTenantTransaction, uuidV7 } = require('./db');

function refreshHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function requiresMfa(role) {
  return ['COMPLIANCE_OFFICER', 'CLIENT_ADMIN', 'SUPER_ADMIN'].includes(role);
}

function base32Decode(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of String(value || '').replace(/=|\s/g, '').toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new ApiError(401, 'MFA_INVALID');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function validTotp(secret, code, now = Date.now()) {
  if (!/^\d{6}$/.test(String(code || ''))) return false;
  const key = base32Decode(secret);
  for (const offset of [-1, 0, 1]) {
    const counter = Math.floor(now / 30_000) + offset;
    const input = Buffer.alloc(8);
    input.writeBigUInt64BE(BigInt(counter));
    const digest = crypto.createHmac('sha1', key).update(input).digest();
    const position = digest[digest.length - 1] & 0x0f;
    const otp = ((digest.readUInt32BE(position) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
    if (crypto.timingSafeEqual(Buffer.from(otp), Buffer.from(String(code)))) return true;
  }
  return false;
}

async function activeSubscription(client, tenantId) {
  const tenant = await client.query(`SELECT status FROM tenants WHERE id = $1`, [tenantId]);
  if (!tenant.rows[0] || tenant.rows[0].status !== 'ACTIVE') {
    throw new ApiError(403, 'TENANT_INACTIVE');
  }
  const result = await client.query(
    `SELECT s.plan_code, s.status, p.api_enabled
       FROM tenant_subscriptions s
       JOIN plans p ON p.code = s.plan_code
      WHERE s.tenant_id = $1
        AND s.period_end >= CURRENT_DATE
      ORDER BY s.period_end DESC
      LIMIT 1`,
    [tenantId]
  );
  const subscription = result.rows[0];
  if (!subscription || subscription.status !== 'ACTIVE' || !subscription.api_enabled) {
    throw new ApiError(402, 'SUBSCRIPTION_SUSPENDED');
  }
  return subscription;
}

function issueAccessToken(config, user, planId) {
  return jwt.sign({
    tenant_id: user.tenant_id,
    user_id: user.id,
    role: user.role,
    plan_id: planId
  }, config.jwtSecret, { algorithm: 'HS256', expiresIn: config.accessTokenTtl });
}

async function issueTokens(client, config, user, planId) {
  const accessToken = issueAccessToken(config, user, planId);
  const sessionId = uuidV7();
  const refreshToken = jwt.sign({
    tenant_id: user.tenant_id,
    user_id: user.id,
    role: user.role,
    plan_id: planId,
    session_id: sessionId,
    type: 'refresh'
  }, config.refreshSecret, { algorithm: 'HS256', expiresIn: config.refreshTokenTtl });
  const decoded = jwt.decode(refreshToken);
  await client.query(
    `INSERT INTO refresh_sessions (id, tenant_id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, to_timestamp($5))`,
    [sessionId, user.tenant_id, user.id, refreshHash(refreshToken), decoded.exp]
  );
  return { access_token: accessToken, refresh_token: refreshToken, expires_in: 900 };
}

async function loadCredential(pool, email) {
  const result = await pool.query(
    `SELECT user_id, tenant_id, email, password_hash
       FROM lookup_auth_credential($1)`,
    [String(email || '').trim().toLowerCase()]
  );
  return result.rows[0] || null;
}

function authRouter({ pool, config, baseMiddleware }) {
  const router = express.Router();
  router.use(baseMiddleware.rateLimit, baseMiddleware.requestId);

  router.post('/login', asyncHandler(async (request, response) => {
    const { email, password } = request.body || {};
    if (!email || !password) throw new ApiError(400, 'VALIDATION_FAILED', { fields: ['email', 'password'] });
    const credential = await loadCredential(pool, email);
    if (!credential || !(await argon2.verify(credential.password_hash, password, { type: argon2.argon2id }))) {
      throw new ApiError(401, 'AUTHENTICATION_FAILED');
    }

    const client = await pool.connect();
    try {
      await beginTenantTransaction(client, credential.tenant_id);
      const userResult = await client.query(
        `SELECT id, tenant_id, email, role FROM users WHERE id = $1`,
        [credential.user_id]
      );
      const user = userResult.rows[0];
      if (!user) throw new ApiError(401, 'AUTHENTICATION_FAILED');
      const subscription = await activeSubscription(client, user.tenant_id);

      if (requiresMfa(user.role)) {
        const mfaToken = jwt.sign({
          tenant_id: user.tenant_id,
          user_id: user.id,
          role: user.role,
          plan_id: subscription.plan_code,
          type: 'mfa'
        }, config.jwtSecret, { algorithm: 'HS256', expiresIn: '5m' });
        await writeAudit(client, {
          tenantId: user.tenant_id, eventType: 'AUTH_MFA_CHALLENGED',
          actorType: 'USER', actorId: user.id, afterState: { request_id: response.locals.requestId }
        });
        await client.query('COMMIT');
        return response.status(200).json({ mfa_required: true, mfa_token: mfaToken, request_id: response.locals.requestId });
      }

      const tokens = await issueTokens(client, config, user, subscription.plan_code);
      await writeAudit(client, {
        tenantId: user.tenant_id, eventType: 'AUTH_LOGIN',
        actorType: 'USER', actorId: user.id, afterState: { request_id: response.locals.requestId }
      });
      await client.query('COMMIT');
      return response.status(200).json({ ...tokens, mfa_required: false, request_id: response.locals.requestId });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }));

  router.post('/mfa/verify', asyncHandler(async (request, response) => {
    const { mfa_token: mfaToken, code } = request.body || {};
    let challenge;
    try {
      challenge = jwt.verify(mfaToken, config.jwtSecret, { algorithms: ['HS256'] });
    } catch {
      throw new ApiError(401, 'AUTHENTICATION_FAILED');
    }
    if (challenge.type !== 'mfa') throw new ApiError(401, 'AUTHENTICATION_FAILED');

    const client = await pool.connect();
    try {
      await beginTenantTransaction(client, challenge.tenant_id);
      const result = await client.query(
        `SELECT u.id, u.tenant_id, u.role, c.mfa_secret, c.mfa_enabled
           FROM users u JOIN auth_credentials c ON c.user_id = u.id
          WHERE u.id = $1`,
        [challenge.user_id]
      );
      const user = result.rows[0];
      if (!user || !user.mfa_enabled || !user.mfa_secret || !validTotp(user.mfa_secret, code)) {
        throw new ApiError(401, 'MFA_INVALID');
      }
      const subscription = await activeSubscription(client, user.tenant_id);
      const tokens = await issueTokens(client, config, user, subscription.plan_code);
      await writeAudit(client, {
        tenantId: user.tenant_id, eventType: 'AUTH_MFA_VERIFIED',
        actorType: 'USER', actorId: user.id, afterState: { request_id: response.locals.requestId }
      });
      await client.query('COMMIT');
      return response.status(200).json({ ...tokens, request_id: response.locals.requestId });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }));

  router.post('/refresh', asyncHandler(async (request, response) => {
    const { refresh_token: refreshToken } = request.body || {};
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, config.refreshSecret, { algorithms: ['HS256'] });
    } catch {
      throw new ApiError(401, 'AUTHENTICATION_FAILED');
    }
    if (decoded.type !== 'refresh' || !decoded.session_id) throw new ApiError(401, 'AUTHENTICATION_FAILED');

    const client = await pool.connect();
    try {
      await beginTenantTransaction(client, decoded.tenant_id);
      const session = await client.query(
        `SELECT id FROM refresh_sessions
          WHERE id = $1 AND user_id = $2 AND token_hash = $3
            AND revoked_at IS NULL AND expires_at > now()
          FOR UPDATE`,
        [decoded.session_id, decoded.user_id, refreshHash(refreshToken)]
      );
      if (!session.rows[0]) throw new ApiError(401, 'AUTHENTICATION_FAILED');
      const userResult = await client.query(`SELECT id, tenant_id, role FROM users WHERE id = $1`, [decoded.user_id]);
      const user = userResult.rows[0];
      if (!user) throw new ApiError(401, 'AUTHENTICATION_FAILED');
      const subscription = await activeSubscription(client, user.tenant_id);
      const tokens = await issueTokens(client, config, user, subscription.plan_code);
      const newSession = jwt.decode(tokens.refresh_token).session_id;
      await client.query(`UPDATE refresh_sessions SET revoked_at = now(), replaced_by = $2 WHERE id = $1`, [decoded.session_id, newSession]);
      await writeAudit(client, {
        tenantId: user.tenant_id, eventType: 'AUTH_REFRESHED',
        actorType: 'USER', actorId: user.id, afterState: { request_id: response.locals.requestId }
      });
      await client.query('COMMIT');
      return response.status(200).json({ ...tokens, request_id: response.locals.requestId });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }));

  return router;
}

module.exports = { authRouter, requiresMfa };