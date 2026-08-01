# Specifications

Authoritative. Where an implementation and a document disagree, the document is right —
unless the document is wrong, in which case fix the document first, then the code.

| File | What it holds | Read when |
|---|---|---|
| `01-domain-analysis.md` | Regulatory domain — EAR, OFAC, EU dual-use, ICP criteria, red flags, liability, 32 business rules | Understanding *why* a rule exists |
| `02-nine-agents.md` | Each agent's question, inputs, behaviour and output | Orienting on the agent model |
| `03-business-analysis.md` | Market, positioning, pricing, competitive landscape, risk register | Product and commercial decisions |
| `04-functional-spec.md` | Twelve modules, actors, permissions, state machine, twelve use cases, immutable rules, cost model | Building any feature |
| `05-technical-architecture.md` | Full schema DDL, RLS, matching pipeline, knowledge base, ingestion, API, portability | Writing code — the primary build reference |
| `06-agent-design.md` | Every system prompt, output schemas, golden test set, accuracy gates | Anything model-related |
| `07-decision-record.md` | 21 decisions with the options rejected and why | Before reversing a design choice |
| `08-system-flow.md` | Login to report, the whole picture | Onboarding, or when lost |
| `09-deck-reconciliation.md` | Investor deck corrections | Updating the pitch |
| `10-gulf-jurisdictions.md` | UAE, KSA, Oman regimes and expansion sequencing | Adding a jurisdiction |
| `build-prompts.md` | One prompt per slice, in order | Every build session |
| `verification.md` | Checks that must fail — run after each slice | Before starting the next slice |

Diagrams referenced in the text are in the `.docx` originals, kept outside the repo.

---

## Where the Immutable Rules Live

They appear in `04-functional-spec.md` section 9 with full reasoning, and in condensed
form in `/AGENTS.md`. `AGENTS.md` is what gets read every session — keep the two in sync
if either changes.

---

## The Two Things Not in Any Document

**The golden test set.** Eighty to a hundred cases with known correct answers, sourced
from practitioner judgment, reconstructable enforcement actions, and the pilot client's
transaction history. Build it alongside slice 4, not after. Structure is in
`06-agent-design.md` section 9.

**The pilot company.** Selection criteria are in `03-business-analysis.md` section 4.3.
The decisive one: the decision-maker must be able to accept prototype status knowingly.
Anything with a real procurement function will fail vendor due diligence before it fails
on product merit.
