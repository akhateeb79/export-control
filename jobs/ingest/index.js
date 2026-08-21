#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { fileURLToPath, URL } = require('node:url');
const { parsePayload } = require('./parsers');
const {
  applyChangedSource,
  createPool,
  latestActiveVersion,
  loadSources,
  markUnchangedCheck,
  recordFailure
} = require('./repository');

const DEFAULT_TIMEOUT_MS = 60_000;

function parseArguments(argv) {
  const options = { sourceCode: null };
  for (const argument of argv) {
    if (argument.startsWith('--source=')) options.sourceCode = argument.slice('--source='.length);
    else if (argument === '--help') {
      process.stdout.write('Usage: node jobs/ingest/index.js [--source=SOURCE_CODE]\n');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function payloadHash(payload) {
  return crypto.createHash('sha256').update(payload).digest('hex');
}

async function fetchPayload(source) {
  const url = new URL(source.source_url);
  if (url.protocol === 'file:' && process.env.INGEST_TEST_MODE === 'true') {
    return fs.readFile(fileURLToPath(url));
  }
  if (url.protocol !== 'https:') {
    throw new Error(`Source ${source.code} must use HTTPS; received ${url.protocol}`);
  }

  const timeout = Number.parseInt(process.env.INGEST_TIMEOUT_MS || DEFAULT_TIMEOUT_MS, 10);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': 'export-control-list-ingestion/1.0' },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Fetch failed with HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

async function ingestSource(client, source) {
  const activeVersion = await latestActiveVersion(client, source.code);
  try {
    const payload = await fetchPayload(source);
    const hash = payloadHash(payload);
    if (activeVersion?.content_hash === hash) {
      await markUnchangedCheck(client, activeVersion.id);
      return {
        source: source.code,
        outcome: 'UNCHANGED',
        versionId: activeVersion.id,
        added: 0,
        removed: 0,
        changed: 0
      };
    }

    const entries = parsePayload(payload, source.format);
    const result = await applyChangedSource(client, source, hash, entries);
    return { source: source.code, ...result };
  } catch (error) {
    await recordFailure(client, source, activeVersion, error);
    return {
      source: source.code,
      outcome: 'FAILED',
      error: error.message,
      previousVersionId: activeVersion?.id || null
    };
  }
}

async function run(options = {}) {
  const pool = createPool();
  const client = await pool.connect();
  try {
    const sources = await loadSources(client, options.sourceCode);
    const results = [];
    for (const source of sources) results.push(await ingestSource(client, source));
    return results;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const results = await run(options);
  process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
  if (results.some((result) => result.outcome === 'FAILED')) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`List ingestion failed: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  fetchPayload,
  ingestSource,
  parseArguments,
  payloadHash,
  run
};