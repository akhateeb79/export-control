# End-to-End System Flow

*Login through to compliance report*

# End-to-End System Flow

*Login through to compliance report — the single picture*

_Version 1.0_

---

## The Flow

*[diagram — see the .docx version]*

## 1. Authentication

- Credentials, then a mandatory second factor for every role that can decide or configure
- Token carries tenant, role, plan and a hard expiry — no silent extension
- Tenant context set inside a transaction using a transaction-scoped statement, so row-level security is active for every query in the request

> The transaction-scoped context is the detail that matters. Under connection pooling a session-scoped setting persists after the request ends and the next request inherits it. That is the most likely cause of a cross-tenant leak in a system of this shape.

---

## 2. Intake

Three routes, converging on one case record.

| Route | Behaviour |
|---|---|
| Manual form | All field options drawn from the lookups module. Red flag checklist completed at entry. |
| Document upload | Extraction returns fields with per-field confidence. Low-confidence fields highlighted. Human confirmation is mandatory before anything reaches an agent. |
| Catalogue and registry | A known product returns its cached classification with the date and control list version. A known party never reuses a prior screening. |

> The asymmetry between product and party caching is deliberate. A classification is stable until the control list moves. A designation can change within days, so every case re-screens.

---

## 3. Orchestration and Agents

- Entitlement is checked before any agent runs — a plan that excludes an agent omits it and the response states the omission
- Complexity determines synchronous or asynchronous routing; the threshold is configuration
- Sanctions and classification run in parallel; licence determination waits for both
- Licence determination internally runs end user, end use and risk as three separate modules

### 3.1 The rule ordering

Immutable rules are evaluated before any weighted scoring. A confirmed designated-party match produces a blocked outcome regardless of how favourable every other input is. There is no combination of scores that can rescue a hard block, because scoring never runs.

### 3.2 The separation that must hold

End user and end use produce independent scores, independent reasoning, independent citations and independent audit entries. The results table has no column capable of holding a combined value, so the separation is structural rather than procedural.

---

## 4. Review and Decision

| Path | Trigger | Outcome |
|---|---|---|
| Fast | All clear, no rule fired | Result on screen; sign-off still required |
| Review queue | Possible hit or low confidence | Compliance officer investigates and records a determination |
| Escalation queue | High risk or unresolved red flags | Senior sign-off with mandatory rationale |
| Blocked | Immutable rule fired | No approval control exists in any interface for any role |

- Every decision that differs from the system recommendation is written as an override with actor, role, rationale and timestamp
- Notifications reach the officer in-app and by email; an approved case affected by a list update is marked urgent

---

## 5. Output

- Case record — six assessments displayed separately, each with its reasoning and citation
- Compliance report — citations, approver identity, timestamp, and the decision-support disclaimer rendered on the document
- Licence package — generated only where a licence is required, with required documents and the submission route

---

## 6. Audit

Not a layer the user visits. Written at every step above, inside the same transaction as the action it records.

- Clear results logged as fully as hits — the absence of a match is itself a compliance record
- Hash chained and sequence numbered, giving tamper evidence rather than only tamper prevention
- Monthly partitions, so retention expiry is a partition drop rather than a mass delete
- A separate vendor access log, visible to the client, recording every platform-side view of their case content

> If the audit write fails, the business operation rolls back with it. An action that was not recorded did not happen.

---

## 7. Two Conditions That Never Change

No case reaches approval without both a screening record and a classification record on file, and without a named human recording the determination. The platform recommends; it never decides.

A list update returns affected open cases to screening and flags affected approved cases for re-review, with immediate urgent notice where an approved case now involves a newly listed party.
