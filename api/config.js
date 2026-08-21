'use strict';

function numberSetting(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

function loadConfig() {
  const jwtSecret = process.env.JWT_SECRET || process.env.SESSION_SECRET;
  if (!jwtSecret) throw new Error('JWT_SECRET or SESSION_SECRET must be configured');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be configured');

  return {
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret,
    refreshSecret: process.env.JWT_REFRESH_SECRET || `${jwtSecret}:refresh`,
    matchingServiceUrl: process.env.MATCHING_SERVICE_URL || 'http://127.0.0.1:5001',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || null,
    anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1/messages',
    classificationWorkerEnabled: process.env.CLASSIFICATION_WORKER_ENABLED !== 'false',
    classificationWorkerPollMs: numberSetting('CLASSIFICATION_WORKER_POLL_MS', 2_000),
    listFreshnessHours: numberSetting('LIST_FRESHNESS_HOURS', 48),
    rateLimitWindowMs: numberSetting('RATE_LIMIT_WINDOW_MS', 60_000),
    rateLimitMax: numberSetting('RATE_LIMIT_MAX', 120),
    accessTokenTtl: '15m',
    refreshTokenTtl: '7d'
  };
}

module.exports = { loadConfig };