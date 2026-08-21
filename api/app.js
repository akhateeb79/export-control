'use strict';

const express = require('express');
const { authRouter } = require('./auth');
const { caseRouter } = require('./cases');
const { loadConfig } = require('./config');
const { createPool } = require('./db');
const { ApiError, errorMiddleware } = require('./errors');
const { createProtectedMiddleware } = require('./middleware');

function createApp(overrides = {}) {
  const config = overrides.config || loadConfig();
  const pool = overrides.pool || createPool(config);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  const middleware = createProtectedMiddleware({ pool, config });
  app.use('/api/v1/auth', authRouter({ pool, config, baseMiddleware: middleware }));
  app.use('/api/v1/cases', caseRouter({ middleware, config }));
  app.use((request, response, next) => next(new ApiError(404, 'NOT_FOUND')));
  app.use(errorMiddleware);
  app.locals.pool = pool;
  return app;
}

module.exports = { createApp };