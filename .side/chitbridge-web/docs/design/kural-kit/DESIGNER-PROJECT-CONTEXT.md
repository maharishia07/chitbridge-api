# Project context — Business app (BUS014) design work

Read this first in every new chat. It records what has been designed and decided so far.

## The app
- A Tamil-first business / accounting app. Business code shown in UI: `BUS014`.
- App name: not decided yet — designs use the placeholder `[YOUR APP NAME]`.
- Tagline (from the kural work): **வள்ளுவர் வழியில் வணிகம்** — "A Thirukkural for every part of the business".
- Existing ledger app sidebar: Day book, Ledgers, Trial balance, P&L, Balance sheet, Dues, Cheques, Waiting, Month lock, Packs, Opening balances, Shop ledgers.

## Thirukkural — one per module
| Module | Kural | Tamil | English |
|---|---|---|---|
| Dashboard | 616 | முயற்சி திருவினை ஆக்கும் முயற்றின்மை / இன்மை புகுத்தி விடும் | Effort brings prosperity; lack of effort brings poverty. |
| Employees & HR | 517 | இதனை இதனால் இவன்முடிக்கும் என்றாய்ந்து / அதனை அவன்கண் விடல் | Know which person can do which task, and by what means, then trust them with it. |
| Accounts & Balance Sheet | 120 | வாணிகம் செய்வார்க்கு வாணிகம் பேணிப் / பிறவும் தமபோல் செயின் | Good business guards the interests of others as carefully as its own. |
| Planning & Approvals | 467 | எண்ணித் துணிக கருமம் துணிந்தபின் / எண்ணுவம் என்பது இழுக்கு | Think carefully before you act. Once begun, hesitating is a mistake. |
| Projects & Targets | 666 | எண்ணிய எண்ணியாங்கு எய்துப எண்ணியார் / திண்ணியர் ஆகப் பெறின் | Those with firm resolve achieve exactly what they set out to do. |
| Sales & Collections | 619 | தெய்வத்தான் ஆகா தெனினும் முயற்சிதன் / மெய்வருத்தக் கூலி தரும் | Even when fortune is against you, hard work still pays its reward. |
| Profit & Reports | 754 | அறனீனும் இன்பமும் ஈனும் திறனறிந்து / தீதின்றி வந்த பொருள் | Wealth earned skilfully and honestly brings both virtue and joy. |

### Tax & compliance kurals
| Screen (route) | Kural | Idea |
|---|---|---|
| GST & TDS (`gst`) | 733 | Pay dues fully and willingly |
| Tax due summary (`tax-due`) | 756 | Tax is the state's rightful share |
| Period close & year end (`period-close`) | 385 | Earn, collect, protect, allocate |
| Accountant role (`role-accountant`) | 512 | The right hands for revenue work |

### Governance kurals
| Screen (route) | Kural | Idea |
|---|---|---|
| Day book & daily close (`daybook`) | 520 | Check every day |
| Approval decision (`approval`) | 541 | Fair before firm (pairs with 467) |
| Month lock (`month-lock`) | 547 | The rules you keep will keep you |
| Audit trail (`audit-trail`) | 448 | Keep people who can say no |
| Suspense & reconciliation (`suspense`) | 436 | Fix your own errors first |
| Settings & controls (`settings`) | 546 | Integrity over force |

### CB CRM kurals (proposed, footer on each page)
| CRM page (route) | Kural | Idea |
|---|---|---|
| Parties list (`crm-parties`) | 120 | same as Ledgers › People — one voice across apps |
| Party page & timeline (`crm-party`) | 783 | the relationship deepens with each visit |
| Messages & dues reminders (`crm-messages`) | 100 | ask for the money, kindly |
| Service & complaints (`crm-service`) | 788 | help comes at once |
| Disputes (`crm-disputes`) | 108 | close the matter, keep the relationship |
| Loyalty & offers (`crm-loyalty`) | 103 | goodwill without counting |
| Leads & enquiries (`crm-leads`) | 94 | kind words at first contact |
Rule: never put a kural inside an outgoing customer message.

**Excluded:** Kural 552 (over-taxation warning) — never on tax screens.
Full Tamil text of all 17 is in `kurals.json` (kural-kit.zip).

### Language
- `kuralLang` = `ta` (Tamil verse leads, English meaning below) or `en` (English meaning leads, Tamil verse below). Defaults to app language; the Tamil verse is always shown.
- Tamil + English are required. More languages later (Hindi, Telugu, etc.) by adding `meaning.<code>` per kural; fallback to English; optional `translit.<code>` (Tamil verse in that script). Translations must be our own or licensed.
- Simple Tamil meanings (`meaning.ta`) not written yet. Tamil UI labels in the mockups need native-speaker review.

### Where a kural appears (placement rules)
- **A · Hero leaf** — palm-leaf panel, Home/Dashboard only, once per screen.
- **B · Header strip** — slim teal strip with red cord line under each module's title; user can hide it for the day.
- **C · Empty state** — kural under "nothing here yet" messages.
- **D · Splash / loading** — app start and long-running reports.
- **E · Print / PDF footer** — one quiet line on bills, statements, reports.
- **Sign-in page** — "Today's kural" (rotates daily) + ticker of module kurals + full **kural library** at the bottom of the index page, grouped Modules / Tax & compliance / Governance, with a தமிழ் / English toggle.
- Rules: one kural per screen; hero on Home only; hide-for-today per user; owner can switch off; never in forms, dialogs, errors or toasts.
- Developer guide for Claude Code / CLI: `kural-kit.zip` → `KURAL_GUIDE.md`, `kurals.json`, `CLAUDE.md` snippet (put in `docs/kural/`).

## Visual language (kural design)
- Colours: page `#F3EBDD`, ink `#2B1D14`, muted `#6B5646`, palm leaf `#E6CF97` (edge `#C9A75E`), cord red `#8E2A23` / `#C2493F`, gold `#C98A12` / `#E0A532`, teal strip `#14423F` with text `#F3E6C4`, card surface `#FBF6EC`.
- Fonts: Noto Serif Tamil (kural Tamil), Spectral italic (kural English), IBM Plex Sans (UI).
- Mark: Valluvar seal (seated figure in a gold circle, inline SVG).
- No emoji in UI; line icons only. Touch targets ≥ 44px.

## Ledgers page — redesign to the frozen CB list standard (2026-10-03)
- Delivered: ledgers-page-redesign.zip (tree pane + CBList, 11 states × Cream/Dark/Terminal × 1366/390, README with answers and "anything else").
- Kural proposed (awaiting Athi): a footer band on every page, every size (CBKural); meaning beside / below / taking turns by space; never in the head. Per ledger: People & stock 120 · Cash & bank 520 · GST/TDS 733 · Suspense 436 · Income & expenses 754 · Capital 385. Candidates: Bank & reconcile 118 · UPI/card settlements 690 · Loans/cash flow 215.

## Ledgers page (chart of accounts) — earlier decisions
- Accounts grouped by class: Personal (People), Real (Things you hold), Nominal (Income and expenses), with sub-groups (Cash & bank, Stock & advances, GST, Taxes & suspense, Owner's equity, Income, Direct costs, Operating expenses, Adjustments).
- Collapsible sections + Expand/Collapse all; collapsible sidebar; sticky header; search by code or name; class filter chips; report buttons (Trial balance, P&L, Balance sheet) top-right.
- Handover zip delivered: plain HTML/CSS/JS (`index.html`, `styles.css`, `data.js`, `app.js`). Clicking an account fires `ledger:open` with `{ code }`.
- Still to do: Dr/Cr balance column per account.

## Artifacts (links)
- Kural in the App (index + library, home, module, placements, library page-fit): https://claude.ai/artifact/Mme3VH7NkGxdZCUXVub6WZ
- Thirukkural slogans for every module (original list): https://claude.ai/artifact/YarFHhRNAcXXx3BkdLHH4a
- Ledgers – Chart of Accounts: https://claude.ai/artifact/LpwVJnNjMniRNko5R7j1Ay
- Chilli Paneer Card Suite (menu card formats): https://claude.ai/artifact/5f39QyHRYnGMJt3nqLHPj6

## Open questions
- Final app name and logo.
- Whether the ledger app's sidebar items map onto the seven kural modules (e.g. Day book / Dues / Cheques → Accounts or Sales & Collections).
- Real data for dashboard figures.
