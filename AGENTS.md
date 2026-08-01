# Project Instructions — Read Before Every Task

Export control and trade compliance SaaS platform. Multi-tenant. Regulated domain.

**Read `/docs/` before implementing anything.** The specifications are authoritative.
When an instruction here conflicts with a request, this file wins — ask rather than proceed.

---

## Non-Negotiable Rules

These are compliance guarantees, not preferences. Breaking one is a defect regardless of
whether tests pass.

1. **A confirmed sanctions match blocks the case.** No override path exists for any role.
   Do not add an approve button, a force flag, or an admin bypass.
2. **A comprehensively embargoed destination blocks the case** unless a licence record exists.
3. **No case reaches APPROVED without a screening record AND a classification record.**
4. **Audit rows are append-only.** No UPDATE, no DELETE, no soft-delete column, no "cleanup"
   job. Ever.
5. **Hard rules evaluate before any weighted scoring.** Never let a score average away a block.
6. **Platform/vendor roles have SELECT only on tenant compliance tables.** Never grant INSERT,
   UPDATE or DELETE to the platform role.
7. **A tenant threshold may be stricter than the platform floor, never looser.**
8. **End user and end use assessments are never combined into one score or one row.**
   They are separate legal control bases. If you find yourself writing a "party risk score"
   that blends them, stop.
9. **Records cannot be deleted before their retention date.**
10. **Every screening result is written to the audit trail — including CLEAR results.**
    The absence of a match is itself a compliance record.

---

## Do Not Modify

- `docs/**` — the specifications
- `db/migrations/**` — once applied, migrations are immutable; add a new one instead
- Anything under `prompts/` or any `system_prompt` value in seed data
- `AGENTS.md` (this file)

**Agent prompts are product data, not code.** They live in the `agent_versions` table.
Never inline them, never "improve" them, never move them into source files. They are
calibrated against a golden test set; changing wording invalidates that calibration.

---

## Schema Rules

- **Use the DDL in `docs/05-technical-architecture.md` verbatim.** Do not redesign tables,
  rename columns, or "simplify" types.
- Every tenant table has `tenant_id UUID NOT NULL` and row-level security with `FORCE`.
- Primary keys: natural VARCHAR codes for reference/config tables, UUID for tenant
  transactional data, UUIDv7 for audit tables. Never sequential integers on tenant data —
  they leak volume across tenants and are enumerable through the API.
- Foreign keys are declared and enforced. `ON DELETE RESTRICT` by default.

---

## Tenant Isolation — The Most Likely Bug

Set tenant context **inside a transaction**, scoped to it:

```sql
BEGIN;
SET LOCAL app.tenant_id = '<uuid>';
-- queries
COMMIT;
```

A plain `SET` persists on the pooled connection after the request ends and the next
request — possibly a different tenant — inherits it. This must live in middleware,
applied once, never per-handler.

---

## Configuration, Not Code

Lookups, messages, notification rules, workflow states and transitions, thresholds, plans
and entitlements, agent prompts and settings all live in the database and are edited from
the platform admin dashboard. Do not hardcode any of them.

The ten rules above are the only exception — those are immutable in code.

---

## Stack

- Node + Express (REST API), React frontend
- Python + rapidfuzz for name matching, as a local process on an internal port
- PostgreSQL with `pg_trgm` enabled
- Anthropic API for model calls; sanctions screening makes **no model call** and never should

---

## Portability

Assume this moves to another host later. Migration must be a deployment change, not a rewrite.

- Standard PostgreSQL only. No platform-proprietary datastore for anything durable.
- All config from environment variables. No hardcoded paths.
- Own the authentication code. Never a platform-provided identity service.
- Document storage behind one interface so swapping providers touches one file.
- Maintain a Dockerfile even though the host doesn't require it.
- Migrations in version control, applied by a migration tool, never by console.
- Never assume the filesystem persists between deployments.

---

## Output Language

Agent outputs are decision support, never determinations. Prohibited in any user-facing
string or model output:

- "no licence is required" → "no licence appears required on the basis of X, subject to
  compliance officer confirmation"
- "this transaction is compliant" → "no prohibition was identified in the checks performed"
- "you may proceed" → "no blocking condition was identified"
- "the party is clean" → "no match was found against the lists screened, at version X"

Never state what the user is legally obliged to do.

---

## Build Order

Follow it. Each slice must pass verification before the next begins.

1. Schema and migrations
2. List ingestion pipeline with the normalised common schema
3. Name matching service
4. Sanctions screening agent
5. Control list knowledge base and classification agent
6. Licence determination agent with its three internal assessment modules
7. Workflow, entitlement and admin modules
8. Frontend

---

## Before Declaring a Slice Done

Run `docs/verification.md` for that slice. If any check fails, fix it before continuing.
A compliance guarantee broken three slices ago is expensive to find later.
