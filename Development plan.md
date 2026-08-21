# Export Control & Trade Compliance Platform
## Comprehensive Development Plan — Replit
### Solutions Architect + UX/UI Guidance

**Last updated:** August 2026
**Status:** Pre-build — ready to start Slice 1
**Repo:** github.com/akhateeb79/export-control

---

## Platform Summary

Multi-tenant SaaS for Gulf re-export companies (UAE first, then KSA/Oman) to prove compliance
with US EAR, OFAC, and EU dual-use controls. The platform recommends and evidences.
The compliance officer determines.

**Stack:** Node + Express (REST API) · React (frontend) · Python + rapidfuzz (matching microservice)
· PostgreSQL + pg_trgm · Anthropic API (model calls)
· Sanctions screening is deterministic — zero model calls, ever.

**Nine agents:** Product Classification → Sanctions Screening → End User Assessment →
End Use Assessment → Risk Assessment → Licence Decision → Document Intelligence →
Audit & Monitoring → Compliance Intelligence. Orchestrator coordinates.

**Ten non-negotiable rules (from AGENTS.md):**
1. Confirmed sanctions match = permanent block. No override for any role.
2. Comprehensively embargoed destination = block unless a licence record exists.
3. No case reaches APPROVED without a screening record AND a classification record.
4. Audit rows are append-only. No UPDATE, DELETE, soft-delete, or cleanup job. Ever.
5. Hard rules evaluate before any weighted scoring.
6. platform_readonly role has SELECT only on tenant compliance tables. Never INSERT/UPDATE/DELETE.
7. Tenant threshold may be stricter than platform floor, never looser.
8. End user and end use assessments are NEVER combined into one score or one row.
9. Records cannot be deleted before their retention date.
10. Every screening result is written to the audit trail — including CLEAR results.

---

## Replit Environment Setup (Do Before Slice 1)

**Project structure:**
```
export-control/
├── api/              ← Node + Express
├── client/           ← React (Vite)
├── services/
│   └── matching/     ← Python + rapidfuzz (internal port 5001 only)
├── jobs/
│   └── ingest/       ← List ingestion scripts
├── db/
│   ├── migrations/   ← Immutable once applied
│   └── seed/         ← Reference data
├── docs/             ← Read-only specs
├── Dockerfile        ← Required by AGENTS.md for portability
├── .replit
└── replit.nix
```

**Replit Secrets (never in code):**
```
DATABASE_URL
ANTHROPIC_API_KEY
JWT_SECRET
JWT_REFRESH_SECRET
MATCHING_SERVICE_URL=http://localhost:5001
INGEST_SCHEDULE=0 2 * * *
LIST_FRESHNESS_HOURS=48
```

**Three concurrent processes in .replit:**
- Express API → port 3000 (externally accessible)
- Vite React dev server → port 5173 (externally accessible)
- Python matching service → port 5001 (internal only, never expose publicly)

---

## Build Slices — Status Tracker

| Slice | Name | Status | Verified |
|-------|------|--------|----------|
| Setup | Replit environment | ⬜ Pending | — |
| 1 | Schema & Migrations | ⬜ Pending | ⬜ |
| 2 | List Ingestion Pipeline | ⬜ Pending | ⬜ |
| 3 | Name Matching Service | ⬜ Pending | ⬜ |
| 4 | Sanctions Agent + API Foundation | ⬜ Pending | ⬜ |
| 5 | Knowledge Base + Classification Agent | ⬜ Pending | ⬜ |
| 6 | Licence Determination Agent | ⬜ Pending | ⬜ |
| 7 | Workflow, Entitlement + Admin | ⬜ Pending | ⬜ |
| 8 | React Frontend | ⬜ Pending | ⬜ |

Update status to ✅ Complete / 🔄 In Progress as work proceeds.

---

## SLICE 1 — Schema and Migrations

**Estimated duration:** 3–5 days
**Builds:** PostgreSQL schema, RLS policies, audit triggers, seed data. Zero application code.

### Migration order (mandatory):
1. Extensions: `pg_trgm`, `uuid-ossp`
2. Shared reference tables: countries, list_sources, lookup_types, lookup_values
3. Configuration tables: workflow_states, workflow_transitions, threshold_definitions, plans
4. Tenant tables: tenants, users, compliance_cases, screening_results, classification_results,
   assessment_results, licence_condition_evaluations
5. RLS policies on every tenant table — `FORCE ROW LEVEL SECURITY`
6. Triggers: append-only audit, threshold floor enforcement, is_system_locked guard
7. `platform_readonly` role — SELECT only on tenant compliance tables

### Key schema rules:
- UUIDv7 primary keys for audit tables (sequential, no volume leakage)
- UUID for all tenant transactional data
- Natural VARCHAR codes for reference/config tables
- Every tenant table: `tenant_id UUID NOT NULL` + foreign key to tenants
- `SET LOCAL app.tenant_id` inside transactions — NEVER a plain `SET`
- Monthly range partitioning on `audit_events`
- `UNIQUE(case_id, assessment_type)` on assessment_results — structural separation of END_USER/END_USE
- No column capable of storing a blended party risk value

### Build prompt (paste into Replit):
```
Read AGENTS.md and docs/05-technical-architecture.md sections 2 through 6.

Create the database schema as PostgreSQL migration files under db/migrations/.
Use the DDL in the document verbatim — do not redesign tables, rename columns, or change types.

Order the migrations: extensions first (pg_trgm), then shared reference tables,
then configuration tables, then tenant tables, then RLS policies, then triggers.

Requirements:
- Every tenant table gets tenant_id UUID NOT NULL and a foreign key to tenants
- Every tenant table gets RLS enabled AND forced, with the policy in section 6.1
- Audit tables use UUIDv7 primary keys with the sequence column, hash chain columns
  and monthly range partitioning from section 5.4
- Create a platform_readonly database role with SELECT only on tenant compliance
  tables — no INSERT, UPDATE or DELETE grants
- Add the rules and triggers that make audit rows append-only
- Add the trigger enforcing tenant thresholds against platform floors
- Add the trigger protecting is_system_locked workflow transitions

Also write db/seed/ with: countries, list_sources, workflow_states,
workflow_transitions, threshold_definitions, lookup_types and lookup_values,
plans, and agents. Seed data only — no application code yet.

Do not write any application code in this slice.
```

### Verification gate — ALL must pass before Slice 2:
```sql
-- 1. RLS enabled and forced on every tenant table
SELECT tablename, rowsecurity, relforcerowsecurity
FROM pg_tables t JOIN pg_class c ON c.relname = t.tablename
WHERE schemaname = 'public' AND EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_name = t.tablename AND column_name = 'tenant_id'
);
-- Every row must show true, true.

-- 2. Audit table rejects modification
UPDATE audit_events SET rationale = 'tampered' WHERE id = (SELECT id FROM audit_events LIMIT 1);
-- Must affect 0 rows.
DELETE FROM audit_events WHERE id = (SELECT id FROM audit_events LIMIT 1);
-- Must affect 0 rows.

-- 3. Cross-tenant read returns nothing
SET LOCAL app.tenant_id = '<tenant-a>';
SELECT count(*) FROM compliance_cases WHERE tenant_id = '<tenant-b>';
-- Must return 0.

-- 4. Platform role cannot write
SET ROLE platform_readonly;
INSERT INTO compliance_cases (...) VALUES (...);
-- Must raise permission error.

-- 5. Assessment results structure
\d assessment_results
-- Must show assessment_type and UNIQUE(case_id, assessment_type).
-- No column capable of storing a blended party risk value.
```

### Replit report to request after Slice 1:
```
Report: Slice 1 Complete
- List every migration file created with line count
- Run verification.md Slice 1 checks and show results
- Confirm pg_trgm is enabled
- Confirm platform_readonly role exists with correct grants
- Confirm no application code was written
- List any deviations from docs/05-technical-architecture.md DDL
```

---

## SLICE 2 — List Ingestion Pipeline

**Estimated duration:** 3–4 days
**Builds:** Standalone Node script under `jobs/ingest/` for OFAC SDN, OFAC Consolidated,
BIS Entity List, BIS Denied Persons, BIS Unverified List.

### Key implementation rules:
- SHA-256 the full payload first. If hash matches latest `list_versions` hash → record check, exit.
- Parse → normalise → diff → write `list_versions` → supersede prior → **one transaction**.
- On failure: prior version stays ACTIVE, failure recorded, freshness = STALE. Never discard good data.
- Name normalisation module is **shared with Slice 3**. Write once, import from both.
- Every source must normalise into identical `sanctions_entries` shape. Matcher cannot tell lists apart.
- Re-screening cascade: new list version → flag open and recently-approved affected cases.

### Build prompt:
```
Read docs/05-technical-architecture.md section 9.

Build the ingestion job as a standalone Node script under jobs/ingest/.

For each source in list_sources:
1. Fetch over HTTPS
2. SHA-256 the payload, compare against the latest list_versions row
3. If unchanged, record the check and exit
4. If changed, parse per the source format
5. Normalise into sanctions_entries, sanctions_entry_names, and
   sanctions_entry_identifiers — every source must produce the same shape
6. Diff against current to derive added, removed, changed counts
7. Insert the new list_versions row and supersede the prior one, in one transaction
8. Trigger the re-screening cascade in section 9.2

Write the name normalisation from section 7.2 as a shared module — slice 3 uses it too.

On fetch or parse failure: keep the prior version active, record the failure, set
the freshness indicator to stale. Do not throw away good data.
```

### Verification gate:
- Run sync twice against unchanged source. Second run creates no version row.
- Corrupt a source file. Prior version remains ACTIVE. Freshness = STALE.
- Confirm every source produces identical `sanctions_entries` schema.
- `list_versions` records added/removed/changed counts for each source.

### Replit report to request:
```
Report: Slice 2 Complete
- Run sync twice against unchanged source. Confirm second run creates no version row.
- Corrupt one source file. Confirm prior version remains ACTIVE and freshness = STALE.
- Show list_versions table with added/removed/changed counts.
- Confirm all sources produce identical sanctions_entries schema.
- Confirm name normalisation is extracted as a shared module.
```

---

## SLICE 3 — Name Matching Service

**Estimated duration:** 4–5 days
**Builds:** Python microservice at `services/matching/` — `POST /screen` on internal port 5001.
No model calls. Fully deterministic.

### Five-stage pipeline (implement in exact order):
1. **Normalise** — lowercase, diacritic strip, legal suffix removal (LLC, L.L.C., FZE, Ltd, Co.),
   honorific removal (Sheikh, Dr., H.E.), Arabic particle handling (Al-, El-, Abd al-)
2. **Generate variants** — deterministic Arabic-Latin transliteration table from
   docs/05-technical-architecture.md section 7.3. Not probabilistic — deterministic.
3. **Retrieve candidates** — PostgreSQL trigram similarity (pg_trgm). Retrieves, does not score.
4. **Score** — rapidfuzz: token_set_ratio, token_sort_ratio, JaroWinkler. All three, all variants.
5. **Return** — maximum score, plus which variant and which algorithm produced it (compliance record).

### Replit-specific:
- Runs as separate Python process on localhost:5001. Never expose publicly.
- Express calls it via HTTP. All DB writes happen in Node API, not in matching service.
- Matching service has read access to `sanctions_entries` only.

### Name groups that must all cross the possible-hit threshold:
```
Abdul Rahman / Abdulrahman / Abd al-Rahman / Abdel Rahman
Mohammed / Mohammad / Muhammad / Mohamed
Al-Hassan / Alhassan / El Hassan / Hassan
Gulf Trading LLC / Gulf Trading L.L.C. / Gulf Trading FZE / Gulf Trading
Abu Dhabi / Abou Dhabi / Abo Dhabi
```

### Build prompt:
```
Read docs/05-technical-architecture.md section 7.

Build a Python service under services/matching/ exposing POST /screen on an internal
port. Input: a name, its script, and optional country. Output: scored candidates.

Implement the five-stage pipeline exactly:
1. Normalise — the rules in 7.2, including legal suffixes and honorifics
2. Generate variants — the Arabic transliteration table in 7.3 as a
   deterministic substitution table, plus the particle rules
3. Retrieve candidates by trigram similarity in PostgreSQL
4. Score with rapidfuzz: token_set_ratio, token_sort_ratio, JaroWinkler
5. Return the maximum across all variants and algorithms, plus which variant
   and which algorithm produced it

No model call anywhere in this service. It is deterministic by design.

Include a test file covering the name groups in docs/verification.md slice 3.
```

### Verification gate:
- All 5 name groups score above possible-hit threshold within each group.
- Triggering variant recorded on every result, not just the score.
- 6-party full screening completes in under 3 seconds.
- Zero model calls anywhere in the matching service (grep confirms).

### Replit report to request:
```
Report: Slice 3 Complete
- Run all 5 name groups from verification.md. Show score for each variant pair.
- Confirm every result records the triggering variant.
- Benchmark: screen 6 parties. Show elapsed time (must be < 3 seconds).
- grep for any model API call in services/matching/. Show zero results.
- Show transliteration variant table is code, not trained weights.
```

---

## SLICE 4 — Sanctions Agent + API Foundation

**Estimated duration:** 5–7 days
**Builds:** Express API with full middleware chain, JWT auth, tenant context middleware,
sanctions screening agent. First live API endpoints.

### Middleware chain order (fixed — implement exactly):
1. Rate limiting
2. Request ID generation
3. JWT verification
4. Tenant resolution
5. **`SET LOCAL app.tenant_id` inside transaction start** ← critical
6. Entitlement check
7. Business logic
8. **Audit write inside same transaction as step 5** ← steps 5 and 8 are ONE transaction
9. Transaction commit
10. Response

### Immutable rule guards (run before any scoring):
- Rule 1: Confirmed hit → BLOCKED. `POST /cases/:id/decision {decision:"APPROVE"}` returns
  `IMMUTABLE_RULE` for every role including the most senior. No exceptions.
- Rule 2: Embargoed destination → BLOCKED unless licence record exists.
- Rule 3: No APPROVED without screening record AND classification record.
- Rule 10: Every result including CLEAR written to audit trail with list version and sync date.

### Endpoints for this slice only:
`POST /auth/login` · `POST /auth/refresh` · `POST /cases` · `POST /cases/:id/submit`
· `GET /cases/:id` · `GET /cases`

### Build prompt:
```
Read AGENTS.md and docs/05-technical-architecture.md section 10, plus
docs/04-functional-spec.md sections 2, 3 and 5.

Build the Express API foundation with the middleware chain from section 10.1,
in that exact order. Steps 3 and 8 must be inside one transaction — if the audit
write fails, the business operation rolls back.

Tenant context uses SET LOCAL inside the transaction, in middleware, once.
Never a plain SET.

Then build the sanctions screening agent:
- Retrieve every party on the case including client-supplied beneficial owners
- Call the matching service for each
- Classify against tenant thresholds
- Write every result including CLEAR to screening_results and audit_events
- Record list version and sync date on every result

Implement immutable rules 1, 2, 3 and 10 from AGENTS.md as guards that run before
any scoring. A confirmed hit must be unapprovable through the API by any role.

Endpoints for this slice only: auth, case create, case submit, case get, case list.
```

### Verification gate:
- `POST /cases/{blocked-id}/decision {decision:"APPROVE"}` as every role → all return `IMMUTABLE_RULE`.
- `POST /cases/{fresh-id}/decision` (no screening record) → `IMMUTABLE_RULE`.
- `SELECT count(*) FROM screening_results WHERE status = 'CLEAR'` → > 0 after clean case.
- `PATCH thresholds below platform floor` → rejected with floor value in response.
- Force audit write failure → business operation rolls back.
- `grep "SET app.tenant_id"` (non-LOCAL) → zero results.

### Replit report to request:
```
Report: Slice 4 Complete
- POST /cases/{blocked-id}/decision {"decision":"APPROVE"} as every role. Show all return IMMUTABLE_RULE.
- POST /cases/{fresh-id}/decision (no screening record). Show IMMUTABLE_RULE.
- SELECT count(*) FROM screening_results WHERE status = 'CLEAR'. Show > 0 after clean case.
- PATCH thresholds below platform floor. Show rejection with floor value in response.
- Force an audit write failure. Show the business operation rolled back.
- grep for plain SET (non-LOCAL) for tenant_id. Show zero results.
```

---

## SLICE 5 — Knowledge Base + Classification Agent

**Estimated duration:** 5–7 days
**Builds:** ECCN control list in database, three-stage classification pipeline using Anthropic API.

### Three-stage pipeline:
**Stage 1 — Attribute extraction (cheap model, e.g. claude-haiku-4-5):**
- Prompt comes from `agent_versions` table — never from code.
- May return `null` for category. A wrong category removes the correct entry permanently.
  Null is correct. Guess is a defect.

**Stage 2 — SQL candidate filtering (no model call):**
- Filter `eccn_entries` to 5–10 candidates using Stage 1 attributes.
- Zero candidates surviving → route to human classification. Never call Stage 3 with empty set.

**Stage 3 — Reasoning (capable model, e.g. claude-sonnet-4-6):**
- Input: full text of 5–10 candidates only + product description.
- Output: ECCN, confidence, reasoning, cited entry, rejected candidates with reasons.

### Cache invalidation:
New control list version → all prior `classification_results` flagged `requires_revalidation`.
Not reusable until compliance officer confirms against new version.

### UX note for Slice 8:
Low-confidence extraction fields → yellow highlight + mandatory confirmation checkbox.
Confidence threshold is configurable (Rules & Thresholds module), not hardcoded.

### Build prompt:
```
Read docs/05-technical-architecture.md section 8 and docs/06-agent-design.md section 5.

First, load the control list into eccn_entries and eccn_parameters.

Then build the three-stage classification pipeline:
- Stage 1: attribute extraction using the cheap model. Prompt from the database, not code.
  It must be able to return null category.
- Stage 2: SQL filtering to five to ten candidates. No model call.
- Stage 3: reasoning over candidate full text using the capable model.

Zero candidates surviving stage 2 routes to human classification. Never call
stage 3 with an empty or guessed candidate set.

Store results in classification_results with agent_version_id and
control_list_version_id. Implement cache invalidation: a control list version
change flags every prior classification for revalidation.

Seed agent_versions with the prompts from docs/06-agent-design.md. Prompts go in
the database. Do not inline them.
```

### Verification gate:
- Product missing determining parameter → `INSUFFICIENT_INFORMATION` naming the parameter.
- Product with correct entry excluded from candidates → `CANDIDATE_SET_INADEQUATE` (not guessed).
- Clearly uncontrolled commodity → EAR99.
- Bump control list version → all prior results flagged `requires_revalidation`.
- Every result records `agent_version_id` and `control_list_version_id`.
- `grep` for prompt text in source files → zero results.
- Golden test set: zero controlled items returned as uncontrolled.

---

## SLICE 6 — Licence Determination Agent

**Estimated duration:** 5–6 days
**Builds:** Licence determination service with three internal modules producing three separate
database rows per case.

### Three modules — three rows in assessment_results:

**END_USER module:**
Assesses buyer legitimacy: entity existence, trade licence verifiability, address type,
web presence, ownership transparency, technical plausibility, prior conduct.
Returns its own score, reasoning, unresolved red flags.

**END_USE module:**
Assesses plausibility of stated use vs. quantity/configuration/destination.
Evaluates catch-all triggers independently: nuclear, missile/UAV, chemical/biological,
military end use in specified countries, advanced computing.
CRITICAL: catch-all applies to EAR99 items. Must be stated explicitly in reasoning.

**RISK module:**
Deterministic immutable rules first. If any fired earlier, this module is skipped.
Then weighted scoring over all inputs.

### Licence logic:
- Every exception condition evaluated individually: MET, UNMET, or UNVERIFIABLE.
- UNVERIFIABLE ≠ MET. Never assume met because probable.
- Catch-all from END_USE → LICENCE_REQUIRED regardless of classification.

### Prohibited output phrasing (grep must return zero):
```bash
grep -rniE "no licence is required|is compliant|you may proceed|the party is clean" .
```

Correct alternatives:
- "no licence appears required on the basis of X, subject to compliance officer confirmation"
- "no prohibition was identified in the checks performed"
- "no blocking condition was identified"
- "no match was found against the lists screened, at version X"

### Build prompt:
```
Read docs/06-agent-design.md sections 6, 7 and 8.

Build the licence determination service. It runs three internal modules and each
writes its own row to assessment_results:
- END_USER — the prompt in section 6
- END_USE — the prompt in section 7
- RISK — deterministic rules first, then weighted scoring

These three are separate calls producing separate scores, separate reasoning and
separate audit entries. There is no combined party risk value anywhere.

Then licence logic per section 8. Every exception condition is evaluated
individually against licence_exception_conditions and recorded as MET, UNMET or
UNVERIFIABLE in licence_condition_evaluations. Never mark a condition MET because
it is probable.

A catch-all trigger from END_USE forces LICENCE_REQUIRED regardless of
classification, including for unclassified items. State that explicitly in reasoning.

Enforce the prohibited output phrasing from AGENTS.md.
```

### Verification gate:
- 3 rows in `assessment_results` per case: END_USER, END_USE, RISK — each with own score/reasoning.
- Uncontrolled item + catch-all end use → LICENCE_REQUIRED with explicit statement.
- Exception case with unevidenced condition → UNVERIFIABLE on that condition.
- Prohibited phrasing grep → zero results.
- No combined party risk value in any table column.

---

## SLICE 7 — Workflow, Entitlement + Admin Modules

**Estimated duration:** 6–8 days
**Builds:** Configuration-driven workflow engine, entitlement middleware, all 12 admin modules.

### Workflow engine:
- States and transitions from database rows. Guard expressions in sandbox (never eval()).
- `is_system_locked` transitions protected by trigger from Slice 1.

### Entitlement enforcement:
- Middleware, not UI checks. API independently enforces entitlement regardless of UI state.
- Plan excludes agent → `ENTITLEMENT_DENIED` at API layer.

### Critical overage rule (counterintuitive — implement as specified):
- At 80% of allowance: warn in UI.
- At 100%: warn in UI.
- Above 100%: **continue serving, create overage record.**
- **NEVER block a screening for a commercial reason.** Ever.

### 12 Admin modules:
1. Lookups — all code lists, editable from platform dashboard
2. Messages — all user-facing strings, English + Arabic, no hardcoded text
3. Notifications — templates, triggers, in-app + email routing
4. Workflow — states and transitions editor
5. Rules & Thresholds — match thresholds, confidence bands, red flag weights (bounded by platform floors)
6. Agent Management — versioned prompts, draft/test/publish/rollback, performance monitoring
7. Subscription — plans, entitlements, usage metering, overage, invoicing state
8. Platform Roles & Permissions — vendor-side roles
9. Client User Management — tenant user creation and admin
10. Client Observation — client dashboards from platform side
11. CMS — landing page, editable without deployment
12. Audit & Access Log — immutable audit trail + vendor access log (visible to client)

### Vendor access log:
Every Super Admin or Platform Support view of tenant case content → logged to `vendor_access_log`.
Client Compliance Officer and Client Admin can see this log. Transparency feature.

### Build prompt:
```
Read docs/04-functional-spec.md sections 4, 5 and 9.

Build the configuration-driven workflow engine. States and transitions come from
the database. Guard expressions are evaluated in a sandbox.

Build entitlement enforcement as middleware, not UI checks.

Allowance behaviour: warn at 80%, warn at 100%, continue serving, create overage record.
Never block a screening for a commercial reason.

Then the platform admin modules: lookups, messages, notification rules, thresholds,
agent management with draft-test-publish and rollback, subscriptions, platform
roles, client user management.

Super admin reads tenant case content only after supplying a reason, and every read
writes to vendor_access_log. No write path to tenant compliance records for any
platform role — enforce at database grant level, not application code.
```

### Verification gate:
- Attempt transition not in `workflow_transitions` → rejected.
- Modify `is_system_locked` transition row → trigger rejection.
- Call agent endpoint as excluded-plan tenant via API → `ENTITLEMENT_DENIED`.
- Exhaust allowance, submit screening → succeeds, creates overage record.
- Suspend tenant → new case creation fails, historical records readable.
- `agent_versions` shows at least one PUBLISHED prompt and one DRAFT.
- No message string hardcoded in any source file.

---

## SLICE 8 — React Frontend

**Estimated duration:** 8–12 days
**Builds:** Complete React frontend — all screens from docs/04-functional-spec.md section 8.
English and Arabic (RTL).

### UX/UI Architecture Principles:

**Authentication:**
- MFA mandatory for Compliance Officer and above. Show it as security, not friction.
- Tenant name prominent post-login. Users must always know which entity they're in.

**Case creation (manual):**
- Red flag checklist is visually mandatory — structured checklist with 23-flag taxonomy.
- All field labels, placeholders, errors from Messages module. No hardcoded strings.
- Party entry supports multiple parties with role tags (Buyer, End User, Consignee,
  Freight Forwarder, Intermediary, Bank, Beneficial Owner).

**Document upload (UC-03):**
- Confidence bar per extracted field.
- Below confidence floor: yellow highlight + mandatory confirmation checkbox.
- Side-by-side layout: extracted form left, document preview right.

**Case view (most important screen):**
- Six assessments in **separate cards**: Classification, Sanctions (per party),
  End User, End Use, Risk, Licence Determination.
- Each card shows: score, confidence, reasoning (expandable), regulatory citation,
  agent version, list version (for sanctions).
- Stale list warning: amber banner on card and case header. Non-dismissible until re-screened.
- **No approve button on blocked case — for any role.** Button does not exist in DOM.
- Decision-support disclaimer at top of case view and on every generated report.

**Review queue:**
- Show triggering variant prominently on possible-hits — not just the score.
- Rationale field for overrides is mandatory before Approve/Override is available.

**Vendor access log:**
- Read-only table: timestamp, platform user role (not name), action, case reference.
- Prominent in Client Admin dashboard.

**Reports:**
- Include: case reference, all six assessment summaries, approver identity, timestamp,
  decision-support disclaimer on the document.

**Localisation:**
- Use CSS logical properties from the start (margin-inline-start, not margin-left).
- Arabic RTL layout. Arabic text renders correctly alongside English UI.

### Technical constraints:
- No `localStorage`, no `sessionStorage`, no browser storage for compliance data. React state only.
- All labels and messages from Messages module. No hardcoded strings.

### Build prompt:
```
Read docs/04-functional-spec.md section 8 and docs/08-system-flow.md.

Build the React frontend. Screens per section 8.

Rules:
- The case view shows six assessments separately, each with its own score,
  reasoning and citation. Never one blended figure.
- No approve control renders on a blocked case, for any role.
- The decision-support disclaimer appears on the case view and on the report.
- A stale list produces a visible warning on every screening result.
- Low-confidence extraction fields are visually distinct and mandatory to confirm.
- The vendor access log is visible to client roles.
- No browser storage holds compliance data. React state only.

All labels and messages come from the messages module, not hardcoded strings.
Support English and Arabic.
```

### Final verification gate:
- No approve control renders on blocked case (DOM inspection).
- End User and End Use display as separate cards with separate scores.
- Decision-support disclaimer appears on case view and generated report.
- Vendor access log visible to Compliance Officer and Client Admin.
- Stale list produces visible warning on screening results.
- `grep localStorage|sessionStorage client/src` → zero results.
- Sample 10 UI labels → all come from Messages module, none hardcoded.
- Run full `verification.md` continuous checks → all pass.

### Replit final report to request:
```
Report: Slice 8 Complete — Platform Ready for Pilot
- Confirm no approve control renders on a blocked case (DOM inspection).
- Confirm End User and End Use display as separate cards with separate scores.
- Confirm decision-support disclaimer appears on case view and generated report.
- Confirm vendor access log is visible to Compliance Officer and Client Admin.
- Confirm stale list produces visible warning on screening results.
- grep localStorage|sessionStorage in client/src. Show zero results.
- grep hardcoded string samples in client/src (10 UI labels). Show all from Messages module.
- Run full verification.md continuous checks. Show all pass.
```

---

## Continuous Verification Checks (Run Anytime)

These apply across all slices:

```bash
# 1. Audit write failure rolls back the business operation
# Force an audit write failure → confirm business operation rolled back

# 2. No browser storage holds compliance data
grep -r "localStorage\|sessionStorage" client/src
# Must return zero results

# 3. No agent prompt in any source file
grep -r "system_prompt\|systemPrompt" api/src
# Must return zero agent prompt text

# 4. No prohibited output phrasing
grep -rniE "no licence is required|is compliant|you may proceed|the party is clean" .
# Must return zero results

# 5. No plain SET for tenant context
grep -r "SET app.tenant_id" api/
# Must return zero (only SET LOCAL is acceptable)
```

---

## When the Agent Drifts — Recovery Guide

| Symptom | Response |
|---------|----------|
| Agent redesigned a table | Stop. Revert. Re-paste DDL from docs/05 verbatim. |
| Agent added override for blocked case | Stop. Point at AGENTS.md Rule 1. Remove code path entirely — not guard behind permission. |
| Agent moved prompt into source file | Revert. Prompts are rows in `agent_versions`. |
| Agent merged END_USER and END_USE | Revert. Point at Rule 8 and the UNIQUE constraint on assessment_results. |
| Agent used plain `SET` for tenant context | Fix immediately. Cross-tenant leak. Must be `SET LOCAL` inside transaction in middleware. |
| Agent blocked screening at allowance limit | Point at Slice 7: warn and continue, never block. |
| Agent reasoning about compliance rules from scratch | Stop. It has no export control knowledge. All rules are in /docs. |

**Session restart protocol:**
```
Read AGENTS.md, then docs/verification.md.
We are on slice N. Slices 1 to N-1 are complete and verified.
Summarise the ten non-negotiable rules back to me before doing anything.
```

If the summary is wrong, correct it before letting it write code.

---

## Timeline

| Phase | Estimated Days | Cumulative |
|-------|---------------|------------|
| Replit environment setup | 1 | 1 |
| Slice 1 — Schema | 4 | 5 |
| Slice 2 — Ingestion | 4 | 9 |
| Slice 3 — Matching | 5 | 14 |
| Slice 4 — Sanctions + API | 6 | 20 |
| Slice 5 — Classification | 6 | 26 |
| Slice 6 — Licence | 6 | 32 |
| Slice 7 — Workflow + Admin | 7 | 39 |
| Slice 8 — Frontend | 10 | 49 |
| Buffer + verification gaps | 5 | 54 |

**~8 weeks to pilot-ready.** Pilot go-live first. Investor conversation second.
Use the pilot as evidence.

---

## Gulf Expansion Sequencing

| Order | Market | Rationale |
|-------|--------|-----------|
| 1 | UAE | Highest scrutiny, largest addressable population, consolidated authority |
| 2 | KSA | Largest economy, requires authority routing config for split-authority regime |
| 3 | Oman | Lightest domestic layer; value prop is purely foreign-regime compliance |
| 4 | Qatar, Bahrain, Kuwait | Assess demand after first three |

Adding a new Gulf jurisdiction = configuration + reference data, not code.
The agent structure holds across all three — they all derive from the same
international non-proliferation architecture.

---

*This plan is the authoritative build guide. Where it conflicts with a build session
instruction, this plan wins. Update the status tracker above as slices complete.*
