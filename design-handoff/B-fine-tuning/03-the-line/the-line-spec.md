# The line — levels, the simulator, and the grid

Covers the **The line** modal: the *TRY IT ON THIS COUNTER* pills and the nineteen-row LINE / WEAK / NONE grid.

Designs: `png/LineLevels.png` (the levels and the simulator), `png/LineGrid.png` (the grid with icons).
Source: `source/Line*.dc.html` — reference only, never ship.

---

## 1. What is wrong today

1. **Five pills at the top, three columns below, and nothing joins them.** Is *Slow · 3G* the LINE column or the WEAK one? The screen never says, so pressing a pill appears to do nothing.
2. **Nothing says what this counter's line is right now**, or what it usually is. Without a reference point, "very slow" is slower than *what?*
3. **Nothing says how far a level is from real.** A simulated level is only meaningful as a multiple of the truth.
4. **Nineteen identical text rows.** No picture to catch the eye, no bands to rest between, so every row is read one at a time.
5. **NONE is a filled black box** — the heaviest mark on the screen belongs to the rarest state.
6. **The legend is at the bottom**, after the thing it explains.
7. **The hourglass reads as trouble.** Waiting is the normal, designed behaviour, not a fault.
8. **A real throttle can be left on**, and a throttled counter looks exactly like a broken shop.

---

## 2. Right now, and usual here

A strip across the top of the modal, before any pill:

```
▂▄▆█  Good line      3.8 Mbps · 190 ms · 0 of the last 20 sends failed
                     Measured from what this counter actually sent — not from the
                     browser saying it is online.

       USUAL HERE · TODAY   good 92% · weak 7% · no line 1% · worst spell 4 min at 11:20 am
       ▇▇▇▇▇▇▃▇▇▇▇▇▇▇▃▇▇▃▇▇▇▇▁▇
       7 am        11 am        3 pm        7 pm        11 pm
```

- **Right now** is computed from the last 20 real sends — latency, throughput and failure rate — never from `navigator.onLine`. A counter can be "online" and reach nothing.
- **Usual here** is one bar per half hour of today, coloured by the band the counter sat in. It answers "is this normal for us?", which is the question behind every support call.
- Tapping a bar shows that half hour: *11:00–11:30 · weak · 6 waiting at worst · cleared by 11:24*.
- Keep 7 days. The strip has a **Today / 7 days** toggle; 7 days shows one bar per hour, quieter.

---

## 3. The five levels

Each level is a card, not a pill, carrying four things: an **icon**, the **numbers** that define it, **what it feels like at the counter**, and **which column of the grid it turns on**.

| Icon | Level | Numbers | What it feels like | Turns on | Distance from real |
|---|---|---|---|---|---|
| ▂▄▆█ green | **Full speed** | 2 Mbps or more · under 300 ms | A bill reaches the shop before you have looked up from the drawer. | LINE | *you are here* |
| ▂▄▆ green | **Slow · 3G** | about 1 Mbps · 300–800 ms | Three to five seconds a bill. Nobody at the counter notices. | LINE | 4× slower |
| ▂▄ amber | **Very slow · 2G** | about 0.25 Mbps · over 800 ms | Twenty seconds and more. The waiting count rises, then falls. Selling never stops. | WEAK | 15× slower |
| ▂▄▆ amber | **Flaky · 1 in 3 fail** | speed is fine · 1 send in 3 does not land | Most go first time, the rest go on the second try. Nothing is ever lost. | WEAK | 33% fail |
| ▂▄▆█ grey, struck | **No network** | nothing gets through at all | Everything that needs the shop waits here and goes by itself when the line is back. | NONE | total |

**The multiplier is computed, not typed.** `simulated ÷ measured`, rounded, recomputed when the real reading changes. If the real line is already slow, *Slow · 3G* may read *about the same as now* — which is honest and useful.

**Full speed is not a level you set.** It is the absence of pretending, so choosing it is the same as pressing Stop.

### The icon family

One set of four bars, used on the level card, in the pill, in the till header and as the grid's column head — learned once, read everywhere.

| Mark | Means |
|---|---|
| Four bars, green | good line — everything goes straight through |
| Three bars, green | slower, still good enough to be invisible |
| Two bars, amber | weak — it works, and it waits |
| Three bars, amber | flaky — the height is fine, the landing is not |
| Bars struck through, grey | no line — **grey, never red**. A shop with no line is not a broken shop |

**Colour never carries it alone.** The number of lit bars, the slash and the count all say the same thing for anyone who cannot tell green from amber.

---

## 4. While it is pretending

*"the counter really behaves this way when it is set — nothing in the grid is pretend"* is the most important sentence on the screen and it is the smallest. Make it structural.

### The standing banner — in this modal **and in the till header**

```
▂▄  Pretending: Very slow · 2G                    8:42 left    [ Stop now ]
    15× slower than this counter really is
```

### Rules

1. **It really throttles this counter.** Anything sent while it is on is really delayed — which is exactly why it must stop itself.
2. **It always counts down and always ends.** Fifteen minutes, then back to real, with a line in the day log: *Very slow · 2G was simulated on Counter 1 by Bala, 3:12–3:27 pm.*
3. **It says how far from real it is**, as a multiple, so the level means something.
4. **The banner shows in the till header too.** Closing the modal does not stop it; only Stop does.
5. **It will not start while a bill is open or a customer is waiting.** It offers to wait: *Start when this bill is done.*
6. **Full speed = Stop.** There is one way back and it is always visible.
7. On a shared counter it names who started it, so the next person knows who to ask.

---

## 5. The grid

### Order of the screen

**Legend → column heads → bands → rows.** The legend is read first, so it goes first.

### Legend

| Mark | Words |
|---|---|
| ✓ green | works |
| ◔ amber | works, then waits here |
| – grey | needs the line |

No hourglass and no ✕. Waiting is the designed behaviour and a cross reads as a fault.

### Column heads

Three heads carrying the bar icon and a plain name: **Good line · Weak line · No line.** The head matching the current (or simulated) level is ringed and carries a **showing** tag; the other two go quiet. *That ring is the whole answer to "which pill does what".*

### Bands

Nineteen rows become three bands, each with a count and a line of context:

| Band | Count | Context line |
|---|---|---|
| **CARRIES ON, WHATEVER HAPPENS** | 7 | the shop can trade all day on these alone |
| **WORKS, AND WAITS** | 6 | 8 waiting here · oldest 23 min · they go by themselves |
| **NEEDS THE LINE — DO THIS INSTEAD** | 6 | every one of these carries its own way round it |

Counts live on the band, never repeated on the rows.

### Rows and their icons

Each row carries the icon that already stands for that thing elsewhere in the till. One 24 px grid, 1.8 stroke, round caps, one weight, `currentColor`.

| Row | Icon |
|---|---|
| Selling and billing | receipt |
| Printing | printer |
| Taking money | banknote |
| Saving a bill here | save / disk |
| Bill numbers | hash |
| Quick keys and sold-out marks | 2×2 grid |
| Parking and taking a bill back up | bookmark with a pause |
| Bills reaching the shop | cloud with an up arrow |
| Sold-out marks and price changes | tag |
| New customers added here | person with + |
| New offers from the shop | megaphone |
| Prices and products | list |
| Today's list | calendar |
| Closing the counter | lock |
| Checking a bill reached the shop | cloud with a tick |
| Sending the day's report | paper plane |
| Looking a customer up | magnifier |
| Speaking instead of typing | microphone |
| Changes made by other counters | two arrows in a circle |

**The icon is never alone** — it sits beside the words, so it costs nothing when it is imperfect, and it is learned by the third visit.

### The third band earns its name

Every row in *NEEDS THE LINE* carries the way round it, inline: *Closing the counter → close it when the line is back, or close on paper and enter it later.* A wall of crosses becomes a plan.

---

## 6. One registry

`{ id, label, icon, bucket: normal | waits | needs_line, workaround?, count? }` — one row per capability, and **the same registry drives this grid, the offline panel and the header pill**. Three hand-written lists will disagree within a month. The grid is the registry filtered by the selected column; nothing in it is typed twice.

Line state is computed from the last 20 attempts:

| State | Threshold | Pill |
|---|---|---|
| Good | fails < 1 in 20 | `all sent` |
| Weak / patchy | 1 in 20 – 1 in 2, or latency over 800 ms | `slow line · 3 waiting` |
| No line | nothing gets through | `no line · 8 waiting` |
| Pretending | any simulation on | `pretending · 2G` |

---

## 7. Phone

- The **Right now** strip stacks: reading, then the day bars full width.
- Level cards become a vertical list, one per row, each still carrying icon, numbers, feel and the column it turns on.
- The grid drops to **one column — the selected level only** — with a level switcher above it, because three columns cannot be read at 390 px. The bands and counts stay.
- The pretending banner pins to the top, above everything, with the countdown and Stop.

---

## 8. Data

```json
{
  "line": {
    "state": "good | weak | none",
    "downKbps": 3800, "latencyMs": 190,
    "failedOfLast": { "failed": 0, "of": 20 },
    "measuredAt": "2026-09-21T08:12:00+05:30"
  },
  "usual": {
    "window": "today",
    "buckets": [{ "at": "07:00", "state": "good" }],
    "share": { "good": 0.92, "weak": 0.07, "none": 0.01 },
    "worstSpell": { "state": "none", "minutes": 4, "at": "11:20" }
  },
  "simulation": {
    "active": true, "level": "2g",
    "startedAt": "...", "endsAt": "...", "startedBy": "u_12",
    "factor": 15
  },
  "capabilities": [
    { "id": "bills_to_shop", "label": "Bills reaching the shop", "icon": "cloud-up",
      "bucket": "waits", "count": 8, "oldestMinutes": 23 }
  ]
}
```

- `simulation.factor` is derived from the measured reading, never stored as a constant.
- `simulation.endsAt` is authoritative: on reload, a lapsed simulation is off.
- `line.state` never comes from `navigator.onLine`.

---

## 9. Acceptance checks

1. The modal shows the counter's real level, its numbers, and today's usual band before any pill.
2. Choosing a level rings that column in the grid and quiets the other two.
3. Every level card shows its numbers, its feel, its column and its distance from real.
4. The multiplier is computed from the live reading and changes when the reading changes.
5. A simulation shows a countdown in this modal **and** in the till header, stops itself, and writes a line in the day log.
6. Closing the modal does not stop a simulation; Stop and Full speed both do.
7. A simulation cannot start with a bill open; it offers to start afterwards.
8. Every grid row carries an icon, and every icon is the one used for the same thing elsewhere.
9. The legend sits above the grid; no hourglass, no ✕, no black, no red anywhere on the screen.
10. Band counts come from the same registry as the rows and the header pill; the three can never disagree.
11. Every row in the third band names its way round.
12. At 390 px the grid shows one column with a level switcher, and nothing is dropped.
