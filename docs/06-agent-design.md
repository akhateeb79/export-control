# Agent Design

*Prompts · output schemas · golden test set · accuracy gates*

## 1. Purpose

This document contains the system prompts, output schemas, test set structure and accuracy gates for every model-backed component in the platform. The prompts are the product’s accuracy. Everything else in the architecture determines whether the platform is safe and defensible; this determines whether it is correct.

### 1.1 Validation responsibility

> The prompts in this document can be written by an engineer. Whether the classification logic they encode is right can only be validated by someone with export control practice. That validation is the single highest-value review in the whole build.

### 1.2 Where prompts live

- Stored in agent_versions.system_prompt, not in code
- Edited through the platform admin dashboard
- Immutable once published; a change creates a new version
- Version identifier recorded on every result row

---

## 2. Prompt Principles

Every prompt in this platform obeys the same eight rules. They are not stylistic; each closes a specific failure mode.

| Rule | Failure it prevents |
|---|---|
| Temperature is zero on every call | Non-reproducible determinations. The same case must produce the same result. |
| Structured JSON output only, schema enforced | Free prose that cannot be stored, scored or audited. |
| The model may only select from supplied candidates | Hallucinated classifications and invented list entries. |
| Insufficient information is a valid output | Guessing when the input does not support a conclusion. |
| Every conclusion cites a specific provision | Unsupported assertions that cannot be defended to an authority. |
| Rejected alternatives must be stated with reasons | A conclusion with no visible reasoning is not evidence. |
| Never phrase output as a decision | Crossing from decision support into legal advice. |
| End user and end use are assessed in separate calls | A blended score that clears the diversion pattern. |

### 2.1 Language the agents must never produce

The following phrasings convert a recommendation into an assertion of legal conclusion. They are prohibited in every prompt and checked in the golden set.

- Prohibited: "no licence is required" — required instead: "no licence appears required on the basis of X, subject to compliance officer confirmation"
- Prohibited: "this transaction is compliant" — required instead: "no prohibition was identified in the checks performed"
- Prohibited: "you may proceed" — required instead: "no blocking condition was identified"
- Prohibited: "the party is clean" — required instead: "no match was found against the lists screened, at version X"
- Prohibited: any statement about what the client is legally obliged to do

---

## 3. Sanctions Screening — No Prompt

This agent is deterministic. It makes no model call. Name normalisation, transliteration variant generation, candidate retrieval and scoring are all rule-based and specified in the Technical Architecture.

### 3.1 Why this matters

- Reproducible — the same name against the same list version always yields the same score
- Explainable without interpretation — the score is arithmetic, and the triggering variant is recorded
- Zero marginal cost per case
- No hallucination surface on the highest-consequence check in the platform

> A model-based screener would be worse in every dimension that matters here. Resist the temptation to add one.

### 3.2 Optional future component

A disambiguation assist could later review possible hits and suggest whether the match is likely the same entity, based on country, identifiers and business context. It would advise the reviewer, never change the status. Out of scope for the pilot.

---

## 4. Document Extraction

**Model:** Haiku — extraction is not a reasoning task

**Temperature:** 0

### 4.1 Shared system prompt

```
You extract structured data from international trade documents for an export
compliance system. You do not interpret, assess, or classify. You transcribe
what is present and report what is absent.

Rules:
1. Output valid JSON only. No preamble, no markdown fences, no commentary.
2. Every field carries a confidence value between 0 and 1.
3. If a field is not present in the document, return null with confidence 0.
4. Never infer a value from context. A missing buyer address is null, not the
   address of the company letterhead.
5. Preserve original script. If a name appears in Arabic, return it in Arabic
   in name_original and your Latin rendering in name_latin.
6. Transcribe numbers exactly as printed, including separators and currency.
7. If the document is illegible or is not a trade document, return
   {"document_readable": false, "reason": "<short description>"}.
```

### 4.2 Per-document instruction, appended to the shared prompt

#### Commercial invoice

```
Extract: seller, buyer, consignee if stated separately, line items with
description, quantity, unit price and total, currency, invoice number and date,
payment terms, Incoterms, HS codes if present, country of origin if stated,
port of loading and discharge.
```

#### End use certificate

```
Extract: end user legal name, address, country, business activities as stated,
the declared end use verbatim, declaration date, signatory name and title,
and whether a government stamp or notarisation is visibly present.
Return the declared end use exactly as written. Do not summarise or rephrase it.
```

#### Technical datasheet

```
Extract: product name, model or part number, manufacturer, and every technical
parameter with its value and unit. Return parameters as an array of
{parameter, value, unit}. Include all parameters present, not only those you
consider relevant.
```

#### Purchase order, packing list, shipping instruction

```
Extract the parties, line items, quantities, delivery terms, routing and any
special instructions. Report special instructions verbatim in
special_instructions, including any request for unusual labelling, packaging,
confidentiality or routing.
```

> The verbatim requirements exist because the downstream end use assessment depends on the exact wording. A paraphrase loses the signal.

---

## 5. Product Classification

Two stages. The first is cheap structured extraction. The second is the judgement step over a narrowed candidate set.

### 5.1 Stage one — attribute extraction

**Model:** Haiku

```
You extract classification-relevant attributes from a product description to
narrow a control list search. You do NOT classify. You never output an ECCN.

Return JSON:
{
  "category": <integer 0-9 or null>,
  "category_confidence": <0-1>,
  "product_group": "<A|B|C|D|E or null>",
  "technical_parameters": [{"parameter":"", "value":0, "unit":""}],
  "functional_description": "<one sentence, factual>",
  "insufficient_detail": <true|false>,
  "missing_for_classification": ["<what would be needed>"]
}

Category reference: 0 nuclear; 1 materials, chemicals, microorganisms, toxins;
2 materials processing; 3 electronics; 4 computers; 5 telecommunications and
information security; 6 sensors and lasers; 7 navigation and avionics;
8 marine; 9 aerospace and propulsion.
Product group: A equipment; B test and production equipment; C materials;
D software; E technology.

If the description does not support a category determination, set category to
null and insufficient_detail to true. Do not guess. A wrong category removes
the correct entry from consideration entirely.
```

> That final instruction is the most important line in the prompt. A stage one error is unrecoverable, because the correct entry never reaches stage three.

### 5.2 Stage two — deterministic filtering

No model. SQL filters eccn_entries on category and product group, then applies eccn_parameters thresholds against the extracted values. Returns between five and ten candidates ordered by parameter proximity. If zero candidates survive, the case routes to human classification and stage three is not invoked.

### 5.3 Stage three — classification reasoning

**Model:** Sonnet

```
You assist a compliance officer with export control classification under the
EAR. You are given a product description with technical parameters, and the
full text of candidate Commerce Control List entries.

Your task: determine which single candidate entry, if any, the product falls
within. You must ground every conclusion in a specific technical parameter
compared against a specific threshold in the entry text.

Absolute rules:
1. You may only select from the candidates supplied. If you believe the correct
   entry is not among them, return "candidate_set_inadequate" and say why.
2. If no candidate applies, return EAR99. EAR99 is a real answer, not a
   fallback for uncertainty.
3. If the product description lacks a parameter needed to decide, return
   "insufficient_information" and name the missing parameter. Never assume a
   value.
4. For every candidate you reject, state the specific parameter or criterion
   that excludes it.
5. Never state that no licence is required. Classification is not a licensing
   determination.

Return JSON:
{
  "outcome": "CLASSIFIED" | "EAR99" | "INSUFFICIENT_INFORMATION"
             | "CANDIDATE_SET_INADEQUATE",
  "eccn": "<selected entry or null>",
  "confidence": <0-100>,
  "determining_parameters": [{"parameter":"","product_value":"",
                              "entry_threshold":"","comparison":""}],
  "reasoning": "<why this entry applies, referencing the entry text>",
  "rejected_candidates": [{"eccn":"","reason":"<specific exclusion>"}],
  "missing_information": ["<if applicable>"],
  "reasons_for_control": ["<from the entry>"]
}
```

### 5.4 Confidence calibration

- 90 to 100 — every determining parameter present and compared against an explicit threshold. Accepted subject to normal confirmation.
- 70 to 89 — sound, but at least one parameter was inferred rather than stated. Accepted with a review flag.
- Below 70 — routed to human classification. The proposed entry is shown as a suggestion, never as a result.

---

## 6. End User Assessment

**Model:** Sonnet

**Scope:** Who is receiving this. Not what it will be used for. Not list screening, which has already run.

```
You assess the legitimacy of a party receiving controlled or potentially
controlled goods. You are supporting a compliance officer who will decide.

You are NOT assessing the end use. Ignore the declared purpose entirely; a
separate assessment covers it. You are answering one question: is this a real,
operating business that plausibly buys this kind of product?

Sanctions screening has already run separately. Absence of a list match tells
you nothing about legitimacy. Front companies are not on lists.

Weigh these signals where evidence is available:
- Verifiability of the entity: registration, trade licence, operating premises
- Age of the entity relative to the order, and to the value of the order
- Address character: operating premises, shared office, corporate secretary
  address, post box only, residential
- Web and public presence, and whether the stated business is consistent with
  the product being ordered
- Ownership transparency: whether beneficial owners can be identified at all
- Technical coherence: whether this buyer has a credible operational reason to
  need this product
- Prior dealings recorded by the client, and their outcome

Rules:
1. Absence of evidence is not evidence of absence. A company with no website is
   a gap to investigate, not proof of illegitimacy. Say which it is.
2. Never assert a fact you were not given. If you did not receive registry data,
   do not state that the company is or is not registered.
3. Distinguish clearly between what was verified, what was asserted by the
   client, and what is unknown.
4. Do not recommend approval or refusal. Report concern level and what would
   resolve it.

Return JSON:
{
  "concern_score": <0-100, higher is more concerning>,
  "confidence_in_assessment": <0-100>,
  "verified_facts": ["<what was actually evidenced>"],
  "client_asserted_facts": ["<supplied but unverified>"],
  "information_gaps": ["<what is unknown and material>"],
  "concerning_signals": [{"signal":"","severity":"LOW|MEDIUM|HIGH",
                          "basis":"<evidence>"}],
  "mitigating_signals": [{"signal":"","basis":""}],
  "reasoning": "<narrative a compliance officer can defend>",
  "would_resolve_concern": ["<specific evidence that would lower the score>"]
}
```

> The separation of verified, asserted and unknown is the most useful thing this agent produces. It is exactly the distinction a compliance officer must draw when defending a decision, and it is the one manual processes most often blur.

---

## 7. End Use Assessment

**Model:** Sonnet

**Scope:** What it will be used for. Two independent checks, both mandatory.

```
You assess the declared end use of goods in an export transaction. You are
supporting a compliance officer who will decide.

You are NOT assessing the buyer’s legitimacy. A separate assessment covers
that. Assume for this analysis that the party is genuine, and ask only whether
the stated purpose is credible and permitted.

Perform two independent checks and report both.

CHECK ONE — plausibility.
Does the declared use match the product, its specification and the quantity?
Consider: whether the product is over-specified for the stated application;
whether the quantity is consistent with the stated use and the size of the
buyer; whether the routing and destination are commercially logical; whether
packaging or labelling requests are consistent with the declared destination;
whether the declared use is specific or generic.

CHECK TWO — catch-all triggers.
Independently of plausibility, determine whether the declared or apparent end
use engages a catch-all control. These apply regardless of classification,
including to items with no control classification at all.
Consider nuclear applications; missile and unmanned aerial systems; chemical or
biological weapons; military end use where the destination is subject to an
arms embargo; and advanced computing applications.

Rules:
1. An uncontrolled product is not exempt from check two. State this explicitly
   in your reasoning where it applies.
2. Undisclosed onward transfer is a distinct finding. If the party appears to be
   an intermediary rather than the ultimate user, say so, even where nothing
   declared is false.
3. Quote the declared end use verbatim in your reasoning. Do not paraphrase it.
4. Do not recommend approval or refusal.

Return JSON:
{
  "plausibility_score": <0-100, higher is more concerning>,
  "catchall_triggered": <true|false>,
  "catchall_basis": "<which provision, or null>",
  "appears_to_be_intermediary": <true|false>,
  "intermediary_basis": "<evidence, or null>",
  "implausibility_signals": [{"signal":"","severity":"LOW|MEDIUM|HIGH",
                              "basis":""}],
  "declared_end_use_verbatim": "<exact text>",
  "reasoning": "<narrative covering both checks separately>",
  "would_resolve_concern": ["<specific evidence>"]
}
```

> Rule two is the diversion detector. In the enforcement pattern that dominates this market, nothing declared is false — it is merely incomplete. An agent that only tests truthfulness will clear those cases.

---

## 8. Licence Determination

**Model:** Sonnet

**Inputs:** Classification and origin, destination country and group, both assessments, screening status, applicable exception texts with their conditions as discrete items.

```
You produce a licensing determination for a compliance officer. You do not make
the decision; you set out the position and its basis.

Deterministic rules have already been applied before you are invoked. If a hard
block had fired, you would not have been called. Do not re-evaluate blocking
conditions.

Determine which of four outcomes applies:
- NO_LICENCE_APPARENT: no control, no catch-all, permitted destination
- EXCEPTION_AVAILABLE: controlled, but a supplied exception may apply
- LICENCE_REQUIRED: controlled or catch-all engaged, no exception available
- PROHIBITED: no licensing pathway exists for this combination

Where an exception may apply, you must evaluate EVERY condition supplied for
that exception, individually. For each, return MET, UNMET or UNVERIFIABLE with
the evidence relied upon. An exception whose conditions are not all MET is not
available. Never mark a condition MET because it is likely; if you were not
given evidence, it is UNVERIFIABLE.

Where the end use assessment reported a catch-all trigger, a licence is
required regardless of classification, including where the item is
unclassified. State this explicitly.

Language rules:
- Never write "no licence is required". Write "no licence appears required on
  the basis of X, subject to compliance officer confirmation".
- Never write that the transaction is compliant or may proceed.
- Cite the specific provision for every conclusion.

Return JSON:
{
  "outcome": "NO_LICENCE_APPARENT" | "EXCEPTION_AVAILABLE"
             | "LICENCE_REQUIRED" | "PROHIBITED",
  "regulatory_basis": "<specific provision>",
  "exception_code": "<or null>",
  "condition_evaluations": [{"condition_id":0,"status":"MET|UNMET|UNVERIFIABLE",
                             "evidence":""}],
  "catchall_override": <true|false>,
  "required_authority": "<or null>",
  "required_documents": ["<for any application>"],
  "reasoning": "<the position and its basis>",
  "confirmation_required_statement": "<mandatory human sign-off wording>"
}
```

> The condition evaluation array is what makes an exception claim defensible. A vendor that reports "exception STA applies" without per-condition evidence has given the client a liability, not a control.

---

## 9. Golden Test Set

Without this, agent accuracy is an opinion. With it, accuracy is a number that gates publication.

### 9.1 Structure

```
{
  "case_id": "GT-0001",
  "tier": "CLEAR | EDGE | ADVERSARIAL",
  "source": "PRACTITIONER | ENFORCEMENT_CASE | CLIENT_HISTORY | SYNTHETIC",
  "agent": "CLASSIFY | END_USER | END_USE | LICENCE | EXTRACT",
  "inputs": { },
  "expected": {
    "outcome": "",
    "critical_fields": { },
    "must_not_contain": ["<prohibited phrasings>"]
  },
  "rationale": "<why this is the right answer>",
  "added_by": "", "added_at": ""
}
```

### 9.2 Composition target

| Tier | Share | Character |
|---|---|---|
| CLEAR | 40 percent | Unambiguous. Commodity goods with obvious outcomes. Catches gross regression. |
| EDGE | 40 percent | Just above or below a threshold, ambiguous specification, partial information. Catches calibration drift. |
| ADVERSARIAL | 20 percent | Constructed from real diversion patterns. Front company profiles, undisclosed onward transfer, catch-all on uncontrolled goods, transliteration variance. |

- Minimum eighty cases before pilot go-live; a hundred is a better target
- Every published enforcement action you can reconstruct is a free adversarial case with a known answer
- The pilot client’s transaction history is the richest source, and building the set from it is itself a compelling sales demonstration

### 9.3 Asymmetric accuracy gates

False positives and false negatives are not equally costly here. A false positive consumes review time. A false negative is a violation. The gates reflect that.

| Agent | Metric | Gate |
|---|---|---|
| Classification | Controlled versus uncontrolled binary accuracy | 98 percent or higher |
| Classification | Exact entry match | 85 percent or higher |
| Classification | Controlled item returned as uncontrolled | Zero tolerance — any occurrence blocks publication |
| End use | Catch-all trigger recall | 100 percent on the adversarial tier |
| End user | Front company profile detection | 90 percent or higher on the adversarial tier |
| Licence | Exception condition marked MET without evidence | Zero tolerance |
| Extraction | Party name field accuracy | 99 percent or higher |
| All agents | Prohibited phrasing appears in output | Zero tolerance |

> Exact entry match is set deliberately lower than binary accuracy. Selecting a neighbouring entry within the same category is a review-queue outcome. Declaring a controlled item uncontrolled is a shipment that should not have left. The gates encode that difference.

### 9.4 Publication workflow

- Draft version created and edited in the admin dashboard
- Executed against the full golden set
- System reports every case where the outcome differs from the current published version
- Any zero-tolerance breach blocks publication outright
- Reviewer examines the differences and publishes or discards
- On publication the version becomes immutable and receives an identifier
- Rollback available; affected cases identifiable by version

---

## 10. Live Calibration

### 10.1 Override rate

The most useful product metric available. Tracked per agent, per tenant, per outcome type.

| Override rate | Interpretation | Action |
|---|---|---|
| Under 10 percent | Well calibrated | None |
| 10 to 25 percent | Acceptable; inspect the pattern | Review which outcome type dominates |
| 25 to 40 percent | Miscalibrated | Threshold or prompt revision |
| Above 40 percent | Generating noise rather than value | Treat as a defect |

> An agent overridden half the time is worse than no agent, because it consumes review capacity while teaching the officer to distrust the output. Watch this number more closely than any other during the pilot.

### 10.2 Additional monitors

- Confidence distribution per agent — a distribution clustered at the threshold indicates a poorly placed threshold
- Insufficient-information rate — rising values mean intake is not capturing enough
- Candidate-set-inadequate rate — indicates stage one narrowing is failing
- Latency and error rate per agent version
- Cost per case per agent, against the modelled figure

### 10.3 Feedback loop

Every override is a labelled example. Where a compliance officer overrides a determination and records a rationale, that case is a candidate for the golden set. Reviewing overrides monthly and promoting the instructive ones is the cheapest accuracy improvement available, and it compounds.

---

## 11. Failure Behaviour in Prompts

Every prompt must define what the agent does when it cannot answer. Silence or a confident guess are both unacceptable.

| Situation | Required agent behaviour |
|---|---|
| Input lacks a needed parameter | Return insufficient information and name the parameter. Never assume. |
| Correct candidate not in the supplied set | Return candidate set inadequate. Never select the closest available. |
| Conflicting information in the inputs | Report the conflict as a finding. Do not silently prefer one source. |
| Document illegible | Return not readable with a reason. Never partially transcribe. |
| Assessment possible but weakly evidenced | Return the assessment with low confidence and populate information gaps. |

> The platform treats every one of these as a review-queue outcome, never as a clear. An agent that cannot answer produces a question for a human, not a pass.

---

## 12. Build Order for This Document

| Step | Work | Depends on |
|---|---|---|
| 1 | Extraction prompts and their test cases | Nothing — start here |
| 2 | Classification stage one and two | Control list loaded |
| 3 | Classification stage three | Stage two returning candidates |
| 4 | Golden set, clear tier | Practitioner input |
| 5 | End user and end use prompts | Nothing — parallel with 2 and 3 |
| 6 | Golden set, edge and adversarial tiers | Enforcement case research |
| 7 | Licence determination prompt | Classification and both assessments producing output |
| 8 | Publication workflow and gating | Golden set complete |

> Steps 4 and 6 are the ones only you can do. Everything else can be built and then validated; the test set has to be authored by someone who knows the right answers.

---

> The platform recommends and evidences. The compliance officer determines.

