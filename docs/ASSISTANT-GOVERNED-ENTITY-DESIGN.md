# The Assistant as a governed entity — one-page design

**Vision.** The platform's own help/AI-assistant knowledge is not a bespoke table — it is a **governed entity that
lives on Chit & Bridge itself**, using the same schema → catalogue → chit → provenance machinery every customer
uses. The platform runs its own help *as a business on the platform*. That is the showcase: *"our own product is
the first tenant, and its assistant is powered by the same engine we sell."*

## 1. Schema vs content — the load-bearing distinction
- **Schema = structure (the mould). Rarely changes; versioned & governed.** A knowledge item = `{question,
  answer, context[], topics[], fit, media}`. Changing the *shape* (add a field) is a deliberate governance event.
- **Catalogue = content (records). Grows constantly.** Every Q&A is a **record/chit conforming to the schema**.
  Adding 1,000 questions never touches the schema. **The schema manages the content; it is not the content.**

## 2. The model
```
Help ENTITY (source / protected, ships at INSTALL)
   └─ SCHEMA: {question, answer, context[], topics[], fit, media}     ← structure, versioned
        └─ CATALOGUE: the approved Q&A library                        ← content, grows
             └─ served via PUBLIC PROJECTION → assist_qa → GET /api/assist/questions
```
- **Base** knowledge ships as the source entity and **propagates to every registered entity** as help.
- An entity may add its **own private** items on top (template → instance). Base flows down; local layers on.
- **Serving stays a public read projection** (`assist_qa`) because the assistant answers pre-auth, while chits are
  tenant-isolated + auth'd. Authoring/governance happen on the entity; serving is a projection of approved items.

## 3. New-learning chit lifecycle — the reconciliation is the point
A received chit is a **raw proposal, never auto-published.** Two steps before it can go live:
1. **Iron it out (normalise):** clean wording, tag `context`, extract `topics`, honesty-check the answer.
2. **Reconcile with the catalogue (triage):** match against what exists and decide a **disposition** —
   - **duplicate / near-dup → reject or merge** (no second "What is a co-assist?");
   - **better answer to an existing item → REFINE it** (fine-tune, don't add);
   - **genuinely new → ADD**.

```
draft → triage(normalise + match) → { NEW · REFINE-existing · REJECT/MERGE } → approve → live → project
```
Fine-tuning is a **versioned replace**: the new answer goes live, the old is **sealed in history** (provenance +
version-freeze). The catalogue **improves, not just grows** — the discipline the flat seed can't enforce alone.

## 4. Two AI loops — don't conflate them
- **Fast loop — AI grows CONTENT (99%).** Captures real unanswered questions, **drafts Q&A chits**, proposes the
  disposition ("looks like a near-dup of `ca_scope`; here's a tighter merged answer"). Human/policy approves.
- **Slow loop — AI *proposes* a SCHEMA change (rare).** If answers keep wanting a missing field, AI suggests
  extending the schema; a human **governs** that change (versioned). **AI increases the catalogue, not the schema.**

## 5. First iteration — a working proof, two paths
Goal: check the concept end-to-end (author → triage → approve → serve → improve) in working condition.

**Critical unknown to VERIFY FIRST:** can the current schema/governance engine host a **custom-field schema**
(question/answer/context…) for a **non-deal source entity**, render it in schema-driven compose, and version it?
- **If YES → Path A (true dogfood, best showcase):** provision a Help source entity; define the Q&A schema;
  author questions as **chits**; triage = the chit status lifecycle (draft→review→approve); on approve, **upsert
  into `assist_qa`** (the projection already built). The help system literally runs on the platform.
- **If NOT YET → Path B (bounded, still proves the loop):** keep `assist_qa` as the store; add `status`
  (draft/approved) + a lightweight **review screen** (list pending, near-dup check via server-side `matchLibrary`,
  buttons: Add / Refine / Reject) + **gap capture** (assistant's unanswered question → a draft row). Migrate
  authoring onto the entity/schema engine later — `assist_qa` stays as the projection either way.

**Required regardless of path (small, mostly built):**
1. `assist_qa` gains a **lifecycle**: `status` (draft/approved), keep `active` for serving (serve approved+active).
2. **Gap capture:** when `matchLibrary`/LLM returns nothing useful, POST the question as a **draft** (the feedback).
3. **Review + disposition:** a screen (cap-admin feature) — pending list, near-dup match, Add/Refine/Reject.
   Refine = versioned replace (add `version` + `superseded_by`, or a `assist_qa_history` row).
4. **AI assist (enhancement, not a blocker):** wire `/api/assist` (LLM) to (a) answer, (b) draft a proposed Q&A
   for a gap, (c) flag near-dups. Deterministic `matchLibrary` already gives the floor without the LLM.
5. **Projection:** approve → serve (already the read path).

## 6. Why it's the showcase
- One engine, dogfooded: schema, catalogue, chit lifecycle, provenance, version-freeze — proven on our own help.
- The assistant visibly **learns**: a gap becomes a reviewed, approved, served answer — on the record.
- When the LLM is wired, the platform is *also* an AI assistant, grounded on its own governed catalogue.

## 7. Open items to decide
- Path A vs B (depends on the §5 verify).
- Approval policy: human-in-the-loop vs auto-approve high-confidence AI drafts (start human).
- Where "refine history" lives (column vs `assist_qa_history`).
- Base-vs-local precedence when a local item overrides a base answer.
