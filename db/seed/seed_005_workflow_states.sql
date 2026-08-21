INSERT INTO workflow_states (code, label_key, is_terminal, is_editable) VALUES
  ('DRAFT', 'workflow.state.draft', FALSE, TRUE),
  ('SCREENING', 'workflow.state.screening', FALSE, FALSE),
  ('REVIEW_REQUIRED', 'workflow.state.review_required', FALSE, TRUE),
  ('ESCALATED', 'workflow.state.escalated', FALSE, TRUE),
  ('APPROVED', 'workflow.state.approved', TRUE, FALSE),
  ('BLOCKED', 'workflow.state.blocked', TRUE, FALSE),
  ('CLOSED', 'workflow.state.closed', TRUE, FALSE)
ON CONFLICT (code) DO NOTHING;