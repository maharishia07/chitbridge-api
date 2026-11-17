# K2b critique — till-scale without sleeps, without the race (supersedes web #160)

**(a) What the brief assumes, checked**
- "#160's boot wait raced the seeding" — PARTLY FALSE. #160's wait (`#tillpill` ≠ 'till' + networkidle) is late in load(), but the
  EMPTY bill has a second, deterministic cause: #160 deleted the 400 ms sleeps on the claim that `searchTyped()→scanned()` is
  synchronous (docs/critique/K2.md). It is not: `addWeighed()` is `async` and awaits `ageAllow()` before `CART.push`
  (public/till.html:16889-16897), and `add()` awaits `modOpen()` (till.html:16296, 16372). Reading CART on the same tick → empty, 5/5.
- "the page already exposes a load-finished signal" — FALSE. Boot is a bare `load();` (till.html:27437); nothing records its end.
  `#tillpill` is painted mid-load (6690) with paints, draftResume and a possible refresh() after it; `HOST._retained` is private.
- The seeding race itself is TRUE: boot `load()` → `pickHost()` sets `CloudHost.key = ls.get('cb_till_key')` (6477) = null, and
  `S = catRestamp(...)` (6643); landing after the harness seed, that unpairs the counter (needShop stops the soap) or replaces S.

**(b) Conflicts with rules / constructs.** One master: the hook goes in api tools/tally-connector/till.html and is copied by
vendor-till (twin PR, same branch). No money, tax, shape or new screen. One wait helper in the harness, not a library.

**(c) Simpler way.** Smallest hook: `var TILL_BOOT = load();` — the boot promise, named (a top-level var, so window.TILL_BOOT).
No new function, no event, no product behaviour change. The harness awaits it, then seeds, then waits per step on the effect
itself: the line on CART, the line's net after price(), the words in #lastnote, the settings control's own effect.

**(d) Risks.** Twin landing: api till-vendor --check reads the web copy → land web and api together (web first). walks.yml walks a
twin api branch, so CI sees the matched pair. Other rounds editing till.html → vendor conflicts are one line. No SQL (b394–b396
unused), no engines, no route, no dependency. The 20× proof costs one extra CI job (~2 min) on every PR — kept small by running only
the files in run-shard's REPEAT list.

**(e) VERDICT: BUILD WITH CHANGES** — (1) fix the real cause (async add) with per-step conditions, not just the boot wait;
(2) the boot signal is a one-line named promise in the till master, vendored; (3) proof = run-shard `--repeat` (20× job) and
REPEAT ×3 inside the walks set.
