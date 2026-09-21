<!-- installed by test-guard/copy-guard -->

# Design rules — read on every UI task

Short on purpose. Read it every time. Breaking it fails a build, not a review.

## Text budget — hard limits

| Element | Max |
|---|---|
| Screen title | **5 words** |
| Card / section title | **6 words** |
| Explanation under a title | **12 words** |
| Button label | **3 words** |
| Tag, chip, pill | **3 words** |
| Empty state | **10 words** |
| Confirm sheet body | **20 words** |
| Any single visible string | **20 words** |
| A whole screen, first view | **50 words** |

`npm run lint:copy` enforces these. Budgets live in `copy-guard.config.json` — loosen a number
there if it is wrong for this codebase; never disable the check.

## Seven rules

1. **Never render a server message.** Every server condition maps to a verdict with a written line, a button and a support code. `error.message` never reaches a user.
2. **A title is a noun phrase, not a sentence.** No full stops in titles.
3. **The same string never appears twice on one screen.** If title and body say the same thing, delete the title.
4. **Truncation is a bug.** If a string needs `…`, shorten the string — do not widen the box.
5. **Every warning carries the button that fixes it.** A warning with no action does not ship.
6. **Everything that is fine collapses into one line.** Only a failing thing earns a row.
7. **Numbers a shopkeeper cares about, large:** how many, how much, how old. Never "rows tried".

## Colour

Red only when a sale has stopped or work is at risk. Advisory amber. Structural grey.
No black fills, no capitals.

## Before showing a screen

Run `npm run lint:copy`, then answer the eight questions in `DESIGN-CHECK.md` in the reply.

---

# Testing policy

A hook enforces this. Arguing with it wastes a turn — scope the command instead.

## Default after any edit

```
npm run test:related        only the tests touching the files you changed
npm test -- path/to.test.ts one file
npm run typecheck           when the change is types only
```

## The full suite

Runs in **CI on push**, and once **before a release**. Not after an edit, not to confirm
a change you already have evidence for, not twice with nothing changed in between.

If you genuinely need it: `ALLOW_FULL_TESTS=1 npm test`. Say in your reply why it was needed.

## Rules

1. **Scope to the change.** If you edited one component, run that component's tests.
2. **One run per change.** The same command with nothing changed in between is blocked for 20 minutes.
3. **A failing test you already saw does not need re-running** to be believed. Fix it, then run it.
4. **Do not re-run to "make sure".** If you need reassurance, read the diff.
5. **Never widen the run to find a flake.** Name the flaky test and move on.
6. When you finish a task, say which tests you ran and why those. One line.
