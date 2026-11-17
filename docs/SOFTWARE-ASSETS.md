# Software assets — what can leave the building, and what cannot

**Status:** the inventory, proven. `tests/bare-slate.test.cjs` runs every claim on this page.

> Athi, 2026-09-15: *"each capability has to be proven without the concept of chit if possible so we understand
> what is tightly bound and what can be reused and we have to clearly mark it, so we should be able to include
> it as a jar file or include in any other language kind of — that will be our software asset."*

---

## The test, and why it is not "few imports"

A module is an **asset** if it can be lifted out, dropped into a program that has never heard of a chit, and
still answer correctly. That is stricter than it sounds, and it is checkable:

1. **It is alone.** Its `require()` list is empty, or holds only a language builtin. A module that reaches for
   `../db` is bound to *this* database however pure its arithmetic looks.
2. **It answers a real question**, exercised with no database, no network, no server, no session, no chit.

`tests/bare-slate.test.cjs` asserts both, per module, every run. **22 checks.**

⚠️ **A green run is not a shipping claim.** It says these eleven *can* be lifted. Nobody has packaged, versioned or
documented them for an outside consumer, and that is the difference between an asset and a product.

---

## The eleven that are assets today

| module | what it decides | notes |
|---|---|---|
| `money.js` | an amount **and** a currency | refuses to total across currencies — a conversion nobody authorised |
| `points.js` | a reward balance | deliberately a *different shape* to money, so neither passes as the other |
| `units.js` | one unit, many spellings | folds `கிலோ → kg`; **never** relates two different units |
| `docnumber.js` | what a document number may look like, per country | India studied; everything else permissive, never guessed |
| `jurisdiction.js` | country → how a party may be paid | `(scheme, value)` pairs; says nothing about worth |
| `rewards.js` | what a point is worth, in words | holds no balance, invents no worth, formats no money |
| `inventory.js` | perpetual stock, weighted average | must answer identically offline on a counter and on the server |
| `canon.js` | the same value, always the same bytes | uses node's `crypto`; a Java port would use its own |
| `order-input.js` | what a catalogue asks a buyer for | 7 presets, schema fragments, documents |
| `form-handshake.js` | which document fills which field | answers at *design* time, before anyone uploads |
| `convert.js` | what a quantity is worth, and who said so | ⭐ the first that stands on two others — money and units are Tier A, so they travel **with** it |

**The shared discipline, and why these eleven and not others:** every one of them **refuses rather than guesses**.
`money` will not convert. `units` will not relate a crate to a kilogram. `docnumber` will not invent a rule for
a country nobody studied. That refusal is what makes them portable — a module that guesses has to know your
context, and a module that knows your context cannot leave.

⚠️ **`convert.js` is the strictest case of that rule, and the reason it is worth reading before the others.** A
conversion is the one place where guessing is easiest and costs the most — a unit factor nobody supplied, a
reciprocal nobody authorised, a date nobody recorded. It refuses all three, and carries **no price feed**: the
rate is an input with a declared provenance, so the engine is the asset and the feed is a plug. It is also the
one with a page over it — `chitbridge-web/public/conversion-lab.html`, running the vendored copy — which is as
close as anything here gets to a demonstration that a module could serve somebody outside this repo.

---

## What is deliberately NOT an asset

⚠️ These are excellent code and they are **bound**. Naming them is as important as naming the ten, because a
package that quietly includes one of them stops being liftable.

| | why it stays |
|---|---|
| `mint.js`, `raiseticket.js` | they mint **chits**. The chit *is* ChitBridge. |
| `govresolve.js`, `regional.js` | read tables — the cascade is a *shape* worth copying, the code is bound |
| `ctpaddress`, `ctpenvelope`, `ctpkeys`, `ctpdirectory`, `ctptransport` | CTP should leave as a **specification**, not a library. Like SMTP, the value is two independent implementations interoperating; shipping ours makes it a product with an API. |
| `workroute.js`, `platformroot.js` | database-bound, and they encode *our* operating model |
| everything in `routes/` | HTTP, sessions, our auth |

---

## The three layers, by portability

1. **The isolation primitive — extractable, and small.** `population` + b247's trigger + `withEntity` +
   FORCE RLS. ~200 lines of SQL and one connection helper, and it has no idea what a chit is. **This is the
   part that would install on a bare slate and work.**
2. **The governance cascade — a shape, not code.** universe → constitution → installation → entity, with
   `bounded()` tighten-only. `lib/govresolve.js` is ~120 lines and already content-free: every rule is data.
   Someone could adopt the cascade and put entirely different content in it.
3. **CTP — a specification.** See [CTP-DESIGN.md](CTP-DESIGN.md).

---

## What would make this a real package — not done

Honestly listed, because the gap between "provably liftable" and "somebody else can use it" is most of the work:

- [ ] **a bare-slate script against an EMPTY Postgres** — create two worlds, prove a chit cannot cross between
      them, prove one entity resolves Indian tax and another Emirati, lift one world, prove CTP carries a chit
      and the rows are identical. **If that runs green on an empty database, the package is real. If it does
      not, the package is a claim.**
- [ ] a package boundary: one folder, one `package.json`, no reaching upward
- [ ] versioning, and a statement of what a breaking change is
- [ ] documentation written for somebody who does not work here
- [ ] a port of one module to a second language, to find out what was secretly JavaScript

⚠️ **The first item is the one that decides the rest.** It defines what the package must contain, and it stops
the package becoming a folder of hopeful abstractions.
