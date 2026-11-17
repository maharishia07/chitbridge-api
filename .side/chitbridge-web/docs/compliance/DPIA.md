# Data protection impact assessment (DPIA) — the platform · DRAFT, for the owner to sign (OWNER-ACTIONS O7)

UAE PDPL Art.21 · DPDP Act 2023 (s.10 for a Significant Data Fiduciary; good practice for us) · ISO/IEC 27701. Drafted 13 Oct 2026 (CO1).
Activities and data: `docs/compliance/ROPA.md`. Not legal advice.

| # | Risk to people | Likelihood · harm | What lowers it today (evidence) | Left to do |
|---|---|---|---|---|
| R1 | One shop reads another shop's customers | low · high | Row-level security per shop, forced (`migration_b49_rls_policies.sql`, b212); every new table closes itself (api `tests/migration-rls.test.js`); b306/b307 use the same policy | — |
| R2 | A shop messages a customer with offers they never agreed to | medium · medium | Consent rows per channel and purpose, never edited; offers refused without consent, with the reason (`lib/privacy.mayMessage`, api `tests/privacy.test.cjs`) | No offer sender calls the gate yet — any future sender must |
| R3 | A request to see or erase data is lost or answered late | medium · medium | The register sets the legal due date and flags late (b307); answered once, never deleted | A screen for it; erase-a-person (dry-run first) |
| R4 | Data leaves India without the person knowing | certain for AU / UAE shops · medium | The processor list with regions is public (`GET /api/privacy/facts`) | Notice text and DPAs (OWNER-ACTIONS O2, O5, O6) |
| R5 | ID numbers exposed (Aadhaar, PAN) | low · high | Masked, hashed and encrypted; consent required when filed by someone else (b174) | Legal answer on holding a full Aadhaar (O4) |
| R6 | A breach is not noticed or reported in time | medium · high | Insert-only sign-in and access logs (b282, b172) | Incident runbook, 6 h / 72 h clocks, durable logs — round CO2 |
| R7 | Records erased too early, or kept forever | medium · medium | Retention is still dry-run only (`lib/retention.js` @stage poc) | Statutory floors per country — round CO3 |
| R8 | A child's data at the online store | low · medium | — | An age line at the store (Standards row "DPDP Act 2023 s.9", Planned) |

**Conclusion (draft):** the residual risks are R4, R6 and R7; each has a named round or owner action. No processing is stopped.

Signed: ______________________ (owner) · date ____________
