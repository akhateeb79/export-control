-- Anthropic Messages API requires the dated Haiku 4.5 identifier.
-- Preserve the original published configuration for auditability and publish v2.
BEGIN;

INSERT INTO agent_versions (
  id, agent_code, version_label, model_id, system_prompt, max_tokens,
  temperature, timeout_seconds, max_retries, status, published_at
)
SELECT
  '00000000-0000-0000-0000-000000000603'::uuid,
  agent_code,
  'v2',
  'claude-haiku-4-5-20251001',
  system_prompt,
  max_tokens,
  temperature,
  timeout_seconds,
  max_retries,
  'PUBLISHED',
  now()
FROM agent_versions
WHERE id = '00000000-0000-0000-0000-000000000601'::uuid
ON CONFLICT (agent_code, version_label) DO NOTHING;

COMMIT;