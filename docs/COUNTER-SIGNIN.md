# Signing in at the counter — the audit, the module, and the flow

**[TILL-187] · 2026-09-21**

Athi: *"There is a real confusion in sign-in procedure in the counter application, can you find out in how many
places this procedure exists for counter application, can you bring it as a single module and create a flow
chart, so it is well understood and can be tested."*

---

## 1 · The confusion, named

There are **four different acts** a shopkeeper would call "signing in", and until this note they were spread
over **eleven entry points, five dialogs and three code paths**, with **three of them painted with the same two
words**.

| The act | What it really does | How often | Needs the line? | What it leaves |
|---|---|---|---|---|
| **connect** | a **device** is given a **key** | once per PC | **yes** | a key on that PC; the program restarts |
| **key** | a **key** is **pasted** in | once per browser | no | a key in that browser; the page reloads |
| **signin** | a **person** proves who they are | every shift | **yes** | who you are — and **no session** |
| **handover** | a **person** hands to another | every shift | no | the next name on the bills; **same counter number** |

The word "Sign in" sat on `connect`, on `signin`, **and** on the name picker, which is not a sign-in at all —
its own last line says so. Pressing the three controls labelled "Sign in" opened three unrelated dialogs.

---

## 2 · Every place it existed — the count

### The page (`tools/tally-connector/till.html`)

**Five dialogs**, where a shopkeeper expected one or two:

| # | Dialog | id | What it is | Door |
|---|---|---|---|---|
| 1 | Connect this counter | `#signindlg` | device pairing, OTP, restart | connect |
| 2 | (same dialog, browser) | `#signindlg` | "paste a key into ⚙" — a dead end with an explanation | key |
| 3 | Sign in | `#usigndlg` | the person sign-in (TILL-183) | signin |
| 4 | Who is at this counter | `#whodlg` | the **name picker** — not a sign-in | handover |
| 5 | Shift | `#shiftdlg` | end of a shift, blind cash count | handover |

**Eleven entry points** that led into one of them:

| Where | Label on screen | Went to | Was it right? |
|---|---|---|---|
| Header pill / **F7** | "who is signed in" | `whoAct()` | ✅ (since TILL-183) |
| ⚙ Settings › Counter | **Sign in** | `signinOpen()` — device | ⚠️ same words, different act |
| Alert strip pill | **Sign in** | `signinOpen()` — device | ⚠️ same words, different act |
| Flash "Not signed in" | **Sign in** | `signinOpen()` — device | ⚠️ same words, different act |
| Flash "Signed out by the shop" | **Sign in** | `signinOpen()` — device | ⚠️ same words, different act |
| Day card, unpaired | **Connect it** | `signinOpen()` — device | ✅ the only correctly-worded one |
| `shopReady()` stop — no key | **Sign in** | `signinOpen` | ⚠️ |
| `shopReady()` stop — wrong key kind | **Sign in** | `signinOpen` | ⚠️ |
| `shopReady()` stop — nobody on | **Sign in** | `openWho` — **the picker** | ❌ **the fix could not fix it** |
| Unsent-bills refusal | "Sign in to send them" | `signinOpen` | ⚠️ |
| **Morning step 1 — "who is on the counter"** | — | `openWho()` — **the picker** | ❌ **could not reach TILL-183 at all** |
| Hub person block | **Sign out** | `openWho()` — **the picker** | ❌ **signed nobody out** |

**Three sign-outs**, also sharing one word:

| Function | What it ends | Needs the line? |
|---|---|---|
| `usignOut()` | the **person's shift**. Counter stays open and keeps billing. | no |
| `signoutOpen/Do()` | **this PC's** claim on the shop. Bills must be sent first. | yes |
| `signoutCloud/Do()` | the same, for the browser counter | no |

**Three ways a key can arrive**, all ending at the same `cb_till_key`:
boot `#key=` in the address · `hashchange` re-pair · ⚙ Settings `set_key` field.

### The shop PC program (`tools/tally-connector/till.js`)

| Route | Act |
|---|---|
| `POST /api/signin/start` → cloud `/api/entities/register` | connect |
| `POST /api/signin/finish` → cloud `/api/entities/verify` → `/api/till/enrol` | connect |
| `POST /api/entities/register` · `/verify` (forwarded, **no key attached**) | signin |
| `POST /api/signout` | leave (device) |

### The backend (`chitbridge-api`)

| Route | Act |
|---|---|
| `routes/entities.js` `POST /entities/register` | sends the OTP — **shared by every act** |
| `routes/entities.js` `POST /entities/verify` | returns the identity **and a session** |
| `routes/till.js` `POST /till/enrol` | trades that session, once, for a **till key** |

> ⚠️ **`connect` and `signin` call the same two cloud endpoints.** They are not two authentication systems —
> they are one, read two ways. What separates them is *what is kept afterwards*: `connect` trades the session
> for a key and throws the session away; `signin` keeps the identity and throws **everything else** away.
> A counter that kept a session would stop billing when it expired, in the middle of an afternoon,
> for no reason a shopkeeper could see.

**Total: 4 acts · 5 dialogs · 11 entry points · 3 sign-outs · 3 key paths · 7 routes.**

---

## 3 · The single module

Everything that *decides* now lives in **`lib/signin.js`** — no surface, no DOM, no request of its own, and a
test asserts it stays that way. It already owned the person sign-in (TILL-183); it now owns **which door a
button means**.

```js
CBSignin.ACTS        // the four acts, each with the ONE word that belongs on it
CBSignin.LEAVES      // the two ways out: a shift, or this PC
CBSignin.door(state) // → { act, label, subject, why, blocked, stop }
CBSignin.leave(state)// → { act, label, costs, blocked, stop }

// and the person sign-in itself, unchanged:
CBSignin.who / ask / code / verify / keep / refusal / stage / say
```

`door()` takes **five plain facts**, never a page object:

```
host    'agent' (shop PC program) | 'browser'   a browser cannot pair — its door is different
paired  is there a key on this device at all
till    does that key carry the `till` scope    a connector key is not a counter key
person  is somebody standing here
online  is the line up right now
```

> ⚠️⚠️⚠️ **Which act a button means is not a property of the button.** It is decided by what the counter is
> holding at that moment — which is exactly why it could not be written into the label at design time, and
> exactly why three labels drifted apart. The page calls `signDoor()` and paints the answer.

### What changed in the page

| Before | After |
|---|---|
| `whoAct()` asked one question: *is somebody on?* | asks the engine, which asks five |
| Morning step "who is on the counter" → the picker | → `whoAct()`, the same door as F7 |
| Hub "Sign out" → the picker | → `usignOut()`, which is what the sentence beside it promised |
| `shopReady()` fix for "nobody signed in" → the picker | → `whoAct()` |
| Three stops all reading "Sign in" | the word comes from `door().label` |

---

## 4 · The flow chart

```
                        ┌─────────────────────────────┐
                        │  someone presses the one    │
                        │  button (F7 / header pill)  │
                        └──────────────┬──────────────┘
                                       │
                              ┌────────▼────────┐
                              │ is there a KEY  │
                              │ on this device? │
                              └───┬─────────┬───┘
                             no   │         │  yes
                     ┌────────────┘         └────────────┐
                     │                                   │
            ┌────────▼────────┐                 ┌────────▼────────┐
            │ shop PC, or a   │                 │ is it a TILL    │
            │ browser?        │                 │ key?            │
            └──┬───────────┬──┘                 └───┬─────────┬───┘
         PC    │           │  browser           no  │         │  yes
        ┌──────▼─────┐ ┌───▼────────┐      ┌────────┘         │
        │  CONNECT   │ │    KEY     │      │ back to the      │
        │  this      │ │  paste one │      │ device door      │
        │  counter   │ │  into ⚙    │      └──────────┐       │
        └──────┬─────┘ └───┬────────┘                 │       │
               │           │                  ┌───────▼───────▼───────┐
        needs the line     no line needed     │ is somebody standing  │
               │           │                  │ at the counter?       │
               ▼           ▼                  └────┬─────────────┬────┘
        ┌──────────────────────┐              no   │             │  yes
        │ OTP → key → restart  │           ┌───────▼──────┐  ┌───▼──────────┐
        └──────────────────────┘           │   SIGN IN    │  │  HAND OVER   │
                                           │  a person    │  │  the shift   │
                                           └──────┬───────┘  └───┬──────────┘
                                          needs the line         no line needed
                                                  │                  │
                                                  ▼                  ▼
                                        ┌──────────────────┐ ┌──────────────────┐
                                        │ OTP → identity   │ │ blind cash count │
                                        │ NO session kept  │ │ SAME counter no. │
                                        └──────────────────┘ └──────────────────┘
```

**The two rules the chart encodes**

1. **Order matters.** A counter with no key has a bigger problem than a counter with nobody on it. Offering a
   shift handover to a counter that cannot bill is a dead end in a new coat — and it is what the page did.
2. **The two acts that work with the line down are the two a shop needs mid-afternoon.** Not a coincidence:
   an identity is fetched once, a shift changes all day.

---

## 5 · How to test it

```
node tests/signin.test.js          # 28 checks, no browser, no network, every branch of §4
node e2e/till-ready.cjs            # the words a blocked counter shows a shopkeeper
node e2e/till-netsim.cjs           # a dead key offers the KEY door, not a sign-in
node e2e/till-pair.cjs             # connect: OTP → key → restart
node e2e/till-morning.cjs          # the morning's who-step, through the same door as F7
```

Full run at the time of writing: **1381 guards across 71 files** and **38 harnesses** — all passing.

**Two assertions were MOVED, never deleted** — both were holding the defect in place:

* `till-ready.cjs` asserted the fix for a blank counter reads literally `'Sign in'`. It is a *browser* counter
  with no key, so the act it needs is not signing in at all. It now asks `signDoor().label`, the same engine
  the page asks, and additionally asserts the word is **not** "Sign in".
* `till-netsim.cjs` asserted a refused key flashes `/sign in/i`. A refused key is not a person failing to sign
  in, and saying so sends a shopkeeper to the wrong screen. It now asserts the flash offers the **device
  door**, and that it is a different word from a dead line.

---

## 6 · Still open

* **The hardware sign-in.** A PIN pad or a card at the counter — `whoAct()` would gain a fifth door. Not built.
* **`/floor/who`.** On a floor, the F7 staff list must come from the shop PC, not the cloud; an unpaired phone
  still shows an empty list.
* **The name picker survives as `handover`**, which is its real job. It is no longer reachable by any control
  labelled "Sign in".
