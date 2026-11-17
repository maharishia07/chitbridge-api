<!-- Line 1: a build round's VERDICT (BUILD AS BRIEFED · BUILD WITH CHANGES · STOP) — else what this PR does, in one line. -->

## §6 checklist (DISCIPLINES §6 — numbers from `node tools/readability.cjs --changed --ratchet --md`; CI `pr-checklist` fails without them)
- [ ] Pass 0 · seams: `<word>` → reused/widened `<name>` (or "nothing exists")
- [ ] Pass 1 · shrink: lines `<before → after>` · complexity `<before → after>` · DB trips `<before → after or n/a>`
- [ ] Pass 2 · humanify: cryptic names `<before → after>` · functions with a what-line `<before → after>` · empty catches `<before → after>`
- [ ] Pass 3 · structure: module header present · CARD line · TRACE row: spec `<doc>` · design `<doc>` · unit `<file>` · walks `<files>`
- [ ] Guard green: `readability --changed --ratchet`
