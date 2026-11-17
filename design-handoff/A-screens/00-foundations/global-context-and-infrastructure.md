# Global context: what the till needs, what the backend must provide

Two audiences, one product: a shop with **nothing** (one cheap Android phone, patchy 2G, no printer, no bank terminal, cash and credit book) and a shop with **everything** (fiscal printer, card terminal, kitchen screens, e-invoicing, accounting). The same till should serve both by asking the backend one question at start-up — *where am I, and what may I do here?* — and then degrading or blooming from the answer.

---

## 1. One object: `GlobalContext`

The counter asks for this once at start-up and after every sync. Nothing in the UI hard-codes a country, currency, tax or paper size.

```jsonc
{
  "version": 412,                       // bumps on any change; counter caches by this
  "org":   { "id", "name", "plan", "features": ["credit_ledger","kot","loyalty"] },
  "shop":  { "id", "name", "legalName", "address", "geo": {lat,lng}, "phone", "whatsapp",
             "logo", "openHours": [{day,from,to}], "closedDates": [] },
  "locale":{ "language": "ta-IN", "fallbackLanguages": ["en-IN"], "script": "Tamil",
             "numberFormat": "en-IN", "digits": "latin|devanagari|arabic",
             "firstDayOfWeek": 1, "calendar": "gregorian|hijri|bikram",
             "textDirection": "ltr|rtl" },
  "money": { "currency": "INR", "symbol": "₹", "decimals": 2,
             "rounding": { "mode": "nearest", "step": 0.50, "cashOnly": true },
             "priceIncludesTax": true, "secondaryCurrency": null,
             "denominations": [500,200,100,50,20,10,5,2,1] },
  "time":  { "timezone": "Asia/Kolkata", "dayStart": "00:00", "businessDayCutoff": "03:00",
             "serverTime": "2026-09-18T12:40:00+05:30" },   // clock-skew correction
  "tax":   { "regime": "gst_regular|gst_composition|vat|sales_tax|none",
             "registered": false, "registrationId": null,
             "rates": [{code,name,rate,appliesTo}], "pricesIncludeTax": true,
             "documentName": "cash memo|tax invoice|receipt",
             "eInvoice": { "required": false, "provider": null, "thresholds": {} },
             "fiscalDevice": null },
  "payments": { "tenders": [
      {"id":"cash","label":"Cash","enabled":true,"opensDrawer":true},
      {"id":"upi","label":"UPI","enabled":true,"mode":"qr_static","payee":"…","verified":false},
      {"id":"card","label":"Card","enabled":false,"terminal":null},
      {"id":"credit","label":"Khata","enabled":true,"needsCustomer":true},
      {"id":"wallet","label":"M-Pesa","enabled":false,"provider":"…"}],
    "tips": {"enabled": false}, "serviceCharge": {"enabled": false, "percent": 0},
    "splitAllowed": true, "changeDue": true },
  "receipt": { "paper": "58mm|80mm|A5|none", "copies": 1, "language": "ta-IN",
               "footerLines": [], "showQr": true, "digitalDelivery": ["whatsapp","sms","qr"],
               "logoOnPrint": true, "legalFooter": "…" },
  "counter": { "id": "C1", "series": "C1/26-27/", "restart": "yearly", "device": {…} },
  "hardware": { "printers": [], "scales": [], "scanners": ["camera"], "drawer": false,
                "customerDisplay": false, "kds": [] },
  "connectivity": { "tier": "offline|intermittent|online", "dataSaver": true,
                    "syncEveryMins": 15, "photoQuality": "none|96|192|384" },
  "policy": { "roles": {…}, "pinLength": 4, "discountLimitPercent": 10,
              "voidNeedsReason": true, "dayCloseRequired": true,
              "priceEditAllowed": false, "negativeStockAllowed": true },
  "compliance": { "dataResidency": "IN", "retentionYears": 8, "gdpr": false,
                  "auditLogRequired": true, "accessibilityTarget": "WCAG-AA" },
  "content": { "weather": {"enabled": true, "source": "backend_proxy"},
               "holidays": ["2026-10-20"], "festivals": [{date,name}],
               "noticeboard": [] }
}
```

### Precedence
`org default → country pack → shop → counter → device → user` — later wins, but only for keys the plan/policy marks `overridable`. Every override is stored with who set it and when, and the hub shows `from ChitBridge` vs `changed here`.

### Country packs
Ship the differences as data, not code: `packs/IN.json`, `KE.json`, `BD.json`, `DE.json`… each carrying tax regime, document names, rounding, denominations, paper default, digital-delivery norms, e-invoice rules, receipt legal lines. A new country is a pack plus translations, not a release.

---

## 2. What the backend must provide

| Endpoint | Purpose | Notes for weak networks |
|---|---|---|
| `GET /bootstrap?counter=…` | The whole `GlobalContext` + catalog version | One call; ~10–50 KB gzipped; ETag |
| `GET /catalog?since=v` | Delta of products, prices, taxes, quick-key groups, images manifest | Deltas only; images fetched lazily by hash |
| `GET /config?since=v` | Context changes only | Cheap poll, 1–2 KB |
| `POST /bills` | Batch of finished bills, **idempotency key per bill** | Retries forever; server dedupes |
| `POST /events` | Opens/closes, cash counts, voids, sign-ins, audit trail | Same batching |
| `GET /time` | Server time for clock-skew and bill sequencing | A phone with a wrong clock is the norm |
| `GET /content` | Weather, holidays, notices, festival hints | **Proxied by your backend**, never a third-party call from the till: one key, one cache, works behind firewalls, and no data leaves to a vendor |
| `GET /assets/:hash` | Images, fonts, translations | Immutable, cacheable forever |
| `POST /einvoice`, `POST /fiscal` | Only where required | Queue and retry; bill stays valid meanwhile |

Cross-cutting: every response versioned; every write idempotent; every list paginated; server decides `connectivity.tier` hints; translations served as small JSON bundles per language so a shop downloads only its own.

**Numbering must be counter-local.** The till mints `C1/26-27/0003` offline; the server never renumbers, only validates uniqueness per (counter, series). This is what makes offline honest.

---

## 3. Shops with nothing — what makes the difference

These are the features that decide whether a small shop can use the app at all.

1. **Works with zero internet, for days.** All billing local; queue with a visible count; "everything has reached ChitBridge" is the trust line you already have. Sync over any window it gets.
2. **One device, many people.** PIN sign-in, no e-mail accounts, no passwords to type on a cracked screen.
3. **No printer.** Receipt as a QR the customer scans, or a WhatsApp/SMS line, or nothing at all — the till must never insist on paper. If they later buy a 58 mm Bluetooth printer, the same bill prints.
4. **Credit book (khata / udhaar).** The most-used feature in cash-poor markets and missing from most Western tills: sell on credit against a name and phone, see who owes what, take part payments, send a reminder. Design it as a tender, not a bolt-on.
5. **Cheap phones.** Android Go, 1 GB RAM, 5-inch screen: a **Lite build** under ~250 KB of JS, text tiles instead of photos, no animation, `photoQuality: none`, and a hard rule that the sell screen works without images or custom fonts.
6. **Data is money.** Data-saver on by default: deltas, image hashes, no analytics beacons, sync on Wi-Fi when available, a visible "data used today".
7. **Power cuts.** Save after every keystroke, resume the exact bill after a reboot, and never lose a parked bill. Warn at 15% battery: "finish this bill, the day is saved".
8. **Low literacy and numeracy.** Pictures and colour groups, voice entry in the local language, amounts read out loud, big denomination buttons for change, and a "show the customer" mode with the total in huge type.
9. **No formal registration.** `tax.registered: false` must be first-class and honest, the way you already do it ("no GSTIN, so no GST is charged"), never a nag.
10. **Weights and loose goods.** Manual weight entry with a per-kg price, tare, and rounding — most small shops have a mechanical scale, not a serial one.
11. **Shared shop, many sellers.** A helper can bill on their own phone and the owner's counter sees it; no server needed on the premises.
12. **Language and script on paper.** Tamil/Bangla/Amharic on a 58 mm thermal printer usually fails — render the receipt as an image on the device when the printer has no font.
13. **Phone as the whole shop.** No PC, no router, no UPS: the phone is the till, the display and the printer link.

---

## 4. Shops with everything — what they'd pay for

1. **Compliance done for them.** E-invoicing where mandated (India IRN/e-way, Brazil NF-e, KSA ZATCA, EU country schemes), fiscal-device protocols (Italy, Poland, Greece, Hungary), digital signatures and retention. The till queues, the backend files.
2. **Tax that is genuinely hard.** US state/county sales tax by address, EU VAT rates per line and per service type, reverse charge, tourist refunds, deposit schemes (bottle return), exemption certificates.
3. **Real payment hardware.** EMV terminals, tap-to-pay on the phone, pre-auth and tips, partial refunds to the original card, end-of-day settlement reconciliation.
4. **Service and kitchen.** Tables and courses, KDS screens, re-fire, split by seat, service charge, tips distribution, allergen and nutrition data on the ticket.
5. **Multi-store and franchise.** Price books per region, central menu with local overrides, a template a new branch inherits in a day, consolidated day-close.
6. **Staff and cash discipline.** Rota-aware sign-in, per-person drawer, blind cash count, void/discount limits with manager approval on the spot, full audit log.
7. **Identity and security.** SSO/SAML, device attestation, PCI scope kept at zero by never touching card data, GDPR/DPDP rights (export and erase a customer), data residency choices.
8. **Data out.** Warehouse export, accounting connectors, delivery-aggregator order intake, a webhook per bill.
9. **Accessibility as a requirement.** WCAG 2.2 AA, EN 301 549 for public procurement, screen-reader flows for the till itself.
10. **Scale numbers.** 50+ counters, 100k SKUs, sub-100 ms key response, background catalog updates with no visible pause.

The nice twist: the things built for the poorest shops — offline-first, local numbering, resilience, plain language — are exactly what enterprise buyers test hardest ("what happens when the network dies mid-service?"). The same engine sells in both markets; only the packs and the hardware drivers differ.

---

## 5. What to add to the hub and settings now

**Hub → Shop details** (already designed) becomes the read-out of `GlobalContext`, grouped as:
- Identity: name, legal name, address, phone/WhatsApp, logo, `last read 12:28`
- Money & time: currency, decimals, rounding, timezone, business-day cutoff
- Tax: regime, registered or not, document name, e-invoice state
- Hours and closed dates
- Language & script (with a "read it out" toggle for voice)
- Connectivity: tier, data saver, photo quality, sync every N minutes, data used today
- Payments allowed here, and what is missing (no card terminal, UPI unverified)
- Each row: value, source (`ChitBridge` / `changed here`), and whether this counter may change it

**Settings** gains only what is device-local: printer and paper, digital receipt channels, hardware pairing, lite/data-saver, PIN length.

**New screens this implies** (add to the design queue): sign-in with PIN · till open/close with cash count · credit ledger (khata) · digital receipt sheet (QR/WhatsApp/SMS) · weight entry · country/first-run wizard reading the pack · e-invoice queue state · a "what this counter cannot do here" panel.

---

## 6. Tiers to build against (one flag drives the UI)

| Tier | Reality | The till does |
|---|---|---|
| **T0 · dark** | No internet at all, ever | Local only; export by QR or file to another phone; numbering local; no weather, no content |
| **T1 · trickle** | 2G for minutes a day, prepaid data | Deltas only, text tiles, sync on demand with a visible cost, receipts by QR |
| **T2 · patchy** | Home broadband that drops | Background sync, photos at 96 px, alerts when the queue grows |
| **T3 · wired** | Stable network | Everything: photos, live dashboards, terminals, KDS, e-invoicing |

Set the tier from `connectivity.tier` plus what the device actually measures, let the owner pin it, and show it as one chip in the hub. Every feature in the app must declare which tier it needs, so the UI can hide or explain instead of failing.

---

## 7. Decisions needed from you

1. Is the **credit ledger (khata)** in scope? It changes the bill model (a bill can be unpaid) and the day-close.
2. Do you want the **content proxy** (weather, holidays, notices) in ChitBridge, or shall the till call a provider directly? Proxy is the right answer for privacy, caching and firewalls.
3. Which **countries** first? Each pack is about a day's work once the schema is in: India, then one African market (Kenya/Nigeria) and one EU country would prove the model.
4. **Digital receipts**: WhatsApp (needs a business API), SMS (costs), or QR only for the first release?
5. Should the counter be allowed to **override tax or prices** at all? My recommendation: never tax, never price; only display and shift-level things.
