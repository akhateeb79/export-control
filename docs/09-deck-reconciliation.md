# Deck Reconciliation

*Investor deck against the specification set*

# Deck Reconciliation

*Investor deck against the specification set — discrepancies and required corrections*

_Version 1.0_

---

## 1. Why This Document Exists

The Master Blueprint and the investor deck contain two different lists of nine agents. Both documents circulate. A prospective investor or client reading them together will find the inconsistency.

Separately, several deck claims are now outdated in a direction that understates the work — and one is outdated in a direction that overstates the differentiation.

---

## 2. The Nine-Agent Discrepancy

| # | Master Blueprint | Investor Deck |
|---|---|---|
| 1 | Product Classification | Product Classification |
| 2 | Sanctions Screening | Sanctions and Denied-Party Screening |
| 3 | End User Assessment | End-Use / End-User Risk — merged |
| 4 | End Use Assessment | Destination and Licence Determination |
| 5 | Risk Assessment | Documentation Generation |
| 6 | Licence Decision | Regulatory Knowledge Retrieval — new |
| 7 | Document Intelligence | Risk Scoring and Confidence |
| 8 | Audit and Compliance Monitoring | Audit Trail and Reporting |
| 9 | Compliance Intelligence and Reporting | Case Orchestration — new |

### 2.1 The material error

> The deck merges End Use and End User into a single assessment. This is not a presentational simplification. They are distinct legal control bases with different triggers, and merging them creates a blind spot in the dominant diversion pattern in the target market.

A verified, established buyer can declare a prohibited or incomplete purpose. A plausible purpose can be declared by a company that does not exist. A merged score averages one strong result against one weak result and produces a middling figure that passes review. That is precisely how the enforcement cases in this corridor occur.

### 2.2 The other differences

- The deck adds Regulatory Knowledge Retrieval, which the blueprint does not contain. This is a legitimate capability but it was never specified.
- The deck counts Case Orchestration as an agent. It is the coordinator, not an agent — it is the only component permitted to issue the unified recommendation, which is a different role.
- The deck drops Compliance Intelligence as a separate function, folding reporting into audit. These are distinct: one evidences the transaction, the other evidences the programme.

### 2.3 Recommended canonical list

Adopt the Master Blueprint list. It is correct on the separation that matters, and it is the list the specification documents implement.

| # | Agent | Note |
|---|---|---|
| 1 | Product Classification | Expanded to include origin and content determination |
| 2 | Sanctions and Denied-Party Screening | Unchanged |
| 3 | End User Assessment | Kept separate — mandatory |
| 4 | End Use Assessment | Kept separate — mandatory |
| 5 | Risk Assessment | Synthesis layer, adds no new findings |
| 6 | Licence Decision | Includes destination — the re-export answer |
| 7 | Document Intelligence | Inbound extraction and outbound generation |
| 8 | Audit and Compliance Monitoring | The evidence layer |
| 9 | Compliance Intelligence and Reporting | Programme-level visibility |

> Regulatory Knowledge Retrieval is a genuine capability but should be described as a shared service available to several agents, not as a tenth agent. The Orchestrator is named separately as the coordinator, not counted among the nine.

---

## 3. Claims Where the Build Is Ahead of the Deck

The deck defers three capabilities to after funding. All three are architecturally present in the MVP because they cannot be retrofitted.

| Deck position | Actual position | Why |
|---|---|---|
| Multi-tenant SaaS after funding | Built from the first migration | Retrofitting multi-tenancy is the most expensive refactor in SaaS |
| Multi-language after funding | Arabic and English in the document pipeline | Transliteration screening is a core accuracy requirement, not localisation |
| ERP integration after funding | API-first design present; ERP connectors deferred | The API is a product surface regardless of who consumes it |

> Correcting these strengthens the deck. Stating that multi-tenant infrastructure is already built signals engineering maturity; deferring it signals the opposite.

---

## 4. Claims Absent From the Deck

Three capabilities are specified and material to a compliance buyer, and appear nowhere in the deck.

- Document ingestion — the deck says the platform ingests a transaction without explaining how. The pipeline handles text and scanned documents, images, spreadsheets, and mixed-language sources with per-field confidence and mandatory human confirmation.
- Internal compliance programme support — the platform is the technical backbone of a client’s compliance programme, not only a screening tool. This is what makes it defensible in a regulatory audit rather than merely useful.
- Red flag detection — twenty-three structured flags captured at intake and scored. A compliance officer will ask about this in the first meeting.

---

## 5. The Claim That Must Change

> Artificial intelligence as an architectural claim is no longer a differentiator.

Several vendors already position as AI-native or agentic trade compliance platforms, alongside the long-established enterprise incumbents. A business case resting on being the AI option will not survive contact with a well-informed buyer, and a compliance buyer in this segment is often well informed.

### 5.1 What to say instead

- Re-export permissibility as the primary question, which no identified competitor treats as the core use case
- Built for the transshipment jurisdiction rather than the country of origin
- Arabic script and transliteration screening as core capability
- No enterprise resource planning dependency
- Priced for mid-market
- Domain judgment encoded in the decision logic rather than reverse-engineered from public documentation

---

## 6. Correction Checklist

| # | Change | Slide |
|---|---|---|
| 1 | Replace the nine-agent list with the canonical list | Multi-agent architecture |
| 2 | Separate End User and End Use explicitly | Multi-agent architecture |
| 3 | Describe Orchestration as coordinator, not agent | Multi-agent architecture |
| 4 | Move multi-tenant from after-funding to in-prototype | Prototype scope |
| 5 | Move multi-language from after-funding to in-prototype | Prototype scope |
| 6 | Add document ingestion to prototype scope | Prototype scope |
| 7 | Add red flag detection to prototype scope | Prototype scope |
| 8 | Add compliance programme support as a capability | Solution |
| 9 | Replace AI-native framing with geography and re-export framing | Solution and Why Us |
| 10 | Reposition founder background as trust signal, not delivered service | Why Us |
| 11 | State the pilot-first sequence explicitly | Roadmap |

> Item 10 matters more than it appears. Presenting practitioner expertise as part of the offering invites a buyer to expect access to it, which converts the business from software into services.
