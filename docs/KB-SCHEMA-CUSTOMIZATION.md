# KB — How a rigid, trustworthy core still bends to your business (schema customization)

*Customer-facing KB entry. Companion to `TRUST.md` (why it's reliable) and `CONSISTENCY-MODEL.md` (the engineering
view of rigid vs flexible). Keep claims TRUE; mark anything not yet wired as "designed." Use cases below are
placeholders to fill in as we go.*

## The question
"If the system is so rigid — fixed receipt, fixed privacy, fixed audit — how can it possibly fit *my* business?
Every business is different. Won't I have to bend my process to your software?"

## The legible answer (what we can say today)
**The rigid part is the *container*, not the *contents*.** Two layers:

1. **The container is fixed — on purpose.** Every deal becomes a sealed, time-stamped record (a "chit"), private
   to you, with both sides holding a copy and a full audit trail. That never changes — it's what makes the record
   trustworthy. You don't *want* this part to be customizable (you wouldn't want a bank that lets each branch
   redefine what "a receipt" means).

2. **What goes *inside* the container is your *schema* — and that's fully yours.** A schema is your business's
   definition of a deal: the fields it carries, which are required, what's a number vs text, minimums, and so on.
   The same trustworthy chit engine carries a **timber order**, a **pharma supply**, or a **service request** —
   the difference is the *schema*, not a different product. Change the schema and the product behaves differently:
   the compose form shows your fields, validation enforces your rules, your catalogue is structured your way.

So: **rigid where it protects you (record, privacy, audit), shaped by you where it runs your business (the schema).**
You configure, you don't fork — and you don't write code.

### What's real today (grounded)
- A **schema engine** exists: each business has schema(s) with typed fields (`entity_schemas` / `schema_fields`).
- **Validation is schema-driven** — catalogue items are checked against your schema (required fields, number type,
  minimums) server-side.
- A chit carries **schema-defined values** (`schema_values` / `business_json`) plus the schema version it was sealed under.

### What's designed, wiring in progress (honest)
- **Compose-from-your-live-schema:** the compose form is meant to render *your* fields; today it can fall back to a
  default template if your schema isn't loaded yet (a known wiring gap — see the Compose audit). [designed]
- **The blueprint → schema → settings cascade:** onboarding picks a vertical "blueprint" that seeds a default
  schema; the full cascade (blueprint → fields → behaviour) is a later juncture. [designed]

## Use cases — [TO BE ADDED]
*(Fill these in with Athi; each shows the SAME engine + a DIFFERENT schema → different behaviour.)*
- **[TO BE ADDED: Timber / building materials]** — fields, required rules, how a counter-sale vs a PO differ by schema.
- **[TO BE ADDED: Pharma / regulated supply]** — batch/expiry fields, stricter required + audit emphasis.
- **[TO BE ADDED: Services / site work]** — no line-item price, milestone/SLA fields, dispute emphasis.
- **[TO BE ADDED: Aggregator / network host]** — how a parent's schema relates to children (ties to network cascade).
- **[TO BE ADDED]** — a side-by-side "same chit, two schemas" screenshot/example.

## Further articulation — [TO BE ADDED]
- **[TO BE ADDED]** — how schema choices flow into settings/behaviour (the cascade), once wired.
- **[TO BE ADDED]** — what's schema-customizable vs what stays rigid, as a simple table for a prospect.
- **[TO BE ADDED]** — "do I need a developer?" → no; schema is configuration. (Confirm the self-serve schema editor exists/planned.)

> Maintainers: this is the spine of the product pitch (rigid core + schema customization). Keep the "real today"
> vs "designed" split honest; promote items from "designed" to "real" as they ship; fill the use cases with Athi.
