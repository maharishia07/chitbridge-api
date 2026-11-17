# Xero · QuickBooks Online · MYOB (and their accountant tools) vs ChitBridge — before the AU practice door (2026-10-12)

**Why this file exists.** Athi's CA friend in Australia has about 150 clients on QuickBooks Online and Xero and wants one door to
verify all their books (PLAN-2026-10-12 §B.2). "Literature is the baseline": the standard must already work before our layer is
worth anything. This is the research round only — no code, no browser automation. It extends FINANCE-COMPARE-2026-10-09 (Oracle /
Zoho / Tally view) with the three products an Australian practice actually runs on.

**How to read it.** Every external claim carries its URL. Numbers from vendor pages are marked *(vendor claim)*; numbers from
third-party guides are marked *(third party)*. Prices are AUD per month as published on 2026-10-12 and change often — Xero raised
AU prices on 1 July 2026 and QBO legacy bank feeds are being switched off bank by bank through December 2026, so re-check before
quoting. ChitBridge cells cite a file in this repo (`web:`) or the API repo (`api:` = `chitbridge-api/`, checked out beside this
repo on the dev PC and inside it on the CI runner).

**One sentence of verdict.** The three incumbents are interchangeable on core books; the practice tools (Xero HQ / Partner Hub,
QBOA → Intuit Accountant Suite, MYOB Practice) are where a 150-client firm lives, and three things are table stakes for even one
client to move: live bank feeds, STP-compliant payroll, and ATO-connected BAS lodgement through SBR. ChitBridge has none of the
three today. What it has that they do not — the two-sided record, structured supplier chits, and an append-only hash-chained
ledger — is real, but it is the *second* conversation, not the first.

---

## 1. The products — core books, bank feeds, GST/BAS, payroll, invoicing, inventory, multi-currency, apps, AUD pricing

### 1.1 Xero (AU)

| Area | What it does | Source |
|---|---|---|
| Plans & price | **Ignite · Grow · Comprehensive · Ultimate 10/20/50/100.** From 1 July 2026: Ignite $37, Grow $78, Comprehensive $107, Ultimate 10 $143, Ultimate 20 $180, Ultimate 50 $250, Ultimate 100 $300 *(vendor claim, GST incl.)*. Multi-organisation discount ended 1 July 2026. | https://www.xero.com/au/pricing-plans/update/ · https://www.xero.com/au/pricing-plans/ |
| Plan caps | Ignite: 20 invoices/month and 5 bills/month, the cap counts approving *and* sending; bank reconciliation included. Grow removes the caps; payroll 2 people; no multi-currency. Comprehensive: payroll 5, multi-currency, budgets. Ultimate 10: payroll 10, projects, KPIs/benchmarking. | https://www.xero.com/au/pricing-plans/ · Xero comparison PDF https://brandfolder.xero.com/8HSCTPAX/as/4chfjksfww2cn9rhn5f5kwx/New_business_pricing_plans_comparison |
| Bank feeds | Direct feeds with CBA, NAB, Westpac, ANZ and most second-tier banks; aggregator or CSV where no feed. Xero says "over 21,000 financial institutions worldwide" *(vendor claim)*. Xero told Treasury (2024) it intends to join the Consumer Data Right regime. | https://www.xero.com/au/accounting-software/bank-feeds/ · https://treasury.gov.au/sites/default/files/2025-03/c2024-598346-xero.pdf · partner list *(third party)* https://digit.business/insights/xero/xero-bank-feeds-setup-australia |
| GST / BAS | GST calculated per transaction; Activity Statement report prefilled; **lodge BAS to the ATO from inside Xero** once the organisation is connected (software ID given to the ATO; "Connected BAS"). | https://www.xero.com/au/accounting-software/submit-gst-returns/ · https://www.xero.com/au/features-and-tools/accounting-software/au-gst/ |
| Payroll / STP | Built in; headcount is the plan cap (2 / 5 / 10 / 20 / 50 / 100). Payroll-only plan exists ($15→$20 in May 2024). STP Phase 2 compliant; Payday Super reporting from 1 July 2026. | https://www.xero.com/au/pricing-plans/ · https://www.accountantsdaily.com.au/technology/19901-the-final-straw-xero-users-balk-at-another-price-hike |
| Invoicing | Quotes, invoices, recurring, online payments (fees), "smart document capture" (bill OCR, beta on Grow, full on Comprehensive). | https://www.xero.com/au/pricing-plans/ |
| Inventory depth | **Shallow.** "Up to 4,000 finished items natively"; stock moves on approved bills/invoices/credit notes; average cost; purchase orders prefill but the page does not say POs move stock; anything deeper is an App Store add-on. | https://www.xero.com/au/features-and-tools/accounting-software/inventory/ |
| Multi-currency | Comprehensive and above. | https://www.xero.com/au/pricing-plans/ |
| Apps | App Store; partner sites claim "1,000+ integrations" *(third party)*. | https://digit.business/insights/xero/xero-vs-quickbooks-vs-myob-australia |
| Market | 1.77 M AU subscribers at March 2024 (FY24 annual report, cited by a third party); "~60% of AU cloud accounting" is a vendor-partner figure, not audited. | https://www.scalesuite.com.au/resources/xero-market-share-australian-businesses |

### 1.2 QuickBooks Online (AU)

| Area | What it does | Source |
|---|---|---|
| Plans & price | **Simple Start · Essentials · Plus · Advanced.** Intuit's AU pricing page renders prices client-side, so the only citable AUD list is third-party: Simple Start $33, Essentials $60, Plus $84, Advanced $125 *(third party, June 2026, GST incl.)*. 70% off for 6 months is the standard intro offer *(vendor claim)*. | https://quickbooks.intuit.com/au/pricing/ · https://rounded.com.au/blog/quickbooks-pricing-explained |
| Plan caps | Users 1 / 3 / 5 / 25. **Accountant access included on every plan.** Automated bank feeds and "GST tracking and e-lodge BAS" on every plan. Multi-currency from Essentials. Inventory and projects from Plus. Budgeting from Plus; custom report builder on Advanced. Chart of accounts capped at 250 below Advanced. | https://quickbooks.intuit.com/au/pricing/ · https://quickbooks.intuit.com/learn-support/en-au/help-article/multicurrency/multi-currency-faq/L5qLwQZwV_AU_en_AU |
| Bank feeds | Moving to Open Banking (CDR). **Legacy feeds are cut bank by bank 18 Aug – 3 Dec 2026** (NAB 1 Sep, Westpac 18 Nov, ANZ 24 Nov, CBA 3 Dec); after that reconnect via Open Banking or upload CSV. Some institutions (AMP, Great Southern Bank) dropped off with no replacement — CSV in the meantime. | https://quickbooks.intuit.com/au/blog/product-update/legacy-bank-feeds-discontinuation/ · https://quickbooks.intuit.com/community/banking-50/amp-bank-feeds-down-and-now-not-available-125630 |
| GST / BAS | GST codes per line; BAS prepared and e-lodged from QBO (vendor wording "e-lodge BAS"); Books review has a BAS-prep flow for accountants. | https://quickbooks.intuit.com/au/pricing/ · https://quickbooks.intuit.com/au/advisor-resource-centre/prepare-your-bas-with-books-review/ |
| Payroll / STP | Add-on "QuickBooks Payroll powered by Employment Hero": ~$6/employee/month Standard, $10 + $6/employee Advanced *(third party, 2026)*. STP Phase 2 via the Employment Hero engine. | https://businessfranchiseaustralia.com.au/news/best-payroll-software-providers-in-2026 |
| Invoicing | Unlimited invoices on all plans; recurring from Essentials. | https://quickbooks.intuit.com/au/pricing/ |
| Inventory depth | Plus and Advanced only; quantity tracking; no evidence of FIFO on AU (US QBO has FIFO; not confirmed for AU). | https://aspireapp.com/en-au/blog/quickbooks-australia-review |
| Multi-currency | Essentials and above; 145+ currencies, rates refresh every four hours *(vendor claim)*; foreign unit cost on items not supported. | https://quickbooks.intuit.com/au/resources/product-updates/multi-currency-in-quickbooks-online/ |
| Market | Smallest AU footprint of the three; third-party click-share April 2025: Xero 60.9%, MYOB 22.2%, QBO 7.0% *(advertising share, not customers)*. | https://www.adthena.com/?p=30795 |

### 1.3 MYOB Business / AccountRight (AU)

| Area | What it does | Source |
|---|---|---|
| Plans & price | **Solo · Business Lite · Business Pro · AccountRight Plus · AccountRight Premier.** MYOB's page: Lite $315/yr (≈$26/mo), Pro $70, Plus $165 *(vendor claim, after promo)*; Premier not priced on the page, third parties say ~$210. Payroll Only add-on $15 (up to 4 employees; "prices change from 1 Nov 2026"). | https://www.myob.com/au/pricing · https://sleek.com/au/?p=102593 |
| Plan caps | **Unlimited users on every Business plan** (vs Xero/QBO seat caps). Bank feeds: 2 on Solo/Lite, unlimited from Pro. "Track GST and lodge BAS" from Lite. Payroll $3/employee/month on Lite/Pro, unlimited on AccountRight. Inventory: orders + 1 location on Lite/Pro ($22/mo add-on for unlimited items); stocktake + sales orders on Plus; multi-location on Premier. **Multi-currency: Premier only.** AI BAS (beta) is a paid extra on Lite/Pro. | https://www.myob.com/au/pricing |
| Bank feeds | Direct feeds; Macquarie outages ran for weeks in 2023 (community threads). | https://myob.lithium.com/discussions/bus-banking/myob-business---macquarie-bank-feeds-down-since-11923/837897 |
| GST / BAS | Lodge activity statement from the file after linking to the ATO; practice-side lodgement in MYOB Practice BAS. | https://www.myob.com/au/support/myob-business/end-of-period/month-end-procedures/lodge-your-activity-statement |
| Payroll / STP | Strongest of the three for complex payroll by reputation *(third party)*; STP Phase 2. | https://aspireapp.com/en-au/blog/xero-vs-myob |
| Inventory depth | Deepest of the three natively (stocktake, sales orders, multi-location on Premier); the reason manufacturing / wholesale stay on AccountRight. | https://www.myob.com/au/pricing · https://aspireapp.com/en-au/blog/xero-vs-myob |
| Reviews | Capterra 3.9/5 from 147 reviews (March 2026); complaints are fees, phone wait, feed setup. | https://www.capterra.com/p/183867/MYOB-Business/reviews/ |

### 1.4 Reckon One (briefly)

Modular (core, payroll, projects, expenses sold separately). "Accounting Plus" $24/month, **unlimited users on every plan**, bank
feeds via Open Banking or direct, STP Phase 2, inventory with negative stock, budgeting in every plan *(vendor claim)*; $1/month
for 6 months promo to 31 Oct 2026. Reckon's CEO publicly positions it as the landing spot for Xero price-hike refugees. No
multi-currency mentioned. Sources: https://www.reckon.com/au/accounting-software/ ·
https://www.reckon.com/au/accounting-software/quickbooks-alternative/ ·
https://www.accountingtimes.com.au/technology/xero-price-hikes-could-drive-user-exodus-says-reckon-ceo

### 1.5 The AU rules all four implement (ATO)

- **Tax invoice**: under $1,000 — "tax invoice" wording, seller identity + ABN, date, description/quantity/price, GST amount (or
  "total includes GST" when GST is exactly 1/11th). $1,000 and over — also buyer identity or ABN. Buyers need a tax invoice to
  claim credits on purchases over $82.50. https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/tax-invoices
- **BAS due dates** (quarterly): 28 Oct · 28 Feb · 28 Apr · 28 Jul; lodging electronically through a registered agent earns the
  agent concession (Q1 2026-27: 28 Oct → 25 Nov 2026; Q3: 28 Apr → 26 May 2027; Q2 no concession). Monthly: 21st of the next month.
  https://www.ato.gov.au/businesses-and-organisations/preparing-lodging-and-paying/business-activity-statements-bas/due-dates-for-lodging-and-paying-your-bas ·
  https://www.ato.gov.au/tax-and-super-professionals/for-tax-professionals/prepare-and-lodge/bas-agent-lodgment-program-2026-27
- **Lodging from software = SBR.** "SBR-enabled software lets you prepare and lodge reports directly"; agents use the Practitioner
  Lodgment Service through SBR-enabled software from a digital service provider (DSP).
  https://www.ato.gov.au/tax-and-super-professionals/digital-services/practitioner-lodgment-service
- **STP**: every employer reports salary/wages, PAYG withholding and super liability through STP-enabled software **on or before
  each payday**; Phase 2 since 1 Jan 2022; from 1 July 2026 Payday Super adds qualifying earnings + super liability per employee
  per payday; failure-to-lodge penalties apply.
  https://www.ato.gov.au/businesses-and-organisations/hiring-and-paying-your-workers/single-touch-payroll/what-is-stp ·
  https://www.ato.gov.au/businesses-and-organisations/super-for-employers/paying-super-on-payday/single-touch-payroll-reporting-under-payday-super
- **DSP Operational Security Framework** (what *we* would have to pass to lodge anything): MFA, no shared logins, audit logs kept
  12 months, onshore hosting by default, TLS 1.3 in transit, encryption at rest, independent certification (ISO 27001 / IRAP) for
  higher-risk products or self-assessment for lower-risk, conformance testing in the ATO external vendor test environment, then
  whitelisting and a Product Register entry, with annual re-assurance.
  https://www.ato.gov.au/online-services/ato-digital-wholesale-services/digital-service-provider-operational-framework ·
  https://softwaredevelopers.ato.gov.au/RequirementsforDSPs · https://softwaredevelopers.ato.gov.au/product-register ·
  https://softwaredevelopers.ato.gov.au/Cloud_Software_Authentication_and_Authorisation

---

## 2. THE ACCOUNTANT SIDE — how a practice sees 150 clients

### 2.1 Xero — Partner Hub (ex-Xero HQ) · Practice Manager (XPM) · Xero Tax · Workpapers · Xero Ask · Xero Sign

| Question | Answer | Source |
|---|---|---|
| How does a practice get into a client? | The client's org admin invites a user at **Adviser** role (full access; cannot change plan/billing unless Subscriber). Roles: Adviser · Standard · Invoice only · Read only; only Adviser sets lock dates. Invites expire after 14 days. The practice may instead hold the subscription itself (partner-billed). Removal is one user at a time (bulk removal "not planned"). | https://central.xero.com/0/article/Adviser-user-role-AU · https://central.xero.com/0/article/Add-a-new-user-to-your-organisation · https://productideas.xero.com/forums/967121-users-setup/suggestions/48655313-user-permissions-ability-to-bulk-delete-users |
| Cross-client dashboard | **Client insights** (free to partners): per client — cash balance, receivables, payables, current ratio, revenue, expenses, net profit, industry; **unreconciled transaction count, value and date**; sort by any column, filter by metric/industry; hourly refresh; one click into the client's org. Only clients on business plans with Adviser access appear. Partner Hub home has an **org watchlist** and **bank feed alerts** widgets. | https://www.xero.com/au/xero-hq/client-insights/ · https://www.xero.com/au/xero-hq/ |
| Bulk work | **Xero Tax** lodges activity statements and all return types to the ATO through a tax-agent profile linked by Cloud Software Authentication and Authorisation; prefill from ATO; 1,000 income tax returns/calendar month cap; activity statements only for periods the ATO has issued (early lodgement "not in pipeline"); one branch/ICA per client (BDO asked for more). No true "lodge 150 BAS in one click" — it is per client inside a shared queue. Workpapers (new) have no client-query feature yet; users refuse to migrate from Classic until Ask returns. | https://www.xero.com/au/xero-tax/ · https://productideas.xero.com/forums/967127-practice-tools/suggestions/50498742-bas-installment-activity-statement-ability-to-un · https://productideas.xero.com/forums/966648-new-xero-workpapers/suggestions/50718245-new-workpapers-send-client-queries |
| Queries to the client | **Xero Ask**: templated queries emailed from the practice, answered (with attachments) in a portal; works for non-Xero clients once added in HQ. Inside a bank line, the **Discuss** tab leaves a note for the accountant. No query history planned. | https://www.xero.com/au/xero-hq/ · https://productideas.xero.com/forums/940636-for-accountants-bookkeepers/suggestions/45331498-xero-hq-ability-to-use-ask-to-send-template-quer |
| Client-side approval | **Xero Sign** (Adobe Acrobat Sign) for declarations and document packs — paid bundle. | https://www.xero.com/au/xero-tax/ |
| Practice pricing | Partner programme is free; status Bronze → Silver → Gold → Platinum by points (clients brought on, products used). Partner Hub + Tax & Workpapers free from Bronze; **Practice Management (XPM) $163.90/mo for Bronze/new, free from Silver**; Xero Tax standalone $71.50 (1 user) / $108.90 (≤3) / $163.90 (4+) *(vendor claim, GST incl.)*. Partner-only client plans: **Xero Ledger $7.00, Xero Cashbook $16.50 per client/month** (1 July 2026). Client subscription discounts from Bronze (percentages only in images). | https://www.xero.com/au/partner-programme/ · https://www.xero.com/au/xero-practice-manager/ · https://www.xero.com/au/xero-tax/ · https://www.xero.com/au/pricing-plans/partner-update |

### 2.2 QuickBooks Online Accountant (QBOA) → Intuit Accountant Suite (IAS)

**Status first: QBOA is discontinued in Australia on 31 December 2026.** Firms move to Intuit Accountant Suite *Core* (free,
"similar to QBOA") between mid and late 2026; *Accelerate* (beta, free until 19 Jan 2027) is opt-in; the *Books Close* app is
$5/onboarded client/month up to 20 clients, $3 beyond, billed from 20 Jan 2027 *(vendor claim, currency not stated)*.
Anything the CA does on QBOA today is mid-migration. Sources: https://quickbooks.intuit.com/au/quickbooks-online-accountant/ ·
https://quickbooks.intuit.com/au/blog/accountants-and-bookkeepers/introducing_ias/ ·
https://www.cpapracticeadvisor.com/2026/02/09/intuit-is-discontinuing-quickbooks-online-accountant-and-replacing-it-with-intuit-accountant-suite/177698/

| Question | Answer | Source |
|---|---|---|
| How does a practice get into a client? | Client's primary/company admin: Settings → Manage users → **Accounting firms** → Invite firm (email). The accountant seat does **not** count against the client's user cap; **max two firms** below Advanced. Accountant gets accountant-only tools (reclassify, write-off, close books, undo reconciliation). Accept → status Invited → Active; client can remove at any time. | https://quickbooks.intuit.com/learn-support/en-au/help-article/account-management/managing-accountant-users-quickbooks-online/L2AcdYvHw_AU_en_AU |
| Cross-client dashboard | Client list with **Overview** and **Bookkeeping** tabs: contact details, payroll dates, **uncategorised bank transactions count**, and a **Books review column showing month-end progress** per client; GST info in the dashboard (AU welcome guide). Team tab controls which staff see which clients. | https://quickbooks.intuit.com/learn-support/en-au/help-article/manage-client/learn-clients-overview-bookkeeping-tabs-quickbooks/L5p3u06h5_AU_en_AU · https://http-download.intuit.com/http.intuit/CMO/accountants/static/accounting/ipd/vo/Welcome-Guide-AU.pdf |
| Bulk work | **Books review** per client: Setup (opening balances, disconnected feeds, duplicate accounts) → Transaction review (uncategorised, missing receipts, undeposited funds, duplicates, balance anomalies vs 6-month average) → Account reconciliation → Final review → Wrap-up (report pack). **Work tab**: client requests, projects, tasks across all clients; "Quick add" non-QBO clients. **Prep for taxes** (AU) rolls the TB into the return. BAS: prepared per client; "e-lodge" from the client file. | https://quickbooks.intuit.com/learn-support/en-au/help-article/manage-client/review-clients-books-quickbooks-online-accountant/L4GubaqKy_AU_en_AU · https://quickbooks.intuit.com/au/advisor-resource-centre/manage-and-track-your-work/ · https://quickbooks.intuit.com/learn-support/en-au/help-article/manage-client/introducing-prep-taxes/L46ItXRic_AU_en_AU |
| Queries to the client | **Ask client**: tick transactions in Books review → Ask client → pre-filled request with due date → client gets email → answers under **My accountant → Requests** in their own QBO → reply shows in Books review → Client requests. Known gap: requests dated in a future year vanish from the Books review tab. | https://quickbooks.intuit.com/learn-support/en-au/help-article/manage-client/review-clients-books-quickbooks-online-accountant/L4GubaqKy_AU_en_AU |
| Client-side approval | Client responds to requests; no built-in e-sign for BAS declaration cited on AU pages (third-party e-sign apps). | — |
| Practice pricing | QBOA free; ProAdvisor program free (certification, discounts for client subscriptions — current AU percentage not published in text; 2016 US figure "50% wholesale" is stale). IAS Core free; add-ons priced per client (above). | https://quickbooks.intuit.com/au/quickbooks-online-accountant/ · https://itwire.com/business-it-news/accounting-software/intuit-launches-accountants-bookkeepers-advisory-program |

### 2.3 MYOB Practice (now "MYOB Practice Compliance") + Partner Hub

| Question | Answer | Source |
|---|---|---|
| How does a practice get into a client? | Client's file administrator: Setup → User Access → **New Advisor** (Online Administrator permission); invite to a generic practice email so access is not tied to one person; **the file then becomes visible to everyone on the practice's email domain**, with per-staff permission set separately in my.myob. Known failures: "Please set your password" email with no file attached; advisor silently downgraded to read-only after a plan upgrade. | https://myob.lithium.com/discussions/myobadvisor/need-to-give-staff-access-to-ar-file/776077/replies/802179 · https://myob.lithium.com/discussions/bus-acc/create-advisor/880594 · https://myob.lithium.com/discussions/accounting_software_general/client-trying-to-invite-us-to-myob-accountight-online-file/858081 |
| Cross-client dashboard | **Transaction processing** (ex-"Accounting dashboard"): list of linked online files, "Link to client" suggestions; MYOB announced a "single dashboard view across all clients' MYOB cloud files" in 2016. Columns are not documented publicly — forum posts mention bank transactions to allocate per file. | https://help.myob.com.au/updates/CBP/clients.htm · https://dynamicbusiness.com.au/news/myob-sets-new-benchmark-for-online-collaboration.html |
| Bulk work | **Practice BAS** / Practice Tax: agent linked to each client in ATO agent settings; import GST + PAYG-W from the file; approve → lodge; "AI BAS" beta. Once imported and approved the statement **locks** and does not update live. Users cannot filter the Activity Compliance screen by agent/client; non-lodgeable PAYG-I forms clutter the unlodged list. 30+ standard workpapers; AI chart-of-accounts mapping. | https://www.myob.com/au/accountants-and-bookkeepers/products/practice-bas · https://www.myob.com/au/support/myob-practice/tax/activity-statements-in-myob-practice/link-a-tax-bas-agent-to-a-client · https://myob.lithium.com/discussions/practicebas/live-linking-of-files/837202 · https://www.myob.com/au/accountants-and-bookkeepers/products/practice-compliance |
| Queries to the client | **Client portal**: documents and queries sent from Practice appear as tasks in the client's portal; comment + digital signature. No printable audit trail of when the client signed off a lodged BAS (complaint). | https://help.myob.com/wiki/display/MP/Portals · https://practice-support.myob.com/dm/getting-your-client-s-digital-approval-on-a-docume · https://myob.lithium.com/discussions/practicebas/printing-final-lodged-basias-return/837390 |
| Client-side approval | Built-in digital signature in the portal; only the client users assigned to the task may approve/reject. Known bug: IAS "approved" in tasks but "waiting signature" in the statement list; workaround is to resend and mark approved manually. | https://community.myob.com/discussions/practicebas/myob-partner-portal/888558 |
| Practice pricing | Partner Hub (2022): status Purple → Silver → Gold → Diamond by points (education, events, referrals); rewards "discounted rates up to 30%", commissions, free subscriptions *(vendor claim, 2022)*. Current MYOB Practice per-client pricing is not published; sales-quoted. | https://www.accountantsdaily.com.au/technology/17838-myob-launches-all-in-one-partner-hub |

### 2.4 What the three have in common (this is the "standard")

1. **Consent is the client's act, revocable, role-scoped.** The client owns the file and invites the practice; the practice never
   self-serves. Xero = Adviser role; QBO = Accounting firm (does not consume a seat, max two firms); MYOB = Advisor at domain level.
2. **A cross-client list with three live signals**: books up to date (uncategorised / unreconciled count), reconciliation state, and
   work progress (Books review column, Partner Hub watchlist, Transaction processing). Alerts for broken bank feeds (Xero widget).
3. **Query threads anchored to a transaction**, answered in the client's own login (Ask client / Xero Ask + Discuss / MYOB portal task).
4. **Lodgement is a practice act through the ATO's SBR rail** with an agent profile linked per client, prefill from the ATO, client
   e-sign of the declaration, then lodge; per-client, queue-shaped, not one button for 150.
5. **The practice tool is free; the money is in client subscriptions** (partner discounts, partner-only ledger plans at $7–$16.50).

---

## 3. UX patterns worth adopting — and the complaints behind them

| Pattern | Who | Why it works | Known complaint | Our reuse point |
|---|---|---|---|---|
| **Bank line vs ledger side-by-side, four verbs** (Match · Create · Transfer · Discuss) with a suggested match highlighted and a single OK | Xero | One screen, one decision per line; the accountant's note lives on the line | Discuss notes block OK until the tab is switched; manual matches "confuse" the auto-matcher; statement balance drifts when feeds skip | `web:public/engine/bank-recon.js` already matches lines; `web:public/app/cap-bank.js` paints them — add verbs, not a new screen |
| **"For review" queue** with Match / Add / Exclude per bank line, bank rules applied automatically | QBO | The uncategorised queue IS the to-do list and its count is the client's health metric | Items jump back into For review after undo, attachments lost; feed disconnects send users to CSV | CB Accounts Bank screen = Task table (`listHeader · rowGrid`, `list-ctl.js`) with a count chip — rule 5 of CLAUDE.md |
| **Match vs Allocate**, with allocation rules | MYOB | Separates "already recorded" from "record now" | Advisor downgraded to read-only cannot allocate; one bank line cannot match many MYOB transactions | Same two verbs exist in bank-recon.js: matched vs missing lines |
| **Reconcile status on the cross-client list** (unreconciled count · value · oldest date) | Xero Client insights | The CA ranks 150 clients by one column | Only business-plan clients appear; hourly refresh | Practice dashboard row = `rowGrid` columns, drill-in via `openChit` / `gsToggle` |
| **Books review as a checklist per client** (Setup → Transactions → Reconciliation → Final → Wrap-up) with a progress column on the client list | QBOA | Month-end is a pipeline, not a feeling | Future-dated requests disappear; QBOA itself is being retired | Period lock exists (`api:lib/period.js`); the checklist could be period-state per shop |
| **Ask client / Ask / portal task**: query anchored to a transaction, due date, attachments, answered in the client's own login | all three | The question and the record never separate | Xero Ask has no history; new Workpapers lost Ask; MYOB has no audit trail of sign-off | A query is a chit (message type) on the record — the rail already carries messages and disputes (`web:public/app/cap-dispute.js`) |
| **Lock dates only an Adviser can set**; everything after lock is a dated adjustment | Xero | Protects lodged periods | Adviser still cannot adjust locked periods without unlocking (idea thread) | `api:lib/period.js` month lock; reversal-not-edit in `api:lib/books.js` |
| **Partner-billed ledger plans** ($7 / $16.50) for clients who only need a ledger the practice keeps | Xero | A 150-client firm wants 100 clients on a cheap ledger and 50 on full books | Price rises every July; multi-org discount gone | Our plans are "held" (`api:lib/plans.js`) — any practice pricing must include a ledger-only tier |
| **Price stability** | none | — | Xero: 10–20%/yr rises, "final straw" coverage May 2024 and Aug 2026; Reckon positions as refuge; 5-day Xero outage May 2026; ATO-side outages Aug–Sep 2026 blocked lodgement | Honesty rule: never promise ATO uptime we do not control |

Complaint sources: https://productideas.xero.com/forums/939198-for-small-businesses/suggestions/45337234-bank-reconciliation-add-batch-toggle-for-discus ·
https://productideas.xero.com/forums/939198-for-small-businesses/suggestions/46473379-bank-reconciliation-reconcile-against-statement ·
https://quickbooks.intuit.com/community/banking-4/i-have-the-last-2-months-of-transactions-that-i-had-already-categorized-get-moved-back-to-review-all-attachments-have-been-removed-has-this-happened-to-anyone-else-23086 ·
https://myob.lithium.com/idea/accountrightideas/bank-feeds-ability-to-match-one-bank-transaction-to-multiple-myob-transactions/206355/comments/539499 ·
https://www.accountantsdaily.com.au/technology/22732-xero-price-hike-has-some-accountants-looking-for-alternatives ·
https://www.smartcompany.com.au/tax/sht-show-xero-outages-hit-accountants-small-businesses-tax-return-week/ ·
https://isdown.app/status/xero/incidents/653959-ato-services-may-be-unavailable

---

## 4. Matrix — feature × product, with ChitBridge today and after AU1 + CA

✅ built and in daily use · ⚠️ partial / add-on / plan-gated · ❌ absent. ChitBridge cells name the file or decision; "after AU1+CA"
assumes the PLAN §B.2 scope (AU tax pack, practice entity + consent grants, practice dashboard, Xero/QBO import) and **nothing
else** — so bank feeds, STP and ATO lodgement stay ❌ unless they are added to the plan.

| Feature | Xero | QBO | MYOB | ChitBridge today | ChitBridge after AU1+CA |
|---|---|---|---|---|---|
| GL · journals · TB · P&L · BS | ✅ | ✅ | ✅ | ✅ `api:lib/books.js` (one writer, gap-free vouchers), `api:lib/ledger.js` (Schedule III) | ✅ + AU chart (`api:lib/accounts-packs.js` is IN-only today) |
| Reversal-not-edit, period lock, year close | ⚠️ lock dates; edits allowed before lock | ⚠️ close books with password | ⚠️ lock periods | ✅ `api:lib/period.js`, `api:lib/books.js` reversal; insert-only triggers `api:migrations/b273_books_journal.sql:206-213` | ✅ FY 1 Jul–30 Jun needs the AU pack (only `api:tests/rollup.test.js:504` knows a July year today) |
| Live bank feeds | ✅ direct + aggregator | ✅ Open Banking (legacy cut 2026) | ✅ direct | ❌ CSV only: `web:public/engine/bank-recon.js` reads a statement file | ❌ not in AU1+CA — **blocker, see §5** |
| Bank reconciliation screen | ✅ | ✅ | ✅ | ⚠️ `web:public/app/cap-bank.js` on device; no verbs, no rules | ⚠️ same unless the four verbs are added |
| Bank rules / auto-categorise | ✅ | ✅ | ✅ | ❌ | ❌ |
| GST engine (AU: taxable · GST-free · input-taxed) | ✅ | ✅ | ✅ | ❌ `api:lib/tax-packs.js` holds only `IN`; `api:lib/tax.js` is CGST/SGST/IGST | ✅ AU pack widens `tax-packs.js` (rule 2: widen, never copy) |
| BAS preparation (G1…1A/1B, W1/W2) | ✅ | ✅ | ✅ | ❌ (`api:lib/gst-returns.js` builds GSTR-1/3B) | ✅ if AU pack adds a BAS builder to `gst-returns.js` |
| BAS **lodgement** to the ATO (SBR) | ✅ | ✅ | ✅ | ❌ no SBR, no DSP registration; India GSP also "decision pending" `web:public/app/cap-standards.js:462` | ❌ not in AU1+CA — **blocker** (DSP framework §1.5) |
| ABN / AU tax-invoice rules | ✅ | ✅ | ✅ | ❌ GSTIN-shaped identity (`api:lib/tax-lines.js`) | ✅ AU pack |
| Payroll · STP Phase 2 · super · Payday Super | ✅ in plan | ⚠️ add-on $6/emp | ✅ | ❌ no payroll (only salary chart lines `api:lib/accounts-packs.js:151-177`; backlog in `web:public/app/cap-legend.js:176`) | ❌ "later" per §B.2 — **blocker for any client with staff** |
| Invoicing (tax invoice, recurring, online pay) | ✅ | ✅ | ✅ | ✅ `api:lib/issued-invoice.js` computed once at billing; ⚠️ no recurring, no card pay | ⚠️ AU layout |
| Receivables: ageing · reminders · interest · early-pay | ⚠️ reminders; interest via apps | ⚠️ | ⚠️ | ✅ `api:lib/receivables.js`, `web:public/app/cap-finance.js` (reminders built; ageing partly) | ✅ |
| Payables: supplier bills arrive structured | ⚠️ OCR capture (Hubdoc-style) | ⚠️ receipt capture | ⚠️ | ✅ a supplier's bill IS a chit in the buyer's books (`api:README.md:3-5`) — no OCR, no re-keying | ✅ **unique** |
| Three-way match (order · goods · invoice) | ❌ (apps) | ❌ | ⚠️ POs | ✅ `web:public/app/cap-match.js`, `api:lib/open-orders.js` | ✅ **unique** |
| Disputes on a record, both sides | ❌ | ❌ | ❌ | ✅ `web:public/app/cap-dispute.js`, `api:migration_b41_dispute_participants.sql` | ✅ **unique** |
| Inventory (perpetual, costing) | ⚠️ avg cost, 4,000 items | ⚠️ Plus+ | ✅ | ✅ `api:lib/inventory.js` weighted average (Ind AS 2), `api:lib/stock-store.js` | ✅ (AASB 102 is the same rule) |
| Multi-currency + revaluation | ⚠️ Comprehensive+ | ⚠️ Essentials+ | ⚠️ Premier only | ⚠️ one currency per shop; `api:lib/posting.js:28` refuses foreign entries without `fx_rate`; no rate table, no revaluation | ⚠️ same — AUD-only shops are fine |
| Fixed assets / depreciation | ✅ | ⚠️ | ✅ | ⚠️ `api:lib/books-assets.js`; table is a DRAFT migration (`b280`), routes 503 until it runs | ⚠️ |
| Budgets | ⚠️ Comprehensive+ | ⚠️ Plus+ | ⚠️ | ❌ | ❌ |
| Audit trail | ⚠️ history per record; "Assurance dashboard" for manual coding | ⚠️ audit log | ⚠️ | ✅ **stronger**: insert-only journal, rule version on every entry (`api:lib/posting.js` RULES_VERSION), hash-chained monthly packs `api:migrations/b274_books_party.sql:68` (`prev_sha256`), nightly recompute names mismatches (`api:lib/books-nightly.js`) | ✅ **unique** |
| Both parties hold the same record | ❌ | ❌ | ❌ | ✅ the chit | ✅ **unique** |
| **Practice entity + client consent grant** (viewer / editor, revocable) | ✅ Adviser invite | ✅ Accounting-firm invite | ✅ Advisor invite | ❌ "No cross-business permission model" — `web:docs/DESIGN-NOTES-2026-10.md` §1.2 item 2; one actor row = one shop (`api:migrations/b173_access_level.sql:47-48`); the only trace is an empty-state "Invite an accountant" (`api:lib/sides.js:143`) | ✅ planned: grants reuse the three levels in `api:lib/access.js` (viewer · commenter · editor) + `api:lib/access-events.js` log |
| Cross-client dashboard (books current? reconciled? BAS due? TB? anomalies) | ✅ Client insights | ✅ Overview/Bookkeeping tabs | ⚠️ Transaction processing | ❌ `web:public/app/cap-network.js` is commerce-only, no finance figures | ✅ planned: one Task table (`listHeader · rowGrid`, `list-ctl.js`) — columns = period state (`api:lib/period.js`), unreconciled count (`bank-recon.js`), BAS due, TB check (`api:lib/books-nightly.js`) |
| Practice staff + roles over clients | ✅ | ✅ Team tab | ⚠️ my.myob | ❌ | ✅ planned (same IAM) |
| Query-to-client thread on a transaction | ✅ Ask + Discuss | ✅ Ask client / My accountant | ✅ portal task | ⚠️ messages and disputes exist on chits; no query type, no due date | ✅ if "query" is a message chit on a ledger entry — no new shape (rule 3) |
| Client approves / e-signs BAS | ⚠️ Xero Sign (paid) | ❌ (apps) | ✅ portal signature | ❌ | ⚠️ needs a decision: ack on the pack (`api:lib/books-pack.js` already has shop acknowledgement) |
| Bulk BAS across clients | ⚠️ per-client queue | ⚠️ per-client | ⚠️ per-client, locks on approve | ❌ | ❌ meaningless without lodgement |
| Move in from Xero / QBO (chart, opening balances, contacts, items) | — | — | ✅ MYOB imports from both | ⚠️ opening balances `api:routes/books.js` `POST /opening` + `web:public/app/cap-books.js:1920`; connector kit `api:tools/tally-connector/adapters/{tally,zoho,csv,gofrugal}.js` reads products/stock only — no chart/contacts/ledger import | ✅ planned: Xero + QBO adapters in the same kit (rule 4: widen the kit) |
| Practice-side pricing (free tool, per-client ledger plan) | ✅ free; $7 / $16.50 ledger | ✅ free (IAS Core) | ⚠️ quoted | ❌ no price anywhere; `api:lib/plans.js` "held" | ❌ undecided |
| Apps / integrations | ✅ 1,000+ | ✅ | ⚠️ | ⚠️ connector kit (Tally · Zoho · CSV · GoFrugal), Tally XML export `api:lib/books-tally.js` | ⚠️ |
| Uptime / ATO outage handling | ⚠️ May 2026 5-day outage | ⚠️ | ⚠️ | n/a | n/a — queue-and-retry would be part of any SBR build |

---

## 5. Where we can be better — and the MUST-MATCH list

### 5.1 Better (the second conversation)

1. **The two-sided record.** On Xero/QBO/MYOB a supplier bill is a PDF that OCR guesses at, then the accountant queries the
   client about. On ChitBridge the supplier *sent* the bill as a chit with lines, HSN/tax and totals frozen at send
   (`api:lib/tax-lines.js`); the buyer's purchase and the seller's sale are the same object. For a CA that means the "Ask client:
   what was this $1,240 to ABC Pty?" thread never starts — the chit answers it. No incumbent has this; it is structural, not a feature.
2. **Three-way match and disputes** on that record (`cap-match.js`, `cap-dispute.js`). Xero and QBO need apps; MYOB has POs only.
3. **Audit trail a CA can sign.** Insert-only journal, rule version stamped on every posting, hash-chained monthly packs the shop
   acknowledges, nightly recompute that reports rather than fixes. Xero's answer is an "Assurance dashboard" of manual codings;
   MYOB users cannot even print when a client approved a BAS. "Audit me" per client is a *read* of what we already keep.
4. **The practice door on a rail.** Because clients and suppliers are already on the same rail, the practice sees a supplier's
   bill the moment it is sent, not when the client remembers to forward it. 150 clients × their suppliers is the distribution
   channel §B.2 names — none of the three has a network side at all.
5. **Price honesty.** Every incumbent raises AU prices yearly; Xero's partner discounts live in images. A published, stable
   per-client ledger price would be noticed by a firm that just absorbed another 10–20% rise.

### 5.2 MUST-MATCH to move even one client (blunt)

| # | Requirement | Why it blocks | ChitBridge status | Blocker? |
|---|---|---|---|---|
| 1 | **Live bank feeds** for the big four + Macquarie/BOQ/Bendigo (direct or CDR/Open Banking via an accredited intermediary) | The CA's whole month-end is "is the bank reconciled"; CSV upload by the client is what QBO users are fleeing in 2026 | ❌ CSV only (`bank-recon.js`) | **Hard blocker.** Needs CDR accreditation or an intermediary (Basiq / Yodlee-class) — a commercial decision, not a build |
| 2 | **STP Phase 2 + Payday Super** payroll (per-payday report via STP-enabled software on the ATO Product Register) | Any client with one employee cannot leave a product that does STP; penalties apply to the client | ❌ no payroll at all | **Hard blocker for clients with staff.** Alternative: integrate an STP-registered payroll (Employment Hero / KeyPay-class) and post the journal — QBO does exactly this |
| 3 | **BAS lodgement through SBR** (DSP Operational Security Framework → test → whitelist → Product Register), or at minimum a BAS the CA can lodge from Online services for agents | Lodgement is the CA's product; "export and re-key" is a step backwards from every incumbent | ❌ no SBR; no DSP registration; India GSP still undecided | **Blocker for the practice door; soft for a single client** if the CA lodges via the ATO portal from our BAS figures. Note the DSP framework's hosting and certification rules bind the whole platform, not one feature |
| 4 | **AU tax pack**: GST 10% with taxable / GST-free / input-taxed, ABN, FY 1 Jul–30 Jun, AUD, tax-invoice wording, AU chart | Nothing above is testable without it | ❌ `tax-packs.js` IN only | Blocker, but it IS the AU1 scope |
| 5 | **Consent grant + practice dashboard** (client invites practice; viewer/editor; one list with unreconciled · period state · BAS due) | This is the door itself | ❌ no cross-business model (DESIGN-NOTES §1.2) | Blocker, IS the CA scope |
| 6 | **Import from Xero / QBO** (chart, contacts, items, opening TB) | 150 clients will not re-key | ⚠️ opening balances typed; adapters read products only | Blocker for scale, IS the CA scope |
| 7 | **Query-to-client on a transaction** with due date and reply in the client's login | Books review / Ask is how the CA works every day | ⚠️ messages on chits | Soft — reuse message chits |
| 8 | **Price list** incl. a ledger-only tier | A partner cannot propose a product with no price | ❌ none | Soft but embarrassing |

**Order that follows from this.** AU1 (tax pack) → CA door (grants, dashboard, import) proves the *layer*; but no client moves
until 1–3 exist, and 1–3 are partnerships/registrations before they are code. The honest pitch to the CA in the meantime is **not**
"switch a client" — it is "connect ChitBridge beside Xero for the supplier-bill side (chits → Xero via the connector kit), and let
the practice door read both." That is reachable with what the repos hold today plus the two adapters, and it is the first thing
Xero / QBO / MYOB cannot copy.

### 5.3 Open questions for Athi (decisions, not research)

1. Bank feeds: CDR accreditation ourselves, or an intermediary? (Cost and timeline decide whether AU is 2027 or 2028.)
2. STP: build payroll, or integrate a registered payroll engine and only post its journal?
3. SBR: is ChitBridge willing to pass the DSP Operational Security Framework (onshore hosting, certification) for AU *and* decide
   the pending Indian GSP question with the same architecture?
4. Does a "query" become a chit type, or a field on a ledger entry? (Rule 3 — one shape; prefer the message chit.)
5. Practice pricing: free door + per-client ledger price, like Xero, or part of the network tier?

---

### Sources consulted (all cited inline above)

Vendor: xero.com/au (pricing, pricing-plans/update, partner-programme, xero-hq, xero-hq/client-insights, xero-tax,
xero-practice-manager, inventory, bank-feeds, submit-gst-returns) · central.xero.com (Adviser role, add user) ·
productideas.xero.com (bank rec, Ask, Workpapers, BAS, users) · quickbooks.intuit.com/au (pricing, quickbooks-online-accountant,
introducing_ias, legacy-bank-feeds-discontinuation, advisor resource centre, learn-support AU help articles) ·
quickbooks.intuit.com/community (bank feeds) · myob.com/au (pricing, practice-bas, practice-tax, practice-compliance, support
articles) · help.myob.com / practice-support.myob.com · myob.lithium.com / community.myob.com · reckon.com/au.
Regulator: ato.gov.au (tax invoices, BAS due dates, BAS agent lodgment program 2026-27, PLS, STP, Payday Super, DSP Operational
Security Framework) · softwaredevelopers.ato.gov.au (RequirementsforDSPs, product register, CAA) · treasury.gov.au (Xero CDR
submissions). Press and reviews: accountantsdaily.com.au, accountingtimes.com.au, smartcompany.com.au, cpapracticeadvisor.com,
isdown.app, capterra.com, aspireapp.com, rounded.com.au, sleek.com, digit.business, scalesuite.com.au, adthena.com,
businessfranchiseaustralia.com.au, dynamicbusiness.com.au, itwire.com.
