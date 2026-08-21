INSERT INTO plans (
  code,
  name,
  case_allowance,
  overage_rate,
  user_seat_limit,
  api_enabled,
  retention_years
) VALUES
  ('STARTER', 'Starter', 100, 15.0000, 5, FALSE, 5),
  ('PROFESSIONAL', 'Professional', 500, 12.0000, 25, TRUE, 7),
  ('ENTERPRISE', 'Enterprise', NULL, NULL, NULL, TRUE, 10)
ON CONFLICT (code) DO NOTHING;