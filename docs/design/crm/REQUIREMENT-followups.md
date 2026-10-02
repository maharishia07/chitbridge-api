# Requirement — follow-ups

**Status:** brief for design. **Not built.** Pass mark: `docs/design/SYSTEM.md`. Data: DATA.md §5 `party_followup`.
Flow: FLOWS.md F6.

## 1 · Purpose
The shop's "call back / collect / remind" list across all parties: what is due today, what is late, who should do it —
each one a tap from the party.

## 2 · Who
Owner sees all; a co-assist sees all, and **Mine** by default. Anyone (editor) can add, finish, snooze; reassigning is
the owner's or the assignee's.

## 3 · Where it sits
CB CRM sidebar **Follow-ups** (with the overdue count as its one live fact, SYSTEM rule 11). Also: the party record's
Next block, the Log sheet's "Add a follow-up", Dues "Remind".

## 4 · What it shows
The Task table (`listHeader` · `rowGrid` · list-ctl). Columns: **Due** (date; amber when late) · **What** (one line) ·
**Party** (name + party_no) · Who (assignee) · Source (Manual · Dues · From a call) · Created. Grouped by
Late · Today · This week · Later using Task's group-sum (`gsToggle`, cap-folders.js:333), late open by default.
Controls: search · filter (Mine / Everyone · Source · Done) · sort (Due · Party · Created) · count · lazy rows.

## 5 · What it does
| Action | Route |
|---|---|
| Add (party picker + what + when + who) | `POST /api/crm/followups` (new) `{party_id, what, due_at, assignee_user_id?, source}` |
| Done | `PATCH /api/crm/followups/:id {done:true}` → timeline entry "Follow-up done" |
| Snooze (Tomorrow · Next week · date) | `PATCH … {due_at}` |
| Reassign | `PATCH … {assignee_user_id}` |
| Open party | the record |
| Act (Call · Message · Mail) | from the row's peek / the record |
Due-today notice: a bell `cb {kind:'followup'}` from the nightly sweep (phase 2), to the assignee.

## 6 · States
- **Empty:** "No follow-ups. Add one from a party, or when you log a call." (no button needed — the add is on the toolbar).
- **All done today:** the Late/Today groups collapse into one line "Nothing due today" (SYSTEM rule 1).
- **Loading / error:** existing loading row; "Couldn't load follow-ups. Try again." + **Try again**.
- **Party merged or removed:** the follow-up moves with the merge; a removed party's follow-ups show the name greyed
  with "No longer your party" + **Delete**.
- **One-sided / not on ChitBridge party:** Act offers Call / Mail only.
- **Assignee left the shop:** "Unassigned" (amber) + **Assign**.

## 7 · Phone
One card per follow-up: due + what on one line, party under it, Done as the visible action; groups as headers.
`scrollWidth === 390`.

## 8 · Words on screen
"Follow-ups" · "Late" · "Today" · "This week" · "Later" · "Mine" · "Everyone" · "Done" · "Snooze" · "Tomorrow" ·
"Next week" · "Nothing due today".

## 9 · Data it reads
`GET /api/crm/followups?scope=mine|all&done=0|1` (new) → `{ followups:[{ followup_id, party_id, party_no,
party_name, what, due_at, assignee_user_id, assignee_name, source, done_at, created_at }] }` — whole list (a shop's
open follow-ups are few), so list-ctl in memory is right.

## 10 · Must NOT
- Be a second task system: a follow-up is a reminder about a party, not a chit; it is never sent to the party.
- Draw its own grouped list — Task's group sum only.
- Decide "late" with the browser clock alone near midnight: the server returns `late:true` against the shop's time zone.

## For the designer
**Standard:** SYSTEM.md; the Task table and its group sum. **Design:** the grouping headers with counts; the row's
due mark (late / today / later); the Add sheet (party picker, presets writing into the date field); the Done/Snooze
affordance on a phone card.
