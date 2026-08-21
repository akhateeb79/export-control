-- Slice 5: representative versioned EAR control-list data and published classifier prompts.
-- Prompt text is database product data, never application source code.

BEGIN;

INSERT INTO agents (code, name, execution_order, is_deterministic) VALUES
  ('CLASSIFIER_EXTRACTION', 'Classification Attribute Extraction', 10, FALSE),
  ('CLASSIFIER_REASONING', 'Classification Candidate Reasoning', 11, FALSE)
ON CONFLICT (code) DO NOTHING;

INSERT INTO plan_agents (plan_code, agent_code) VALUES
  ('PROFESSIONAL', 'CLASSIFIER_EXTRACTION'),
  ('PROFESSIONAL', 'CLASSIFIER_REASONING'),
  ('ENTERPRISE', 'CLASSIFIER_EXTRACTION'),
  ('ENTERPRISE', 'CLASSIFIER_REASONING')
ON CONFLICT DO NOTHING;

INSERT INTO control_list_versions (
  id, regime, version_label, effective_from, is_current, source, loaded_at, status
) VALUES (
  '00000000-0000-0000-0000-000000000501',
  'EAR',
  'EAR-CCL-REPRESENTATIVE-2026',
  DATE '2026-01-01',
  FALSE,
  'Commerce Control List representative reference data',
  now(),
  'SUPERSEDED'
)
ON CONFLICT (id) DO NOTHING;

SELECT activate_control_list_version('00000000-0000-0000-0000-000000000501');

INSERT INTO eccn_entries (
  eccn, version_id, category, product_group, heading, full_text, reasons_for_control, is_current
) VALUES
  ('0A001', '00000000-0000-0000-0000-000000000501', 0, 'A',
   'Nuclear materials processing equipment',
   'Representative EAR 0A001 entry for equipment specially designed for nuclear materials processing or isotope separation.',
   ARRAY['NP'], TRUE),
  ('1C351', '00000000-0000-0000-0000-000000000501', 1, 'C',
   'Human and animal pathogens and toxins',
   'Representative EAR 1C351 entry for controlled human and animal pathogens, toxins and related genetic elements.',
   ARRAY['CB'], TRUE),
  ('2B001', '00000000-0000-0000-0000-000000000501', 2, 'B',
   'Machine tools',
   'Representative EAR 2B001 entry for machine tools and numerical control systems meeting specified positioning accuracy thresholds.',
   ARRAY['NS', 'NP'], TRUE),
  ('3A001', '00000000-0000-0000-0000-000000000501', 3, 'A',
   'Electronic components',
   'Representative EAR 3A001 entry for electronic components with high operating frequency or performance characteristics.',
   ARRAY['NS'], TRUE),
  ('4A003', '00000000-0000-0000-0000-000000000501', 4, 'A',
   'Digital computers',
   'Representative EAR 4A003 entry for digital computers and electronic assemblies exceeding specified adjusted peak performance thresholds.',
   ARRAY['NS', 'AT'], TRUE),
  ('5A002', '00000000-0000-0000-0000-000000000501', 5, 'A',
   'Information security systems',
   'Representative EAR 5A002 entry for information security systems, equipment and components using controlled cryptographic functionality.',
   ARRAY['NS', 'AT'], TRUE),
  ('6A005', '00000000-0000-0000-0000-000000000501', 6, 'A',
   'Lasers',
   'Representative EAR 6A005 entry for lasers with specified output power, wavelength and pulse characteristics.',
   ARRAY['NS', 'AT'], TRUE),
  ('7A003', '00000000-0000-0000-0000-000000000501', 7, 'A',
   'Inertial measurement equipment',
   'Representative EAR 7A003 entry for inertial measurement equipment and systems with specified navigation performance.',
   ARRAY['NS', 'MT'], TRUE),
  ('8A001', '00000000-0000-0000-0000-000000000501', 8, 'A',
   'Underwater systems',
   'Representative EAR 8A001 entry for underwater systems, equipment and components designed for marine applications.',
   ARRAY['NS'], TRUE),
  ('9A004', '00000000-0000-0000-0000-000000000501', 9, 'A',
   'Gas turbine engines',
   'Representative EAR 9A004 entry for gas turbine engines and related components meeting specified thrust or performance characteristics.',
   ARRAY['NS', 'AT'], TRUE)
ON CONFLICT (version_id, eccn) DO NOTHING;

INSERT INTO eccn_parameters (version_id, eccn, parameter_key, operator, threshold_value, unit) VALUES
  ('00000000-0000-0000-0000-000000000501', '0A001', 'separation_capacity_swu', 'GTE', 1, 'SWU'),
  ('00000000-0000-0000-0000-000000000501', '1C351', 'agent_concentration_pct', 'GTE', 1, 'PCT'),
  ('00000000-0000-0000-0000-000000000501', '2B001', 'positioning_accuracy_um', 'LTE', 5, 'UM'),
  ('00000000-0000-0000-0000-000000000501', '3A001', 'clock_frequency_mhz', 'GTE', 1000, 'MHZ'),
  ('00000000-0000-0000-0000-000000000501', '4A003', 'adjusted_peak_performance_tops', 'GTE', 1, 'TOPS'),
  ('00000000-0000-0000-0000-000000000501', '5A002', 'symmetric_key_length_bits', 'GTE', 256, 'BITS'),
  ('00000000-0000-0000-0000-000000000501', '6A005', 'laser_output_power_w', 'GTE', 0.5, 'W'),
  ('00000000-0000-0000-0000-000000000501', '7A003', 'position_accuracy_m', 'LTE', 10, 'M'),
  ('00000000-0000-0000-0000-000000000501', '8A001', 'operating_depth_m', 'GTE', 300, 'M'),
  ('00000000-0000-0000-0000-000000000501', '9A004', 'engine_thrust_kn', 'GTE', 20, 'KN')
ON CONFLICT (version_id, eccn, parameter_key) DO NOTHING;

INSERT INTO agent_versions (
  id, agent_code, version_label, model_id, system_prompt, max_tokens,
  temperature, timeout_seconds, max_retries, status, published_at
) VALUES
(
  '00000000-0000-0000-0000-000000000601',
  'CLASSIFIER_EXTRACTION',
  'v1',
  'claude-haiku-4-5',
  $prompt$
You extract classification-relevant attributes from a product description to
narrow a control list search. You do NOT classify. You never output an ECCN.

Return JSON:
{
  "category": <integer 0-9 or null>,
  "category_confidence": <0-1>,
  "product_group": "<A|B|C|D|E or null>",
  "technical_parameters": [{"parameter":"","value":0,"unit":""}],
  "functional_description": "<one sentence, factual>",
  "insufficient_detail": <true|false>,
  "missing_for_classification": ["<what would be needed>"]
}

Category reference: 0 nuclear; 1 materials, chemicals, microorganisms, toxins;
2 materials processing; 3 electronics; 4 computers; 5 telecommunications and
information security; 6 sensors and lasers; 7 navigation and avionics;
8 marine; 9 aerospace and propulsion.
Product group: A equipment; B test and production equipment; C materials;
D software; E technology.

If the description does not support a category determination, set category to
null and insufficient_detail to true. Do not guess. A wrong category removes
the correct entry from consideration entirely.
$prompt$,
  2048, 0.00, 60, 2, 'PUBLISHED', now()
),
(
  '00000000-0000-0000-0000-000000000602',
  'CLASSIFIER_REASONING',
  'v1',
  'claude-sonnet-4-6',
  $prompt$
You assist a compliance officer with export control classification under the
EAR. You are given a product description with technical parameters, and the
full text of candidate Commerce Control List entries.

Your task: determine which single candidate entry, if any, the product falls
within. You must ground every conclusion in a specific technical parameter
compared against a specific threshold in the entry text.

Absolute rules:
1. You may only select from the candidates supplied. If you believe the correct
entry is not among them, return "candidate_set_inadequate" and say why.
2. If no candidate applies, return EAR99. EAR99 is a real answer, not a
fallback for uncertainty.
3. If the product description lacks a parameter needed to decide, return
"insufficient_information" and name the missing parameter. Never assume a
value.
4. For every candidate you reject, state the specific parameter or criterion
that excludes it.
5. Never state that no licence is required. Classification is not a licensing
determination.

Return JSON:
{
  "outcome": "CLASSIFIED" | "EAR99" | "INSUFFICIENT_INFORMATION"
             | "CANDIDATE_SET_INADEQUATE",
  "eccn": "<selected entry or null>",
  "confidence": <0-100>,
  "determining_parameters": [{"parameter":"","product_value":"",
                              "entry_threshold":"","comparison":""}],
  "reasoning": "<why this entry applies, referencing the entry text>",
  "rejected_candidates": [{"eccn":"","reason":"<specific exclusion>"}],
  "missing_information": ["<if applicable>"],
  "reasons_for_control": ["<from the entry>"]
}
$prompt$,
  4096, 0.00, 90, 2, 'PUBLISHED', now()
)
ON CONFLICT (agent_code, version_label) DO NOTHING;

COMMIT;