INSERT INTO workflow_transitions (
  from_state,
  to_state,
  required_role,
  guard_expression,
  requires_rationale,
  is_system_locked
) VALUES
  ('DRAFT', 'SCREENING', NULL, 'mandatory_fields_present', FALSE, FALSE),
  ('SCREENING', 'REVIEW_REQUIRED', NULL, 'possible_hit OR low_confidence OR unresolved_red_flag', FALSE, FALSE),
  ('SCREENING', 'BLOCKED', NULL, 'confirmed_sanctions_match OR comprehensive_embargo_without_licence', FALSE, TRUE),
  ('SCREENING', 'APPROVED', NULL, 'all_agents_clear AND no_rule_fired AND plan_permits_auto_clear', FALSE, TRUE),
  ('REVIEW_REQUIRED', 'ESCALATED', 'COMPLIANCE_OFFICER', 'requires_escalation', TRUE, FALSE),
  ('REVIEW_REQUIRED', 'APPROVED', 'COMPLIANCE_OFFICER', 'screening_complete AND classification_complete', TRUE, TRUE),
  ('REVIEW_REQUIRED', 'BLOCKED', 'COMPLIANCE_OFFICER', 'human_block_decision', TRUE, TRUE),
  ('ESCALATED', 'APPROVED', 'COMPLIANCE_OFFICER', 'screening_complete AND classification_complete', TRUE, TRUE),
  ('ESCALATED', 'BLOCKED', 'COMPLIANCE_OFFICER', 'senior_sign_off_refused', TRUE, TRUE),
  ('DRAFT', 'CLOSED', 'COMPLIANCE_OFFICER', 'case_abandoned_with_rationale', TRUE, FALSE),
  ('SCREENING', 'CLOSED', 'COMPLIANCE_OFFICER', 'case_abandoned_with_rationale', TRUE, FALSE),
  ('REVIEW_REQUIRED', 'CLOSED', 'COMPLIANCE_OFFICER', 'case_abandoned_with_rationale', TRUE, FALSE),
  ('ESCALATED', 'CLOSED', 'COMPLIANCE_OFFICER', 'case_abandoned_with_rationale', TRUE, FALSE)
ON CONFLICT (from_state, to_state) DO NOTHING;