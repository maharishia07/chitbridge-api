# T1-AI critique — written before any code (rule 00)
Missing on the runner: ../chitbridge-docs is empty (RECONCILIATION-2026-10-14.md, area README, DISCIPLINES.md) — built from the brief's inline copy.
(a) Assumptions, checked
- lib/ai.js reads only the first content block — TRUE, lib/ai.js:337 `j.content[0].text`. A thinking/tool block first blanks every skill.
- Model ids come from "the slot configuration" — FALSE today: no slot→model config exists. ai.js:12 and assist.js:95/165/224 hard-code `claude-haiku-4-5-20251001` four times; ai_skill (b110) has no model column.
- negationIn/verifyQuantity exist — TRUE (lib/numerals.js:189, :271). verifyQuantity runs on raise (capture.js:246); negationIn runs NOWHERE outside scripts/prove-numerals.js. Compose fill (`line-item-draft`, app.html:6330 → governance.js:402) runs neither, and its prompt asks for no raw_phrase.
- numerals.js is ADOPTED from engines (header: DO NOT EDIT) — the guard must CALL it, not change it. "half" is already 0.5 (EN table); "1/2" is not read — engines change, not this round.
- Three direct model calls in routes/assist.js — TRUE (ask :95, conform :165, catalogue intro :224) on ASSIST_LLM_API_KEY via the SDK, no wallet, no daily cap, no ledger.
- Privacy register — lib/privacy.js:31 FACTS lists Anthropic as "lib/ai.js" only; the assist routes are a second, unlisted path.
- Seed drift: the in-code message-to-chit seed lacks b141's raw_phrase (the table wins in prod; the seed is the self-heal).
(b) Conflicts
- invokeSkill refuses a call it cannot meter to an entity (ai.js:273, S1). /api/assist and conform/catalogue-structure accept ANONYMOUS callers → through the one pipe an anonymous caller gets the library floor / deterministic verdict (no model). Correct by S1; a visible behaviour change.
- Skills are data: a new skill absent from a populated ai_skill table would 400 until a migration runs → getSkill falls back to the SEED only for ids the table has never heard of (an inactive row stays retired).
(c) Simpler way: widen invokeSkill (opts: grounding block, smaller max_tokens, timeout) instead of a second caller; lift the raise's inline quantity check into one helper both raise and compose fill call.
(d) Risks: default model id changes when AI_MODEL is unset (owner confirms the env); ASSIST_LLM_API_KEY retires — the assist uses ANTHROPIC_API_KEY (ASSIST_LLM_PROVIDER stays the on-switch); migration b433 (ai_skill.model + 3 skills + prompt patches) — code works before it runs; numerals stays engines-owned.
(e) VERDICT: BUILD WITH CHANGES — anonymous assist callers fall to the floor (S1); getSkill seed fallback for unknown ids; one quantity-guard helper (lib/line-guard.js) because numerals.js is vendored.
