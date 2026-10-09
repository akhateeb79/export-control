'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  process.stderr.write('DATABASE_URL is not set\n');
  process.exit(1);
}

const sqlPath = path.join(__dirname, '../db/seed/seed_demo.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

const pool = new Pool({ connectionString: databaseUrl });

(async () => {
  const client = await pool.connect();
  try {
    process.stdout.write('Running demo seed…\n');
    await client.query(sql);
    process.stdout.write('Demo seed completed.\n');
    process.stdout.write('\nDemo credentials (password: Demo@12345):\n');
    process.stdout.write('  SUPER_ADMIN       admin@gulftrade.ae\n');
    process.stdout.write('  COMPLIANCE_OFFICER officer1@gulftrade.ae\n');
    process.stdout.write('  COMPLIANCE_OFFICER officer2@gulftrade.ae\n');
    process.stdout.write('  ANALYST           analyst@gulftrade.ae\n');
    process.stdout.write('\n13 demo cases loaded across all workflow states.\n');
  } catch (error) {
    process.stderr.write(`Seed failed: ${error.message}\n`);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
