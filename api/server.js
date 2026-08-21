'use strict';

const { createApp } = require('./app');

const port = Number(process.env.API_PORT || 3000);
const app = createApp();
app.listen(port, '0.0.0.0', () => {
  process.stdout.write(`Export-control API listening on ${port}\n`);
});