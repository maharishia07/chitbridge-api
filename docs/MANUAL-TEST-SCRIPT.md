# Manual test script — Chit & Bridge, register → full lifecycle (screen by screen)

For the **testing team**. Follow top to bottom; tick **Pass/Fail** and note anything unexpected. Each step says
what to do, what you should see, and **why it matters** (the area it proves).

## 0. Prerequisites (read first — important)
- **This tests the DEV build _after_ deploy.** All the new work is held on branches; the test team runs this only
  **after** Athi pushes + the dev API (Railway) and web (Vercel) are deployed **and** the migrations below are run.
  Testing before that = you're testing the *old* build.
- **Migrations applied on the dev DB:** `chit_direction`, `dispute_routing`, `chit_reads`, `check_constraints`,
  `otp_attempts`. (If per-actor unread or OTP-lockout steps misbehave, a migration was likely missed.)
- **Test OTP:** dev runs with `DEV_OTP=123456` → **every OTP is `123456`**. (This is deliberate for testing; it is
  blocked in production.)
- **Accounts to prepare as you go:** **Entity A** (primary business), **Entity B** (a second, unrelated business —
  for the isolation check), **Actor A1 & A2** (co-assists under A), and one **Customer** phone number.
- **Two browsers / incognito windows** help (A in one, B in the other) for the isolation test.
- Note the **environment/stage indicator** in the UI shows **dev/live**, not demo. (Demo = the no-login mock; not
  what we're testing.)

Legend: **Do** = action · **See** = expected · **Proves** = area covered.

---

## 1. Registration + OTP (incl. new OTP lockout)
| # | Do | See | Proves |
|---|---|---|---|
|1.1| Open the app → **Register**. Pick role/blueprint, enter business name + email, submit. | "Verification code sent" (dev shows the code). | Register flow, blueprint capture |
|1.2| Enter OTP **`123456`** → verify. | Logged in; landing on the main app (Task panel). | OTP verify → token |
|1.3| **(New) OTP lockout:** Register a *fresh* email, then on verify enter a **wrong** code (e.g. `000000`) **5 times**. | After wrong tries you see "**Incorrect code — N attempts left**"; on the limit, "**Too many incorrect attempts — request a new code**" (HTTP 429). | OTP attempt-counter (`lib/otp.js`) |
|1.4| Request a new code (re-register / resend) then enter `123456`. | Lockout cleared; verifies successfully. | Counter resets on fresh OTP |

## 2. First look — navigation & dashboard
| # | Do | See | Proves |
|---|---|---|---|
|2.1| Scan the left menu. | Task, Order, Compose, Co-assists, Disputes, Suppliers, Catalogue, Network, MIS, Settings, Profile, 🔔. | Nav wiring |
|2.2| Click each menu item once. | Each screen loads without error; the clicked item highlights. | All panels render |
|2.3| Look bottom-right. | A floating **💬 Assistant** button is present. | Assistant mounted (every screen) |

## 3. Compose → Send (the two-copy core)
| # | Do | See | Proves |
|---|---|---|---|
|3.1| **Compose**. Note the schema-driven fields (subject/delivery/note) + line items. | Fields render from your schema. | Schema → compose |
|3.2| Add a line item or two; choose **To: a counterparty** (or self), **Send as: entity**. Send. | Success toast ("bridged"). | Chit creation |
|3.3| Go to **Order** (sent). | Your sent chit appears with its status. | `sent` copy |
|3.4| If sent to a counterparty, log in as them → **Task**. If a **self-chit**, check Task too. | A **received** copy exists with its **own** status (self-chit shows in both). | Two-copy fan-out, independent status |

## 4. Task panel lifecycle (+ per-actor unread, restore)
| # | Do | See | Proves |
|---|---|---|---|
|4.1| **Task** → open a received chit. | Detail opens: header, parties, line items, messages. | Detail render (esc'd) |
|4.2| Act through the lifecycle: **Accept → In progress → Complete** (use the on-screen actions). | Status advances each step; timeline records each action. | State machine + audit |
|4.3| Send a **message** on the chit. | Message appears on the record, both sides can see it. | On-record messaging |
|4.4| Toggle **My Task / All Task**. | List scopes to your queue vs the whole floor. | Actor view scoping |
|4.5| **Unread:** have another user/actor act on a chit assigned to you. | The row shows an **unread** marker/colour for you specifically. | Per-actor unread (`chit_reads`) |
|4.6| Archive a chit, then **Restore from Trash**. | It leaves the list on archive and comes back on restore. | Restore endpoint |

## 5. Co-assists (actors) — the heart of the "acts for you" model
| # | Do | See | Proves |
|---|---|---|---|
|5.1| **Co-assists** → read the banner; click **"?"**. | Banner explains co-assists; "?" shows co-assist help from the library. | coassists "?" context |
|5.2| **Add** Actor **A1** (name + handle/user id). Repeat for **A2**. | Both appear in the list; a login id/OTP is shown to share. | Actor create |
|5.3| In a separate window, **log in as A1** (username + OTP `123456`, then set a PIN if prompted). | A1 is signed in, acting under Entity A. | Actor login (PIN/OTP) |
|5.4| As Entity A, **push** a task to A1; as A1, **pull** one from the pool. | Assignment moves accordingly; counts update. | Push/pull assignment |
|5.5| **Bulk-assign:** select several chits → assign all to A2. | All selected move to A2 in **one** action; counts consistent. | Bulk assign (now **transactional**) |
|5.6| Put A1 on **break / leave**. | A1's open work **returns to the pool**; recorded. | Presence → reassignment |

## 6. Disputes
| # | Do | See | Proves |
|---|---|---|---|
|6.1| On a chit, **raise a dispute** (add a note). | Dispute recorded; both sides see it; 🔔 reflects it. | Dispute raise + notify |
|6.2| (If set) assign a **dispute handler** actor in Profile; raise a dispute on a chit that actor doesn't own. | The handler is flagged for that dispute (notify/view), even unassigned. | Dispute routing / team |
|6.3| **Resolve** the dispute (resolution note). | Status → resolved; recorded on the timeline (atomic). | Dispute resolve (transactional) |

## 7. Suppliers
| # | Do | See | Proves |
|---|---|---|---|
|7.1| **Suppliers** → add a supplier by **user id OR email**. | Supplier resolves and is added (either identifier works). | Supplier resolution fix |

## 8. Catalogue (shop side)
| # | Do | See | Proves |
|---|---|---|---|
|8.1| **Catalogue** → add a product with a **name, price, unit**. | Product appears; price saved. | Catalogue CRUD |
|8.2| Note the shop's **public link / bridge id** for §10. | You have the storefront URL. | Public catalogue handle |

## 9. Notifications / Profile / Settings
| # | Do | See | Proves |
|---|---|---|---|
|9.1| Click **🔔**. | Real recent activity by others (not a hardcoded number); your own actions excluded. | Notifications feed + real badge |
|9.2| **Profile** → confirm your **user id** field; set the **dispute handler** to one of your actors; save. | Saves; only your own actors are selectable. | Profile (user_id, handler guard) |
|9.3| **Settings** → review toggles. | Settings show but are labelled **"not yet active"**. | Honest dead-settings labelling |

## 10. End-customer storefront (no-login) — incl. NEW price integrity + OTP cap
| # | Do | See | Proves |
|---|---|---|---|
|10.1| Open the shop's **public catalogue** URL (no login). | Only **public** products show, with shop name/identity. | Public, visibility-gated browse |
|10.2| Add items to an order, enter a **phone**, start order. | "Code sent" (dev → `123456`). | Customer OTP issue |
|10.3| **(New) Price tamper test:** before confirming, if you can alter the request, set a line **price to 0/1**; otherwise just confirm a normal order. | Order total is the **shop's catalogue price**, NOT the tampered value; an item **not** in the catalogue is **rejected** (422). | **Order price integrity** (`repriceAgainstCatalogue`) |
|10.4| Confirm with OTP `123456`. | "Order placed"; you get an order/customer token. | Customer order (two-copy, atomic) |
|10.5| **(New) Customer OTP cap:** start another order, enter a wrong OTP 5×. | Locks out after the cap (429), same as §1.3. | OTP cap on the public surface |
|10.6| View **my-orders** as the customer. | You see **only your own** orders. | Per-customer isolation |
|10.7| As Entity A, check the order arrived as a **Task**. | The order is a received chit on A's side. | Storefront → chit |

## 11. Network (now write-gated)
| # | Do | See | Proves |
|---|---|---|---|
|11.1| **Network** → view your structure (reads). | The tree/connections load (auth required). | Network reads |
|11.2| Try a **write** (register/connect/approve/claim) on dev. | Unless `NETWORK_WRITE_ENABLED=true` is set on dev, you get **"Network editing disabled"** (503). | **Network write-gate** |
|11.3| Hit `GET /api/network/entities/<any-id>/catalogue` and `POST` the same path **with NO Authorization header** (e.g. curl/Postman). | Both rejected **401 Unauthorised** (no token). With a valid token: GET → 200, POST → 503 (NET_WRITE_DISABLED). | **cb_* catalogue auth (F1 fix)** |

## 12. AI assistant (library mode — no AI key yet)
| # | Do | See | Proves |
|---|---|---|---|
|12.1| On any screen, click **"?"** at the top. | A help panel answers from the library; an **"Explore ? to know more"** hint. | Per-screen "?" |
|12.2| Open **💬 Assistant**; ask "is this for a timber yard?" and "what is a co-assist?". | Honest, relevant answers from the library (with fit signal pre-login); never overselling. | Library matcher, honesty |
|12.3| On **Co-assists** and during **Compose**, open the assistant. | Suggestions are **screen-relevant** (coassists / schema answers). | coassists + schema contexts |
|12.4| Ask something nonsensical. | "I am not certain… I will not guess or oversell." | No-oversell guardrail |
| | *(Note: real AI answers only appear once an Anthropic key is configured + `CFG.ASSIST_LLM=true`. Until then it's library mode — that's expected.)* | | |

## 13. Tenant isolation (P0 — must pass)
| # | Do | See | Proves |
|---|---|---|---|
|13.1| Log in as **Entity B** (separate browser). | B sees only B's own chits/orders/catalogue — **nothing of A's**. | **Tenant isolation (P0)** |
|13.2| Try to open one of **A's** chit links/ids while logged in as B. | Denied / not found (no cross-entity data). | Isolation on direct access |

> **Any** cross-entity leak in §13 is a **drop-everything P0** — report immediately with steps.

---

## What "done" looks like
Every section 1–13 ticked Pass, with special attention to the **new** behaviours: OTP lockout (1.3, 10.5), order
price integrity (10.3), network write-gate (11.2), bulk-assign atomicity (5.5), per-actor unread (4.5), and the
isolation check (13). Log each failure with: screen, steps, what you expected, what happened, screenshot.

## Known-not-built (don't log these as bugs)
Real AI answers (needs a key), non-human co-assists (connectors/devices/agents — planned), subscription/quota
limits, MIS as authoritative server rollup, network *editing* on dev unless explicitly enabled, AI-assisted schema
building. See `docs/TECH-HARDENING-BACKLOG.md`.
