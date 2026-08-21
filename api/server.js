'use strict';

const { createApp } = require('./app');
const { createClassificationWorker } = require('./classification');

const port = Number(process.env.API_PORT || 3000);
const app = createApp();
const worker = createClassificationWorker(app.locals.classifier, app.locals.config);
worker.start();
app.listen(port, '0.0.0.0', () => {
  process.stdout.write(`Export-control API listening on ${port}\n`);
});