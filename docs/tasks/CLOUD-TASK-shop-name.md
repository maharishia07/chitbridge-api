# Cloud task — the shop's name is the profile's name; a mismatch is reported, never hidden

**Outcome (one):** everywhere the API names the shop (the counter's snapshot `shop.name`, the order invoice, Trade
ready, network offers), the account's own name (`identities.display_name`) wins; a trade name copied into the vault
(e.g. by the Tally connector) only fills it when the profile's name is empty. When the two differ, the profile-map
answer (`GET /api/integrations/profile-map`) carries a `name_mismatch: { profile, other, source }` block so the web
profile page can show a note. Decision: `C:\Users\mahar\DECISIONS.md` is not in this repo — the rule, verbatim:
*"The shop's name is the profile's name (Athi, 2026-10-01). The account's own name wins everywhere it is shown;
a trade name copied in from Tally or the vault only fills it when it is empty. The two should match, and when they
differ the profile page says so."* Found live: Tallytest's counter showed "CB Test Traders" (its Tally company name).

**Branch:** you are on `cloud/shop-name` (cut from `main`). Open a PR against `main`; never push to `main`.

## Build (all in `lib/profile.js` unless stated)
1. `invoiceParty`: `trade_name: me.display_name || tag.trade_name || null`. `legal_name` is a SEPARATE fact and stays
   as it is (`tag.legal_name`) — the legal name is what a tax invoice prints as the legal name. Check `name:` (today
   `tag.legal_name || me.display_name`) is left alone and say so in the PR.
2. `profileValues`: for the key `trade_name` only, the profile's value is kept even when a vault row has an equal or
   higher rung; the vault's differing value is recorded on it as `other: { value, source, rung }`. Every other key
   keeps today's rung ranking untouched.
3. The profile-map route (`routes/integrations.js` ~470) adds `name_mismatch` when `trade_name.other` exists and
   differs (case- and space-insensitive compare), else omits it. Nothing else in that answer changes shape.
4. Header comment on `invoiceParty`: quote the decision and the date.

## Proof (exit codes; commit outputs) — OFFLINE ONLY
- New `tests/shop-name.test.js` (pattern: the existing offline tests, e.g. `tests/rev01-price-includes-tax.test.js` —
  stub the db/vault exactly the way they do; never a real database): both set and different → `invoiceParty().trade_name`
  = the profile's name, `profileValues().trade_name.other.value` = the vault's, profile-map has `name_mismatch`;
  same name differing only in case/spaces → no mismatch; profile name empty → vault name used, no mismatch;
  `legal_name` unchanged in every case; a non-name key (e.g. `address`) still follows rung ranking.
- A breaks file `tests/shop-name-breaks.test.js` (restore from a COPY; anchors on one line): revert the precedence,
  drop the `other`, report a mismatch for a case-only difference, let the vault win `trade_name` — each caught.
- Add the new test to the offline guard set the same way `tests/rev01…` and the two-sided tests are listed
  (`scripts/guards.cjs` or wherever the offline set lives); run that set → 0.

## Do not touch
SQL, migrations, `tools/tally-connector/*` (the connector keeps writing what it writes — only the READ precedence
changes), `public/till.html`, any route other than the profile-map one, live services (no DATABASE_URL, never call
the live API). Commit messages end with `Co-Authored-By: Claude <noreply@anthropic.com>`.
