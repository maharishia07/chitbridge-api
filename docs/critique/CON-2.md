# CON-2 critique - a STOP reply withdraws marketing consent (22 Oct 2026)
The critic review is the spec: docs repo `23-connectors-and-integrations/reviews/CON-2-critic-2026-10-22.md` (2efe75b). This is the builder's pointer and the checks done before code.
**VERDICT: BUILD WITH CHANGES** - the 4 changes C1-C4 are in the brief and built.
(a) Assumptions checked against the code (api origin/main ba156cb9):
- true - the webhook resolves the shop from OUR number then calls `capture.createCapture` (routes/capture.js ~159); `cap.duplicate` marks a redelivery.
- true - `privacy.notePref` is the one append-only writer; `LAW[country]` is the one per-country table; `gate()` is the one reader (lib/privacy.js).
- true - `whatsapp-out.notify` is the one sender; inside the 24 h window free text is allowed; `provider_ref` is not on `bindingFor`, so it is read from channel_binding.
- true - `party_contact_pref` has no `source` column (baseline 4250-4267) -> b777, checked with `schema.hasColumn` before use.
- false - "git branch con/..." : `con` is a Windows device name (rule 4), so the branch is `connect-con2-stop-replies`.
(b) Conflicts: none. One word list (LAW), one writer, one sender, one gate. No second country read: `shopFacts` also replaces logRequest's inline read.
(c) Simpler way: none that keeps a shared phone safe; the number-match union (C2) is the least that fails safe.
(d) Risks: over-withdrawing on a 9-digit tail collision (safe direction); local-language words need cb-country; b777 is Athi's to run; twin web PR is one label.
(e) Not built: START (CON-2b), e-mail STOP (unverified From:), shop name / quiet hours on offers (MKT-8).
