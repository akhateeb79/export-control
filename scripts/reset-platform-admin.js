'use strict';
// One-time script: create or reset the platform super-admin password
// Usage: node --env-file .env scripts/reset-platform-admin.js

const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const EMAIL    = 'compliance.export@gmail.com';
const PASSWORD = 'Aegis@Admin2024!';

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    const hash = await bcrypt.hash(PASSWORD, 12);
    console.log('Password hashed...');

    // Check if user already exists
    const existing = await client.query(
      `SELECT u.id, u.role, u.tenant_id FROM users u
         JOIN auth_credentials ac ON ac.user_id = u.id
        WHERE ac.email = $1`,
      [EMAIL]
    );

    if (existing.rows.length > 0) {
      const user = existing.rows[0];
      console.log(`User found: role=${user.role}, tenant_id=${user.tenant_id ?? 'NULL (platform)'}`);
      // Update password
      await client.query(
        `UPDATE auth_credentials SET password_hash = $1 WHERE email = $2`,
        [hash, EMAIL]
      );
      // Ensure role is SUPER_ADMIN with no tenant
      await client.query(
        `UPDATE users SET role = 'SUPER_ADMIN', tenant_id = NULL WHERE id = $1`,
        [user.id]
      );
      console.log(`✓ Password reset for ${EMAIL}`);
    } else {
      console.log('User not found — creating platform super-admin...');
      const userId = uuidV7();
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO users (id, tenant_id, email, role, status, full_name)
         VALUES ($1, NULL, $2, 'SUPER_ADMIN', 'ACTIVE', 'Platform Administrator')
         ON CONFLICT (email) DO UPDATE SET role = 'SUPER_ADMIN', tenant_id = NULL, status = 'ACTIVE'`,
        [userId, EMAIL]
      );
      // Get actual user id (in case of conflict)
      const uRow = await client.query(`SELECT id FROM users WHERE email = $1`, [EMAIL]);
      const realUserId = uRow.rows[0].id;
      await client.query(
        `INSERT INTO auth_credentials (user_id, tenant_id, email, password_hash, mfa_enabled)
         VALUES ($1, NULL, $2, $3, FALSE)
         ON CONFLICT (email) DO UPDATE SET password_hash = $3, tenant_id = NULL`,
        [realUserId, EMAIL, hash]
      );
      await client.query('COMMIT');
      console.log(`✓ Platform super-admin created: ${EMAIL}`);
    }

    console.log('\n─────────────────────────────────');
    console.log(`  Email   : ${EMAIL}`);
    console.log(`  Password: ${PASSWORD}`);
    console.log('─────────────────────────────────\n');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

function uuidV7() {
  const bytes = crypto.randomBytes(16);
  const timestamp = BigInt(Date.now());
  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

run();
