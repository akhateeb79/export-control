'use strict';

// SRP: this script owns only the UAE list import concern.
// DIP: reads DATABASE_URL from env, passed in — does not reach into process.env inside functions.

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const XLSX = require('xlsx');

const XLSX_PATH = path.join(__dirname, '../setup/UAE Control List.xlsx');
const SHEET_NAME = 'UAE Control List ';
const BATCH_SIZE = 200;

function parseRows(xlsxPath) {
  const wb = XLSX.readFile(xlsxPath);
  const ws = wb.Sheets[SHEET_NAME];
  if (!ws) throw new Error(`Sheet "${SHEET_NAME}" not found in workbook`);
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  // Row 0: title, Row 1: blank, Row 2: headers, Row 3+: data
  return raw.slice(3).filter((row) => row[0] && String(row[0]).trim()).map((row) => ({
    seq_no:           Number(row[0]),
    good_type:        String(row[1] || 'Chemical').trim(),
    cas_number:       String(row[2] || '').trim() || null,
    hs_code:          String(row[3] || '').trim() || null,
    scientific_name:  String(row[4] || '').trim(),
    product_name:     String(row[5] || '').trim() || null,
    controlled_good:  String(row[6] || 'Yes').trim() === 'Yes',
    needs_declaration: String(row[7] || 'No').trim() === 'Yes',
    under_list_of:    String(row[8] || '').trim() || null
  })).filter((row) => row.scientific_name);
}

async function runMigration(client, sqlPath) {
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await client.query(sql);
}

async function importRows(client, rows) {
  let inserted = 0;
  let updated = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    for (const row of batch) {
      const result = await client.query(
        `INSERT INTO uae_control_list_entries
           (seq_no, good_type, cas_number, hs_code, scientific_name, product_name,
            controlled_good, needs_declaration, under_list_of)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (seq_no) DO UPDATE SET
           good_type        = EXCLUDED.good_type,
           cas_number       = EXCLUDED.cas_number,
           hs_code          = EXCLUDED.hs_code,
           scientific_name  = EXCLUDED.scientific_name,
           product_name     = EXCLUDED.product_name,
           controlled_good  = EXCLUDED.controlled_good,
           needs_declaration= EXCLUDED.needs_declaration,
           under_list_of    = EXCLUDED.under_list_of,
           imported_at      = now()
         RETURNING (xmax = 0) AS is_insert`,
        [
          row.seq_no, row.good_type, row.cas_number, row.hs_code,
          row.scientific_name, row.product_name,
          row.controlled_good, row.needs_declaration, row.under_list_of
        ]
      );
      if (result.rows[0].is_insert) inserted++; else updated++;
    }
    process.stdout.write(`  ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length} rows processed\r`);
  }
  return { inserted, updated };
}

(async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) { process.stderr.write('DATABASE_URL is not set\n'); process.exit(1); }

  const migrationPath = path.join(__dirname, '../db/migrations/057_uae_control_list.sql');
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    process.stdout.write('Applying migration 057_uae_control_list…\n');
    await runMigration(client, migrationPath);
    process.stdout.write('Migration applied.\n');

    process.stdout.write('Parsing UAE Control List XLSX…\n');
    const rows = parseRows(XLSX_PATH);
    process.stdout.write(`Parsed ${rows.length} entries.\n`);

    process.stdout.write('Importing entries…\n');
    const { inserted, updated } = await importRows(client, rows);
    process.stdout.write(`\nImport complete: ${inserted} inserted, ${updated} updated.\n`);

    const counts = await client.query(
      `SELECT good_type, COUNT(*)::int AS count,
              COUNT(*) FILTER (WHERE controlled_good)::int AS controlled,
              COUNT(*) FILTER (WHERE needs_declaration)::int AS needs_declaration
         FROM uae_control_list_entries GROUP BY good_type ORDER BY good_type`
    );
    process.stdout.write('\nBreakdown:\n');
    counts.rows.forEach((r) => {
      process.stdout.write(`  ${r.good_type}: ${r.count} entries, ${r.controlled} controlled, ${r.needs_declaration} need declaration\n`);
    });
  } catch (error) {
    process.stderr.write(`Import failed: ${error.message}\n`);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
