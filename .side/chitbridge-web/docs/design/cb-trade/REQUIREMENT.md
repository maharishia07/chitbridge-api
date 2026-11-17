# Designer brief — CB Trade (export & import)

**Status:** brief for design. **Not built.** **Pass mark:** `docs/design/SYSTEM.md`. Decision: DECISIONS.md 2026-10-09 "CB Trade … creates the export documents".
Visual reference (dummy, illustrative): the Country lens https://claude.ai/artifact/VZXhvmm2A3ipbwF2SiYrPz — one country / compare all three, the currency
overlay, the lane panel (laws · standards · EXIM documents · words of caution).

## Who and why
A shop that sells to, or buys from, another country (a spice exporter to Australia, a dealer importing from the UAE). They must see, for ONE
lane, what the law asks, what they already hold, and get the documents out — in the buyer's currency, with the ₹ value — without an agent.

## Four parts (tabs)
1. **Lanes** — pick a lane (India → Australia …): Laws · Standards · EXIM documents · Words of caution, each row with its status
   (in force / partly / planned) and proof, from the Standards register's lane rows; "Compare countries" opens the side-by-side view.
2. **Ready?** — for that lane: what you hold ✓ / missing ✗ (IEC code, FSSAI, halal, LUT, BIS…), each with one action ("add your IEC"),
   read from Trade ready + Know your business (one source). One line on top: "Ready for India → Australia: 5 of 7 · 2 missing".
3. **Deals** — orders and bills with foreign parties (the rail's chits): their currency first, ₹ beside it, the rate, its source and date.
4. **Documents** — from a deal: Export invoice (foreign currency + ₹ at the customs-notified rate, zero-rated/LUT wording), Packing list,
   Certificate of origin (agreement: India–Australia ECTA, India–UAE CEPA). Fill → check → sign → print/send. Reuse the Documents
   (authority forms) engine.

## Shots wanted
Laptop + phone, light + dark: Lanes (IN→AU) · Ready? with 2 missing · a Deal in A$ with ₹ beside · the Export invoice preview · the
Certificate of origin preview · the compare view.

## Not in this brief
Live customs/ICEGATE filing, freight booking, LC handling (UCP 600 is "planned" on the register), payments abroad.
