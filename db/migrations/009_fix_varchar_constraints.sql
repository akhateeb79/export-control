-- OFAC identifier type labels are publisher-supplied descriptions, not
-- controlled codes. Allow the full label while retaining a reasonable cap.
BEGIN;

ALTER TABLE sanctions_entry_identifiers
  ALTER COLUMN id_type TYPE VARCHAR(512);

COMMIT;