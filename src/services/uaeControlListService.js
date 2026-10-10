'use strict';

// SRP: UAE National Control List screening only. No classification logic here.
// OCP: add new match strategies by adding to STRATEGIES array; existing code is not modified.
// DIP: db pool injected by caller (not imported directly).

const SIMILARITY_THRESHOLD = 0.35; // pg_trgm similarity score

/**
 * Screen a product against the UAE National Control List.
 *
 * @param {object} pool   - pg Pool instance
 * @param {object} params - { productName, scientificName, casNumber, hsCode }
 * @returns {{ status, matchedEntryId, matchScore, entry }}
 *   status: 'UAE_CONTROLLED' | 'UAE_DECLARATION_REQUIRED' | 'UAE_CLEAR' | 'UAE_UNKNOWN'
 */
async function screenAgainstUaeList(pool, { productName, scientificName, casNumber, hsCode } = {}) {
  // 1. Exact CAS match (highest confidence)
  if (casNumber) {
    const result = await pool.query(
      `SELECT id, controlled_good, needs_declaration, scientific_name, product_name,
              1.0::numeric AS score
         FROM uae_control_list_entries
        WHERE cas_number = $1
        LIMIT 1`,
      [casNumber.trim()]
    );
    if (result.rows.length) return buildResult(result.rows[0]);
  }

  // 2. Exact HS code match
  if (hsCode) {
    const result = await pool.query(
      `SELECT id, controlled_good, needs_declaration, scientific_name, product_name,
              0.95::numeric AS score
         FROM uae_control_list_entries
        WHERE hs_code = $1
        LIMIT 1`,
      [hsCode.trim()]
    );
    if (result.rows.length) return buildResult(result.rows[0]);
  }

  // 3. Fuzzy name match (scientific_name or product_name)
  const searchTerm = scientificName || productName;
  if (searchTerm) {
    const result = await pool.query(
      `SELECT id, controlled_good, needs_declaration, scientific_name, product_name,
              GREATEST(
                similarity(scientific_name, $1),
                COALESCE(similarity(product_name, $1), 0)
              ) AS score
         FROM uae_control_list_entries
        WHERE scientific_name % $1
           OR product_name    % $1
        ORDER BY score DESC
        LIMIT 1`,
      [searchTerm.trim()]
    );
    if (result.rows.length && Number(result.rows[0].score) >= SIMILARITY_THRESHOLD) {
      return buildResult(result.rows[0]);
    }
  }

  // Nothing matched
  return { status: 'UAE_UNKNOWN', matchedEntryId: null, matchScore: null, entry: null };
}

function buildResult(row) {
  let status;
  if (row.needs_declaration) status = 'UAE_DECLARATION_REQUIRED';
  else if (row.controlled_good) status = 'UAE_CONTROLLED';
  else status = 'UAE_CLEAR';

  return {
    status,
    matchedEntryId: row.id,
    matchScore: Number(row.score),
    entry: { scientificName: row.scientific_name, productName: row.product_name }
  };
}

module.exports = { screenAgainstUaeList };
