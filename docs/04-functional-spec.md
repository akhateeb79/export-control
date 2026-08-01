# Functional Specification

*Twelve modules — configuration-driven — multi-tenant SaaS*

Export Control & Trade Compliance Platform
Functional Specification
Twelve modules · configuration-driven · multi-tenant SaaS
Version 1.0

## 1. Scope

### 1.1 In scope

- Three agent services: Sanctions Screening, Product Classification, Licence Determination
- Six distinct assessments — the Licence Determination service internally runs End User, End Use and Risk as separate modules producing separate scores
- Document ingestion: PDF, scanned PDF, images, DOCX, spreadsheets, in mixed languages
- Multi-tenant SaaS with row-level isolation and subscription entitlement
- Twelve configurable modules administered from the platform admin dashboard
- Immutable audit trail with client-visible vendor access logging

### 1.2 Out of scope for this release

- ERP and CRM integration
- Commercial ownership-tracing data providers
- Agents 5 to 9 as separately deployed services
- Regional hosting outside the development platform
- Automated licence submission to any authority portal

### 1.3 Governing principles

- No hard-coding — behaviour is configuration, held in the database, changed without deployment
- Hard compliance rules are the sole exception and are immutable in code
- Every determination is a recommendation; a human always decides
- No person from the vendor participates in any client compliance determination
- Tenants may tighten a threshold, never loosen it below the platform floor

---

## 2. Actors

### 2.1 Platform side

| Role | Scope |
|---|---|
| Super Admin | The platform owner. Full configuration authority. Read access to any tenant case content, always logged. No write access to client compliance records. |
| Platform Support | System telemetry in full. Case content only against an open support ticket, logged. No write access to compliance records. |
| Platform Ops | System telemetry only. No access to case content. |

### 2.2 Client side

| Role | Scope |
|---|---|
| Client Admin | Manages their own users, views their configuration, sees the vendor access log, exports records. |
| Compliance Officer | Reviews, decides, releases, overrides. The only role that can approve or release. |
| Reviewer | Investigates queued items and recommends. Cannot approve or release. |
| Initiator | Creates cases, uploads documents, records red flag observations. Cannot approve, release or override. |
| API Client | Programmatic case submission and result retrieval. Subject to the same entitlement rules. |

> Which client roles exist for a given tenant is determined by their subscription plan. On the lowest tier the Reviewer role may be unavailable, collapsing review into the Compliance Officer.

---

## 3. Permission Matrix

| Action | Initiator | Reviewer | Compliance Officer | Client Admin |
|---|---|---|---|---|
| Create case | Yes | Yes | Yes | Yes |
| Upload document | Yes | Yes | Yes | Yes |
| Record red flag | Yes | Yes | Yes | Yes |
| View own cases | Yes | Yes | Yes | Yes |
| View all tenant cases | No | Yes | Yes | Yes |
| Investigate queued item | No | Yes | Yes | No |
| Approve case | No | No | Yes | No |
| Release stopped case | No | No | Yes | No |
| Override recommendation | No | No | Yes | No |
| Escalate | No | Yes | Yes | No |
| Generate report | No | Yes | Yes | Yes |
| Manage users | No | No | No | Yes |
| View vendor access log | No | No | Yes | Yes |
| Export audit trail | No | No | Yes | Yes |
| Change tenant thresholds | No | No | No | Yes |

> No client role can override a hard block. The action does not exist in any interface and is rejected at the API layer regardless of role.

---

## 4. Module Architecture

| # | Module | Owns |
|---|---|---|
| 1 | Lookups | Every code list, category and type. Countries, party types, document types, red flag taxonomy, status codes, list sources, agent types. |
| 2 | Messages | All user-facing text, labels, help text and errors, per language. |
| 3 | Notifications | Templates, triggers, recipient rules, channel routing across in-app and email. |
| 4 | Workflow | Case states, permitted transitions, guard conditions, escalation paths. |
| 5 | Rules & Thresholds | Match thresholds, confidence bands, red flag weights, escalation triggers. Bounded by immutable platform floors. |
| 6 | Agent Management | Agent registry, versioned prompts, model selection, execution settings, test harness, publish workflow, performance and override monitoring. |
| 7 | Subscription | Plan definitions, tenant subscriptions, entitlement enforcement, usage metering, overage, lifecycle transitions, invoicing state. |
| 8 | Platform Roles & Permissions | Vendor-side roles and their access scope. |
| 9 | Client User Management | Platform-side creation and administration of tenant users. |
| 10 | Client Observation | Client admin and client operations dashboards viewed from the platform side. |
| 11 | CMS | Landing page and public content, editable without deployment. |
| 12 | Audit & Access Log | Immutable case audit trail plus the separate vendor access log. |

---

## 5. Case State Machine

### 5.1 States

| State | Meaning |
|---|---|
| DRAFT | Created, not yet submitted. Editable. |
| SCREENING | Agents running. Read-only. |
| REVIEW_REQUIRED | One or more findings need human judgement. Queued. |
| ESCALATED | Raised to the senior compliance role for sign-off. |
| APPROVED | Determination made and recorded. Shipment may proceed. |
| BLOCKED | Hard rule fired. Terminal unless a licence pathway is recorded. |
| CLOSED | Concluded without shipment. Terminal. |

### 5.2 Permitted transitions

| From | To | Guard |
|---|---|---|
| DRAFT | SCREENING | All mandatory fields present and valid |
| SCREENING | REVIEW_REQUIRED | Any agent returned a possible hit, low confidence, or unresolved red flag |
| SCREENING | BLOCKED | Any immutable hard rule fired |
| SCREENING | APPROVED | All agents clear, no rule fired, and the plan permits auto-clear |
| REVIEW_REQUIRED | ESCALATED | Risk is HIGH, or two or more red flags remain unresolved |
| REVIEW_REQUIRED | APPROVED | Compliance Officer approves with recorded rationale |
| REVIEW_REQUIRED | BLOCKED | Compliance Officer blocks |
| ESCALATED | APPROVED | Senior sign-off recorded |
| ESCALATED | BLOCKED | Senior sign-off refused |
| Any state | SCREENING | Re-screening triggered by a list update |
| Any non-terminal | CLOSED | Case abandoned, reason recorded |

> States and transitions are database rows with guard expressions, not code. The immutable rules are the exception: no configuration can create a transition out of BLOCKED to APPROVED without a recorded licence, and none can reach APPROVED without a screening record.

---

## 6. Use Cases

#### UC-01 — Tenant onboarding

**Actor:** Super Admin

**Trigger:** A new client contracts for the service

**Preconditions:** Plan exists in the subscription module

Main flow
- Super Admin creates the tenant record and assigns a plan
- System provisions tenant configuration from plan defaults
- Super Admin creates the initial Client Admin user
- System issues an activation invitation
- Client Admin sets credentials and enrols second-factor authentication
- System writes tenant creation to the platform audit log
Alternate and exception paths
- Plan does not exist — Super Admin must define it first
- Activation not completed within the configured window — invitation expires and must be reissued

#### UC-02 — Manual case creation

**Actor:** Initiator

**Trigger:** A new enquiry or order arrives

**Preconditions:** User authenticated, tenant active, allowance not exhausted

Main flow
- User opens the case form
- System loads all field options from the lookups module
- User enters parties, product, transaction and destination
- User completes the red flag checklist
- User submits
- System validates and moves the case to SCREENING
- Orchestrator is invoked
Alternate and exception paths
- Mandatory field missing — submission rejected with field-level messages
- Allowance exhausted — case still accepted, overage warning displayed, never blocked
- Tenant suspended — creation refused, historical access retained

#### UC-03 — Document-driven case creation

**Actor:** Initiator

**Trigger:** User has source documents rather than typed data

**Preconditions:** As UC-02

Main flow
- User uploads one or more documents
- System detects type and language
- Extraction returns fields with per-field confidence
- System presents a pre-filled form with low-confidence fields highlighted
- User confirms or corrects every extracted value
- User completes the red flag checklist and submits
- System stores the original document linked to the case
Alternate and exception paths
- Unsupported format — rejected with the accepted list shown
- Extraction fails — user falls back to manual entry, failure logged
- Confidence below the configured floor on a critical field — confirmation is mandatory, not optional

#### UC-04 — Sanctions screening

**Actor:** Sanctions Agent

**Trigger:** Case enters SCREENING

**Preconditions:** Lists synced within the configured freshness window

Main flow
- Agent retrieves every party on the case, including supplied beneficial owners
- Each name is normalised and transliteration variants generated
- Every variant is matched against every enabled list using the configured algorithms
- Highest score across variants and algorithms is taken per party per list
- Result classified against tenant thresholds
- Every result including CLEAR is written to the audit trail with list version and sync date
Alternate and exception paths
- List stale beyond the freshness window — case halts, platform alerted, user informed
- Confirmed hit — hard rule fires, case moves to BLOCKED, no override offered
- Possible hit — case moves to REVIEW_REQUIRED with the matched record and triggering variant shown

#### UC-05 — Product classification

**Actor:** Classification Agent

**Trigger:** Case enters SCREENING

**Preconditions:** Knowledge base current

Main flow
- Agent checks the tenant product catalogue for an existing classification
- If found and the control list version is unchanged, cached result is returned with its original date
- If not found, structured narrowing selects candidate entries
- Full text of candidates only is supplied to the model
- Agent returns classification, confidence, reasoning, the entry cited and the candidates rejected
- Result is written to the catalogue against the current list version
Alternate and exception paths
- Confidence below threshold — flagged for human classifier review
- Control list updated since the cached classification — cache invalidated and reclassification triggered
- No candidate identified — routed to human classification, never guessed

#### UC-06 — Licence determination

**Actor:** Licence Agent

**Trigger:** Classification and screening complete

**Preconditions:** Both prior agents returned results

Main flow
- End User module assesses buyer legitimacy and returns its own score and reasoning
- End Use module assesses plausibility and catch-all triggers and returns its own score and reasoning
- Risk module applies immutable rules first, then weighted scoring
- Licence logic evaluates classification, origin, destination and both assessments
- Any licence exception has every condition evaluated individually
- Determination returned with regulatory basis and per-condition status
Alternate and exception paths
- Catch-all triggered on an unclassified item — licence required despite no classification
- Exception condition unverifiable — recorded as unverifiable, never assumed met
- Hard rule fired earlier — licence logic is skipped, case is already BLOCKED

#### UC-07 — Human review of a possible hit

**Actor:** Compliance Officer

**Trigger:** Case in REVIEW_REQUIRED

**Preconditions:** User holds the Compliance Officer role

Main flow
- Officer opens the queued case
- System displays the matched record, score, triggering variant, source list and version
- Officer investigates and records a determination
- If cleared, rationale is mandatory
- System records an override entry with actor, role, timestamp and rationale
- Case transitions per the workflow
Alternate and exception paths
- Officer is not authorised — action rejected at the API layer
- Risk is HIGH — approval is unavailable, only escalation
- Officer takes no action within the configured period — reminder notification issued

#### UC-08 — Escalation and sign-off

**Actor:** Senior compliance role

**Trigger:** Case in ESCALATED

**Preconditions:** Escalation trigger met

Main flow
- Senior user opens the escalation queue
- Full case, all agent reasoning and the reviewer recommendation are shown
- Senior user approves or refuses with mandatory rationale
- Decision written to the audit trail as the determination of record
Alternate and exception paths
- Senior user unavailable — configured delegation applies, delegation itself logged
- Refusal — case moves to BLOCKED or CLOSED per the recorded reason

#### UC-09 — List update re-screening cascade

**Actor:** System

**Trigger:** Scheduled ingestion detects changes

**Preconditions:** Ingestion completed successfully

Main flow
- System normalises new and changed entries into the common schema
- System identifies every open case involving an affected party
- System identifies every case approved within the retention window involving an affected party
- Open cases are returned to SCREENING
- Approved cases are flagged for re-screening review and the Compliance Officer notified
- If an approved case now involves a newly listed party, an urgent notification is issued immediately
Alternate and exception paths
- Ingestion fails — prior list version retained, platform alerted, freshness indicator turns stale
- Volume of affected cases exceeds the configured batch limit — processed in tranches, all notified

#### UC-10 — Report generation

**Actor:** Compliance Officer

**Trigger:** Determination recorded

**Preconditions:** Case in a terminal state

Main flow
- Officer requests the compliance report
- System assembles case summary, every screening result with citations, classification with reference, both assessments, the determination, the approver identity and timestamp
- Decision-support disclaimer is rendered on the document
- Report generation is itself written to the audit trail
Alternate and exception paths
- Case not in a terminal state — draft report watermarked as provisional
- Plan does not include report export — action refused with an upgrade prompt

#### UC-11 — Super Admin views client case content

**Actor:** Super Admin

**Trigger:** A client raises a question requiring case-level clarification

**Preconditions:** Super Admin authenticated

Main flow
- Super Admin opens the tenant case in read mode
- System requires a reason and optional ticket reference before content is displayed
- Content is displayed read-only; no editing control exists anywhere in the interface
- Access is written to the vendor access log with actor, tenant, case, reason, timestamp
- The entry becomes visible in that client’s own dashboard
Alternate and exception paths
- Reason not supplied — content is not displayed
- Any write attempt — rejected at the API layer irrespective of role

#### UC-12 — Agent version publication

**Actor:** Super Admin

**Trigger:** A prompt or threshold requires change

**Preconditions:** Draft version created

Main flow
- Super Admin edits the agent prompt in draft
- Draft is executed against the golden test set
- System reports outcome differences against the current published version
- Super Admin reviews the differences and publishes or discards
- On publication the version becomes immutable and receives a new identifier
- All subsequent cases record that identifier
Alternate and exception paths
- Golden set accuracy falls below the configured floor — publication blocked
- Regression detected after publication — rollback to the prior version, affected cases identified

---

## 7. User Stories with Acceptance Criteria

### Screening

**Story:** As a Compliance Officer I need every party screened under all plausible spellings so that a transliteration difference cannot cause a missed match.

- Given a party name in Arabic script, when screening runs, then at least the configured minimum number of transliteration variants are generated and each is screened
- Given any variant produces a score above the possible-hit threshold, then the case moves to REVIEW_REQUIRED and the triggering variant is displayed
- Given all variants score below the threshold, then the result is CLEAR and is written to the audit trail with the list version

### Hard rules

**Story:** As the platform owner I need hard blocks to be unoverridable so that the product cannot be used to defeat a control.

- Given a confirmed match on a designated list, when any user of any role attempts approval, then the request is rejected at the API layer and the attempt is logged
- Given a tenant configuration attempts to set a threshold below the platform floor, then the configuration is rejected with the floor value shown

### Classification currency

**Story:** As a Compliance Officer I need to know when a cached classification is no longer reliable.

- Given a control list update, when a cached classification was made against a prior version, then it is marked for revalidation and cannot be reused until confirmed
- Given a classification is displayed, then its date and the control list version are always shown alongside it

### Audit integrity

**Story:** As a Compliance Officer I need the record to be tamper-evident so that it is defensible to an authority.

- Given any audit entry exists, when any user or platform role attempts modification or deletion, then the operation fails and the attempt is logged
- Given platform staff view case content, then an entry appears in the vendor access log visible to that client within the same session

### Entitlement

**Story:** As the platform owner I need plan limits enforced server-side so that the interface cannot be bypassed.

- Given an agent is not included in a tenant plan, when a case is submitted through the API, then the orchestrator omits that agent and the response states the omission
- Given the case allowance is exhausted, when a screening is requested, then the screening proceeds and an overage record is created

> The final criterion is deliberate. Screening is never withheld for a commercial reason.

---

## 8. Screen Definitions

| Screen | Must provide |
|---|---|
| Case list | Filter by state, risk, date, owner. Allowance counter. Stale-list indicator when applicable. |
| Case creation | All fields from lookups. Red flag checklist. Document upload. Field-level validation. |
| Extraction confirmation | Extracted values with per-field confidence. Low-confidence fields visually distinct and mandatory to confirm. |
| Case detail | Per-agent result with its own score, reasoning and citation. Six assessments displayed separately, never combined into a single figure. |
| Review queue | Items needing judgement, with the specific trigger, matched evidence and elapsed time. |
| Escalation queue | Senior view. Full reasoning and reviewer recommendation. Mandatory rationale on decision. |
| Report view | Assembled report with disclaimer. Export action. |
| Vendor access log | Client-visible. Every platform access with actor, reason, timestamp. |
| Client admin | User management, plan and usage, tenant thresholds within platform floors. |
| Platform admin | The twelve modules, tenant list, telemetry, agent management, subscription administration. |

---

## 9. Immutable Rules — Not Configurable

| Ref | Rule |
|---|---|
| IM-1 | A confirmed designated-party match blocks the case. No role, tenant or platform configuration can alter this. |
| IM-2 | A comprehensively embargoed destination blocks the case absent a recorded licence. |
| IM-3 | A case cannot reach APPROVED without a screening record. |
| IM-4 | A case cannot reach APPROVED without a classification record. |
| IM-5 | Audit entries cannot be modified or deleted by any actor. |
| IM-6 | Hard rules are always evaluated before weighted scoring. |
| IM-7 | Vendor roles have no write path to client compliance records. |
| IM-8 | A tenant threshold may be stricter than the platform floor, never looser. |
| IM-9 | Records cannot be deleted before the retention period expires. |
| IM-10 | End user and end use scores are never combined into a single value. |

---

## 10. Validation, Notifications and Failure Behaviour

### 10.1 Validation

- Mandatory: at least one party with a role, product description, destination, stated end use
- Party name must be non-empty after normalisation; a name of only punctuation or digits is rejected
- Destination must resolve to a country in the lookups module
- Uploaded documents validated on type, size and readability before acceptance
- Red flag checklist completion is enforced or optional per platform configuration

### 10.2 Notifications

| Event | Recipient | Channel |
|---|---|---|
| Case requires review | Compliance Officer | In-app and email |
| Case escalated | Senior compliance role | In-app and email |
| Case blocked | Compliance Officer and Client Admin | In-app and email |
| Approved case affected by a list update | Compliance Officer | In-app and email, marked urgent |
| List sync failed | Platform Ops | Email |
| Allowance at eighty and one hundred percent | Client Admin | In-app and email |
| Agent error rate above threshold | Super Admin | Email |

### 10.3 Failure behaviour

> A compliance platform that fails silently is more dangerous than one that is unavailable. Every degraded state is visible.

- Model provider unavailable — case held in SCREENING, retried with backoff, user informed the case is pending not clear
- List sync failure — prior version retained, freshness indicator turns stale, screening continues with an explicit stale-data warning on every result
- Extraction confidence below floor — manual entry required, never silently accepted
- Agent timeout — case returns to REVIEW_REQUIRED, never auto-cleared
- Partial agent failure — case cannot reach APPROVED; the missing assessment is named

---

## 11. Retention and Non-Functional Requirements

### 11.1 Retention

- Case records, screening results, classifications and audit entries retained to the configured legal minimum
- Deletion before expiry is refused for every actor
- Suspension for non-payment grants read-only access to all historical records and prevents new case creation only
- On termination the tenant receives a complete export before any deletion is scheduled
- Downgrade never removes agent results from cases already decided

### 11.2 Non-functional targets for pilot

| Measure | Pilot target |
|---|---|
| Synchronous case completion | Under twenty seconds at the median |
| Asynchronous case completion | Under three minutes at the median |
| Sanctions screening alone | Under three seconds |
| List sync frequency | At least weekly, daily preferred |
| Availability | Ninety-nine percent, excluding announced maintenance |
| Concurrent cases per tenant | Ten without degradation |

---

## 12. Operational Cost — First Client

Costs are modelled per compliance case, then scaled to monthly volume. Rates verified against published Anthropic pricing as at the first of August 2026 and should be re-checked before commitment.

### 12.1 Cost per case

| Step | Model | Approximate cost |
|---|---|---|
| Document extraction, three pages | Haiku 4.5 | $0.010 |
| Product classification with narrowed candidates | Sonnet 5 | $0.019 |
| End user assessment | Sonnet 5 | $0.016 |
| End use assessment | Sonnet 5 | $0.012 |
| Licence determination | Sonnet 5 | $0.017 |
| Sanctions screening | Deterministic — no model call | $0.000 |
| Open-source research, two searches | Search tooling | $0.020 |
| Subtotal |  | $0.094 |
| Allowance for retries and failed extractions |  | $0.020 |
| Planning figure per case |  | $0.115 |

> Sonnet 5 is currently at introductory pricing of two dollars input and ten dollars output per million tokens through the thirty-first of August 2026, reverting to three and fifteen thereafter. Model the higher rate: roughly fifteen cents per case from September.

### 12.2 Monthly cost at three volume scenarios

| Item | 100 cases | 300 cases | 1000 cases |
|---|---|---|---|
| Model and search usage at $0.15 | $15 | $45 | $150 |
| Development platform subscription | $25 | $25 | $25 |
| Reserved virtual machine | $20 | $20 | $30 |
| Database and storage | $10 | $15 | $30 |
| Scheduled ingestion jobs | $3 | $3 | $5 |
| Domain and transactional email | $3 | $3 | $8 |
| Monitoring | $0 | $0 | $0 |
| Total monthly | $76 | $111 | $248 |

### 12.3 Reading these figures

- At three hundred cases a month, a realistic figure for a mid-size trading company, all-in operating cost is roughly one hundred and ten dollars
- Against a mid-tier subscription in the six to nine hundred dollar range, gross margin is approximately eighty-five percent — healthy for software of this kind
- Model usage is the only cost that scales with volume; everything else is close to fixed at this stage
- Prompt caching on system prompts and control list candidates reduces repeated input to a tenth of base cost and is the single most effective optimisation available
- Routing extraction to the smallest capable model rather than the largest is the second

### 12.4 Costs not included above

- Build-phase model usage during development and golden test set construction — a one-off figure in the low hundreds
- Commercial ownership-tracing data, deferred to the enterprise tier, at twenty to eighty thousand annually when taken
- Regional hosting migration after the pilot
- Security certification, sequenced after pilot validation
- Any human time, which is currently unpriced because it is yours

> The significant finding is that the first client can be served for roughly one hundred dollars a month. Infrastructure is not the constraint on this business. Time is.

---

The platform recommends and evidences. The compliance officer determines.
