# The namespace — every kind of id, and what separates them

**Status:** the register. Where a row says ✅ it is enforced in code and the file is named; where it says 🟡 it
is Athi's specification and **not built**; ⚠️ marks a contradiction that needs settling.

> **Why this file exists.** The grammar was real and well argued — but it lived only inside the header comments
> of `lib/handle.js`, with the rest scattered across `routes/actors.js`, `lib/local-identity.js`,
> `lib/bridgeid.js`, `routes/catalogue.js` and `lib/ctpaddress.js`. Asked a direct question about foreign
> addressing on 2026-09-15, I reconstructed it from the code and **got the customer id wrong twice in a row**.
> Athi: *"you need to have name space somewhere properly documented."* This is that place. When this file and
> the code disagree, **the code wins and this file is the bug.**

⭐ **The machine-readable table is [`namespace.yaml`](namespace.yaml), and it is checked on every run** by
`tests/namespace.test.cjs` (16 checks, inside `npm run guards`). Change the CHECK constraint, the bridge-id
alphabet, a length cap, the reserved list or the minted kinds without updating the register and the guard fails
and names the difference. This page is the argument; the YAML is the rule.

**Where each kind is minted — and every one of these files now points back here**, because that is where
somebody looking for the grammar actually arrives: `lib/bridgeid.js` · `lib/handle.js` · `lib/local-identity.js`
· `lib/ctpaddress.js` · `routes/actors.js`.

---

## 1 · Three names, three jobs

From `lib/handle.js`, and the rule everything else hangs off:

| | example | what it is |
|---|---|---|
| `bridge_id` | `CBM5P72HB7` | the **identity** — minted, unique, never changes, never reused, rarely typed |
| `user_id` | `acmetraders` | the **handle** — unique, human, portable; what you give someone |
| `display_name` | `Acme Traders` | the **label** — what a person reads; not unique, and does not need to be |

⭐ **`bridge_id` is a flat namespace with NO grammar** — no `@`, no `.`, no `~`. That is what makes it the right
thing to address across a boundary (§5). `user_id` is the space that carries meaning, and therefore the space
that can collide.

---

## 2 · The register

| kind | shape | separator | enforced |
|---|---|---|---|
| **bridge id** ✅ | `CB` + 8 of `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` | — | `lib/bridgeid.js` — CSPRNG; omits `I O 0 1` because it is read aloud |
| **entity** ✅ | `acmetraders` — 8–20 chars, lowercase, **no `@`, no `.`** | — | `handle.checkRoot()`; set once (`routes/entities.js`) |
| **network node** ✅ | `acmetraders.clothing` — exactly 2 levels | `.` | `handle.check()`, `MAX_DEPTH = 2`; depth lives in the ltree, not the name |
| **employee / co-assist** ✅ | `ravi@acmetraders` | `@` | **rendered, not stored** — see §3 |
| **minted party** ✅ | `~acmetraders.sup-0001`, `~acmetraders.cus-0001` | `~` | `handle.minted()` / `isMinted()`; `lib/local-identity.js` |
| **storefront shopper** ✅ | their real email, else `cust-<8hex>@shopper.cb` | — | `routes/catalogue.js` — `entity_kind = 'shopper'` |
| **storefront customer** 🟡 | `email@entityid.cr` / `phone@entityid.cr` | `.cr` | ⚠️ **not in the code** — see §6 |
| **foreign entity** 🟡 | `CBM5P72HB7@in.example` | `@domain` | wire format works (§5); the typed→bridge translation does not exist |

**Reserved labels** (`handle.RESERVED`): `api www app admin root cb chitbridge network system support help`, plus
`PLATFORM_ROOT_HANDLE` from the environment. ⚠️ Checked on the **root label only** — `acmetraders.support` is a
legal store name, a bare `support` is not.

**Two shapes a handle may never take**, both because a reader would be fooled even though the code would not:
`^cb[a-z0-9]{8}$` (looks like a bridge id) and `<kind>-<digits>` in the second label (looks like a minted party).

### The row-level types, which are not the same question
- `identity_type` — `entity` · `actor` · `local`
- `entity_kind` — `actor` · `customer` · `test` · `internal` · `shopper`

---

## 3 · ⚠️ The employee handle is RENDERED, not stored

The single most misread fact here, and the one that settles most arguments about collisions.

`routes/actors.js` inserts `actor_key` + `parent_entity_id` with `identity_type = 'actor'` and **writes no
`user_id` at all**. `ravi@acmetraders` is composed at display time from the actor key and the parent entity's
*current* handle — deliberately, because `user_id` is mutable and a copy in a JWT would print a name the owner
had already changed.

Consequences, and they are load-bearing:

1. **`identities.user_id` never contains an `@`.** Entities are forbidden it by `checkRoot`; actors have no
   `user_id`. So no stored row can ever be matched by an address of the form `something@somewhere`.
2. Uniqueness is `UNIQUE(actor_key, parent_entity_id)` — *this employee, at this business* — **not** on the
   rendered string.
3. ⭐ Therefore **"is this an employee handle?" is answerable by one query**, with no marker and no new data:
   *is there an actor with `actor_key = x` whose parent entity has `user_id = y`?*
4. ⚠️ `actor_key` is validated as 4–12 of `[a-z0-9]` — which **permits a bridge-id-shaped key** such as
   `cbm5p72hb7`. `handle.LOOKS_LIKE_BRIDGE` already exists and is applied to handles; it is **not** applied to
   `actor_key`. Applying it there would make the two spaces disjoint by construction. **Open.**

---

## 4 · Why `@` and `.` are banned in an entity's own id

Not style — the grammar of the whole space. One identifier space holds several kinds of thing and the
**separator** is what tells them apart without a lookup:

```
acmetraders                an ENTITY      registered, the root of everything below
ravi@acmetraders           an EMPLOYEE    @ binds a person to the business they work for
acmetraders.clothing       a NETWORK node . binds a store to the network it was born in
~acmetraders.sup-0001      a MINTED party ~ created BY a business, never registered
```

`~` is unforgeable **by construction**, not by a rule someone must remember: `check()` has always required every
label to begin with a letter or digit, so no registered handle can start with it. **Any new marker must earn its
place the same way** — a character that is already illegal, rather than one we promise to police.

⚠️ **A minted party is deliberately NOT a recipient.** `isMinted()` is asked in the recipient resolver, the
business search and supplier/customer add, so a chit can never be addressed to someone who cannot sign in to
open it. Anything new that reuses this shape must say which side of that line it is on.

---

## 5 · Crossing an installation boundary (CTP)

**The address is `bridge_id@domain`** — `CBM5P72HB7@in.example`.

`lib/ctpaddress.js` resolves **only** by `bridge_id` (`WHERE bridge_id = $1 AND identity_type = 'entity'`). It
never touches `user_id`. Because `bridge_id` has no grammar, there is nothing for it to collide with, and **no
marker is needed on the wire**.

⚠️ **The ambiguity that does exist is in the TYPED string.** `ravi@acmetraders` and `alpha-timers@in.example`
are the same shape to a parser, and both parse as CTP addresses today. Three things keep them apart, and they
should be applied in this order:

1. **Which field it was typed in.** A login box means employee; an add-supplier box means business.
2. **Resolve local first** — `bridge_id`, then `user_id`, then `email`. Only if nothing matches locally **and**
   the right-hand side is a **paired installation** (`ops.population.ctp_peers`) is it a foreign address.
   `gmail.com` can never be mistaken for one, because pairing is a deliberate recorded act.
3. **Then the employee check in §3.3**, as belt-and-braces.

### 🟡 What is NOT built
- **Typed handle → bridge id across a boundary.** `alpha-timers` is a name in *their* database; we cannot
  translate it. This needs a small `resolve` verb — *does this handle exist here, and what is its bridge id and
  display name* — asked **once, at add time**, after which the bridge id is stored and never asked again.
- **Reading a foreign catalogue.** CTP has exactly two verbs today: `GET /.well-known/ctp.json` and
  `POST /api/ctp/deliver` (one copy, one way). [CTP-DESIGN.md](CTP-DESIGN.md) §9.6 deliberately avoided a read
  path — *"CTP should push status changes as further envelopes rather than invent a read path."* Pull vs push is
  **an open decision for Athi**; the `resolve` verb above is needed either way.
- **A foreign supplier needs a local row.** `supplier_list.supplier_entity_id` is a local `uuid NOT NULL`, so
  the foreign business needs a row standing for it, carrying its bridge id and home installation. Same shape as
  a minted party, with the one difference that matters: **a foreign party IS sendable**, so `isMinted()` must
  not swallow it.

---

## 6 · The storefront customer id — BUILT, and I said twice that it was not

Athi, 2026-09-15: *"storefront customer is mail-id@entityid.cr or phonenumber@entityid.cr"* … *"that was the
discussion we had and you confirmed me that it has been done."*

**He was right and I was wrong, twice.** `.cr` has been built since b170. I missed it because the literal is
never written as a string in the files I grepped — it is composed inside one builder:

```js
// routes/catalogue.js
function crHandle(channel, raw, entity) {
  const local = channel === 'email' ? raw.replace('@', '=') : raw;
  const at = (entity && entity.user_id) || (entity && entity.bridge_id) || '';
  return `${local}@${at}.cr`;
}
```

    9876512345@alpha-timers.cr        a phone customer of Alpha Timers
    xyz=gmail.com@alpha-timers.cr     an email customer — the FULL address, "@" swapped to "="

⭐ **The full address, not the local part**, so `xyz@gmail.com` and `xyz@yahoo.com` at the same shop stay two
people. Collapsing them would have merged two customers into one identity — cross-customer order visibility and
a misrouted OTP.

⭐ **The shop is named by its handle, not its bridge id.** Athi, 2026-08-20: *"use user id not bridge id for
customer"* — `9876512345@CBZQK5DAH9.cr` is unreadable and means nothing to the person it names. Entities
registered before b170 have no `user_id` and fall back to the bridge id, so **both forms exist at once**. That
is safe because the handle is only ever COMPARED, never parsed — which is also why there is exactly one builder,
used at every call site, so a returning customer regenerates the same handle.

⚠️ **It is stored in `identities.email`, which is UNIQUE and is the OTP lookup key** — and it is not an email
address, so the column name misstates what it holds. That is the real gap against the specification below, and
it is tracked as **NS-5**.

### The specification, 2026-09-15

> *"the user-id table will have three different ids: a) entity-id, b) employee id, c) customer id with its own
> @ and .br or .cr differentiation. each id will have their own bridge id, which is going to the 8 char internal
> id, now 8char internal id @ domain name."*

| | form | in `user_id` today |
|---|---|---|
| entity | `acmetraders` | ✅ yes |
| employee | `username@entityid.br` | ❌ not stored at all — **NS-6** |
| customer | `contact@entityid.cr` | ❌ stored in `email` — **NS-5** |

Each already has **its own bridge id**, and the cross-boundary address is `bridge_id@domain` (§5) — those two
halves are already true.

---

## 7 · Adding a new kind of name

1. **Does it need a new marker at all?** If the question can be answered by a lookup the schema already
   supports (§3.3), it does not.
2. **Is the marker unforgeable by construction?** It must be a character `check()` already refuses, not one we
   promise to validate.
3. **Which side of the recipient line is it on?** Can it be sent a chit, or not — and which code enforces that.
4. **Is it stored or rendered?** Rendered costs nothing and cannot drift; stored needs a migration and a
   uniqueness surface.
5. **Write the row into §2 of this file in the same commit.** A grammar that lives only in comments is how this
   file came to be needed.
