# Incident & breach runbook — India · Australia · UAE (round CO2, control K5)

Source: `docs/research/COMPLIANCE-OBLIGATIONS-2026-10.md` (CO0) rows IN-6, IN-7, AU-7, AU-8, AE-4. Not legal advice; notice wording
needs a lawyer in each country before first use (owner's checklist, `OWNER-ACTIONS.md`). Every incident — and every drill — gets a row
in `INCIDENT-REGISTER.md` the same day, even when the answer is "not reportable".

## 0 · How we hear about it
- **A critical log line** (`lib/logger.js` in chitbridge-api: database unreachable, RLS off, a half-applied migration, bytes never
  landed) is POSTed at once to `CB_ALERT_WEBHOOK` (the on-call channel). Proof: `chitbridge-api/tests/co2-controls.test.cjs`.
- A shop, a customer, a provider (Supabase · Railway · Vercel · Meta) or a researcher tells us → `support@` / the grievance contact.
- **The clock starts when we NOTICE**, not when it is confirmed. Write the noticed-at time (IST and UTC) first.

## 1 · The clocks (from noticed-at)
| Clock | Who | What | Rule |
|---|---|---|---|
| **6 hours** | CERT-In | Report a listed cyber incident (unauthorised access, data breach, compromise, DoS, malware…) via incident@cert-in.org.in / the CERT-In form | CERT-In Directions 28 Apr 2022, dir.(ii) ◐ |
| **without delay** + **72 hours** | Data Protection Board (India) and each affected person | First intimation at once; the detailed report within 72 h | DPDP Act s.8(6); Rules 2025 r.7 (from 13 May 2027) ◐ |
| **30 days** to assess, then **as soon as practicable** | Australian Privacy Commissioner (OAIC form) and each affected person | Only if "likely to result in serious harm"; one notice for jointly held data | Privacy Act 1988 s.26WH(2), s.26WK, s.26WL ◐ |
| **72 hours** of paying | Australian Signals Directorate | Only if a ransom is paid and turnover > A$3M (not us today) | Cyber Security Act 2024 Part 3 ◐ |
| **deadline: ?** | UAE Data Office and each person; as processor → the shop (controller) first | Executive Regulation not confirmed | PDPL FDL 45/2021 Art.9 ? |
| **at once** | Each affected shop | We are their processor in every country: tell the shop first so it can meet its own clock | DPDP s.8(2) · APP 11 · PDPL Art.8 |

## 2 · Steps
1. **Contain** — revoke the key/session (`docs/RUNBOOK-rotate.md` in the api), take the route down, stop the job. Do not delete evidence.
2. **Preserve** — export the Railway logs for the window *now* (they are short-lived); `signin_events`, `access_events`, `state_log` are
   insert-only and stay. Note the request ids (`X-Request-Id`).
3. **Classify** — personal data? which countries' people? which shops? Is it a CERT-In listed type? → fills the clock table above.
4. **Report** — send what is known inside each clock; say what is not yet known. Later facts go in a follow-up, not a late first report.
5. **Tell the shops** affected, in shopkeeper words: what happened · what it means for you · what to do.
6. **Close** — root cause, the fix, the test that now proves it; register row closed with dates.

## 3 · Drill
Once a year (and after any change to this file): a tabletop drill on a made-up incident, timed against the clocks; recorded as a
`drill` row in the register. The first drill is on the owner's checklist.
