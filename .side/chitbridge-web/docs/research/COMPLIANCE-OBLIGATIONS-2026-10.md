# Compliance obligations that fall on ChitBridge — India · Australia · UAE (round CO0, track D of M1)

*Research, 2026-10-13. Owner brief (13 Oct): "we may have obligations which auditors may not be worried and we will be liable … it
should be well documented in Standards and demonstratable".* This is not legal advice. Before anything here is promised to a customer, a
lawyer in each country should sign it off.

## 0 · How to read this

**How far each citation was checked.** This round ran on a Linux runner. `meity.gov.in` and `ato.gov.au` returned **403**. The CERT-In
PDF downloaded, but its text could not be extracted (the fonts are glyph-encoded). So every citation carries one of these marks:

| Mark | Meaning |
|---|---|
| **✔** | The official page was read in this round. |
| **◐** | The official source is named, and the rule is the statute's known text, backed by at least one secondary source found in this round. **A person must open the official link once and tick it** before it goes into the Standards register as "In force". |
| **?** | Not found, or the sources conflict. Nothing is guessed: the question stays open. |

**What "we" means.** ChitBridge (CB) is a multi-tenant SaaS platform. It holds each shop's chits, bills, books, catalogue, customers'
contact details, staff identity documents and the shop's own banking/tax vault. It delivers a chit from one business's copy to another's,
across borders too (CTP, `docs/CTP-DESIGN.md`). Today **everything runs in one Postgres on Supabase, AWS ap-south-1 (Mumbai)**
(`chitbridge-api/migrations/b257_where_an_installation_runs.sql`, header). The API runs on Railway and the web app on Vercel.

**Three kinds of obligation**, because the owner's worry is the first two:

- **D — Direct.** The law puts the duty on CB itself, as fiduciary, controller, intermediary, body corporate or service provider. We are liable.
- **C — Contract-carried.** The law puts the duty on the shop, but the shop can only meet it through us (its processor), so the duty must be written into our contract, and a failure is ours in practice.
- **P — Product.** The law is the shop's (GST, Companies Act, ATO, FTA). It is not ours to obey, but our software is the shop's record system, so the shop is non-compliant if our software can't support it. Auditors check these. The **D** and **C** items are the ones nobody else checks.

**What already exists, and is reused here (CLAUDE.md rule 1).** The **Standards register** is `public/app/cap-standards.js`
(`STANDARDS`, the fields `a k c p m g n w s at why`). It is painted by `public/standards.html`, Settings › Standards and the Legend, and
already holds rows for DPDP Act 2023 (`s:"part"`) and Companies Act Rule 3(1) (`s:"live"`). **"Documented in Standards and demonstrable"
= one row per obligation below in that register**, with `at`/`go` pointing at the screen or record that proves it. No new page, no new
shape. Other existing assets used as evidence: `docs/THREAT-MODEL.md`, `docs/TRUST.md`, `docs/KB-your-data-is-safe.md`,
`docs/OBSERVABILITY-AND-SAFETY.md`, `docs/DATA-RESIDENCY-DESIGN.md`, `docs/RUNBOOK-rotate.md` (all in chitbridge-api).

---

## 1 · Our ROLE per data type

| Data type (where it lives) | India (DPDP Act 2023) | Australia (Privacy Act 1988) | UAE (PDPL, FDL 45/2021) | Why |
|---|---|---|---|---|
| **Shop's account**: owner's name, phone, e-mail, sign-in (`identities`, `signin_events` b282) | **Data Fiduciary** | **APP entity**, if covered (see AU §a) | **Controller** | We decide why and how: sign-in, billing, security. |
| **Shop staff / actors** (`identities`, `identity_documents` b174: Aadhaar, PAN… masked + encrypted) | **Processor** for the shop's HR purpose; **Fiduciary** for our own security use (sign-in logs, fraud) | Contracted service provider to the shop; holder in our own right for security logs | **Processor** / **Controller** (same split) | The shop decides to file a staff ID. We also use access data to secure the platform. |
| **Shop's customers** (storefront orders, `otp_contact`, CRM parties `party_*` b276, delivery contacts on chits) | **Processor** for the shop. **Fiduciary** for the no-login storefront OTP that *we* run (`routes/catalogue.js` customer OTP) | Service provider to the shop | Processor; Controller for the storefront OTP | The shop is the merchant. We run the OTP channel and decide how it works. |
| **Counterparty data on a delivered chit** (sender snapshot, contact in `business_json`) | Each shop is fiduciary of **its copy**; CB is **processor** for both copies | Same | Same | Per-copy model (`DATA-RESIDENCY-DESIGN.md`, "Provenance"). |
| **Books, invoices, GST/VAT records** (`journal_entry`/`journal_line` b273, chits) | Not personal data except where a proprietor is a person. For **records law** CB is the shop's **electronic-records service provider** (Companies (Accounts) Rules 3(6)) | Record-keeping service | Record-keeping service (FTA) | The shop is the taxpayer. |
| **Shop's banking/tax vault** (`entity_profile` vault, `lib/vaultcrypto.js`) | Processor. For a sole proprietor it is **personal financial data**: "sensitive personal data" under the SPDI Rules 2011 r.3 while those apply | Processor / holder | Processor | — |
| **Platform telemetry**: request logs, IPs, user agents (`lib/logger.js` → Railway stdout; `signin_events`) | **Fiduciary**, and **body corporate / service provider** for CERT-In | APP entity (if covered) | Controller | Our own security purpose. |
| **Messages / attachments between businesses** (`cb_attachment` b65, messages b67) | Also a possible **intermediary**, IT Act s.2(1)(w) (we receive, store and transmit records on behalf of others) | — | — | Brings the IT (Intermediary Guidelines) Rules 2021 into play: see IN-12. |

**DPDP "Significant Data Fiduciary" (s.10):** only if the Government notifies us. Not expected at our size. ◐

---

## 2 · INDIA

**Sources.** All ◐ unless marked:

- DPDP Act 2023 (No. 22 of 2023) — https://egazette.gov.in/WriteReadData/2023/248045.pdf, and MeitY https://www.meity.gov.in/data-protection-framework (403 here).
- **DPDP Rules 2025, G.S.R. 846(E), notified 13/14 Nov 2025** — sources disagree on the day. **Phasing:** rules 1, 2, 17–21 in force 13 Nov 2025; rule 4 (consent managers) 13 Nov 2026; **rules 3, 5–16, 22–23 from 13 May 2027.** ◐ (scconline 14 Nov 2025 and 26 Dec 2025; mondaq). So the *operative* DPDP duties bite **May 2027**. Until then the IT Act s.43A + **SPDI Rules 2011** still apply (they are displaced by DPDP Act s.44(2) once it commences ◐).
- CERT-In Directions under IT Act s.70B(6), No. 20(3)/2022-CERT-In, 28 Apr 2022, effective 27 Jun 2022 — https://www.cert-in.org.in/PDF/CERT-In_Directions_70B_28.04.2022.pdf ◐ (file downloaded; text not extractable).
- IT (Intermediary Guidelines and Digital Media Ethics Code) Rules 2021 — https://www.meity.gov.in/ (403) ◐.
- Companies (Accounts) Rules 2014, r.3 as amended by G.S.R. 206(E) (24 Mar 2021) and G.S.R. 624(E) (5 Aug 2022); Companies Act 2013 s.128(5) — https://www.mca.gov.in ◐.
- CGST Act 2017 s.35, s.36; CGST Rules r.48(4), r.56, r.57 — https://cbic-gst.gov.in ◐.

| # | Obligation (D/C/P) | Rule + URL | What CB has today | Gap | Evidence a reviewer can SEE |
|---|---|---|---|---|---|
| IN-1 | **Notice before consent**: itemised data, purpose, how to withdraw, how to complain to the Board (D for our account data; C: give shops a notice template) | DPDP Act s.5; Rules r.3 (from May 2027). Now: SPDI r.4 (privacy policy on the website), r.5(3) | A terms tick at sign-up (`chitbridge-web/public/app.html:3515`, "I accept the terms of use"). No privacy policy or notice text found in web or api. | **No privacy notice / policy exists.** SPDI r.4 needs one **today**. | A public `/privacy` page, versioned; the notice version stored against each account at sign-up. |
| IN-2 | **Consent**: free, specific, unambiguous, withdrawable as easily as given, recorded (D; C for shops' marketing to customers) | s.6(1)–(4), s.6(10) (burden of proof on the fiduciary); s.7 legitimate uses | `identity_documents.consent_at` with a CHECK requiring consent for an Aadhaar filed by someone else (b174, `routes/identity-docs.js:230`). CRM consent is designed (`docs/design/crm/DATA.md` §5 `party_contact_pref` b277) but **b277 does not exist**. | No consent ledger for marketing or WhatsApp outbound (`lib/whatsapp-out.js`). No withdrawal path. | A consent row per (person, purpose, channel, given_at, withdrawn_at, notice_version); a sending refusal shown when consent is absent. |
| IN-3 | **Purpose limitation & erasure** when the purpose is served or consent is withdrawn, unless law requires retention; **48 h warning** before erasure for the classes in the Third Schedule (D/C) | s.8(7); Rules r.8 + Third Schedule ◐ (the 48 h detail comes from a secondary source only) | `lib/retention.js` (@stage **poc**, dry-run only); b105 adds `retention_expires_at` **defaulting to now()+90 days** on `chit_status`. Test purges are hand SQL (b171a–d). `DELETE /:chit_id/purge` (`routes/chits.js:4582`). | No retention schedule per data type. **The 90-day default contradicts the statutory floors** (IN-9/IN-10: 72 months / 8 years) and must never go live as is. `reg-in` has **no `retentionYears`** (AU and AE packs do: `lib/reg-au.js:511`, `lib/reg-ae.js:723`). | A retention schedule table (data type → period → legal basis), shown in Standards. The dry-run report of what would retire. |
| IN-4 | **Data-principal rights**: access summary (s.11), correction/erasure (s.12), grievance (s.13), nominee (s.14); respond within the period in Rules r.14 (**90 days** for grievances ◐) (D; C: we must let the shop answer for its customers) | s.11–14; Rules r.13, r.14 | Shop-side exports exist (`routes/products.js:781` export.csv; books export via `lib/bookpack.js` / Tally). Nothing for an individual. | No request intake, no clock, no per-person "what we hold" export, no erase-person flow (one person's rows span ~30 FKs — b171b header). | A rights-request register with received / answered dates; one person's export. |
| IN-5 | **Security safeguards**: encryption / masking / tokenisation, access control, **logs to detect unauthorised access, kept ≥ 1 year**, backups, contracts with processors (D) | s.8(5); Rules **r.6(1)(a)–(g)** (1-year log retention at r.6(1)(e) ◐). Now: SPDI r.8 (IS/ISO/IEC 27001 or an approved code) | RLS per entity (`migration_b49_rls_policies.sql`, b212 FORCE RLS). Vault AES-256-GCM (`lib/vaultcrypto.js`). ID documents masked + hashed + encrypted (b174). Insert-only `signin_events` (b282) and `access_events` (b172). Rate limits, helmet, statement timeout (`db/index.js:53`). JWT rotation runbook. | **CSP off** (`server.js:160-161`). App/request logs live only in Railway stdout (plan retention ≪ 1 year). No documented DB backup / restore test (`docs/THREAT-MODEL.md`, row E4). No MFA for owners (methods exist in `lib/signin-events.js` METHODS, but no MFA policy). | A control register (CO2) with each control's evidence. Log-retention setting + a sample one year old. A restore-drill record. |
| IN-6 | **Breach intimation** to the **Board** and **each affected principal**: "without delay", with a detailed report to the Board **within 72 h** (D; C: processor → fiduciary) | s.8(6); Rules r.7 ◐ | None. `log.onCritical` hook exists but has no sink (`docs/OBSERVABILITY-AND-SAFETY.md` §5). | No incident procedure, no breach register, no notice templates. | An incident runbook; a breach register (even when empty); a tabletop-drill record. |
| IN-7 | **CERT-In**: report listed incidents **within 6 h** of noticing; **point of contact** registered; **ICT logs kept for a rolling 180 days within India**; clocks synced to **NIC/NPL NTP** (D, as a body corporate / service provider) | CERT-In Directions 28 Apr 2022, dir. (i)–(iv) ◐ | Request-id logging (`lib/logger.js`). Logs → Railway (region and retention not stated in the repo). | No CERT-In PoC. No 6 h path. **Log retention and location are unproven**. Clock source is the host default. | A PoC registration record; a log-sink config showing ≥180 days and an India region; the NTP setting; the 6 h step in the incident runbook. |
| IN-8 | **Cross-border transfer**: allowed except to countries the Government restricts (negative list) (D) | s.16; Rules r.15 ◐ | All data in ap-south-1. CTP cross-installation delivery is designed (`docs/CTP-DESIGN.md`), not built. | No transfer check in the CTP design; no sub-processor list. | A sub-processor list with regions (Supabase, Railway, Vercel, WhatsApp/Meta, any AI provider `lib/ai.js`); a CTP delivery check against a restricted-country list. |
| IN-9 | **Companies Act audit trail**: accounting software must record an **edit log of every change, which cannot be disabled**; keep it 8 years (P, which we claim) | Companies (Accounts) Rules r.3(1) proviso (from 1 Apr 2023); Act s.128(5); Audit Rules r.11(g) ◐ | **Journal insert-only by trigger + grant** (`migrations/b273_books_journal.sql:201-211`); reversals point at what they reverse. Chit corrections are amendments beside the original (b137). Register row "live" (`cap-standards.js:352`). | Master data (ledgers b272, parties b274, finance terms b298) and chit `business_json`: is every change logged? **Not verified.** `state_log` has no DB-level UPDATE/DELETE refusal (unlike b172/b282). 8-year retention is not stated anywhere. | A query proving no UPDATE/DELETE grant on each books table; a sample edit-log export per voucher. |
| IN-10 | **Books kept in electronic form: daily backup on servers physically in India; accessible in India at all times**; the company tells the ROC every year the **service provider's name, IP, location and cloud address** (C: we must supply these facts to every Indian company customer) | Companies (Accounts) Rules r.3(5), r.3(6) (G.S.R. 624(E), 5 Aug 2022) ◐ | Primary DB in Mumbai (b257). | Backup location and frequency are not documented. **No "service-provider facts" sheet** for a company's AOC-4 filing. | A one-page "for your ROC filing" sheet in Settings; Supabase backup region + schedule recorded. |
| IN-11 | **GST records**: keep accounts until **72 months from the due date of the annual return** (s.36); entries never erased or overwritten, and **a log of every electronic entry edited or deleted** (r.56(8) ◐); electronic backup + production on demand (r.57); **e-invoice IRN** for AATO > ₹5 cr (r.48(4); N/N 10/2023-CT), reported within 30 days for AATO ≥ ₹10 cr (GSTN advisory) ◐ (P) | CGST Act s.35, s.36; Rules r.48(4), r.56, r.57 | e-invoice schema and threshold modelled (`lib/reg-in.js:279-303`, INV-01 v1.1); GSTR shapes (`lib/gst-returns.js`). | No IRP connection (we are not a GSP/IRP). 72-month floor not in `reg-in`. r.56 edit log: same gap as IN-9. | A retention floor visible per pack; the edit-log export (shared with IN-9). |
| IN-12 | **If an intermediary**: publish rules, privacy policy and user agreement; **Grievance Officer**: acknowledge in **24 h**, resolve in **15 days**; keep a user's info **180 days** after the account ends; report incidents to CERT-In (D, conditional) | IT Act s.2(1)(w), s.79; Intermediary Rules 2021 r.3(1)(a),(h), r.3(2) ◐ | None. | Whether CB is an intermediary is a **legal question** (B2B record exchange). Assume yes until advised. | A published Grievance Officer name, contact and timelines; a grievance log. |
| IN-13 | **Grievance / contact person**: publish the business contact of a person who answers data questions (DPO only for a Significant Data Fiduciary) (D) | DPDP s.8(9)(10); Rules r.9 ◐; SPDI r.5(9) (grievance officer, resolve within one month) — in force now | None found. | Missing. | The same published contact as IN-12. |
| IN-14 | **Children**: verifiable parental consent for anyone under 18; no tracking or targeted ads at children (D/C) | s.9; Rules r.10 ◐ | Storefront takes orders from anyone with a phone; no age signal. | No policy. Low risk (B2B), but the storefront is consumer-facing. | A terms clause ("customers 18+ or under a guardian") plus a storefront line. |
| IN-15 | **Processor contracts**: a fiduciary may engage a processor only under a valid contract (C both ways: shops → CB, CB → Supabase/Railway/Vercel/Meta) | s.8(2) ◐ | None (no DPA / ToS text in the repos). | Missing. | A DPA template + the sub-processor list (shared with IN-8). |
| IN-16 | **Aadhaar**: no storing or collecting the number except as allowed; masking (D) | Aadhaar Act 2016 s.29; Aadhaar (Data Security) Regulations 2016 ◐ | Masked + hash + encrypted, consent-gated (b174). | Is the encrypted full number allowed to be held at all (Aadhaar Data Vault rules apply to "requesting entities")? **?** → legal. | — |

---

## 3 · AUSTRALIA

**Sources** ◐ unless marked:

- Privacy Act 1988 (Cth), Schedule 1 APPs, Part IIIC (NDB) — https://www.legislation.gov.au/C2004A03712/latest; OAIC https://www.oaic.gov.au/privacy/australian-privacy-principles.
- OAIC NDB page — https://www.oaic.gov.au/privacy/notifiable-data-breaches/about-the-notifiable-data-breaches-scheme **✔ read**: the duty applies to entities the Privacy Act covers; notify when "likely to result in serious harm"; via the OAIC online form. That page states no timelines or section numbers. Those below are from the Act ◐, and s.26WH(2)/s.26WK(2) are confirmed by the OAIC *Pacific Lutheran College* determination (2023) via legal500.
- Cyber Security Act 2024 Part 3 (ransomware payment reporting) ◐.
- ATO record keeping: TAA 1953 Sch 1 s.382-5; ITAA 1936 s.262A (already cited in `lib/reg-au.js:511`); Corporations Act 2001 s.286 ◐.
- ATO **DSP Operational Security Framework** — https://www.ato.gov.au/online-services/ato-digital-wholesale-services/digital-service-provider-operational-framework (403 here); https://softwaredevelopers.ato.gov.au/operational_framework ◐.

**(a) Are we covered at all?** Organisations with annual turnover ≤ A$3M are exempt "small businesses" (s.6C, s.6D), unless an exception
applies (s.6D(4): e.g. health service, trading in personal information) ◐. CB today is almost certainly under A$3M in Australia. But:

1. Every AU shop over A$3M is an APP entity and must hold *us* to APP 11 by contract (**C**).
2. A small business can **opt in** (s.6EA).
3. Removing the small-business exemption is on the reform agenda (tranche 2): **?**, not enacted as found.

**Recommendation: comply as if covered.** The controls are the same ones India needs.

| # | Obligation | Rule | CB today | Gap | Evidence |
|---|---|---|---|---|---|
| AU-1 | **APP 1**: an open, clearly expressed privacy policy; practices, procedures and systems for compliance (D if covered; C) | APP 1.2–1.4 | None | No policy | Same `/privacy` page, with an AU section |
| AU-2 | **APP 3/5**: collect only what is reasonably necessary; tell the person at collection (who, why, overseas recipients, how to complain) | APP 3, APP 5 | Storefront collects phone + name only | No collection notice at the storefront OTP | A collection notice shown at the OTP step |
| AU-3 | **APP 6/7**: use or disclose only for the primary purpose; direct marketing only with opt-out (plus the **Spam Act 2003** s.16: consent, sender identity, unsubscribe for commercial e-messages) | APP 6, APP 7; Spam Act 2003 s.16–18 ◐ | `lib/whatsapp-out.js`, outbound b126 | No consent / opt-out ledger (shared with IN-2) | The consent ledger + unsubscribe proof |
| AU-4 | **APP 8 + s.16C**: before disclosing overseas, take reasonable steps so the recipient complies. **We stay accountable** for an overseas recipient's breach | APP 8.1; s.16C | **All AU data sits in India (ap-south-1)**: that *is* an overseas disclosure / use | No contract terms, no disclosure in a notice | Sub-processor + region list; AU notice names India; (later) an AU-region installation (`DATA-RESIDENCY-DESIGN.md` tier 1) |
| AU-5 | **APP 11**: protect from misuse, interference, loss and unauthorised access; **destroy or de-identify** once no longer needed (unless law requires keeping) | APP 11.1, 11.2 | As IN-5 | As IN-5; no destruction schedule | Shared with IN-3 / IN-5 |
| AU-6 | **APP 12/13**: give access, correct. Organisations respond "within a reasonable period" (OAIC guidance: usually 30 days ◐) | APP 12.4, 13.5 | None for individuals | As IN-4 | Rights register (shared) |
| AU-7 | **Notifiable Data Breaches**: on suspicion, **assess within 30 days**; on an eligible breach, **notify OAIC and affected individuals as soon as practicable**; one notice is enough for data jointly held (C/D) | s.26WE, **s.26WH(2)**, **s.26WK(2)–(3)**, s.26WL, s.26WJ | None | As IN-6 | The breach register + assessment clock (shared) |
| AU-8 | **Ransomware payment report** to the ASD/ACSC within **72 h** of paying (turnover > A$3M) | Cyber Security Act 2024 Part 3 ◐ | n/a | Not applicable at our size today; put a note in the runbook | Runbook line |
| AU-9 | **Tax / company records** kept 5 years (tax) and 7 years (companies), in English or readily convertible, producible to the ATO (P) | TAA 1953 Sch1 s.382-5; ITAA 1936 s.262A; Corporations Act s.286(2) ◐ | `reg-au` `retentionYears: 5` (`lib/reg-au.js:511`) | Companies' 7 years not modelled; retention not enforced (IN-3 gap) | The pack floor visible in Standards |
| AU-10 | **DSP Operational Security Framework**: applies only if we use **ATO digital wholesale services / SBR** (e.g. lodging BAS or STP). It requires encryption in transit and at rest, **MFA**, audit logging producible on request, **Australian data hosting by default** (offshore needs disclosure / approval), personnel security, certification by questionnaire (higher tiers by user count) ◐ | ATO DSP OSF (pages above, 403 here) | **Not applicable today**: no ATO API integration found in the api | When BAS/STP lodging is planned, OSF is a precondition: plan for AU hosting and MFA | The OSF questionnaire, kept with the CO2 evidence |

---

## 4 · UAE

**Sources** ◐ unless marked:

- Federal Decree-Law No. 45 of 2021 on the Protection of Personal Data (PDPL), in force 2 Jan 2022 — https://u.ae/en/about-the-uae/digital-uae/data/data-protection-laws; UAE Data Office (FDL 44/2021).
- **Executive Regulation: "?". Sources conflict.** Some vendor pages claim it was issued in 2026 with a 1 Jan 2027 deadline. Chambers 2026 (via businessdubai.ae) and DLA Piper say it has not been issued. **No decision number was found.** Breach timelines and DPO thresholds therefore stay open.
- VAT Decree-Law 8/2017 Art.78; Tax Procedures Decree-Law 28/2022 + its Executive Regulation (`lib/reg-ae.js:723` cites TPL-ER Art.3(1)(a), 5 years); Corporate Tax Decree-Law 47/2022 Art.56 (7 years) ◐.
- **e-Invoicing:** Ministerial Decisions **243 & 244 of 2025** (29 Sep 2025). Pilot from 1 Jul 2026. Businesses with revenue ≥ AED 50M appoint an Accredited Service Provider (ASP) and go live **1 Jan 2027**; others go live 1 Jul 2027. ASP accreditation is under MR 64/2025, amended by MR 56/2026 ◐ (KPMG, Baker McKenzie, A&M). **An ASP-appointment extension to 30 Oct 2026 is reported (10 May 2026): "?"**, so check mof.gov.ae.

**Scope.** The PDPL covers controllers and processors in the UAE, and those outside it that process data of UAE residents (Art.2) ◐.
**Excluded:** health and banking data under their own laws, and free zones with their own law (**DIFC, ADGM**). A shop in DIFC/ADGM falls
under DIFC DP Law 5/2020 / ADGM DPR 2021 instead. **Not researched this round: "?"**

| # | Obligation | Rule (PDPL art.) | CB today | Gap | Evidence |
|---|---|---|---|---|---|
| AE-1 | Lawful basis = **consent**, unless an Art.4 exception applies (contract, legal obligation, etc.); consent must be specific, clear, provable, withdrawable (D/C) | Art.4, Art.6 | As IN-2 | As IN-2 | Consent ledger (shared) |
| AE-2 | **Processing principles**: fair, purpose-limited, minimal, accurate, kept no longer than needed (D/C) | Art.5 | As IN-3 | As IN-3 | Retention schedule (shared) |
| AE-3 | **Controller duties**: security measures, records of processing, use only processors that give guarantees. **Processor duties**: act on instructions, keep a processing record, delete at end (D both ways) | Art.7, Art.8 | As IN-5 | No record of processing (RoPA) | RoPA (CO1), shared with ISO 27701 |
| AE-4 | **Breach notification** to the Data Office and data subjects; processor → controller (D/C) | Art.9 (timelines via the Executive Regulation: **?**) | None | As IN-6 | Breach register (shared) |
| AE-5 | **DPO** in specified cases (large-scale or sensitive processing) | Art.10–11 | None | Probably not required at our size: **?** | — |
| AE-6 | **Data-subject rights**: information, portability, correction/erasure, restriction, stop processing, automated decisions | Art.13–18 | None for individuals | As IN-4 | Rights register (shared) |
| AE-7 | **Security** + **DPIA** for high-risk processing | Art.20, Art.21 | As IN-5 | No DPIA | One DPIA for the platform (CO1) |
| AE-8 | **Cross-border**: to a country with adequate protection, or by the Art.23 routes (contract, consent, etc.) (D) | Art.22, Art.23 | **UAE data sits in India**. India has no UAE adequacy listing: **?** | Need contract clauses + notice | Sub-processor/region list; DPA clauses |
| AE-9 | **Tax records**: 5 years (VAT / tax procedures), 7 years (corporate tax), producible to the FTA, in Arabic on request (P) | VAT DL 8/2017 Art.78; TP DL 28/2022; CT DL 47/2022 Art.56 ◐ | `reg-ae` `retentionYears: 5` (`lib/reg-ae.js:723`) | 7-year corporate-tax floor not modelled | Pack floor in Standards |
| AE-10 | **e-Invoicing** via an ASP (Peppol "5-corner") from 2027 (P, and for us a build-or-partner decision) | MD 243/244 of 2025; MR 64/2025 ◐ | Nothing found | **Decide:** integrate with an ASP, or apply to be one. Shops ≥ AED 50M need it by **1 Jan 2027** | Decision recorded; a Standards row (`k:'law'`, `c:['AE']`, `s:'plan'`) |

---

## 5 · Security-readiness frame: SOC 2 TSC + ISO/IEC 27001:2022 Annex A

**Sources:** AICPA *2017 Trust Services Criteria (revised points of focus 2022)*, https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria-with-revised-points-of-focus-2022 ◐. ISO/IEC 27001:2022, https://www.iso.org/standard/27001 (paywalled; control names only) ◐. ISO/IEC 27701 (privacy extension) is the natural home for the DPDP / PDPL / APP privacy controls.

Neither is a legal obligation. They are how a buyer or auditor will **ask** us to show the obligations above. The control table maps each
control to its TSC and Annex A references, so one piece of evidence serves both frameworks.

---

## 6 · CROSS-COUNTRY CONTROL TABLE (one control → many rules)

| Ctrl | Control (what we build once) | Satisfies | SOC 2 / ISO 27001:2022 A. | Evidence a reviewer sees | Round |
|---|---|---|---|---|---|
| **K1** | **Privacy notice + policy**, versioned; the accepted version stored per account; storefront collection notice | IN-1, IN-13 · AU-1, AU-2, AU-4 · AE-1 | P1, P2 / 5.34 | `/privacy` page; `notice_version` on the account | CO1 |
| **K2** | **Consent ledger** (person · purpose · channel · given/withdrawn · notice version) + send-gate. Fills the designed `party_contact_pref` (b277): no second shape | IN-2, IN-14 · AU-3 · AE-1 | P2, P3 / 5.34 | Consent rows; a refused send that names the reason | CO1 |
| **K3** | **Retention schedule per data type with statutory floors**: `retentionYears` added to `reg-in` (72 months GST / 8 years Companies Act) and `reg-au` (+7 years companies), `reg-ae` (+7 years CT); `lib/retention.js` reads the floor; the **90-day b105 default is replaced** | IN-3, IN-9, IN-10, IN-11 · AU-5, AU-9 · AE-2, AE-9 | C1.2, P4 / 5.33, 8.10 | Schedule shown in Standards; dry-run output | CO3 |
| **K4** | **Rights requests**: intake, 30-day clock (AU) / Rules r.14 (IN) / PDPL; per-person export; erase-person routine (dry-run-first, like b171) | IN-4 · AU-6 · AE-6 | P5, P6 / 5.34 | Rights register with dates; an export file | CO1 |
| **K5** | **Incident & breach runbook + register**: CERT-In 6 h · DPDP 72 h · OAIC 30-day assess · PDPL Art.9; `log.onCritical` → alert; a named point of contact | IN-6, IN-7 · AU-7, AU-8 · AE-4 | CC7.3–CC7.5 / 5.24–5.28, 6.8 | Runbook; register; one tabletop drill a year | CO2 |
| **K6** | **Durable logs**: app + request logs shipped from Railway to a sink **in India**, kept **≥ 1 year** (DPDP r.6 covers the 180-day CERT-In rule); NTP to NIC/NPL; app and DB tables insert-only (extend the b172/b282 REVOKE to `state_log`) | IN-5, IN-7, IN-9 · AU-10 · AE-3 | CC7.2 / 8.15, 8.16, 8.17 | Sink config; a 1-year-old sample; a grant query | CO2 |
| **K7** | **Edit-log proof for books + masters + bills**: every change to ledgers, parties, terms, chit `business_json` written with before/after (reuse the `lib/access-events.js` diff idea); a per-voucher export | IN-9, IN-11 · AU-9 · AE-9 | PI1.4, CC8.1 / 8.15 | Edit-log export; "no UPDATE/DELETE grant" query per table | CO3 |
| **K8** | **Backup + restore**: daily, region **India** (r.3(5)), restore drill recorded; the shop's "ROC service-provider facts" sheet | IN-10, IN-11 · AU-5 · AE-3 | A1.2, A1.3 / 8.13, 8.14 | Backup schedule screenshot; drill log; the facts sheet | CO3 |
| **K9** | **Sub-processor & region list + DPA** (shops ↔ CB, CB ↔ Supabase / Railway / Vercel / Meta / AI provider); transfer clauses for AU (APP 8) and UAE (Art.22–23) | IN-8, IN-15 · AU-4 · AE-3, AE-8 | CC9.2 / 5.19–5.23 | Published list; signed DPA template | CO1 |
| **K10** | **Security baseline**: CSP on (F1), owner MFA, encryption at rest beyond the vault, least privilege (D1/D2 in the threat model), key rotation (have), vulnerability scanning | IN-5 · AU-5, AU-10 · AE-7 | CC6.1–CC6.8 / 5.15–5.18, 8.2, 8.5, 8.24, 8.28 | Control register with a status and evidence link each | CO2 |
| **K11** | **Grievance / privacy contact** published, with 24 h acknowledge / 15-day resolve (intermediary rules) and a log | IN-12, IN-13 · AU-1 · AE-5 | P8 / 5.34 | Published name; grievance log | CO1 |
| **K12** | **Records of processing + one DPIA** | IN-5 · AU-1 · AE-3, AE-7 | P1 / 5.34 | RoPA + DPIA documents in `docs/` | CO1 |
| **K13** | **Standards register rows** for every obligation above (`cap-standards.js`, fields `k:'law'`, `c:[…]`, `s`, `m`, `at`/`go` → the evidence screen). Add `AU` / `AE` if `STD_COUNTRIES` lacks them | all: "documented and demonstrable" | — | `/standards.html` matrix, filtered by country | CO1–CO3 (each adds its rows) |

---

## 7 · Build rounds, sized

Sizes: S ≈ one PR · M ≈ 2–3 PRs · L ≈ a multi-step track.

| Round | Contents | Size | Order / why |
|---|---|---|---|
| **CO1 · privacy** | K1 notice + policy (S, plus legal review); K2 consent ledger = build b277 as designed (M); K4 rights intake + per-person export (M; erase-person L, dry-run first); K9 sub-processor list + DPA template (S docs + legal); K11 grievance contact (S); K12 RoPA + DPIA (S docs); K13 rows (S) | **L** | **K1, K9 and K11 first: they are owed today** under SPDI r.4 / r.5(9), before DPDP May 2027. |
| **CO2 · security controls + evidence** | K5 incident runbook + register + `onCritical` sink (M); K6 India log sink ≥ 1 year + NTP + `state_log` insert-only (M); K10 CSP, owner MFA, control register (M); CERT-In PoC registration (S, owner action) | **L** | **K5 + K6 first: the CERT-In 6 h and 180-day duties are live now.** |
| **CO3 · record-keeping proofs** | K3 retention floors in the packs + replace the 90-day default (M; the engine change goes in chitbridge-engines, then adopt); K7 edit-log for masters + bills + export (M); K8 backup region/schedule doc + restore drill + ROC facts sheet (S–M) | **M–L** | **K3 before `lib/retention.js` ever leaves `@stage poc`.** |

**Open questions for a lawyer or the owner (not guessed):**

1. Is CB an "intermediary" (IN-12)?
2. May we hold an encrypted full Aadhaar (IN-16)?
3. UAE Executive Regulation status, and Art.22 adequacy of India (AE-4, AE-8).
4. The UAE ASP deadline extension (AE-10).
5. DIFC / ADGM shops.
6. AU small-business coverage, and whether to opt in (s.6EA).
7. The exact DPDP Rules notification date (13 vs 14 Nov 2025) and the r.8 48-hour detail.

**Reuse points named (rule 1):** `cap-standards.js` (register) · `lib/retention.js` + b105 (retention) · `reg-*.js` `retentionYears` (floors) · `lib/access-events.js` diff + b172/b282 REVOKE pattern (insert-only logs, edit log) · `lib/logger.js` `onCritical` (alerts) · `docs/design/crm/DATA.md` `party_contact_pref` (consent) · b171 dry-run → apply pattern (erasure) · `lib/vaultcrypto.js` (encryption). **New paths proposed:** a consent ledger (already designed as b277), a rights register, a breach register, and a sub-processor list. Nothing existing holds any of these (searched: grep for consent / grievance / breach / DPDP across api `lib`, `routes`, `migrations`, `docs`).
