# Is my data private? Can anyone else see it?

**Short answer: No one else can see your records. Your data is yours alone — unless *you* explicitly
share it with a connection.** Here's how that's guaranteed, in plain terms and then technically.

## In plain terms

- Every record you create — chits, orders, tasks, line items, history — is **stamped with your account
  and stored as your own copy.** When you open the app, the system only ever shows you rows that belong
  to *your* account.
- You **cannot** see another business's data, and they cannot see yours. Even when you exchange a chit
  with someone, each side keeps its **own separate copy** — your notes, status, and history stay private
  to you; deleting yours never touches theirs.
- The **only** way data is shared is when **you grant a permission** (for example, connecting with a
  supplier, or sharing within a network you both joined). Nothing is shared by default.

## Technically, for the security-minded

1. **Your identity is proven, not claimed.** Every request carries a signed token (JWT). The server
   verifies the signature and reads *who you are* from the token — it never trusts an account ID sent in
   the request. So you can't ask for "someone else's data" by changing a parameter; the system ignores
   any such attempt and only ever uses your verified identity.
2. **Data is owned at the row level.** Each account has its *own* copies of every record, and every
   database read is filtered to "where owner = you." This isn't a setting that can be forgotten — it's
   how the queries are written everywhere.
3. **Guessing IDs gets you nothing.** If you request a record you don't own — even by its exact ID — the
   system returns *"not found."* Membership in the record is checked first.
4. **No injection or back doors.** All database access uses parameterized queries (no way to smuggle in
   commands), every data endpoint requires authentication, and team members ("actors") are locked to
   their own organisation and lose access the moment they're removed.
5. **Encrypted in transit.** All traffic is over HTTPS.

## What we ask of you (your half of the lock)

The strongest part of the system is that your identity token is the *only* key to your data — so keep
your account secure: don't share your login, use the official app, and log out on shared devices. If you
ever suspect your account is compromised, contact support so the session can be invalidated.

> We treat any possibility of one account seeing another's data as the most serious class of issue and
> fix it immediately. Isolation isn't a feature we add on top — it's the foundation the product is built on.
