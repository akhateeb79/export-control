INSERT INTO threshold_definitions (
  code,
  label_key,
  data_type,
  platform_floor,
  platform_default,
  stricter_is
) VALUES
  ('SANCTIONS_POSSIBLE_HIT', 'threshold.sanctions_possible_hit', 'NUMERIC', 75, 80, 'HIGHER'),
  ('SANCTIONS_CONFIRMED', 'threshold.sanctions_confirmed', 'NUMERIC', 90, 95, 'HIGHER'),
  ('CLASSIFY_MIN_CONF', 'threshold.classify_min_conf', 'NUMERIC', 70, 80, 'HIGHER'),
  ('DOCUMENT_CONFIRM_CONF', 'threshold.document_confirm_conf', 'NUMERIC', 80, 85, 'HIGHER')
ON CONFLICT (code) DO NOTHING;