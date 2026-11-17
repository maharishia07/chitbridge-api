# Offer Lab — the panel layout (requirement for the designer)

From the 16 Oct walk (WALK-REG R55/R56, `C:/dev/docs/29-qa-test-tooling-ux-locale-and-design-system/WALK-REG-2026-10-16.md`).
Athi: *"why can it not follow the same panel idea — the left side shows all the offers, click any offer, for which we can open the
settings?"* · *"give it to the designer and make it perfect, and use the flow we already have."* Pass mark: `docs/design/SYSTEM.md`.
Walk mock-up (layout only, sample data): `C:/dev/toolset/walk-mocks/offer-lab-panel.js`.

## Keep the flow we have — change the layout
Today `offer-lab-next.html` runs three numbered steps: **1 Settings** (margin threshold · loyalty bonus — shop-wide) → **2 Offer** (one offer)
→ **3 Work it out** (the offer engine checks it against step 1). Same engine, same saved offers, same "work it out" — but step 1 is not a
step, it is the shop's rule for every offer. So:

| Area | What it holds | From today's page |
|---|---|---|
| Top line | "Offer rules: every offer keeps ≥ 25% margin · loyalty bonus up to 10% ✎" — ✎ opens the two fields inline | step 1 |
| Left panel | Every offer the shop has (saved + live): name · kind · when · ✓ clears margin / ⚠ below. "+ New offer" on top. Filter by kind and by ✓/⚠. | "Saved offers" |
| Right panel | The selected offer: What (kind + terms) · For whom (everyone / a segment — customer-only offers) · When · then its result straight away: customer pays · your margin after it · ✓/⚠ against the rule. Actions: Put it live · Try on a sample basket · Duplicate · Stop. | steps 2 + 3 on one page |

**+ New offer** → a picker of every kind the offer engine supports (`offer_kinds`; the engine's 31 tested scenarios: % off · amount off ·
buy X get Y · bundle price · tiered · customer-only · combos …), grouped by family, each with a one-line example in the shop's currency.

## Rules
- Cost is read only here (DECISIONS: "cost never travels") — the margin figure never leaves the Lab.
- The result is the engine's answer (`/api/offers/evaluate` · `explain`), never arithmetic on the page.
- **Specific to the shop and country** (Athi: *"it has to be specific to the shop, country etc, cannot be drifted"*): currency, units, sample
  basket and sample shop from the shop's country pack (and kind of business). Today the UAE shop sees "Whole ₹" and "Sample Tiffin Corner".
- Colours: the app tokens only (Athi: *"use the avatar panel colors"*) — the theme the person chose.
- Same panel pattern as Settings (sidebar list → detail), phone: list first, tap → detail full-screen, back.

## States to draw
No offers yet (the picker is the empty state) · several offers, one ⚠ · an offer that clears the rule · editing the rule line · phone 390 px.
