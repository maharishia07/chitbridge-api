# The CAREFUL footer — give this file to the CLI first

Just the footer. Replaces the pink strip pinned to the bottom of the counter hub —
*CAREFUL · These stop billing for a moment* with **Sign out · Clear and reload · Close this counter**.

Unzip into the repo as `design-handoff/footer/`.

> **Read every file in this folder before you start.** All the `.md` files and all the `.png` images —
> the order below is the order to read them in, not a shortlist. Do not begin any code until you have
> seen all of them.

## Read in this order

| Order | File | Why |
|---|---|---|
| 1 | `footer-spec.md` | The whole thing: why the strip fails, where each of the three actions belongs, the confirm sheet that replaces the standing warning, the fallback footer, data shape, acceptance checks, and the order to build in. |
| 2 | `png/HubFooter.png` | The board — the strip as it is, the three new homes, and the confirm sheet drawn out. |
| 3 | `source/HubFooter.dc.html` | Exact colours, sizes, spacing and copy. **Reference only — never ship this file.** It uses a design tool's template format (`x-dc`, `sc-for`, `{{holes}}`), not app code. |

The image is the visual truth; the spec is the rules. Where they disagree, ask.

## The change in one line

**A warning that is always on the screen is not read. Move each action to where it belongs, and put the caution in a confirm sheet at the moment the button is pressed — with the live numbers that make the promise checkable.**

- **Sign out** → the person block in the header, beside Hand over.
- **Close this counter** → the day card, as **Close the day**.
- **Clear and reload** → Counter health ▸ technical, as **Repair this counter**.
- The strip is deleted. The word CAREFUL leaves the product.

## Build it in three steps (spec §8)

1. Add the three confirm sheets and wire them to the **existing** footer buttons — nothing moves yet, and this alone makes the product safer.
2. Move each action to its new home.
3. Delete the footer.

Each step ships on its own.

## Rules this change inherits from the rest of the package

1. **Red is only for a stopped sale or work at risk.** Advisory is amber, structural is grey.
2. A warning belongs at the moment of the act, never standing on the screen beforehand.
3. Say the consequence, not the adjective. Name the button with its verb, never OK.
4. Show the numbers a promise depends on — *96 of 96 sent · none waiting · none in hand*.
5. The safe way out is first, plain and unfilled.
6. **Mobile-first.** On a phone the sheet is a bottom sheet, full width, buttons stacked with the safe one on top.
7. Targets ≥ 44 px (48 on phones), contrast ≥ 4.5:1.

## Two of the new homes live in other packages

This spec is buildable on its own — but the header's person block and the day card are designed in the **counter hub** package (`counter-hub.zip`), and the technical view is in **counter health** (`counter-health.zip`). If the CLI has not built those yet, tell it to place the moved actions in the existing header and existing day card rather than waiting.

## Paste-ready start

```
Read EVERY file in design-handoff/footer/ first — every .md and every .png — before writing any code.
Read design-handoff/footer/README-FOOTER.md, then footer-spec.md and png/HubFooter.png.
Find the CAREFUL footer component and show me: the file, where each of the three actions is
handled, and whether any of them already confirms before acting.
Then do step 1 only — add the three confirm sheets from spec §3, wired to the existing footer
buttons, with the readiness numbers read when the sheet opens. Do not move anything yet.
Show me the close sheet with everything clear, and with 3 bills still waiting.
After I approve, do steps 2 and 3: move each action to its home and delete the strip.
```
