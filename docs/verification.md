# Verification Checks

Run the checks for a slice before starting the next one. Every check is a thing that should
**fail**. If any of them succeeds, you have a compliance defect.

---

## After Slice 1 — Schema

```sql
-- 1. RLS is enabled and forced on every tenant table
SELECT tablename, rowsecurity, relforcerowsecurity
FROM pg_tables t JOIN pg_class c ON c.relname = t.tablename
WHERE schemaname = 'public' AND EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_name = t.tablename AND column_name = 'tenant_id'
);
-- Every row must show true, true.

-- 2. Audit table rejects modification
SET LOCAL app.tenant_id = '<tenant-a>';
UPDATE audit_events SET rationale = 'tampered' WHERE id = (SELECT id FROM audit_events LIMIT 1);
-- Must affect 0 rows.
DELETE FROM audit_events WHERE id = (SELECT id FROM audit_events LIMIT 1);
-- Must affect 0 rows.

-- 3. Cross-tenant read returns nothing
SET LOCAL app.tenant_id = '<tenant-a>';
SELECT count(*) FROM compliance_cases WHERE tenant_id = '<tenant-b>';
-- Must return 0, not an error and not a row count.

-- 4. Platform role cannot write
SET ROLE platform_readonly;
INSERT INTO compliance_cases (id, tenant_id, case_ref, state, destination_country,
  stated_end_use, retention_until)
VALUES (gen_random_uuid(), '<tenant-a>', 'X', 'DRAFT', 'AE', 'test', '2031-01-01');
-- Must raise a permission error.

-- 5. Assessment results cannot hold a combined score
\d assessment_results
-- Must show assessment_type and a UNIQUE constraint on (case_id, assessment_type).
-- There must be no column capable of storing a blended party risk value.
```

---

## After Slice 2 — Ingestion

- Run the sync twice against unchanged source data. The second run must detect no change via
  content hash and create no new version row.
- Corrupt a source file and run. The prior version must remain `ACTIVE`, a failure must be
  recorded, and the freshness indicator must report stale.
- Confirm every source normalises into the same `sanctions_entries` shape. The matcher must
  not be able to tell which list a row came from.
- Confirm `list_versions` records added, removed and changed counts.

---

## After Slice 3 — Matching

Test names that must match each other:

```
Abdul Rahman / Abdulrahman / Abd al-Rahman / Abdel Rahman
Mohammed / Mohammad / Muhammad / Mohamed
Al-Hassan / Alhassan / El Hassan / Hassan
Gulf Trading LLC / Gulf Trading L.L.C. / Gulf Trading FZE / Gulf Trading
Abu Dhabi / Abou Dhabi / Abo Dhabi
```

Each group must produce scores above the possible-hit threshold within the group.

- Confirm the triggering variant is recorded on every result, not just the score.
- Confirm a full-index screening of six parties completes in under three seconds.
- Confirm no model call occurs anywhere in the screening path.

---

## After Slice 4 — Sanctions Agent

```
-- Attempt to approve a case with a confirmed hit
POST /api/v1/cases/{blocked-case-id}/decision  { "decision": "APPROVE" }
-- Must return IMMUTABLE_RULE. Try as every role including the most senior. All must fail.

-- Attempt to approve a case with no screening record
POST /api/v1/cases/{fresh-case-id}/decision  { "decision": "APPROVE" }
-- Must return IMMUTABLE_RULE.

-- Confirm CLEAR results are written
SELECT count(*) FROM screening_results WHERE status = 'CLEAR';
-- Must be greater than zero after any clean case.

-- Attempt to set a tenant threshold below the platform floor
PATCH /api/v1/admin/tenants/{id}/thresholds { "SANCTIONS_CONFIRMED": 60 }
-- Must be rejected with the floor value in the response.
```

---

## After Slice 5 — Classification

- Submit a product description missing a determining parameter. The agent must return
  `INSUFFICIENT_INFORMATION` and name the parameter. It must not guess.
- Submit a product whose correct entry is deliberately excluded from the candidate set.
  The agent must return `CANDIDATE_SET_INADEQUATE`, not the nearest available entry.
- Submit a clearly uncontrolled commodity. Must return EAR99, not a low-confidence guess.
- Confirm every result records `agent_version_id` and `control_list_version_id`.
- Bump the control list version. Every prior classification must be flagged
  `requires_revalidation` and must not be reusable until confirmed.
- Run the golden set. Zero tolerance: no controlled item returned as uncontrolled.

---

## After Slice 6 — Licence Determination

- Confirm three separate rows appear in `assessment_results` per case: `END_USER`,
  `END_USE`, `RISK`. Each with its own score and reasoning.
- Submit an uncontrolled item with a catch-all end use. Must return `LICENCE_REQUIRED`
  and state explicitly that classification does not exempt it.
- Submit a case qualifying for a licence exception with one condition unevidenced. That
  condition must be `UNVERIFIABLE`, and the exception must not be declared available.
- Grep every agent output for prohibited phrasing:

```bash
grep -rniE "no licence is required|is compliant|you may proceed|the party is clean" \
  --include="*.json" --include="*.ts" --include="*.js" .
```

Must return nothing.

---

## After Slice 7 — Workflow and Entitlement

- Attempt a workflow transition not present in `workflow_transitions`. Must be rejected.
- Attempt to modify a transition row where `is_system_locked` is true. Must be rejected
  by trigger.
- Call an agent endpoint as a tenant whose plan excludes that agent, **via the API not the
  UI**. Must return `ENTITLEMENT_DENIED`.
- Exhaust a tenant's case allowance, then submit a screening. **It must succeed** and create
  an overage record. Screening is never blocked for a commercial reason.
- Suspend a tenant. Historical records must remain readable; new case creation must fail.

---

## After Slice 8 — Frontend

- Confirm no approve control renders on a blocked case, for any role.
- Confirm end user and end use display as separate scores with separate reasoning, never
  as one figure.
- Confirm every agent result displays its reasoning and its citation.
- Confirm the decision-support disclaimer appears on the case view and on the report.
- Confirm the vendor access log is visible to the client.
- Confirm a stale list produces a visible warning on every screening result.

---

## Continuous

- Every audit write happens inside the same transaction as the action it records. Force an
  audit write failure and confirm the business operation rolls back with it.
- No `localStorage`, `sessionStorage` or other browser storage holds compliance data.
- No agent prompt appears in any source file.
