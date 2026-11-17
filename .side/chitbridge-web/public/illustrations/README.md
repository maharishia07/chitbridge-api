# Illustration pack (concept)

A set of standalone SVG illustrations for Chit & Bridge — **one file per subject**,
grouped into **chapters**. Each subject maps to a single screen or domain event.
Changing a screen's art means editing **only that one `.svg`**; nothing else in the
app moves. That's the whole point of doing it subject-by-subject.

## Review
Open `/illustrations/` in the running web app (live: `https://chitbridge-web.vercel.app/illustrations/`).
It serves `index.html`, a gallery driven by `manifest.json` with a sticky **chapter nav**
so you can jump to any chapter. Concept only — **nothing is wired into the app yet.**

## Chapters & subjects
**1 · Lifecycle of a chit** — how a chit is born, shared, advanced and retired
- `compose-author.svg` — Compose / author · Compose empty / help
- `draft.svg` — Draft · Drafts folder (empty)
- `chit-bridged.svg` — Chit bridged · onboarding / send-success (two co-held copies)
- `status-update.svg` — Status update · Status tab header / state-change confirmation
- `archive-sunset.svg` — Archive (sunset) · Archive folder

**2 · Working together** — messages, forwarding, co-signed evidence
- `message-update.svg` — Message update · Messages tab (internal vs external)
- `forward.svg` — Forward · forward confirmation (new thread)
- `attachment.svg` — Attachment · attachments section / empty

**3 · Attention & exceptions** — urgency and disputes
- `priority-sla.svg` — Priority / SLA · priority badge / delivery (SLA-ISL)
- `dispute-flag.svg` — Dispute flag · dispute raised / disputes queue

**4 · Empty & feedback states** — calm placeholders
- `empty-inbox.svg` — Empty list · any list with no rows
- `no-results.svg` — No results · search / advanced-filter empty

## Shared visual language
- viewBox `0 0 480 320`, flat, line+fill.
- Recurring motifs: the **chit card**, the **bridge**, the **edge** (dashed).
- Palette is in `manifest.json` (`style.palette`) — blue `#3F66A6`, gold `#C08A2E`,
  green `#3E8A5F`, red `#C2473F`, panel `#F7F4EE`.

## Adding / changing a subject
1. Add or edit one `*.svg` (keep the viewBox and palette).
2. Add/adjust its row under a chapter in `manifest.json` (`file`, `title`, `where`).
The gallery picks it up automatically — no other file changes.
