# The Nine Agents

*Role, inputs and output of each agent in the pipeline*

Export Control & Trade Compliance Platform
The Nine Agents
Role, inputs, and output of each agent in the pipeline
Version 1.0

## Architecture at a Glance

*[diagram — see the .docx version]*

## How to Read This Document

Nine agents operate under a single orchestrator. Four gather evidence independently. One synthesises without adding findings. One converts that position into a licensing determination. Three provide input handling, evidence recording, and management reporting across the whole pipeline.

Every agent produces its own score, its own reasoning trace, and its own regulatory citation. None of them decides. The compliance officer decides, and their decision is what enters the record as the determination of record.

---

## 1 · Product Classification

**Question:** What is this item, and whose rules control it?

### Input routes

- Manual form — product name, technical description, specifications
- Document upload — technical datasheet, invoice, or purchase order; extracted and pre-filled for confirmation
- Product catalog lookup — a previously classified item returns instantly with no agent call

### What it does

- Determines ECCN under the Commerce Control List
- Determines EU Annex I entry where applicable
- Establishes country of origin
- Calculates US content percentage and de minimis status — whether the item is subject to EAR at all

### Design note

Classification is stored per product, not per case. A trading company ships the same items repeatedly; re-classifying each time wastes cost and time. The catalog is the cache.

> Business rule: when the control list is updated, every cached classification made against the prior version is flagged for re-validation. Classifications go stale when the list moves.

### Output

Classification, confidence score, reasoning, the control list entry cited, and the list version it was assessed against. Below the confidence threshold it routes to a human classifier.

---

## 2 · Sanctions & Denied-Party Screening

**Question:** Is any party to this transaction listed?

### Input routes

- Manual form — name, country, address, identifiers
- Document extraction — parties pulled from invoice, purchase order, bill of lading, end use certificate
- Party registry lookup — a known counterparty is already on file with its screening history

### Who is screened

Buyer, end user, consignee, freight forwarder, intermediary or broker, bank, and the directors and beneficial owners of each. A clean buyer with a sanctioned majority shareholder is a blocked transaction under the fifty percent rule.

### Lists covered

- OFAC Specially Designated Nationals
- OFAC Consolidated Sanctions List
- BIS Entity List
- BIS Denied Persons List
- BIS Unverified List

### Design note

Unlike classification, a screening result is never cached as a final answer. Sanctions status can change within days. The registry stores the party and its screening history; every case re-screens against the current list.

> Transliteration handling is critical in this market. A single Arabic name yields several valid English spellings, each screening differently. The agent stores the original script, generates variants, screens all of them, and reports the highest score across the set. Screening one spelling is the most common real-world failure.

### Output

Per party: status of clear, possible hit, or confirmed hit; match score; the matched record itself; the source list, its version, and sync date; and the name variant that triggered the match. Clear results are logged as compliance records, not discarded.

---

## 3 · End User Assessment

**Question:** Is this a real business that plausibly buys this product?

This is not list screening. Agent 2 asked whether a party appears on a list. This asks whether the party is genuine. A front company is on no list — that is the point of a front company.

### Input routes

- Party record carried forward from Agent 2
- Documents — trade licence, certificate of incorporation, company profile
- Red flag observations recorded at intake by the person who dealt with the customer
- Open-source research performed by the agent
- The tenant’s own prior dealings with this party

### What it examines

- Whether the entity exists and its trade licence is verifiable
- Age of the entity — formation shortly before the order is a signal
- Address type — post box, corporate secretary address, shared office, residential
- Web presence, and whether the stated business matches the product ordered
- Ownership transparency — whether beneficial owners can be identified at all
- Technical plausibility — whether this buyer has a credible reason to want this item
- Prior conduct — whether earlier shipments reached their stated destination

### Stated limitation

Without a commercial corporate intelligence provider, the agent cannot perform authoritative registry lookups or multi-layer ownership tracing. On open sources it performs research, document verification, structured red flag scoring, and internal history review. That is a scored, evidenced suspicion sufficient to trigger investigation — it is not full know-your-customer verification. This should be stated to the client rather than assumed away.

### Output

End user legitimacy score, its own reasoning trace, the specific signals found, unresolved red flags, and its own review flag.

---

## 4 · End Use Assessment

**Question:** What will this item actually be used for, and is that permitted?

### Input routes

- Stated end use from case intake or extracted from the end use certificate
- The end use certificate document itself
- Product technical profile carried forward from Agent 1
- Transaction context — quantity, configuration, destination, routing, packaging
- Red flag observations recorded at intake

### Two checks, both required

Plausibility. Does the stated use match the item and the quantity ordered? An item specified far beyond the requirements of the stated application is a recognised diversion signal, as is a quantity that exceeds any credible local demand.

Catch-all triggers. Independent of plausibility, certain end uses require authorisation regardless of classification — nuclear, missile and unmanned aerial systems, chemical and biological weapons, military end use in specified countries, and advanced computing applications.

> Catch-all provisions apply to uncontrolled items as well. An item with no control classification can still require a licence on end use alone. End user screening will never detect this; only end use assessment will.

### The signal that matters most in this market

Undisclosed onward transfer. The declared end use is legitimate and nothing in the declaration is technically false — it is merely incomplete, because the buyer intends to resell and will not say where. The agent weighs routing logic, packaging inconsistent with the declared destination, quantities exceeding plausible local demand, and whether the party is an end user at all or an intermediary.

### Output

End use risk score, catch-all determination identifying which provision is triggered, plausibility reasoning, unresolved red flags, and its own review flag.

---

## Why Agents 3 and 4 Are Never Merged

End user and end use fail independently. A verified, established, entirely genuine buyer can declare a prohibited or incomplete purpose. A perfectly plausible purpose can be declared by a company that does not really exist.

The regulatory architecture itself separates them: end-user controls operate through listing mechanisms, while end-use controls operate through catch-all provisions with different triggers and different knowledge standards. They are distinct legal bases, not two views of one assessment.

A merged score averages a strong result against a weak one and produces a middling figure that passes review. That is precisely how diversion cases occur — a long-standing, verifiable distributor whose goods surface somewhere else months later. The end user check passes them. Only the end use check does not.

> Consolidating both into one service is an engineering choice and is acceptable. Merging them into one score is a compliance error. Each must produce its own score, reasoning, citation, review flag, and audit entry.

---

## 5 · Risk Assessment

**Question:** Taken together, what is the risk position?

The synthesis layer. It performs no new checks. It takes the outputs of the preceding agents, applies the business rules, and produces one scored and explained position.

### Inputs

- Classification result and confidence
- Sanctions status for every party
- End user legitimacy score
- End use risk and catch-all determination
- Destination country profile — control group, embargo status, diversion risk
- Unresolved red flag count and severity

### How it works

Deterministic rules run before any scoring. A confirmed sanctions match produces a blocked outcome regardless of how favourable every other input is. Only where no hard rule fires does weighted scoring apply.

> This ordering is the entire design. A scoring model capable of averaging away a sanctions hit would be a liability rather than a product.

### Output

- Overall risk level: low, medium, high, or blocked
- Which specific rule fired, where one did
- Contribution of each input to the score
- Required next action — proceed, gather information, escalate, apply for a licence, or stop
- Full reasoning trace with the regulatory basis for each finding

---

## 6 · License Decision

**Question:** Can this ship, and under what authority?

The output agent. Everything before it was analysis. This produces the answer the client actually needs.

### Inputs

- Classification and origin from Agent 1
- Destination country and its control group
- Risk position and any fired rules from Agent 5
- End use determination and catch-all status from Agent 4

### Four possible outcomes

- No licence required — uncontrolled or below threshold, clean parties, permitted destination
- Licence exception applies — controlled, but a named exception covers it, with every condition individually verified
- Licence required — application to the relevant authority before shipment
- Prohibited — sanctioned party, embargoed destination, or catch-all triggered

### Where systems commonly fail

Licence exceptions carry multiple conditions. The agent must evaluate each condition separately and record it as met, unmet, or unverifiable — never simply declare the exception applicable. An exception claimed without meeting its conditions is a violation, not a defence.

> For a re-exporting business this is the most valuable output the platform produces: this item, of this origin, currently held here, moving to this destination, for this use — is that authorised?

### Output

The determination, the specific regulatory provision it rests on, exception conditions with per-condition status, required documentation, and where a licence is needed, which authority and which application route.

---

## 7 · Document Intelligence

**Role:** Turns documents into structured case data, and case data into documents.

### Inbound — extraction

- Accepts text PDF, scanned PDF, images, DOCX, and spreadsheets
- Detects document type and language
- Extracts parties, product descriptions, technical parameters, quantities, values, destinations, and declared end use
- Handles mixed-language documents, retaining original script alongside working translations
- Returns extracted fields with per-field confidence for human confirmation before anything reaches the analysis agents

### Outbound — generation

- Compliance case reports
- Licence application packages and supporting document checklists
- End use certificate templates
- Missing-document identification for an incomplete case file

> The human confirmation step between extraction and analysis is not optional. Extraction is strong but not infallible, and an incorrect party name entering screening unreviewed is a liability. The platform assists; the person confirms.

---

## 8 · Audit & Compliance Monitoring

**Role:** The evidence layer. Not a feature of the platform — the reason it is defensible.

### What it records

- Every case creation, with a snapshot of the submitted data
- Every agent run and every result received
- Every human review, decision, and override, with actor identity, role, timestamp, and rationale
- Every document generated
- Every re-screening triggered by a list update

### Properties

- Immutable — no user, including the most senior, can alter or delete an entry
- Clear results are recorded as fully as hits; the absence of a match is itself a compliance record
- Retention enforced to the applicable legal minimum
- Exportable on demand in a form a regulator can read

### Monitoring function

Beyond recording, the agent watches for change. When a sanctions list is updated it identifies every open and recently approved case involving an affected party and flags it for re-screening, escalating immediately where an approved case now involves a newly listed entity.

> Demonstrated, documented diligence is treated by regulators as a mitigating factor in enforcement. This agent is what produces that evidence. It is the single feature most directly tied to the buyer’s personal exposure.

---

## 9 · Compliance Intelligence & Reporting

**Role:** Management visibility across all cases, and the reporting a compliance programme requires.

### What it produces

- Executive dashboards — case volume, throughput, risk distribution, bottlenecks
- Key indicators — screening hit rates, average review time, override frequency, unresolved red flags
- Compliance programme self-assessment reports against the applicable framework criteria
- Regulator-ready exports for a specific case, party, product, or date range
- Trend analysis — recurring counterparties, destination concentration, repeated flag patterns

### Why it belongs in the platform

A compliance function must be able to demonstrate not only that individual transactions were reviewed, but that the programme as a whole operates, is monitored, and improves. Agent 8 evidences the transaction. Agent 9 evidences the programme.

---

## The Orchestrator

Not an agent. The coordinator.

- Receives the case and validates completeness
- Determines which agents apply and in what order
- Runs independent agents in parallel and dependent agents in sequence
- Resolves conflicting outputs
- Calculates overall confidence
- Issues a single unified recommendation
- Is the only component permitted to issue that recommendation

---

The platform recommends and evidences. The compliance officer determines.
