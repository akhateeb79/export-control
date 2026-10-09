BEGIN;

INSERT INTO workflow_states (code, label_key, is_terminal, is_editable) VALUES
  ('SCREENED', 'workflow.state.screened', FALSE, FALSE),
  ('CLASSIFICATION', 'workflow.state.classification', FALSE, FALSE),
  ('CLASSIFIED', 'workflow.state.classified', FALSE, FALSE),
  ('DETERMINATION', 'workflow.state.determination', FALSE, FALSE),
  ('PENDING_REVIEW', 'workflow.state.pending_review', FALSE, TRUE),
  ('REJECTED', 'workflow.state.rejected', TRUE, FALSE),
  ('REFERRED', 'workflow.state.referred', TRUE, FALSE)
ON CONFLICT (code) DO NOTHING;

INSERT INTO tenants (id, name, status)
VALUES ('10000000-0000-4000-8000-000000000001', 'Gulf Trade Solutions LLC', 'ACTIVE')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, updated_at = now();

SET LOCAL app.tenant_id = '10000000-0000-4000-8000-000000000001';

INSERT INTO tenant_subscriptions (
  id, tenant_id, plan_code, status, period_start, period_end, cases_used
) VALUES (
  '10000000-0000-4000-8000-000000000101',
  '10000000-0000-4000-8000-000000000001',
  'PROFESSIONAL', 'ACTIVE', CURRENT_DATE - 30, CURRENT_DATE + 335, 13
)
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  period_start = EXCLUDED.period_start,
  period_end = EXCLUDED.period_end,
  cases_used = EXCLUDED.cases_used;

INSERT INTO users (id, tenant_id, email, role, status, display_name) VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'admin@gulftrade.ae', 'SUPER_ADMIN', 'ACTIVE', 'Platform Admin'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'officer1@gulftrade.ae', 'COMPLIANCE_OFFICER', 'ACTIVE', 'Sarah Al-Mansouri'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'officer2@gulftrade.ae', 'COMPLIANCE_OFFICER', 'ACTIVE', 'James Hartley'),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'analyst@gulftrade.ae', 'ANALYST', 'ACTIVE', 'Fatima Al-Rashidi'),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'api@gulftrade.ae', 'API_CLIENT', 'ACTIVE', 'API Integration')
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email, role = EXCLUDED.role, status = EXCLUDED.status,
  display_name = EXCLUDED.display_name, updated_at = now();

INSERT INTO auth_credentials (user_id, tenant_id, email, password_hash, mfa_enabled) VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'admin@gulftrade.ae', '$2b$12$LhCj7ur2RTqqun.r9FiFcu0b1o11UDy.Ycb0cGRMh1zhNuuLxZ05S', FALSE),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'officer1@gulftrade.ae', '$2b$12$LhCj7ur2RTqqun.r9FiFcu0b1o11UDy.Ycb0cGRMh1zhNuuLxZ05S', FALSE),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'officer2@gulftrade.ae', '$2b$12$LhCj7ur2RTqqun.r9FiFcu0b1o11UDy.Ycb0cGRMh1zhNuuLxZ05S', FALSE),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'analyst@gulftrade.ae', '$2b$12$LhCj7ur2RTqqun.r9FiFcu0b1o11UDy.Ycb0cGRMh1zhNuuLxZ05S', FALSE),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'api@gulftrade.ae', '$2b$12$LhCj7ur2RTqqun.r9FiFcu0b1o11UDy.Ycb0cGRMh1zhNuuLxZ05S', FALSE)
ON CONFLICT (user_id) DO UPDATE SET
  email = EXCLUDED.email,
  password_hash = EXCLUDED.password_hash,
  mfa_enabled = FALSE,
  mfa_secret = NULL,
  updated_at = now();

INSERT INTO parties (
  id, tenant_id, legal_name, name_script, country_code, address,
  address_type, registration_no, incorporated_on, website
) VALUES
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Emirates Process Industries FZCO', 'LATIN', 'AE', 'Jebel Ali Free Zone, Dubai, UAE', 'PREMISES', 'JAFZA-184920', '2012-04-16', 'https://emiratesprocess.example'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Najd Precision Systems Company', 'LATIN', 'SA', 'Second Industrial City, Riyadh, Saudi Arabia', 'PREMISES', '1010842231', '2015-09-03', 'https://najdprecision.example'),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'Bharat Industrial Controls Private Limited', 'LATIN', 'IN', 'Peenya Industrial Area, Bengaluru, India', 'PREMISES', 'U31909KA2010PTC052100', '2010-02-11', 'https://bharatcontrols.example'),
  ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'Anadolu Navigation Teknolojileri AS', 'LATIN', 'TR', 'Teknopark Istanbul, Pendik, Türkiye', 'PREMISES', 'IST-742991', '2018-06-22', 'https://anadolunav.example'),
  ('30000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'Shenzhen Secure Communications Co Ltd', 'LATIN', 'CN', 'Nanshan High-Tech Park, Shenzhen, China', 'PREMISES', '91440300MA5F8Y7K2Q', '2017-11-08', 'https://szsecure.example'),
  ('30000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', 'Gulf Logistics and Warehousing PJSC', 'LATIN', 'AE', 'Dubai South Logistics District, Dubai, UAE', 'PREMISES', 'DED-663821', '2008-03-19', 'https://gulflogistics.example'),
  ('30000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001', 'Arabian Freight Services LLC', 'LATIN', 'AE', 'Khalifa Port Free Trade Zone, Abu Dhabi, UAE', 'PREMISES', 'AD-449183', '2014-01-27', 'https://arabianfreight.example'),
  (
    '30000000-0000-4000-8000-000000000008',
    '10000000-0000-4000-8000-000000000001',
    COALESCE((
      SELECT sen.raw_name
      FROM sanctions_entry_names sen
      JOIN sanctions_entries se ON se.id = sen.entry_id
      WHERE se.source_code = 'OFAC_SDN' AND se.is_current = TRUE
      ORDER BY sen.id LIMIT 1
    ), 'AEROCARIBBEAN AIRLINES'),
    'LATIN', 'AE', 'PO Box 8831, Dubai, UAE', 'PO_BOX', 'DED-998102', '2025-01-09', NULL
  )
ON CONFLICT (id) DO UPDATE SET
  legal_name = EXCLUDED.legal_name,
  country_code = EXCLUDED.country_code,
  address = EXCLUDED.address,
  registration_no = EXCLUDED.registration_no;

INSERT INTO products (
  id, tenant_id, part_number, name, description, specifications, origin_country, us_content_pct
) VALUES
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'GTS-PUMP-220', 'Industrial centrifugal pump', 'General-purpose stainless-steel centrifugal pump for water treatment, 22 kW motor, non-nuclear application.', '{"flow_rate_m3h":120,"motor_power_kw":22,"material":"316 stainless steel"}', 'DE', 8),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'GTS-FOG-7A', 'Fiber optic gyroscope', 'High-precision closed-loop fiber optic gyroscope with 0.01 degree/hour bias stability for inertial navigation.', '{"position_accuracy_m":5,"bias_stability_deg_hr":0.01,"interface":"RS-422"}', 'US', 76),
  ('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'GTS-ENC-256', 'Secure encryption gateway', 'Ruggedized network encryption appliance using AES-256 with customer-accessible cryptographic functionality.', '{"symmetric_key_length_bits":256,"throughput_gbps":10,"crypto":"AES-256"}', 'US', 82),
  ('40000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'GTS-RF-3A', 'High-frequency electronic component', 'Radiation-tolerant mixed-signal electronic component with 1.4 GHz clock capability.', '{"clock_frequency_mhz":1400,"temperature_range_c":"-55 to 125"}', 'US', 68),
  ('40000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'GTS-MOD-UNK', 'Industrial control module', 'Electronic control module for industrial equipment; technical specifications and component datasheet are pending.', '{"specification_status":"incomplete"}', 'AE', 20)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  specifications = EXCLUDED.specifications;

INSERT INTO compliance_cases (
  id, tenant_id, case_ref, state, destination_country, stated_end_use,
  incoterms, planned_ship_date, overall_risk, fired_rule_code,
  decided_by, decided_at, decision_rationale, retention_until, created_at
) VALUES
  ('70000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'GTS-2026-001', 'DRAFT', 'AE', 'Replacement pump for a municipal water-treatment facility in Dubai.', 'DAP', CURRENT_DATE + 21, 'LOW', NULL, NULL, NULL, NULL, CURRENT_DATE + 2555, now() - interval '13 days'),
  ('70000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'GTS-2026-002', 'DRAFT', 'SA', 'Factory automation upgrade for a food-packaging line in Riyadh.', 'CIP', CURRENT_DATE + 25, 'LOW', NULL, NULL, NULL, NULL, CURRENT_DATE + 2555, now() - interval '12 days'),
  ('70000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'GTS-2026-003', 'SCREENING', 'IN', 'Secure communications gateway for an electricity distribution control center.', 'DAP', CURRENT_DATE + 18, 'MEDIUM', NULL, NULL, NULL, NULL, CURRENT_DATE + 2555, now() - interval '11 days'),
  ('70000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'GTS-2026-004', 'SCREENED', 'TR', 'Navigation sensor evaluation for commercial rail positioning research.', 'FCA', CURRENT_DATE + 16, 'MEDIUM', NULL, NULL, NULL, NULL, CURRENT_DATE + 2555, now() - interval '10 days'),
  ('70000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'GTS-2026-005', 'CLASSIFICATION', 'CN', 'Evaluation of high-frequency components for civilian telecommunications test equipment.', 'CPT', CURRENT_DATE + 14, 'HIGH', NULL, NULL, NULL, NULL, CURRENT_DATE + 2555, now() - interval '9 days'),
  ('70000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', 'GTS-2026-006', 'CLASSIFIED', 'AE', 'Industrial process monitoring gateway for an oilfield services workshop.', 'DAP', CURRENT_DATE + 12, 'MEDIUM', NULL, NULL, NULL, NULL, CURRENT_DATE + 2555, now() - interval '8 days'),
  ('70000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001', 'GTS-2026-007', 'DETERMINATION', 'SA', 'Precision inertial sensor for civil aviation maintenance calibration.', 'CIP', CURRENT_DATE + 10, 'HIGH', NULL, NULL, NULL, NULL, CURRENT_DATE + 2555, now() - interval '7 days'),
  ('70000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000001', 'GTS-2026-008', 'PENDING_REVIEW', 'IN', 'Encryption gateways for a regulated commercial banking network.', 'DAP', CURRENT_DATE + 9, 'MEDIUM', NULL, NULL, NULL, NULL, CURRENT_DATE + 2555, now() - interval '6 days'),
  ('70000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000001', 'GTS-2026-009', 'PENDING_REVIEW', 'CN', 'Mixed-signal components for civilian 5G base-station testing.', 'CPT', CURRENT_DATE + 8, 'HIGH', NULL, NULL, NULL, NULL, CURRENT_DATE + 2555, now() - interval '5 days'),
  ('70000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000001', 'GTS-2026-010', 'APPROVED', 'AE', 'Industrial pump for a district cooling plant expansion.', 'DDP', CURRENT_DATE + 7, 'LOW', NULL, '20000000-0000-4000-8000-000000000002', now() - interval '1 day', 'Screening, classification, and end-use evidence support approval.', CURRENT_DATE + 2555, now() - interval '4 days'),
  ('70000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001', 'GTS-2026-011', 'APPROVED', 'TR', 'Fiber optic gyroscope for certified commercial rail surveying equipment.', 'FCA', CURRENT_DATE + 6, 'MEDIUM', NULL, '20000000-0000-4000-8000-000000000003', now() - interval '12 hours', 'Required authorization evidence and consignee controls were verified.', CURRENT_DATE + 2555, now() - interval '3 days'),
  ('70000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000001', 'GTS-2026-012', 'REJECTED', 'AE', 'Electronic component procurement for an undisclosed third-party end user.', 'EXW', CURRENT_DATE + 5, 'BLOCKED', 'RULE_1', '20000000-0000-4000-8000-000000000002', now() - interval '6 hours', 'Confirmed sanctions match; transaction blocked without override.', CURRENT_DATE + 2555, now() - interval '2 days'),
  ('70000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000001', 'GTS-2026-013', 'REFERRED', 'CN', 'Industrial control module with incomplete technical specifications and unclear ultimate application.', 'CPT', CURRENT_DATE + 4, 'HIGH', NULL, '20000000-0000-4000-8000-000000000003', now() - interval '2 hours', 'Referred for technical data and enhanced end-user due diligence.', CURRENT_DATE + 2555, now() - interval '1 day')
ON CONFLICT (id) DO UPDATE SET
  state = EXCLUDED.state,
  overall_risk = EXCLUDED.overall_risk,
  fired_rule_code = EXCLUDED.fired_rule_code,
  decided_by = EXCLUDED.decided_by,
  decided_at = EXCLUDED.decided_at,
  decision_rationale = EXCLUDED.decision_rationale;

INSERT INTO case_parties (id, tenant_id, case_id, party_id, party_role) VALUES
  ('80000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'END_USER'),
  ('80000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'END_USER'),
  ('80000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', 'END_USER'),
  ('80000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000004', 'END_USER'),
  ('80000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000005', 'END_USER'),
  ('80000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000006', 'CONSIGNEE'),
  ('80000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000007', '30000000-0000-4000-8000-000000000002', 'END_USER'),
  ('80000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000008', '30000000-0000-4000-8000-000000000003', 'END_USER'),
  ('80000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000009', '30000000-0000-4000-8000-000000000005', 'END_USER'),
  ('80000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000010', '30000000-0000-4000-8000-000000000001', 'END_USER'),
  ('80000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000011', '30000000-0000-4000-8000-000000000004', 'END_USER'),
  ('80000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000012', '30000000-0000-4000-8000-000000000008', 'END_USER'),
  ('80000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000013', '30000000-0000-4000-8000-000000000007', 'CONSIGNEE')
ON CONFLICT (case_id, party_id, party_role) DO NOTHING;

INSERT INTO case_products (id, tenant_id, case_id, product_id, product_snapshot) VALUES
  ('90000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '{"part_number":"GTS-PUMP-220","name":"Industrial centrifugal pump","origin_country":"DE"}'),
  ('90000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000005', '{"part_number":"GTS-MOD-UNK","name":"Industrial control module","origin_country":"AE"}'),
  ('90000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000003', '{"part_number":"GTS-ENC-256","name":"Secure encryption gateway","origin_country":"US"}'),
  ('90000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000002', '{"part_number":"GTS-FOG-7A","name":"Fiber optic gyroscope","origin_country":"US"}'),
  ('90000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000005', '40000000-0000-4000-8000-000000000004', '{"part_number":"GTS-RF-3A","name":"High-frequency electronic component","origin_country":"US"}'),
  ('90000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000006', '40000000-0000-4000-8000-000000000003', '{"part_number":"GTS-ENC-256","name":"Secure encryption gateway","origin_country":"US"}'),
  ('90000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000007', '40000000-0000-4000-8000-000000000002', '{"part_number":"GTS-FOG-7A","name":"Fiber optic gyroscope","origin_country":"US"}'),
  ('90000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000008', '40000000-0000-4000-8000-000000000003', '{"part_number":"GTS-ENC-256","name":"Secure encryption gateway","origin_country":"US"}'),
  ('90000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000009', '40000000-0000-4000-8000-000000000004', '{"part_number":"GTS-RF-3A","name":"High-frequency electronic component","origin_country":"US"}'),
  ('90000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000010', '40000000-0000-4000-8000-000000000001', '{"part_number":"GTS-PUMP-220","name":"Industrial centrifugal pump","origin_country":"DE"}'),
  ('90000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000011', '40000000-0000-4000-8000-000000000002', '{"part_number":"GTS-FOG-7A","name":"Fiber optic gyroscope","origin_country":"US"}'),
  ('90000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000012', '40000000-0000-4000-8000-000000000004', '{"part_number":"GTS-RF-3A","name":"High-frequency electronic component","origin_country":"US"}'),
  ('90000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000013', '40000000-0000-4000-8000-000000000005', '{"part_number":"GTS-MOD-UNK","name":"Industrial control module","origin_country":"AE"}')
ON CONFLICT (case_id, product_id) DO NOTHING;

INSERT INTO screening_results (
  id, tenant_id, case_id, party_id, source_code, list_version_id,
  status, top_score, matched_entry_id, triggering_variant, screened_at
)
SELECT
  ('a0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  '10000000-0000-4000-8000-000000000001',
  ('70000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  CASE n
    WHEN 1 THEN '30000000-0000-4000-8000-000000000001'::uuid
    WHEN 2 THEN '30000000-0000-4000-8000-000000000002'::uuid
    WHEN 3 THEN '30000000-0000-4000-8000-000000000003'::uuid
    WHEN 4 THEN '30000000-0000-4000-8000-000000000004'::uuid
    WHEN 5 THEN '30000000-0000-4000-8000-000000000005'::uuid
    WHEN 6 THEN '30000000-0000-4000-8000-000000000006'::uuid
    WHEN 7 THEN '30000000-0000-4000-8000-000000000002'::uuid
    WHEN 8 THEN '30000000-0000-4000-8000-000000000003'::uuid
    WHEN 9 THEN '30000000-0000-4000-8000-000000000005'::uuid
    WHEN 10 THEN '30000000-0000-4000-8000-000000000001'::uuid
    WHEN 11 THEN '30000000-0000-4000-8000-000000000004'::uuid
    WHEN 12 THEN '30000000-0000-4000-8000-000000000008'::uuid
    ELSE '30000000-0000-4000-8000-000000000007'::uuid
  END,
  'OFAC_SDN',
  (SELECT id FROM list_versions WHERE source_code = 'OFAC_SDN' AND status = 'ACTIVE' ORDER BY fetched_at DESC LIMIT 1),
  CASE WHEN n = 12 THEN 'CONFIRMED_HIT' ELSE 'CLEAR' END,
  CASE WHEN n = 12 THEN 100 ELSE 0 END,
  CASE WHEN n = 12 THEN (
    SELECT se.id FROM sanctions_entries se
    WHERE se.source_code = 'OFAC_SDN' AND se.is_current = TRUE
    ORDER BY se.id LIMIT 1
  ) ELSE NULL END,
  CASE WHEN n = 12 THEN (
    SELECT sen.raw_name FROM sanctions_entry_names sen
    JOIN sanctions_entries se ON se.id = sen.entry_id
    WHERE se.source_code = 'OFAC_SDN' AND se.is_current = TRUE
    ORDER BY sen.id LIMIT 1
  ) ELSE NULL END,
  now() - make_interval(hours => 14 - n)
FROM generate_series(1, 13) n
ON CONFLICT (id) DO NOTHING;

INSERT INTO classification_results (
  id, tenant_id, product_id, case_id, agent_version_id, control_list_version_id,
  eccn, is_ear99, confidence, reasoning, candidates_considered, rejection_reasons,
  requires_revalidation, confirmed_by, status, requires_human_review,
  cited_entry, cached, completed_at, created_at
)
SELECT
  ('b0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  '10000000-0000-4000-8000-000000000001',
  CASE n
    WHEN 5 THEN '40000000-0000-4000-8000-000000000004'::uuid
    WHEN 6 THEN '40000000-0000-4000-8000-000000000003'::uuid
    WHEN 7 THEN '40000000-0000-4000-8000-000000000002'::uuid
    WHEN 8 THEN '40000000-0000-4000-8000-000000000003'::uuid
    WHEN 9 THEN '40000000-0000-4000-8000-000000000004'::uuid
    WHEN 10 THEN '40000000-0000-4000-8000-000000000001'::uuid
    WHEN 11 THEN '40000000-0000-4000-8000-000000000002'::uuid
    WHEN 12 THEN '40000000-0000-4000-8000-000000000004'::uuid
    ELSE '40000000-0000-4000-8000-000000000005'::uuid
  END,
  ('70000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  (SELECT id FROM agent_versions WHERE agent_code = 'CLASSIFIER_REASONING' AND status = 'PUBLISHED' ORDER BY published_at DESC LIMIT 1),
  (SELECT id FROM control_list_versions WHERE regime = 'EAR' AND is_current = TRUE AND status = 'ACTIVE' LIMIT 1),
  CASE n WHEN 5 THEN '3A001' WHEN 6 THEN '5A002' WHEN 7 THEN '7A003' WHEN 8 THEN '5A002' WHEN 9 THEN '3A001' WHEN 11 THEN '7A003' WHEN 12 THEN '3A001' ELSE NULL END,
  n = 10,
  CASE WHEN n = 5 THEN 55 WHEN n = 13 THEN 25 ELSE 94 END,
  CASE
    WHEN n = 5 THEN 'Classification processing is in progress for the 3A001 candidate set.'
    WHEN n = 10 THEN 'The general-purpose industrial pump does not meet a supplied CCL entry and is classified EAR99.'
    WHEN n = 13 THEN 'Technical specifications are incomplete; clock rate, cryptographic functionality, and performance thresholds are not available.'
    ELSE 'Supplied technical parameters meet the cited Commerce Control List entry thresholds.'
  END,
  CASE
    WHEN n IN (5, 9, 12) THEN ARRAY['3A001']
    WHEN n = 10 THEN ARRAY[]::text[]
    WHEN n = 13 THEN ARRAY['3A001', '5A002']
    WHEN n IN (6, 8) THEN ARRAY['5A002']
    ELSE ARRAY['7A003']
  END,
  CASE WHEN n = 13 THEN '{"3A001":"clock frequency missing","5A002":"cryptographic capability missing"}'::jsonb ELSE '{}'::jsonb END,
  FALSE,
  CASE WHEN n >= 6 THEN '20000000-0000-4000-8000-000000000004'::uuid ELSE NULL END,
  CASE WHEN n = 5 THEN 'PENDING' WHEN n = 10 THEN 'EAR99' WHEN n = 13 THEN 'INSUFFICIENT_INFORMATION' ELSE 'CLASSIFIED' END,
  n IN (5, 13),
  CASE n WHEN 5 THEN '3A001' WHEN 6 THEN '5A002' WHEN 7 THEN '7A003' WHEN 8 THEN '5A002' WHEN 9 THEN '3A001' WHEN 11 THEN '7A003' WHEN 12 THEN '3A001' ELSE NULL END,
  FALSE,
  CASE WHEN n = 5 THEN NULL ELSE now() - make_interval(hours => 13 - n) END,
  now() - make_interval(hours => 14 - n)
FROM generate_series(5, 13) n
ON CONFLICT (id) DO NOTHING;

INSERT INTO assessment_results (
  id, tenant_id, case_id, assessment_type, agent_version_id, score,
  reasoning, signals, regulatory_basis, catchall_triggered, requires_review
)
SELECT
  (
    CASE assessment_type WHEN 'END_USER' THEN 'c1000000' WHEN 'END_USE' THEN 'c2000000' ELSE 'c3000000' END
    || '-0000-4000-8000-' || lpad(n::text, 12, '0')
  )::uuid,
  '10000000-0000-4000-8000-000000000001',
  ('70000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  assessment_type,
  CASE assessment_type
    WHEN 'END_USER' THEN (SELECT id FROM agent_versions WHERE agent_code = 'END_USER' AND status = 'PUBLISHED' ORDER BY published_at DESC LIMIT 1)
    WHEN 'END_USE' THEN (SELECT id FROM agent_versions WHERE agent_code = 'END_USE' AND status = 'PUBLISHED' ORDER BY published_at DESC LIMIT 1)
    ELSE (SELECT id FROM agent_versions WHERE agent_code = 'RISK' AND status = 'PUBLISHED' ORDER BY published_at DESC LIMIT 1)
  END,
  CASE WHEN n = 12 THEN 100 WHEN n IN (9, 13) THEN 78 WHEN n IN (7, 11) THEN 58 ELSE 24 END,
  CASE
    WHEN n = 12 THEN 'A confirmed blocking sanctions match creates an unacceptable transaction risk.'
    WHEN n = 13 THEN 'Incomplete product specifications and an unclear ultimate application require enhanced review.'
    WHEN n = 9 THEN 'Destination and controlled electronics profile require officer review.'
    ELSE 'Entity, end-use, and transaction evidence are consistent with the declared commercial activity.'
  END,
  jsonb_build_object(
    'destination', (SELECT destination_country FROM compliance_cases WHERE id = ('70000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid),
    'screening', CASE WHEN n = 12 THEN 'CONFIRMED_HIT' ELSE 'CLEAR' END,
    'data_quality', CASE WHEN n = 13 THEN 'INCOMPLETE' ELSE 'SUFFICIENT' END
  ),
  'EAR Parts 732, 736, 738, 740 and applicable end-use controls',
  CASE WHEN n = 12 THEN 'PROHIBITED_PARTY' WHEN n = 13 THEN 'INSUFFICIENT_DATA' ELSE NULL END,
  n IN (9, 12, 13)
FROM generate_series(7, 13) n
CROSS JOIN (VALUES ('END_USER'), ('END_USE'), ('RISK')) types(assessment_type)
ON CONFLICT (case_id, assessment_type) DO NOTHING;

INSERT INTO licence_determinations (
  id, tenant_id, case_id, agent_version_id, outcome, exception_code,
  regulatory_basis, required_authority, reasoning
)
SELECT
  ('d0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  '10000000-0000-4000-8000-000000000001',
  ('70000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  (SELECT id FROM agent_versions WHERE agent_code = 'LICENCE' AND status = 'PUBLISHED' ORDER BY published_at DESC LIMIT 1),
  CASE
    WHEN n = 10 THEN 'NLR'
    WHEN n = 12 THEN 'PROHIBITED'
    WHEN n = 13 THEN 'INSUFFICIENT_INFORMATION'
    ELSE 'REQUIRED'
  END,
  NULL,
  CASE
    WHEN n = 10 THEN 'EAR99; no listed control identified for the stated transaction.'
    WHEN n = 12 THEN 'OFAC blocking sanctions and EAR General Prohibition Five.'
    ELSE 'EAR Commerce Country Chart and applicable NS/AT controls.'
  END,
  CASE WHEN n IN (7, 8, 9, 11) THEN 'BIS' WHEN n = 12 THEN 'OFAC' ELSE NULL END,
  CASE
    WHEN n = 10 THEN 'The industrial pump is EAR99 and the screened parties are clear.'
    WHEN n = 12 THEN 'The end user is a confirmed sanctions match; the transaction is prohibited.'
    WHEN n = 13 THEN 'A determination cannot be completed until technical specifications and ultimate end use are supplied.'
    ELSE 'The controlled classification and destination require authorization before export.'
  END
FROM generate_series(7, 13) n
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  record_row RECORD;
  previous_hash CHAR(64);
  new_hash CHAR(64);
BEGIN
  SELECT entry_hash INTO previous_hash
  FROM audit_events
  WHERE tenant_id = '10000000-0000-4000-8000-000000000001'
  ORDER BY sequence_no DESC, occurred_at DESC
  LIMIT 1;

  FOR record_row IN
    SELECT id, state, created_at
    FROM compliance_cases
    WHERE tenant_id = '10000000-0000-4000-8000-000000000001'
      AND id::text LIKE '70000000-0000-4000-8000-%'
      AND NOT EXISTS (
        SELECT 1 FROM audit_events ae
        WHERE ae.tenant_id = compliance_cases.tenant_id
          AND ae.case_id = compliance_cases.id
          AND ae.event_type = 'DEMO_CASE_CREATED'
      )
    ORDER BY created_at, id
  LOOP
    new_hash := repeat(md5(COALESCE(previous_hash, '') || record_row.id::text || 'DEMO_CASE_CREATED'), 2);
    INSERT INTO audit_events (
      id, tenant_id, case_id, event_type, actor_type, actor_id,
      before_state, after_state, rationale, occurred_at, prev_hash, entry_hash
    ) VALUES (
      gen_random_uuid(), '10000000-0000-4000-8000-000000000001',
      record_row.id, 'DEMO_CASE_CREATED', 'USER',
      '20000000-0000-4000-8000-000000000004',
      NULL, '{"state":"DRAFT"}', 'Realistic demonstration case seeded.',
      record_row.created_at, previous_hash, new_hash
    );
    previous_hash := new_hash;

    new_hash := repeat(md5(COALESCE(previous_hash, '') || record_row.id::text || record_row.state), 2);
    INSERT INTO audit_events (
      id, tenant_id, case_id, event_type, actor_type, actor_id,
      before_state, after_state, rationale, occurred_at, prev_hash, entry_hash
    ) VALUES (
      gen_random_uuid(), '10000000-0000-4000-8000-000000000001',
      record_row.id, 'DEMO_CASE_STATE_SET', 'USER',
      '20000000-0000-4000-8000-000000000002',
      '{"state":"DRAFT"}', jsonb_build_object('state', record_row.state),
      'Demonstration workflow state established.',
      GREATEST(record_row.created_at + interval '1 hour', now() - interval '1 hour'),
      previous_hash, new_hash
    );
    previous_hash := new_hash;
  END LOOP;
END;
$$;

COMMIT;