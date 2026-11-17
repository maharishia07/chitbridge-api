# REQUIREMENT — Standards, made simple: a matrix, and a door from the index page (for the designer · 2026-10-03)

Athi, 2026-10-03: *"provide the content of the standards available in settings, let us see how we can simplify it through designer
and create a matrix view or something so it makes more sense and will see how to bring it under index"* · *"if you want to include
the recent additions include as well."*

## Today
Settings › Standards (`public/app/cap-admin.js` standardsSettingsHTML; data `public/app/cap-standards.js` STANDARDS, 44 rows): four
tabs (What we follow · What you follow · Your trade · Why bother), each a long list of rows: group · standard · what it covers ·
status (In force / Partly / Planned) · what's missing · where in the app. True and careful (the status column is the point: a
compliance page that overclaims is worse than none), but long, buried in Settings, and hard to read at a glance.

## Ask
1. **A matrix view**: groups (or areas of the business: Selling · Buying · Money & GST · Books · People & privacy · Look & access ·
   How we build) × status (In force · Partly · Planned), each cell a count you can open; or another arrangement you judge clearer.
   The honest status stays (Partly/Planned always say what's missing, rule: no overclaim).
2. **Two audiences, one page**: the SHOP ("what does this protect me from?") and a BUYER / CA / auditor ("which standard, which
   clause, is it in force?"). Plain words first; the standard's name and clause one tap away.
3. **A door from the index page**: a small "Standards" box or link (with the RAIL box and "Read me" pattern already decided for the
   index page), opening the matrix; Settings keeps the editing parts only.
4. The frozen look (docs/design/list-standard, SYSTEM.md §3a, DESIGNER-MEMORY.md), all themes, phone first, ≤ 3 columns per list.

## The content — counts by group today
| Group | In force | Partly | Planned | Total |
|---|---|---|---|---|
| Verification | 1 | 2 | 0 | 3 |
| Localisation | 6 | 2 | 0 | 8 |
| Accessibility | 5 | 2 | 0 | 7 |
| Records & data | 5 | 2 | 4 | 11 |
| Commercial | 2 | 1 | 4 | 7 |
| Identity & access | 0 | 3 | 2 | 5 |
| Platform | 3 | 0 | 0 | 3 |
| **All** | **22** | **12** | **10** | **44** |

## Recent additions (adopted 2026-10-02/03, NOT yet in the register; add them)
| Group (proposed) | Standard / law | What it covers | Status |
|---|---|---|---|
| Books | Golden rules of double entry (personal · real · nominal) | Every line's Dr/Cr placed by rule; shown in the ＋ Entry preview | In force |
| Books | Companies Act 2013 s.128 + Rule 3(1) Accounts Rules (audit trail, from 1 Apr 2023) | Books insert-only; corrections by reversal; change log | In force |
| Books | Schedule III, Companies Act (Division I) | Balance sheet and P&L presentation; GST credit as an asset | In force (company format); proprietor format: one Capital account |
| Books | AS 2 / Ind AS 2 (inventories) | Closing stock at the lower of cost and NRV | In force (manual count); automatic waits for quantities |
| Books | AS 10 / Ind AS 16 + Schedule II; Income-tax Act s.32 + Appendix I (WDV, 180-day rule) | Assets, depreciation by entity type | In force (register b280) |
| Books | Tally voucher types (Sales, Purchase, Receipt, Payment, Contra, Credit/Debit note, Journal) | Voucher series SV/PV/RV/PY/CV/CN/DN/JV; manual MJ | In force |
| Books | SA 505 (external confirmations) | Party balance confirmation; monthly mutual reconciliation | Planned |
| Books | SA 240 (fraud risk: manual journals tested first) | Manual entries numbered MJ, filterable | In force |
| Money & GST | CGST Act s.49 / 49A / 49B, Rule 88A | GST set-off order; CGST and SGST never cross | In force |
| Money & GST | CGST Act s.9(3)/9(4) + notifications; s.49(4) / Rule 86(2) | Reverse charge; paid in cash only | In force (engine); screens follow |
| Money & GST | GST (Compensation to States) Cess Act 2017, s.11(2) | Cess posted; cess credit pays only cess | In force |
| Money & GST | GSTR-1 / GSTR-3B (GSTN schema) | Returns built from the frozen invoices, reconciled to the Ledger | Partly (built; filing via a GSP not connected) |
| Money & GST | CGST Act s.16(2)(aa) + GSTR-2B | Input credit only when the supplier filed | Partly (matching built; screen next) |
| Money & GST | e-invoice INV-01 schema 1.1 (IRP); e-way bill Rule 138 | Payloads built and validated | Partly (no GSP connection: decision pending) |
| Money & GST | CGST Act s.50 | Interest on late GST | In force (engine function) |
| People & privacy | Digital Personal Data Protection Act 2023 | Purpose limitation, consent, right to see/correct/erase; no scraping; no sensitive inference | Partly (CRM rules decided; consent records in CRM Phase 5) |
| Money & GST | RBI Account Aggregator (ReBIT FI schema) | Bank statements by consent | Planned (decision pending: FIU) |
| Look & access | WCAG 2.x AA contrast | All 16 themes checked (theme-contrast test) | In force |

## Full list today (from cap-standards.js)

| Group | Standard | What it covers | Status |
|---|---|---|---|
| Verification | ISO/IEC/IEEE 29119-3 | Test completion report — the template a run is written up on | Partly — The measured sections are generated from the ledger; the judgement sections (dev |
| Verification | JUnit XML | Test result interchange — what every CI writes and every tool reads | In force |
| Verification | Gherkin | The spec and the test as one text — Given / When / Then | Partly — The FORMAT is adopted; Cucumber the RUNNER is deliberately not — every “When I c |
| Localisation | BCP 47 (RFC 5646) | Language tags — en-IN, ar-AE, ta | In force |
| Localisation | UTS #35 · CLDR | Locale data and the -u- extensions (nu·hc·ca·fw) | In force |
| Localisation | RFC 4647 | Language priority list and matching | In force |
| Localisation | ECMA-402 (Intl) | Number, money, date, collation, direction | In force |
| Localisation | IANA tz database | Time zones — via the engine, not a kept table | In force |
| Localisation | ISO 4217 | Currency codes on every price | In force |
| Localisation | ISO 8601 | Timestamps in storage and transport | Partly — Display follows the reader's locale by design, which is not ISO form. |
| Localisation | GNU gettext | String catalogue — the English is the key | Partly — Primitive and a 449-entry catalogue exist; the call sites are not wrapped yet. |
| Accessibility | WCAG 2.2 — 1.4.3 / 1.4.6 | Text contrast, measured not asserted | In force |
| Accessibility | WCAG 2.2 — 1.4.4 | Resize text to 132% without loss of function | In force |
| Accessibility | WCAG 2.2 — 2.3.3 | Animation from interactions can be turned off | In force |
| Accessibility | WCAG 2.2 — full audit | Keyboard, focus order, names and roles | Partly — Keymap and focus states exist; no independent audit has been run. |
| Accessibility | Okabe–Ito | Colour-universal palette for colour blindness | In force |
| Accessibility | CSS Logical Properties | Right-to-left layout without a second stylesheet | In force |
| Records & data | RFC 7386 | JSON merge-patch for catalogue golden records | In force |
| Records & data | GS1 | SKU / GTIN identity on catalogue items | Partly — Codes are carried and matched; check-digit validation is not enforced. |
| Records & data | PIM (discipline) | One place holds product information; every channel reads it | In force |
| Records & data | MDM · golden record | One authoritative record per real product, however many sources describe it | In force |
| Records & data | UBL 2.1 · PEPPOL BIS Billing 3.0 (invoice abroad) | The world's invoice document: our frozen invoice block (the GST e-invoice schema) maps to it field for field | Planned — Mapped (C:\dev\catalogue\UBL-MAPPING-2026-09-05.md), not rendered. Missing: an E |
| Records & data | GST UQC + UN/ECE Rec 20 (units) | One unit, three names: ours · the Rec 20 code the world uses · the GST Unit Quantity Code an Indian invoice pr | In force |
| Commercial | EMVCo QR (MPM) | Merchant-presented QR — the format PIX · PayNow · PromptPay · DuitNow · BharatQR · HKQR are all profiles of | Planned — NOT implemented. Named here because the counter's QR is dispatched per SCHEME (l |
| Commercial | NPCI UPI deep link | upi://pay — the payee, amount and reference a UPI app reads | In force |
| Commercial | ISO/IEC 18004 | The QR symbology itself — how a string becomes a printable code | In force |
| Accessibility | WAI-ARIA APG · combobox | List autocomplete with MANUAL selection | Partly — The behaviour is followed at the counter: the search box is a COMMAND box, so a  |
| Records & data | schema.org ItemAvailability | What a product's status MEANS outside our walls | In force |
| Records & data | GDSN | Sharing product data BETWEEN companies, on GS1 identity | Planned — Not implemented. The identity it needs (GS1) is carried already, which is what m |
| Records & data | ISO 17442 (LEI) | Legal Entity Identifier | Partly — A field exists to record it; the value is not verified against GLEIF. |
| Records & data | ISO 6523 | Organisation identifier SCHEME, so an id says which register it came from | Planned |
| Records & data | UN/LOCODE | Places, ports and terminals | Planned |
| Identity & access | ISO/IEC 24760 | The IAM vocabulary — identity · identifier · attribute | Partly — We use its distinctions; we do not implement its lifecycle model. |
| Identity & access | RBAC (ANSI INCITS 359) | Role-based access — coarse, five roles | Partly — The hat IS role-based, but roles are fixed and not composable; there is no permi |
| Identity & access | NIST SP 800-63B | Authentication assurance | Partly — One-time code to a verified channel is roughly AAL2 single-factor; we do not cla |
| Identity & access | SCIM (RFC 7644) | Provisioning identities from an HR system | Planned |
| Identity & access | OAuth 2 · OIDC | Federated sign-in | Planned |
| Platform | RFC 7519 (JWT) | Session tokens | In force |
| Platform | Idempotency-Key | A mutation runs at most once, even on replay | In force |
| Platform | PostgreSQL RLS | Tenant isolation enforced by the database | In force |
| Commercial | Incoterms 2020 (ICC) | Who bears cost and risk, and to what point | Partly — Carried on instruments and forms; not yet enforced against the shipment record. |
| Commercial | UCP 600 · ISBP 745 | Documentary credits | Planned |
| Commercial | HS codes (WCO) | Tariff classification on goods | Planned |
| Commercial | ISO 20022 | Financial messaging | Planned |
