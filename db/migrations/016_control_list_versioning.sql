-- Slice 5: version-safe Commerce Control List storage and activation.
-- Existing migrations remain immutable; this migration extends their contracts.

BEGIN;

ALTER TABLE control_list_versions
  ADD COLUMN source TEXT,
  ADD COLUMN loaded_at TIMESTAMPTZ,
  ADD COLUMN status VARCHAR(12);

UPDATE control_list_versions
   SET source = COALESCE(source, regime),
       loaded_at = COALESCE(loaded_at, now()),
       status = CASE WHEN is_current THEN 'ACTIVE' ELSE 'SUPERSEDED' END;

ALTER TABLE control_list_versions
  ALTER COLUMN source SET NOT NULL,
  ALTER COLUMN loaded_at SET NOT NULL,
  ALTER COLUMN status SET NOT NULL,
  ADD CONSTRAINT control_list_versions_status_check
    CHECK (status IN ('ACTIVE', 'SUPERSEDED')),
  ADD CONSTRAINT control_list_versions_current_status_check
    CHECK (is_current = (status = 'ACTIVE'));

CREATE UNIQUE INDEX control_list_versions_one_active_per_regime
  ON control_list_versions (regime)
  WHERE status = 'ACTIVE';

ALTER TABLE eccn_parameters
  ADD COLUMN version_id UUID;

UPDATE eccn_parameters parameter
   SET version_id = entry.version_id
  FROM eccn_entries entry
 WHERE entry.eccn = parameter.eccn;

ALTER TABLE eccn_parameters
  ALTER COLUMN version_id SET NOT NULL;

ALTER TABLE eccn_parameters
  DROP CONSTRAINT eccn_parameters_eccn_fkey;

ALTER TABLE eccn_entries
  DROP CONSTRAINT eccn_entries_pkey,
  ADD CONSTRAINT eccn_entries_pkey PRIMARY KEY (version_id, eccn),
  ADD CONSTRAINT eccn_entries_category_check CHECK (category BETWEEN 0 AND 9),
  ADD CONSTRAINT eccn_entries_product_group_check CHECK (product_group BETWEEN 'A' AND 'E');

ALTER TABLE eccn_parameters
  ADD CONSTRAINT eccn_parameters_versioned_entry_fkey
    FOREIGN KEY (version_id, eccn)
    REFERENCES eccn_entries(version_id, eccn)
    ON DELETE RESTRICT,
  ADD CONSTRAINT eccn_parameters_operator_check
    CHECK (operator IN ('GT', 'GTE', 'LT', 'LTE', 'EQ', 'RANGE')),
  ADD CONSTRAINT eccn_parameters_unique_key
    UNIQUE (version_id, eccn, parameter_key);

DROP INDEX idx_eccn_narrow;
CREATE INDEX idx_eccn_version_narrow
  ON eccn_entries (version_id, category, product_group)
  WHERE is_current;
CREATE INDEX idx_eccn_full_text_trgm
  ON eccn_entries USING gin (full_text gin_trgm_ops)
  WHERE is_current;
CREATE INDEX idx_eccn_parameters_versioned
  ON eccn_parameters (version_id, eccn, parameter_key);

CREATE OR REPLACE FUNCTION activate_control_list_version(target_version_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  target control_list_versions%ROWTYPE;
BEGIN
  SELECT *
    INTO target
    FROM control_list_versions
   WHERE id = target_version_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Control list version % does not exist', target_version_id;
  END IF;

  PERFORM 1
    FROM control_list_versions
   WHERE regime = target.regime
   FOR UPDATE;

  UPDATE control_list_versions
     SET status = 'SUPERSEDED', is_current = FALSE
   WHERE regime = target.regime
     AND status = 'ACTIVE'
     AND id <> target.id;

  UPDATE control_list_versions
     SET status = 'ACTIVE', is_current = TRUE
   WHERE id = target.id;

  UPDATE classification_results
     SET requires_revalidation = TRUE
   WHERE control_list_version_id <> target.id
     AND requires_revalidation = FALSE;
END;
$$;

COMMIT;