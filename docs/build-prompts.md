# Build Prompts

One prompt per slice, in order. Paste one, let it finish, run the matching checks in
`verification.md`, fix anything that fails, then move to the next.

**Never paste two slices at once.** Never say "build the platform."

---

## Slice 1 — Schema and Migrations

```
Read AGENTS.md and docs/05-technical-architecture.md sections 2 through 6.

Create the database schema as PostgreSQL migration files under db/migrations/.
Use the DDL in the document verbatim — do not redesign tables, rename columns,
or change types.

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

---

## Slice 2 — List Ingestion

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

Normalisation is the important part. The matching engine must not be able to tell
which list a row came from.

On fetch or parse failure: keep the prior version active, record the failure, set
the freshness indicator to stale. Do not throw away good data.

Write the name normalisation from section 7.2 as a shared module — slice 3 uses it too.
```

---

## Slice 3 — Matching Service

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

---

## Slice 4 — Sanctions Agent and API Foundation

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

---

## Slice 5 — Knowledge Base and Classification

```
Read docs/05-technical-architecture.md section 8 and docs/06-agent-design.md section 5.

First, load the control list into eccn_entries and eccn_parameters. Category and
product group must be queryable; parameter thresholds must be comparable numerically.

Then build the three-stage classification pipeline:
- Stage 1: attribute extraction using the cheap model. Prompt from the database,
  not from code. It must be able to return null category — a wrong category
  removes the correct entry from consideration permanently.
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

---

## Slice 6 — Licence Determination

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
classification, including for unclassified items. State that explicitly in the
reasoning.

Enforce the prohibited output phrasing from AGENTS.md.
```

---

## Slice 7 — Workflow, Entitlement and Admin

```
Read docs/04-functional-spec.md sections 4, 5 and 9.

Build the configuration-driven workflow engine. States and transitions come from
the database. Guard expressions are evaluated in a sandbox — never as arbitrary
code execution.

Build entitlement enforcement as middleware, not UI checks. Every endpoint declares
the capability it requires. Plan entitlements come from plan_agents and plans.

Allowance behaviour: warn at 80 percent, warn at 100 percent, continue serving,
create an overage record. Never block a screening for a commercial reason.
This is deliberate and contradicts standard SaaS practice.

Then the platform admin modules: lookups, messages, notification rules, thresholds,
agent management with draft-test-publish and rollback, subscriptions, platform
roles, client user management.

Super admin reads tenant case content only after supplying a reason, and every read
writes to vendor_access_log. No write path to tenant compliance records exists for
any platform role — enforce at the database grant level, not in application code.
```

---

## Slice 8 — Frontend

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

---

## When the Agent Drifts

It will. Symptoms and responses:

**It redesigned a table.** Stop. Revert. Re-paste the DDL and say: use this verbatim,
do not modify column definitions.

**It added an override for a blocked case.** Stop. Point at AGENTS.md rule 1. Ask it to
remove the code path entirely, not to guard it behind a permission.

**It moved a prompt into a source file.** Revert. Prompts are rows in `agent_versions`.

**It merged end user and end use.** Revert. Point at AGENTS.md rule 8 and the unique
constraint on `assessment_results`.

**It used a plain `SET` for tenant context.** Fix immediately — this is the cross-tenant
leak. Must be `SET LOCAL` inside a transaction, in middleware.

**It blocked a screening at the allowance limit.** Point at slice 7: warn and continue,
never block.

**It is confidently wrong about a regulation.** It has no export control knowledge.
Do not let it reason about compliance rules from first principles — everything it needs
is in `/docs`.

---

## Session Restart

Context resets. When it does, start with:

```
Read AGENTS.md, then docs/verification.md.
We are on slice N. Slices 1 to N-1 are complete and verified.
Summarise the ten non-negotiable rules back to me before doing anything.
```

If the summary is wrong, correct it before letting it write code.
