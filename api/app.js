'use strict';

const express = require('express');
const { authRouter } = require('./auth');
const { adminRouter } = require('./admin');
const { adminDataRouter } = require('./admin-data');
const { caseRouter } = require('./cases');
const { createClassificationService } = require('./classification');
const { loadConfig } = require('./config');
const { createPool } = require('./db');
const { ApiError, errorMiddleware } = require('./errors');
const { createProtectedMiddleware } = require('./middleware');
const { createLicenceDeterminationAgent } = require('../src/agents/licence-determination-agent');
const { setupRouter } = require('./setup');
const { partyRouter } = require('./parties');
const { documentRouter } = require('./documents');
const { icpRouter } = require('./icp');
const { intelligenceRouter } = require('./intelligence');
const { reportsRouter } = require('./reports');
const { tenantRouter } = require('./tenants');
const { userRouter } = require('./users');
const { notificationRouter } = require('./notifications');
const { featuresRouter } = require('./features');
const { monitorRouter, platformMonitorRouter } = require('./monitor');
const { referenceRouter } = require('./reference');
const { orchestrate } = require('./orchestrator');
const { createNotificationService } = require('../src/services/notification');
const { recommendedActionsRouter } = require('./recommended-actions');

function createApp(overrides = {}) {
  const config = overrides.config || loadConfig();
  const pool = overrides.pool || createPool(config);
  const classifier = overrides.classifier || createClassificationService({
    pool,
    config,
    modelClient: overrides.modelClient
  });
  const licence = overrides.licence || createLicenceDeterminationAgent({
    config,
    modelClient: overrides.modelClient
  });
  const notification = overrides.notification || createNotificationService();
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  const middleware = createProtectedMiddleware({ pool, config });
  app.use('/api/setup', setupRouter({ pool }));
  app.use('/api/v1/auth', authRouter({ pool, config, baseMiddleware: middleware }));
  app.use('/api/v1/users', userRouter({ middleware, config }));
  app.use('/api/v1/notifications', notificationRouter({ middleware }));
  app.use('/api/v1', recommendedActionsRouter({ middleware, notification }));
  app.use('/api/v1/features', featuresRouter({ middleware }));
  app.use('/api/v1/cases', monitorRouter({ middleware, pool }));
  app.use('/api/v1/admin', platformMonitorRouter({ middleware, pool }));
  app.use('/api/v1/reference', referenceRouter({ middleware, pool }));
  app.use('/api/v1/tenants', tenantRouter({ middleware }));
  app.use('/api/v1/cases', caseRouter({
    middleware,
    config,
    classifier,
    licence,
    modelClient: overrides.modelClient,
    orchestrator: (caseId, tenantId) => orchestrate(caseId, tenantId, pool, {
      config,
      classifier,
      licence,
      notification
    })
  }));
  app.use('/api/v1/cases/:id/documents', documentRouter({
    middleware,
    config,
    modelClient: overrides.modelClient,
    pool
  }));
  app.use('/api/v1/parties', partyRouter({ middleware }));
  app.use('/api/v1/admin', adminRouter({ middleware }));
  app.use('/api/v1/admin/data', adminDataRouter({ middleware }));
  app.use('/api/v1/icp', icpRouter({ middleware, pool }));
  app.use('/api/v1/intelligence', intelligenceRouter({
    middleware,
    config,
    pool,
    modelClient: overrides.modelClient
  }));
  app.use('/api/v1/reports', reportsRouter({ middleware, pool }));
  app.use((request, response, next) => next(new ApiError(404, 'NOT_FOUND')));
  app.use(errorMiddleware);
  app.locals.pool = pool;
  app.locals.classifier = classifier;
  app.locals.licence = licence;
  app.locals.notification = notification;
  app.locals.config = config;
  app.locals.modelClient = overrides.modelClient;
  return app;
}

module.exports = { createApp };