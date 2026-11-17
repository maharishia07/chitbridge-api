# Floating AI assistant — design + roadmap

A single, context-sensitive assistant on **every page** (pre-auth *and* in-app) that consolidates the scattered
help + KB. You describe your problem; it points you to the right tool/facility. Pre-auth it honestly assesses
**fit** ("is this for you"). Library-backed, rich-media ready, **built not to oversell**.

## Built now (v1 — web `63caa7d`)
- A floating **💬 Assistant** button (bottom-right) on every page, mounted from `route()` (survives re-renders;
  appended to `document.body`, so it shows pre-auth on welcome/login/register too).
- **Context-sensitive:** `curScreen()` reads the current screen (`UI.nav` post-auth, the hash pre-auth) and seeds
  the relevant suggestions; pre-auth it surfaces **fit** entries first.
- **Library-backed matching:** `assistAsk()` keyword-scores the question against `ASSIST_LIB` (topic hits weighted,
  plus word overlap) and returns the best entry — or honestly says "I am not certain… I will not guess or oversell."
- **Rich media ready:** an entry can carry `media:{type:'img'|'video', src}` → rendered inline (text / picture / movie).
- **Honest fit:** entries can carry `fit:'good'|'maybe'|'no'`, shown with the answer (so it can say "probably not").

## Library entry shape (`ASSIST_LIB`)
```js
{ id, topics:[...keywords], q:"question", a:"plain answer",
  fit?:'good'|'maybe'|'no',           // for pre-auth qualification
  context?:['welcome','task','*',...],// which screens surface it ('*' = everywhere)
  media?:{ type:'img'|'video', src }  // optional picture/movie
}
```

## Consolidation (single source)
- **DONE (web 9658a74):** `buildAssistLib()` folds **`HELP_PACKS.qa` + `CO_HELP` + `COMPOSE_HELP`** into `ASSIST_LIB`
  at first open — with topics derived from each question and `context` set to the screen. So the floating assistant
  draws from the same content as the per-screen "?" overlays (no duplication; the source arrays stay as-is and also
  feed the "?" boxes + the banner `HELP_PACKS[key].msg`).
- **DONE (web 4728ab1):** the KB docs (`TRUST.md`, `KB-SCHEMA-CUSTOMIZATION.md`, `KB-your-data-is-safe.md`) are
  distilled into 13 curated `ASSIST_LIB` entries — isolation, durability, security, audit/record, no-dev
  customization, plus the honest pre-auth "new company" + "might not fit you" (with `fit` signals).
- **DONE (web 65b3946):** 5 use-case entries with `media` — `uc_timber`, `uc_pharma`, `uc_services`,
  `uc_aggregator`, `uc_compare` (same engine, different schema). Media renders gracefully: a missing asset hides
  cleanly and shows a "screen clip coming" caption, so no broken images until the real clips land. Drop the clips
  in `public/app/assets/` per its README.
- **DONE (web 26e9360):** the "?" overlays now render from `ASSIST_LIB` (`helpBoxFromLib`) — so the "?" and the
  floating assistant share **both content AND rendering** (one library, one render path, via `assistEntryHTML`).
  The content arrays (`HELP_PACKS`/`CO_HELP`/`COMPOSE_HELP`) remain as the source folded by `buildAssistLib`, and
  `HELP_PACKS[key].msg` still feeds the inline banner.
- **DONE (dead-code removal):** the now-unused render functions `coHelpBox`/`coAsk`/`coAskFree`,
  `composeHelpBox`/`composeAsk`/`composeAskFree`, and `menuHelp`/`mAsk` are deleted. Retained: `coBanner` (inline
  banner), `menuAssist` (inline banner), and `mAskFree` (still used by `assistPage`'s Ask box).

## Reliability seam — `answer()` (continuity if the AI ever fails)
**DONE.** Both consumers (`assistAsk`, `helpAsk`) now route through a single **`answer(question, contextKey)`**
seam, with the keyword matcher factored into `matchLibrary()`. The seam is **tiered so the assistant degrades,
never breaks**:
1. **tier 1 — LLM (future):** slots in ABOVE `matchLibrary`, wrapped in a **timeout + try/catch**; on ANY
   error/timeout/rate-limit it **falls through to tier 2 in the same turn** — the user sees no error, just a
   slightly-less-smart answer.
2. **tier 2 — `matchLibrary` (the floor):** deterministic keyword match over `ASSIST_LIB`, **pure client-side,
   zero network** — works offline / API-down / LLM-down. *This is the always-on chatbot; it cannot be "down."*
3. **tier 3 — caller's static fallback:** suggested Q&A buttons + curated overlay when tier 2 finds nothing.

`answer()` is **async on purpose** so the LLM tier drops in later **without changing any caller**. Principle (keep
it): *the deterministic library answer is the floor; the LLM is an enhancement that must never be a single point
of failure.*
### Tier-1 LLM stub — wired (client seam), gated OFF
**DONE (client).** The tier-1 seam is now real but disabled by default:
- `CFG.ASSIST_LLM` (default **`false`**) gates tier 1 — with it off, `answer()` is matcher-only (no behaviour change).
- `askLLM(question, contextKey)` is the stub: it **calls our backend proxy** `EP.assist → POST /api/assist`
  (the model key **never** touches the client), and returns a library-shaped `{q,a,fit?,media?}` or `null`.
- `answer()` runs `Promise.race([askLLM, _timeout(6000)])` inside try/catch; **any** failure (disabled / demo /
  endpoint-missing / timeout / network / bad shape) falls through to `matchLibrary`. `askLLM` also returns `null`
  in demo mode (never call a model from the no-login mock).
- So flipping `CFG.ASSIST_LLM=true` *before* the backend exists is safe: `/api/assist` 404s → caught → library
  floor answers. The fall-through is observable in the tester log (`cblog` warns the 404).

**Backend proxy `POST /api/assist` — STUB BUILT (api `routes/assist.js`, mounted + rate-limited in `server.js`):**
- **Request:** `{ q:string, context:string, stage:string }` (+ optional `Authorization: Bearer` for post-auth).
- **Response (real):** `{ answer:string, fit?:'good'|'maybe'|'no', media?:{type,src,caption} }` (matches a lib entry).
- **In place now:** input validation (`q` required, ≤500 chars → 422); **soft/optional auth** (`softIdentity` —
  attaches a minimal tenant-scoped identity if a valid token is present, else anonymous/public-KB-only; never
  throws, so the assistant works pre-auth); the **no-oversell `SYSTEM_PROMPT`** held server-side; a dedicated
  rate limiter (`ASSIST_RATE_LIMIT_MAX`, default 40/15m); `safeErr` on 500.
- **Gating:** with no `ASSIST_LLM_PROVIDER` + `ASSIST_LLM_API_KEY` env (the default/held state) it returns **503**
  ("not configured") and logs an **info** line — the client catches it and uses its library floor. If a provider
  is set but the SDK call isn't implemented yet it returns **501**. Smoke-tested: empty/long→422, valid→503.
### Real Haiku call — WIRED (dormant; turns on only when you add a key)
**DONE.** The provider call is implemented in `routes/assist.js` using `@anthropic-ai/sdk` (added to
`package.json`):
- **Model:** `claude-haiku-4-5-20251001` by default (override with `ASSIST_LLM_MODEL`) — small/fast/cheap, right
  for help/onboarding. `max_tokens: 400` bounds output cost.
- **Grounding:** `lib/assist-kb.js` — a server-side, **honest** knowledge base (every line must be TRUE; planned
  features are listed under "NOT YET BUILT"). Kept server-side so it's tamper-proof and **prompt-cached**
  (`cache_control: ephemeral`) — the repeated grounding is charged ~90% less after the first call. Usage
  (incl. `cache_read`/`cache_write` tokens) is logged per call.
- **Guardrail:** the no-oversell `SYSTEM_PROMPT` is always the first system block.
- **Isolation:** anonymous callers are grounded on the public KB only. A tenant-scoped block would be added ONLY
  when `identity` is set (P0 invariant — never another entity's data). None is sent yet.
- **Degradation:** SDK lazy-required (missing dep → 503, not a boot crash); 8 s timeout + 1 retry; **any** model
  or network error → **502**, so the web client falls through to its library floor. Verified: no key → 503,
  bad key → real API 401 → 502, empty/long q → 422.

**To turn it on (when you choose):**
1. Get an Anthropic API key (console.anthropic.com) and **set a low monthly spend cap** (e.g. $5–10).
2. Add to the API env (`.env`, never the client): `ASSIST_LLM_PROVIDER=anthropic` and `ASSIST_LLM_API_KEY=...`
   (optionally `ASSIST_LLM_MODEL=...`, `ASSIST_RATE_LIMIT_MAX=...`).
3. Flip `CFG.ASSIST_LLM=true` on the web (`app.html`).
Until step 2 the endpoint returns 503 and the assistant runs on its free library floor — no cost, no behaviour change.

### Screen contexts — `coassists` + `schema` added
**DONE.** Sharper, screen-specific entries so the assistant is useful on those surfaces:
- **`coassists`** (5 curated entries): what a co-assist is, push/pull/bulk assignment, scoping/limits, break/leave
  returning work to the pool, and the honest "non-human participants are planned, not live yet".
- **`schema`** (5 curated entries): what a schema/blueprint is, changing the fields a deal carries, no developer
  needed, sealed-record behaviour when a schema changes, and how schemas differ across businesses. Tagged
  `context:["schema","compose","register"]` so they surface where schema is actually touched (Compose + register),
  since there is no standalone schema screen yet.
- **Server (`routes/assist.js`):** a `CONTEXT_HINTS` map turns the `context` the client sends (`curScreen()`) into
  a one-line steer injected into the prompt (`coassists`, `schema`, `compose`, `disputes`, `network`, `catalogue`,
  `suppliers`) — so the real Haiku answer is tailored to the screen, not generic.

- **Next:** real screen clips into `public/app/assets/`; (later) optionally extend the same backbone to
  AI-assisted **schema building** and richer **co-assist** guidance — both bigger features on top of this seam,
  not a flag flip.

## Phased roadmap
1. **v1 (done):** floating widget + seed library + keyword match + context + media support + fit-check.
2. **Fill the library** — migrate HELP_PACKS/CO_HELP/COMPOSE_HELP + KB; add the use-case entries with media.
3. **Real NLU/AI** — back `assistAsk` with an LLM over the library + (post-auth) the user's live context, instead of
   keyword match. Keep the "honest, no-oversell, says when it doesn't know" guardrail in the prompt.
4. **Pre-auth fit funnel** — a short guided "is this for you" (ties to the simulator/fit questions); capture a lead only if they opt in.
5. **Analytics** — which questions are asked / unanswered → grows the library; surfaces product gaps.
6. **Rich media** — short screen clips per use case.

## Principles (keep these)
- **Honest, not salesy** — fit can be "probably not"; say "I don't know" rather than guess.
- **Context first** — answer for the screen the user is on.
- **One library** — the assistant, the "?" overlays, and the KB draw from the same source of truth.
- **Pre-auth value** — help a prospect decide *before* signing up.

Cross-refs: `KB-SCHEMA-CUSTOMIZATION.md`, `TRUST.md`, `MESSAGING.md` (the "?" help these consolidate into).
