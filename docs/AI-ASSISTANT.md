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
  The old `coHelpBox`/`composeHelpBox`/`menuHelp` render functions are now unused (safe to delete later); the
  content arrays (`HELP_PACKS`/`CO_HELP`/`COMPOSE_HELP`) remain as the source folded by `buildAssistLib`, and
  `HELP_PACKS[key].msg` still feeds the inline banner.
- **Next:** real screen clips into `public/app/assets/`; then the real AI behind `assistAsk`/`helpAsk` (LLM over
  the library + live context, keeping the honest / no-oversell guardrail).

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
