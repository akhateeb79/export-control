-- UAE National Control List: chemicals and strategic goods controlled under UAE law.
-- Stored separately from EAR/CCL because they are different regulatory regimes.

BEGIN;

CREATE TABLE uae_control_list_entries (
  id                  SERIAL PRIMARY KEY,
  seq_no              INTEGER NOT NULL,
  good_type           VARCHAR(32) NOT NULL,          -- Chemical, Strategic
  cas_number          VARCHAR(128),
  hs_code             VARCHAR(20),
  scientific_name     TEXT NOT NULL,
  product_name        TEXT,                          -- synonyms, may be long
  controlled_good     BOOLEAN NOT NULL DEFAULT TRUE,
  needs_declaration   BOOLEAN NOT NULL DEFAULT FALSE,
  under_list_of       VARCHAR(128),
  imported_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (seq_no)
);

-- pg_trgm indexes for fuzzy name matching against extracted product descriptions
CREATE INDEX uae_control_list_scientific_trgm
  ON uae_control_list_entries USING GIN (scientific_name gin_trgm_ops);

CREATE INDEX uae_control_list_product_trgm
  ON uae_control_list_entries USING GIN (product_name gin_trgm_ops)
  WHERE product_name IS NOT NULL;

CREATE INDEX uae_control_list_hs_code
  ON uae_control_list_entries (hs_code)
  WHERE hs_code IS NOT NULL AND hs_code <> '';

CREATE INDEX uae_control_list_cas
  ON uae_control_list_entries (cas_number)
  WHERE cas_number IS NOT NULL AND cas_number <> '';

-- Add UAE control status to classification_results (OCP: new columns, no existing ones changed)
ALTER TABLE classification_results
  ADD COLUMN IF NOT EXISTS uae_control_status  VARCHAR(32),   -- UAE_CONTROLLED, UAE_DECLARATION_REQUIRED, UAE_CLEAR, UAE_UNKNOWN
  ADD COLUMN IF NOT EXISTS uae_matched_entry_id INTEGER REFERENCES uae_control_list_entries(id),
  ADD COLUMN IF NOT EXISTS uae_match_score      NUMERIC(5,2);

COMMENT ON COLUMN classification_results.uae_control_status IS
  'UAE National Control List check result: UAE_CONTROLLED, UAE_DECLARATION_REQUIRED, UAE_CLEAR, UAE_UNKNOWN';

COMMIT;
