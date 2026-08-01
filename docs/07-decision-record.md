# Architecture Decision Record

*Twenty-one decisions with the options rejected and why*

# Architecture Decision Record

*Twenty-one decisions with the options rejected and why*

_Version 1.0_

---

## How to Use This Register

Each entry records a decision, the alternatives that were considered, and the reasoning that selected between them. The decisions themselves are reflected across the specification documents. The reasoning is recorded only here.

The purpose is reconstruction. In six months, facing a change, the question will not be what was decided but why the rejected option was rejected. Without that, a decision gets reversed for a reason that was already considered and dismissed.

> Revisit an entry when its context changes — not when it becomes inconvenient. If a decision is reversed, supersede the entry rather than editing it, and record what changed.

---

## Decisions

### ADR-001 — Multi-tenant from day one

**Status:** Accepted

**Context:** The platform is a SaaS product intended for multiple client companies. The pilot involves one client, which made single-tenant tempting for speed.

Options considered
- Single-tenant instance for the pilot, multi-tenant later
- Multi-tenant architecture from the first line of data code
**Decision:** Multi-tenant from the outset. The pilot client becomes tenant one on production infrastructure.

Consequences
- Tenant identifier required on every tenant table from the first migration
- Row-level security policies written before any feature work
- Slower initial build, but avoids the most expensive refactor in SaaS
- Onboarding a second client becomes an administrative action rather than a project

---

### ADR-002 — Shared schema with row-level security

**Status:** Accepted

**Context:** Tenant isolation must be guaranteed, not merely intended. Three isolation models were available at differing cost.

Options considered
- Shared schema with a tenant column and row-level security
- Separate database schema per tenant
- Separate database instance per tenant
**Decision:** Shared schema with a tenant column, enforced by PostgreSQL row-level security with FORCE enabled.

Consequences
- Isolation is enforced by the database, not by application query discipline
- A query written without a tenant filter still returns only the current tenant rows
- Migration complexity does not multiply with tenant count
- Scales comfortably to roughly fifty tenants; revisit beyond that
- Requires transaction-scoped context setting under connection pooling — see ADR-014

---

### ADR-003 — MVP agent set

**Status:** Accepted

**Context:** The pitch deck commits to three core agents. The initial recommendation was optimised for a manufacturer classifying its own products, which proved wrong once the target market was identified as Gulf re-exporters.

Options considered
- Sanctions, Classification, Risk
- Sanctions, Classification, Licence Determination
- Sanctions, Classification, Licence Determination with End User, End Use and Risk as internal assessment modules
- Four separately named agents
**Decision:** Three agent services, six distinct assessments. Licence Determination internally runs End User, End Use and Risk as separate modules each producing its own score and reasoning.

Consequences
- The re-export permissibility question is answered, which is what this market asks
- Business requirements covering end user, end use and catch-all detection are all satisfied
- The deck can still state three core agents accurately
- Service consolidation does not compromise assessment separation

---

### ADR-004 — Ownership tracing without a commercial provider

**Status:** Accepted

**Context:** A business requirement calls for identifying indirect exposure through majority ownership. Free public sources publish designation lists, not corporate ownership graphs.

Options considered
- License a commercial corporate intelligence provider before the pilot
- Drop the requirement from MVP scope
- Capture ownership supplied by the client at intake and screen those parties
- Defer to a paid provider at enterprise tier only
**Decision:** Client-supplied ownership captured as structured intake data and screened as additional parties, with a paid provider planned for the enterprise tier after funding.

Consequences
- Most of the value delivered at no data cost, because clients often hold this information
- The provenance of every ownership record is stored explicitly so the limitation is never obscured
- The limitation must be disclosed to the pilot client in writing rather than assumed away
- Upgrade path preserved without schema change

---

### ADR-005 — Control list knowledge base design

**Status:** Accepted

**Context:** The classification agent must reason against a large control list. This is the most consequential technical decision in the build, affecting cost, latency and accuracy simultaneously.

Options considered
- Supply the full control list text in every prompt
- Vector retrieval over a chunked control list
- Structured extraction into database tables with rule-based matching only
- Structured narrowing to a candidate set, then focused reasoning over candidates
**Decision:** Two-stage structured narrowing. A cheap model extracts category, product group and technical parameters; SQL filters to five to ten candidates; a capable model reasons over the full text of those candidates only.

Consequences
- Token cost bounded regardless of control list size
- Citations are exact, because candidates come from structured records rather than similarity search
- Rejected candidates are recorded, which is what makes the determination defensible
- A stage one category error is unrecoverable, so that prompt must permit returning null rather than guessing
- Zero surviving candidates routes to human classification rather than a model guess

---

### ADR-006 — Name matching approach

**Status:** Accepted

**Context:** Screening accuracy depends on matching names across transliteration variance, word order differences and legal suffix noise. This market involves Arabic-script names throughout.

Options considered
- Exact string matching
- Edit distance alone
- Token-based similarity alone
- A model-based matcher
- Normalisation, then variant generation, then trigram retrieval, then multiple algorithms scored in parallel
**Decision:** A five-stage deterministic pipeline: normalise, generate transliteration variants, retrieve candidates by trigram similarity, score with multiple algorithms, take the maximum and record which variant produced it.

Consequences
- Reproducible — the same name against the same list version always yields the same score
- No hallucination surface on the highest-consequence check in the platform
- Zero marginal cost per case
- Requires a maintained transliteration substitution table, which is finite and well established
- Trigram index required, so the relevant PostgreSQL extension must be enabled

---

### ADR-007 — Workflow engine

**Status:** Accepted

**Context:** The no-hard-coding mandate applies to the case state machine. Compliance workflows differ between clients and change as regulations change.

Options considered
- Hard-coded state machine in application code
- States and transitions as database rows with guard expressions
- A full business process engine
**Decision:** Configuration-driven. Two tables holding states and transitions, with guard expressions evaluated against case context.

Consequences
- Workflow changes without deployment, satisfying the mandate
- Right-sized for a solo build; a process engine would become a project of its own
- Transitions the immutable rules depend on are marked system-locked and protected by trigger
- Guard expression evaluation must be sandboxed, never evaluated as arbitrary code

---

### ADR-008 — Entitlement enforcement

**Status:** Accepted

**Context:** Subscription plans determine which agents, features and limits apply per tenant. Enforcement location determines whether it can be bypassed.

Options considered
- Interface-level checks only
- Middleware guard at the API layer with entitlement definitions in the database
- A dedicated policy engine
**Decision:** Middleware guard evaluated on every request, with plan entitlements stored as data.

Consequences
- Cannot be bypassed through direct API access
- Distinct from row-level security, which governs data access rather than feature access
- Plan changes take effect immediately without deployment
- Every endpoint must declare the capability it requires

---

### ADR-009 — List ingestion

**Status:** Accepted

**Context:** Sanctions and control list data must be current, and freshness is a compliance guarantee made to clients.

Options considered
- Manual download and upload
- Scheduled fetch, parse, normalise into a common schema, with content hashing for change detection
- An aggregated commercial feed
**Decision:** Scheduled ingestion normalising every source into one common entity schema, versioned, with content hash comparison to detect change.

Consequences
- The matching engine never knows which list a record originated from, so adding a source requires no matcher change
- Retrofitting normalisation later would require rewriting the matcher
- Version records enable the re-screening cascade and provide the audit citation
- Failure leaves the prior version active with a visible staleness indicator rather than halting screening silently

---

### ADR-010 — Prompt storage

**Status:** Accepted

**Context:** Agent prompts determine product accuracy and must be changeable without deployment, but a determination made two years ago must remain reconstructable.

Options considered
- Prompts embedded in application code
- Prompt files under version control
- Prompts stored in the database, versioned, immutable once published
**Decision:** Database-stored, versioned, immutable on publication, edited through the platform admin dashboard.

Consequences
- Satisfies the no-hard-coding mandate and the agent management module requirement
- Every result row records the agent version that produced it
- A published version can never be edited, only superseded
- Requires a draft, test and publish workflow with rollback

---

### ADR-011 — Agent accuracy validation

**Status:** Accepted

**Context:** Without measurement, agent accuracy is an opinion. This is the most commonly skipped step and the one whose absence causes the most damage in a compliance product.

Options considered
- Manual spot checks
- A golden test set with known correct answers
- Golden set plus outcome diffing on every prompt change
- Golden set, outcome diffing, and live override-rate monitoring
**Decision:** Golden test set gating publication, outcome diffing between versions, and override rate monitored in production.

Consequences
- Accuracy gates are asymmetric — a missed control is zero tolerance while a neighbouring classification is a review-queue outcome
- Test set authoring requires practitioner judgement and cannot be delegated to engineering
- Override rate becomes the primary product health metric during the pilot
- Every override with a recorded rationale is a candidate golden case, so the set compounds

---

### ADR-012 — API style

**Status:** Accepted

**Context:** The API is a product surface for future integration as well as the interface for the platform itself.

Options considered
- REST
- GraphQL
- A typed RPC framework
**Decision:** REST.

Consequences
- Simplest to build and document for a solo developer
- Matches what any future integration will expect
- Adds no client-side complexity to the frontend

---

### ADR-013 — Primary key strategy

**Status:** Accepted

**Context:** Key type should reflect table nature. Multi-tenant exposure adds a consideration absent from single-tenant systems.

Options considered
- Sequential integers throughout
- UUID throughout
- Natural code keys for reference data, UUID for tenant transactional data
**Decision:** Mixed by table nature. Stable natural codes for reference and configuration tables, UUID for tenant transactional data, sequences only where append-only and never exposed.

Consequences
- Reference tables remain readable in queries and logs
- Sequential integers on tenant data would leak transaction volume between tenants and be enumerable through the API
- Consistent with the stated key convention

---

### ADR-014 — Audit table design

**Status:** Accepted

**Context:** The audit trail is the product’s core value and its highest-volume table. It must survive an infrastructure migration and support a five-year retention obligation.

Options considered
- Sequence primary key
- Random UUID primary key
- Time-ordered UUID with a sequence column, hash chaining and range partitioning
**Decision:** Time-ordered UUID primary key, a monotonic sequence column for gap detection, hash chaining for alteration detection, and monthly range partitioning.

Consequences
- Survives multi-region deployment, which the roadmap requires — a sequence would collide across instances
- Time ordering preserves index insert locality, avoiding the page splitting cost of random keys
- Gap detection and hash chaining together provide tamper evidence, not only tamper prevention
- Retention expiry becomes a partition drop rather than a mass delete
- The same pattern applies to the vendor access log, which clients read

---

### ADR-015 — Immutable rules as an exception to no-hard-coding

**Status:** Accepted

**Context:** The mandate requires everything configurable. Some compliance rules must not be configurable by anyone, including the platform owner.

Options considered
- Everything configurable without exception
- A defined set of rules immutable in code, everything else configurable
**Decision:** Ten immutable rules held in code and enforced structurally. All other behaviour is configuration.

Consequences
- A platform administrator cannot disable a sanctions block, which would make the product an instrument for defeating controls
- Immutability is enforced by schema structure and database permissions where possible, not by application discipline
- Tenants may set thresholds stricter than the platform floor, never looser
- The immutable set is deliberately small and each entry is justified

---

### ADR-016 — Development and hosting platform

**Status:** Accepted

**Context:** The platform requires hosting for both build and pilot. Client data residency is a known future constraint.

Options considered
- Build and host on the chosen development platform
- Build locally and deploy to a major cloud from the outset
- Build on the development platform, deploy elsewhere
**Decision:** Build and host on the development platform for the pilot, subject to strict portability rules and written disclosure to the pilot client.

Consequences
- Fastest path to a working pilot with no infrastructure overhead
- Hosting region does not match the target market, which is disclosed rather than concealed
- No security certification is available to pass through to clients
- Portability rules are mandatory from the first commit so migration is a deployment change, not a rebuild
- Migration to regional hosting is a funded milestone, not an emergency

---

### ADR-017 — Deployment type

**Status:** Accepted

**Context:** The hosting platform offers request-billed autoscaling and fixed-cost reserved capacity.

Options considered
- Autoscale, billed per request
- Reserved capacity at fixed monthly cost
**Decision:** Reserved capacity.

Consequences
- Fixed infrastructure cost against fixed subscription revenue, which protects margin
- Supports a persistent worker process for asynchronous agent execution
- Avoids the resource starvation failure mode on a compliance screening call
- Predictable billing, which matters when the platform is priced as a subscription

---

### ADR-018 — Behaviour at subscription allowance limits

**Status:** Accepted

**Context:** Standard SaaS practice blocks a feature when its quota is exhausted. Applied here, that would prevent a screening.

Options considered
- Hard stop at the allowance limit
- Warn and continue, billing overage
**Decision:** Never block a screening for a commercial reason. Warn at eighty percent, warn again at one hundred, continue serving, record overage.

Consequences
- A compliance check is never withheld because of billing state
- Overage must be priced low enough that no client hesitates to run a screening
- Suspension for non-payment restricts new case creation only; historical records remain readable
- Contradicts standard SaaS practice deliberately and for a stated reason

---

### ADR-019 — Platform access to client compliance records

**Status:** Accepted

**Context:** The platform owner requires visibility to answer client questions. The audit trail’s evidentiary value depends on the vendor being unable to alter it.

Options considered
- Full platform access including write
- Read access only, logged
- No platform access to case content
**Decision:** Read access for the owner role, requiring a stated reason, logged to a client-visible access log. No write path to compliance records for any platform role, enforced by database permission.

Consequences
- The client can state that their vendor cannot alter the record, which is stronger than an assurance that it did not
- The access log protects the owner against any allegation of data misuse
- Data corrections are performed by the client through their own audited workflow
- A genuine system defect requires a documented remediation with written client authorisation, not a dashboard action

---

### ADR-020 — End user and end use assessment separation

**Status:** Accepted

**Context:** The investor deck merged these into a single assessment. They are distinct legal control bases with different triggers.

Options considered
- A single combined party risk assessment
- Two independent assessments, each with its own score, reasoning and audit entry
**Decision:** Permanently separate. Enforced structurally by a typed results table with a unique constraint, so no combined value can be stored.

Consequences
- A verified buyer declaring a prohibited use, and a plausible use declared by a front company, are both detected
- A merged score would average one strong result against one weak result and clear the dominant diversion pattern in this market
- Consolidating both into one service call is acceptable; merging the outputs is not
- The investor deck requires correction to match

---

### ADR-021 — Sanctions agent is deterministic

**Status:** Accepted

**Context:** Every other agent uses a model. The highest-consequence check does not.

Options considered
- Model-based screening or disambiguation
- Fully deterministic rule-based matching
**Decision:** Deterministic. No model call in the screening path.

Consequences
- Reproducible, explainable without interpretation, and free per case
- No hallucination surface on the check whose failure carries criminal exposure
- A model-based disambiguation assist may later advise reviewers on possible hits, but can never change a status
- Accuracy depends on the quality of the transliteration table rather than on prompt engineering

---
