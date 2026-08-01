# Deep Domain Analysis

*Export control regulatory domain — EAR, OFAC, EU dual-use, ICP framework*

Export Control & Trade Compliance
Deep Domain Analysis
Governing Regimes: EAR + OFAC + EU Dual-Use + BAFA ICP Framework
Version 1.0 — Pre-Build Foundation Document

## 1. The Export Control Universe — What It Is and Why It Exists

### 1.1 Fundamental Purpose

Export control law exists to prevent the proliferation of weapons of mass destruction (WMD), conventional military equipment, and dual-use technology that could be repurposed for military or terrorist ends. It is not trade protectionism — it is security law applied to commercial transactions.

The core philosophy: free trade is the default. Restrictions are the exception. But that exception carries criminal liability, making ignorance legally dangerous.

"Know Your Product" and "Know Your Customer" are not marketing slogans in this domain — they are legal obligations that, if breached, can result in prison sentences, multi-million-euro fines, and permanent loss of export licensing rights.

### 1.2 The Three Governing Regimes for the MVP

#### A. EAR — Export Administration Regulations (US)

Administered by: Bureau of Industry and Security (BIS), US Department of Commerce.

Scope: Controls the export, re-export, and in-country transfer of commercial and dual-use items, software, and technology. Applies to US-origin goods and goods containing US-controlled content above de minimis thresholds.

Key instrument: Commerce Control List (CCL) — classifies items by Export Control Classification Number (ECCN). Format: 1A001, 3E001, 5D002, etc. First digit = product category (0–9). Letter = product type (A=equipment, B=test, C=materials, D=software, E=technology). Last 3 digits = classification entry.

EAR99: Items not listed on the CCL. Generally no license required, but still subject to embargo and end-use restrictions.

License Exceptions: Authorized pathways to export without a specific license (e.g., LVS – low value, GBS – group of countries, ENC – encryption, TSR – technology and software). Each has conditions that must be verified per transaction.

Entity List: BIS-maintained list of organizations and persons for whom a license is required for all items subject to EAR. This is separate from sanctions — it is a licensing restriction, not a prohibition.

Unverified List: Parties BIS has been unable to verify — a due diligence red flag.

Denied Persons List: Parties denied export privileges.

#### B. OFAC — Office of Foreign Assets Control (US)

Administered by: US Department of Treasury.

Scope: Administers and enforces economic and trade sanctions against targeted foreign countries, governments, entities, and individuals. Applies to US persons, US-dollar-denominated transactions, and any transaction that touches the US financial system — regardless of where the exporter is located.

SDN List (Specially Designated Nationals and Blocked Persons): The master prohibition list. Transactions with SDN-listed parties are prohibited. Assets must be blocked. No exceptions without a specific OFAC license.

Consolidated Sanctions List: Broader than SDN — includes FSE (Foreign Sanctions Evaders), SSI (Sectoral Sanctions), NS-MBS (Non-SDN Menu-Based Sanctions), PLC (Palestinian Legislative Council), and others. Each program has different legal consequences.

Country Programs: Full embargoes (Cuba, Iran, North Korea, Syria, Russia-specific sectors) with program-specific rules. A party not on any list may still be in a sanctioned country — triggering separate prohibitions.

50% Rule: An entity owned 50% or more (individually or collectively) by an SDN is itself treated as an SDN, even if not separately listed. This is a major gap in manual screening — software must calculate aggregate ownership.

Secondary Sanctions: OFAC can sanction non-US persons for doing business with sanctioned parties — extending US jurisdiction extraterritorially. Relevant for Middle East-based companies operating internationally.

#### C. EU Dual-Use Regulation + BAFA ICP Framework

Administered by: European Commission (regulation), BAFA (Germany) and equivalent national authorities per member state.

Scope: Regulation (EU) 2021/821 controls exports of dual-use items — goods, software, and technology that have both civilian and military applications. Annex I contains the EU control list.

BAFA ICP Framework: The Internal Compliance Programme standard published by Germany's Federal Office for Economic Affairs and Export Control. While German in origin, it represents the most detailed publicly available ICP standard in the EU and is treated as a reference framework across member states and by global compliance professionals.

Key distinction: The BAFA ICP framework is not just a checklist — it defines the organizational and process architecture that a company must have BEFORE it can apply for global export licenses, and it is the standard against which reliability audits are conducted. This has direct product implications: the platform must support ICP documentation, not just individual transaction screening.

---

## 2. The Core Compliance Workflow — Transaction Lifecycle

Every export transaction, from the moment a sales inquiry arrives to the moment goods cross the border, must pass through a defined sequence of compliance gates. No gate can be skipped. This is the operational backbone the platform must model.

### Step 1: Order Receipt and Initial Screening Trigger

Trigger: Any incoming order, inquiry, or quote request from a foreign party.

Required actions:

- Identify all transaction parties: buyer, end user, consignee, freight forwarder, intermediary, bank.
- Capture product description and technical specifications.
- Capture stated end use and end user country.
- Capture destination country.
Platform implication: Case creation form must capture all of these fields. None are optional in a compliant workflow.

### Step 2: Product Classification

The compliance team must determine the ECCN (or EU equivalent) for every item in the transaction. This is the most technically demanding step.

Classification process:

- Compare product technical specifications against CCL entry criteria.
- Identify the correct ECCN based on technical parameters (not the name of the product).
- Determine if the product is EAR99 (below the CCL threshold).
- For EU: determine if the item is in Annex I of Regulation (EU) 2021/821.
- Document the classification rationale, not just the conclusion.
Critical rules:

- A supplier's classification is a starting point, not a final answer. The exporter bears independent classification responsibility.
- Classification must be verified whenever the control list changes — which happens multiple times per year.
- Dual classification may apply: an item may have both a US ECCN and an EU control list entry.
Platform implication: The Product Classification Agent must take technical description as input, apply CCL criteria, produce an ECCN with reasoning, and flag when control list updates may affect prior classifications.

### Step 3: Sanctions Screening

All parties in the transaction must be screened against all applicable sanctions lists before any commitment is made — before quotes, contracts, or shipments.

Who must be screened:

- Buyer / customer
- End user (if different from buyer)
- Consignee (final recipient)
- Freight forwarder
- Intermediary / broker
- Bank involved in payment
- Directors and beneficial owners of the above (for entity ownership tracing)
Lists to screen against:

- OFAC SDN List
- OFAC Consolidated Sanctions List (FSE, SSI, NS-MBS, etc.)
- BIS Entity List
- BIS Denied Persons List
- BIS Unverified List
- EU Consolidated Sanctions List
- UN Security Council Consolidated List
- UK HM Treasury Consolidated List (post-Brexit)
Name matching complexity:

- Names transliterated from Arabic, Cyrillic, Chinese, Farsi may have multiple valid spellings.
- BAFA recommends: link first AND last name components with AND logic to reduce false positives.
- A configurable match threshold is required — the platform must let compliance officers set the sensitivity level.
- Possible Hit (below threshold) must trigger human review — not auto-clear.
- Definite Hit must hard-block the transaction.
50% rule implications for the platform:

- If entity A is screened and not on any list, but is 50%+ owned by an SDN entity, A is treated as blocked.
- This requires ownership graph traversal — a capability beyond simple name matching.
Platform implication: Sanctions Screening Agent must handle multi-party, multi-list screening with configurable thresholds, produce a per-party result with the matched record and source, and support human review workflow for possible hits.

### Step 4: Country/Embargo Check

Independent of sanctions screening, the destination country must be checked against:

- OFAC country programs (Cuba, Iran, North Korea, Syria, Russia-sector restrictions, etc.)
- EU embargo regulations per destination country
- US country groups under EAR (A, B, D, E — each has different licensing requirements per ECCN)
An EAR country group determines which license exceptions apply and which require a specific license. For example, a 5D002 (encryption software) item may be exportable to a Group B country under exception ENC, but not to a Group D:1 country without a specific license.

Platform implication: Country risk must be a separate determination, not bundled into sanctions screening. The combination of ECCN + destination country + end use determines the license requirement.

### Step 5: End Use and End User Assessment

Even if an item is EAR99 or below the control threshold, catch-all provisions can trigger a license requirement if:

- The exporter knows or has reason to know the item will be used in WMD programs (nuclear, chemical, biological, missile).
- The destination is an embargoed country.
- The end use appears to be military and the country is subject to arms embargo.
End user credibility assessment requires:

- Verification that the end user's stated business is plausible for the product ordered.
- Website and open-source review of the end user organization.
- Red flag detection — see Section 5.
- For global license holders: ongoing customer reliability verification and periodic re-screening.
Platform implication: End Use Assessment Agent must evaluate the coherence between the product, the stated end use, and the end user's stated business. Red flag scoring is the core output.

### Step 6: License Determination

Based on Steps 2–5, the compliance team must determine:

- No License Required (NLR): Item is EAR99 or below EU threshold, no prohibited party, no embargoed destination, no red flags.
- License Exception: Item is controlled but qualifies for a specific exception (must verify all conditions).
- License Required: Must apply to BIS/OFAC/BAFA before proceeding.
- Transaction Prohibited: Sanctioned party, embargoed country, or catch-all triggered. Hard stop.
License exceptions under EAR are numerous and condition-heavy:

- LVS: Low Value Shipments — applies only to certain ECCN categories, value thresholds vary.
- GBS: Ship to Group B countries for certain ECCNs.
- CIV: Civil end use for certain items normally controlled for national security.
- ENC: Encryption items — complex conditions, annual self-classification reports required.
- TSR: Technology and software transfer to certain countries and nationals.
- STA: Strategic Trade Authorization — allows export to close allies without individual license.
Platform implication: License Decision Agent must traverse the exception tree systematically and document why each exception does or does not apply.

### Step 7: Stop/Release Function

This is a mandatory ICP element: the system must be able to hard-block a shipment from proceeding. Only authorized export control staff can release a stopped transaction.

The stop function must prevent:

- Generation of shipping documents
- ERP release of the order
- Invoice issuance
The release function must require:

- Identity of the releasing officer
- Documented rationale for release
- Supervisory approval for high-risk cases
Platform implication: The platform's BLOCKED status must integrate with downstream systems. For the MVP, a compliance report showing BLOCKED status serves as the manual stop instruction. Production will require ERP integration.

### Step 8: License Application (if required)

If a license is required:

- Application must be submitted through the relevant authority portal (BIS SNAP-R, ELAN-K2 for Germany, OFAC license portal).
- Application must be complete and accurate — incomplete applications trigger reliability reviews.
- The CECO must be identified and responsible.
- Supporting documents: End Use Certificate (EUC), technical specifications, commercial invoice, end user declaration.
Platform implication: Document Intelligence Agent must generate draft license application packages and track submission status.

### Step 9: Post-License Compliance

After a license is granted:

- License conditions must be monitored throughout the transaction lifecycle.
- License validity period must be tracked — shipments cannot occur after expiry.
- License value/quantity residuals must be tracked — a license authorizes a specific quantity or value.
- Reporting obligations (e.g., BIS semi-annual reports for some license exceptions) must be met.
- Final pre-shipment check: re-screen all parties immediately before shipment.
Platform implication: This is Phase 2 functionality but must be designed into the data model now. License records, residuals, and expiry dates must be data entities.

### Step 10: Record Keeping

ALL steps above must be documented and retained. Legal retention periods:

- EAR: 5 years from date of export or license expiry.
- OFAC: 5 years from date of transaction.
- EU/BAFA: Per national implementation — typically 5–10 years.
What must be retained:

- Classification rationale per product
- Screening results including negative results (screened and clear)
- End user assessments
- License applications and approvals
- End use certificates
- All internal approval decisions and overrides
- Training records for compliance staff
Platform implication: The Audit & Compliance Monitoring Agent must produce an immutable, timestamped record of every decision, by every actor, in every transaction. This is not a log — it is a legal record.

---

## 3. Red Flags — The Intelligence Layer

Red flags are behavioral and transactional signals that indicate a possible diversion, procurement attempt, or sanctions evasion. They do not automatically prohibit a transaction, but they trigger an enhanced due diligence obligation. Proceeding past a red flag without documented investigation is legally equivalent to constructive knowledge of the violation.

### 3.1 Product Procurement Red Flags

- Inquiry from new or unknown customer whose identity cannot be verified
- Customer declines to answer questions about destination or intended use
- Customer asks no normal commercial or technical questions — suggests they already know the product
- Requests for unusual confidentiality regarding destination or product
- Unusually favorable payment terms — large cash advance without negotiation
- Vague or inconsistent product description (e.g., "spare parts" for unusually large quantities)
- Product appears over-specified for stated civilian use
- Stated product value does not match market norms
- Packaging requirements inconsistent with stated destination (e.g., seaworthy packing for intra-EU delivery)
- Equipment not suitable for the facility where it will allegedly be used
- Customer lacks expected knowledge of safety requirements for the ordered goods
- Customer requests unusual labeling, identification, or markings
- Contract split into multiple sub-orders without plausible justification
- Transport routes that are geographically or economically illogical
- Customer cannot explain what happened to previously delivered products of same type

### 3.2 Expertise Transfer Red Flags

- Inquirer's letterhead is incomplete or appears photocopied
- Technical questions reveal lack of expertise expected for the project type
- No justification provided for why expertise or training is needed
- Project split into subsections without explanation — suggests obfuscation of full scope
- Inquirer abandons cooperation once partial information is obtained
- Declines expert assistance or training that would normally be standard for the project
- Destination specified as a protected or restricted security area
- Only reachable via PO box or mobile number — no verifiable institutional presence

### 3.3 Platform Implication: Red Flag Scoring

The platform must operationalize red flags into a structured detection system:

- Red flag checklist integrated into case intake — for salespeople and logistics staff to flag observations.
- AI-assisted detection from transaction metadata — e.g., product mismatch analysis, geography inconsistencies.
- Each red flag logged with evidence — who flagged it, what was observed, when.
- Red flag score contributes to overall Risk Assessment Agent output.
- Any transaction with unresolved red flags must not be released without CECO-level sign-off.

---

## 4. The ICP Framework — What the Platform Must Support Organizationally

The BAFA ICP framework defines 9 criteria that a company's internal compliance program must meet. The platform is not just a screening tool — it must function as the technical backbone of a company's ICP. Each criterion has platform implications.

### ICP Criterion 1: Top-Level Management Commitment

Requirement: Written commitment by company management to export control compliance. Compliance code of conduct exists and is communicated to all staff.

**Platform implication:** The platform must support document management for compliance policy documents. CECO designation must be recorded. The platform's user permission model must enforce the hierarchy: CECO > Export Control Officer > Staff.

### ICP Criterion 2: Risk Analysis

Requirement: Continuous risk assessment covering company size, product range, customer portfolio, and business activities. Must be updated when any of these change.

**Platform implication:** The platform must maintain a risk profile per company (for B2B SaaS) or per department. Product catalog risk classification, customer geography distribution, and transaction volume must feed into a dynamic risk dashboard.

### ICP Criterion 3: Organizational Structure / Chain of Responsibilities

Requirement: Export control responsibility must be defined in writing. CECO identified in organizational chart. Export control staff must have authority to stop any transaction. Direct reporting line to CECO must exist. Absence coverage rules must be in place.

**Platform implication:** User roles must map to organizational hierarchy: CECO, Export Control Officer, Reviewer, Initiator. Stop function must be available only to authorized roles. Absence delegation must be a configurable feature.

### ICP Criterion 4: Human, Technical and Other Resources

Requirement: Adequate staffing with demonstrated expertise. Electronic system for export management recommended (required for global licenses). Staff must have access to current legislative texts and sanctions lists at all times.

**Platform implication:** The platform IS the technical resource. Regulatory knowledge base (CCL, sanctions lists, EU Annex I) must be current and accessible from within the platform. Data freshness indicators are mandatory.

### ICP Criterion 5: Workflow Management and Operational Procedures

Requirement: Process manual covering the entire transaction lifecycle from order to shipment. Must address embargoes, sanctions screening, product classification, license monitoring, and red flag handling. Must be reviewed at least annually.

**Platform implication:** The platform workflow is the digital process manual. Every step must be enforced procedurally — the system should not allow a case to advance without completing prior steps. This is the audit-proof workflow the ICP requires.

### ICP Criterion 6: Record Keeping and Documentation

Requirement: All verification steps documented per order. Negative results (screened and clear) must also be documented. Records accessible to authorities. Retention periods must be enforced.

**Platform implication:** Every screening event — including clear results — must be written to the audit log. Not just hits. The absence of a hit is itself a compliance record. Retention enforcement must be built into the data model.

### ICP Criterion 7: Staff Selection, Training, and Awareness-Raising

Requirement: Export control staff must have verified expertise. Annual training required. All training certificates retained. All employees (not just compliance staff) must receive annual awareness briefings.

**Platform implication:** Training module is a Phase 2 feature but must be designed into the user model now. Training completion records per user. Awareness notification system for all staff touching export processes.

### ICP Criterion 8: Process Control, ICP Audit, Corrective Measures, Whistleblower System

Requirement: Daily operations must include random transaction audits (4-eyes principle). Full ICP system audit annually (minimum every 3 years). Written corrective action process. Internal whistleblower channel for reporting suspected violations.

**Platform implication:** Audit sampling feature: system flags random transactions for supervisor review. ICP audit report: generates a structured self-assessment against all 9 criteria. Whistleblower channel: secure internal reporting, tracked separately from transaction records.

### ICP Criterion 9: Physical and Technical Security

Requirement: Listed items protected from unauthorized removal. Access controls for listed software and technology. Password protection, firewalls, email controls. AEO-S certification may substitute.

**Platform implication:** Access control model: users only see transactions relevant to their role and territory. Encryption at rest and in transit. Session management, audit of system access. Data residency considerations for KSA/UAE deployments.

---

## 5. Liability Architecture — What's at Stake

This section directly informs the platform's human override, audit trail, and decision support positioning.

### 5.1 Criminal Law (Germany/EU — AWG)

- Intentional arms embargo violation: 1–10 years imprisonment.
- Intentional EU embargo violation: up to 5 years.
- Negligent violation of AWV or EC Dual-Use Regulation: up to 5 years or fine.
- Negligent violation: administrative fine up to €500,000.

### 5.2 US Penalties (EAR/OFAC)

- EAR criminal: up to 20 years imprisonment and $1M per violation.
- EAR civil: up to $300,000 per violation or twice the value of the transaction.
- OFAC criminal: up to $1M and 20 years per violation.
- OFAC civil: up to $356,579 per violation (2024 inflation-adjusted) or twice transaction value.

### 5.3 Corporate Liability

- Company fines up to €10M for intentional offense, €5M for negligent offense.
- Confiscation: the entire transaction value (not just profit) may be seized.
- License revocation: loss of all export privileges — existential for a manufacturing company.
- Saved ICP implementation costs factor INTO the fine calculation — i.e., choosing not to implement an ICP to save money is treated as aggravating, not neutral.

### 5.4 Personal Liability of the CECO

The CECO is personally liable for:

- Their own actions and omissions.
- Actions of subordinates that the CECO failed to prevent through adequate organizational measures.
- Failure to implement an effective ICP — even if no violation occurred.
The CECO cannot delegate away liability. They can delegate signature authority (Form AV2) but retain overall responsibility.

### 5.5 Platform Positioning Implication

The platform must be positioned and architected as "decision support, not legal advice." This is not just a ToS disclaimer — it must be architecturally enforced:

- Every recommendation includes the regulatory citation it is based on.
- Every recommendation is explicit that human sign-off is required before any action.
- Override capability exists — but every override is logged with actor identity, timestamp, and rationale.
- The CECO or Export Control Officer must be the recorded approver for releases. Sales cannot self-approve.
The platform reduces CECO liability by providing documented evidence of a functioning ICP. That is the primary liability value proposition — not just efficiency.

---

## 6. Data Domain — Every Entity the Platform Must Model

### 6.1 Core Transaction Entities

- Compliance Case: The master record for each transaction screening. Contains all sub-entities and links to all agent outputs.
- Party: Any person or organization involved in a transaction. Types: Buyer, End User, Consignee, Freight Forwarder, Intermediary, Bank, Beneficial Owner.
- Product: Item being exported. Contains: description, technical specifications, ECCN (US), EU classification, EAR99 flag, classification confidence, classification history.
- Transaction: The specific proposed export. Contains: quantity, value, destination country, stated end use, Incoterms, shipping route.
- License: Any export license or exception applied. Contains: license type, authority, number, validity period, authorized value/quantity, residual balance, conditions.

### 6.2 Reference Data Entities

- Sanctions List Entry: Record from OFAC SDN, Consolidated, BIS Entity List, etc. Contains: name, aliases, addresses, identifiers, program, effective date, source list, list version.
- ECCN Entry: Record from Commerce Control List. Contains: ECCN, product description, technical parameters, reason for control, license requirements by country group, license exceptions.
- Country Profile: Country name, ISO code, EAR country group (A/B/D/E), OFAC country program status, EU embargo status, UN embargo status, risk rating.
- Embargo Program: Specific sanction program. Contains: program name, authority, effective date, prohibitions, exceptions, licensed activities.

### 6.3 Operational Entities

- Screening Result: Output of sanctions screening per party. Contains: party ID, list screened, match status, match score, matched record, screened by (agent), screened at, human review decision.
- Classification Result: Output of product classification. Contains: product ID, proposed ECCN, confidence score, reasoning, CCL entry cited, classified by (agent), classified at, human confirmation.
- Risk Score: Aggregated risk output. Contains: case ID, sanctions risk, classification risk, end use risk, red flag count, overall risk level, recommendation, generated at.
- Audit Event: Immutable record of every system action. Contains: event ID, case ID, action type, actor (user or agent), timestamp, before state, after state, rationale. Cannot be deleted or modified.
- Override Record: Specific audit event for human decisions that differ from system recommendation. Contains: override type, original recommendation, override decision, override actor (must be authorized role), business justification.
- Red Flag Record: Specific observation of a red flag. Contains: flag type, description, observed by, observed at, resolution status, resolution rationale, resolved by, resolved at.
- Document: Any compliance document attached to a case. Contains: document type, case ID, file reference, upload timestamp, uploader, validation status.

---

## 7. Business Rules — The Logic the Platform Must Enforce

These are non-negotiable rules derived from EAR, OFAC, and the BAFA ICP framework. They govern how the platform must behave, independent of any AI output.

### 7.1 Hard Block Rules (No Override Permitted)

- Rule BR-001: Any transaction with a confirmed OFAC SDN match must be blocked. No exception. No user override. OFAC license application required.
- Rule BR-002: Any transaction with a confirmed EU Consolidated Sanctions match must be blocked.
- Rule BR-003: Any transaction where the destination country is under a comprehensive OFAC embargo (Cuba, Iran, North Korea, Syria) must be blocked unless an OFAC license is presented and valid.
- Rule BR-004: Any transaction where a party is on the BIS Denied Persons List must be blocked.
- Rule BR-005: A compliance case cannot be moved to APPROVED status without a completed sanctions screening event on record.
- Rule BR-006: A compliance case cannot be moved to APPROVED status without a product classification on record.

### 7.2 Human Review Required Rules

- Rule BR-010: Any sanctions screening result with a match score above the configured minimum threshold but below the confirmed match threshold must be flagged as POSSIBLE HIT and routed to human review queue.
- Rule BR-011: Any product classification with confidence score below 70% must be flagged for human classifier review.
- Rule BR-012: Any transaction involving a BIS Entity List party requires human review and a specific EAR license determination.
- Rule BR-013: Any transaction involving a BIS Unverified List party requires enhanced due diligence documentation before proceeding.
- Rule BR-014: Any transaction with 2 or more unresolved red flags requires CECO-level approval.
- Rule BR-015: Any transaction where the destination country is in EAR Country Group D or E requires explicit license exception verification before release.

### 7.3 Documentation Rules

- Rule BR-020: Every screening event — including CLEAR results — must generate an audit record.
- Rule BR-021: Every override of a system recommendation must be documented with actor identity, role, rationale, and timestamp.
- Rule BR-022: The releasing party for any APPROVED case must be an authorized Export Control Officer or CECO — never a Sales or Logistics role.
- Rule BR-023: Case records must be retained for a minimum of 5 years from the date of the compliance decision. The system must prevent deletion before retention period expires.
- Rule BR-024: Any change to a product classification must re-trigger the risk assessment for all open cases involving that product.

### 7.4 Screening Currency Rules

- Rule BR-030: Sanctions lists must be updated at minimum weekly. The platform must display the date of last list update on every screening result.
- Rule BR-031: A final pre-shipment re-screening must be performed within 24 hours of planned shipment date for any case where more than 30 days have passed since initial screening.
- Rule BR-032: If a sanctions list update occurs after a case has been approved, the system must flag the approved case for re-screening review.

---

## 8. Stakeholder Map

### 8.1 Within the Pilot Company

- CECO (Chief Export Control Officer): Board/Director level. Personally liable. Must approve high-risk decisions. Platform provides their compliance dashboard and case exception queue.
- Export Control Officer: Day-to-day compliance operations. Performs reviews, releases transactions, manages the screening queue. Primary power user of the platform.
- Sales / Business Development: Initiates compliance cases at the point of inquiry. Must flag red flags. Cannot approve or release. Platform guides them through intake.
- Logistics / Shipping: Executes shipment. Must not generate shipping documents for blocked or unreviewed cases. Platform provides release status confirmation.
- Legal / General Counsel: Reviews complex cases. Approves self-disclosure decisions. Receives compliance reports.
- IT / Security: Manages platform access, integrations. Concerned with data residency and access controls.
- Internal Audit: Reviews ICP effectiveness. Uses platform's ICP audit report and audit trail.

### 8.2 External Stakeholders

- Regulatory Authorities (BIS, OFAC, BAFA): Do not directly interact with the platform in the MVP but are the ultimate audience for the audit trail. Their standards define every platform requirement.
- Customers / End Users: Provide information that feeds into compliance cases. Their cooperation with End Use Certificates is a workflow dependency.
- Freight Forwarders: May need to be screened and may provide logistics documentation.
- Anthropic / Claude API: AI backbone for classification and analysis. Platform must not send personally identifiable or trade-secret data to the API without appropriate data processing agreements.

---

## 9. Known Domain Edge Cases the MVP Must Handle

### 9.1 Catch-All Provisions

EAR99 items and items below the EU control threshold can still require a license if the exporter knows or has reason to know they will be used in WMD programs. The platform must flag this scenario when red flags combine with destination country risk — even for unclassified products.

### 9.2 Deemed Exports

Releasing controlled technology to a foreign national inside the US (or EU) constitutes an export to their country of nationality. The platform must ask: "Is this a domestic transaction involving a foreign national?" This is out of scope for MVP but must not break the data model.

### 9.3 Re-Export Control

A product exported from the US that later needs to be exported from another country to a third country is subject to EAR re-export controls. The MVP platform focuses on initial exports, but the data model must record origin country and US content percentage to enable future re-export checking.

### 9.4 De Minimis Rule

Foreign-made products containing US-controlled content below 25% (10% for some countries) are not subject to EAR. Above the threshold, they are. The platform must record US content percentage in product specifications.

### 9.5 Intangible Technology Transfer

Sending an email with controlled technical data, sharing a drawing via cloud storage, or providing remote access to a controlled system — all constitute exports of technology. The BAFA ICP requires explicit written procedures for ITT. The platform should support ITT case types in addition to physical goods shipments.

### 9.6 Brokering and Intermediary Activities

Arranging a transaction between two non-US parties for goods that would require a US license can itself require a license. The platform must support brokering case types where the company is not the direct exporter.

### 9.7 License Exception Conditions

Most license exceptions have conditions that must ALL be verified. For example, License Exception STA requires that the exporter obtain from the consignee a copy of their government's import certificate, and the consignee must agree not to re-export. The platform must track each condition individually, not just flag the exception as applicable.

---

## 10. What This Means for the MVP — Direct Build Implications

### 10.1 The 3-Agent Selection is Confirmed, with Precision

Based on this domain analysis, the correct 3 agents are:

- Sanctions Screening Agent: Must cover OFAC SDN, OFAC Consolidated, BIS Entity List, BIS Denied Persons List. Multi-party screening. 50% rule awareness (Phase 2). Configurable threshold. Human review queue.
- Product Classification Agent: Must accept technical description, apply CCL criteria, produce ECCN + reasoning + CCL citation. Confidence scoring. Flag for human review below 70%. Track classification per product, not per case.
- Risk Assessment Agent: Aggregate sanctions result + classification result + country risk + red flag count. Apply business rules BR-001 through BR-032. Produce structured recommendation: CLEAR / REVIEW / BLOCKED. Produce compliance case summary document.

### 10.2 Data Model Must Support Full ICP

Even for the MVP, the data model must include all entities from Section 6. Do not shortcut the schema to only what the 3 agents need today. The audit log, case entity, party entity, and product entity must be built to the full spec now.

### 10.3 The Audit Trail is Not a Feature — It is the Product

For a regulated pilot company, the audit trail is what makes the platform legally valuable. Every screening event, every classification, every risk decision, every human override must be immutably logged. This must be built correctly in the MVP — it cannot be retrofitted.

### 10.4 "Decision Support, Not Legal Advice" Must Be Architecturally Visible

Every output screen must display: the recommendation, the regulatory basis for the recommendation, and explicit language that human sign-off is required. The platform must never present itself as making the compliance decision — it supports the human decision-maker who bears the liability.

### 10.5 Red Flag Intake Must Be in MVP Scope

Red flag detection based on the 15 product red flags and 8 expertise red flags from the BAFA ICP must be part of the case intake form and the risk agent. This is not Phase 2 — it is a core ICP requirement that any pilot company will expect.

---

End of Domain Analysis — Version 1.0
This document serves as the domain foundation for all subsequent Business Analysis, Functional Specification, and Technical Architecture documents.
