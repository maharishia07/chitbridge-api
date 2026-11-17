# ICON-MAP — one picture, one meaning (till + online shop)

Athi, 2026-10-10: *"change icons as much as you can."* Rule (DECISIONS 2026-10-10 "Icons instead of words"): every control that can be a
picture IS a picture; never an abbreviation; ONE icon set, ONE meaning per icon; the word stays reachable (`aria-label` + `title`, a held press
on touch); an icon that counts carries its digit. Words stay only for money, names, and sentences saying what happened.
Helper: `icoBtn()` in till.html (markup contract `data-ic` + `aria-label` + `title`). Checked by `node e2e/icon-map-guard.cjs`.
The guard reads the table below: **an icon in two rows, or a meaning with two icons, fails it.**

| meaning | icon | where | word (aria-label / title) |
|---|---|---|---|
| Sell (mode) | 🛍️ | till mode pill, mode list, back to selling | Sell |
| Receive (mode) | 📥 | till mode list | Receive |
| Despatch (mode) | 📦 | till mode list | Despatch |
| Maintenance (mode) | 🛠️ | till mode list | Maintenance |
| Today's bills | 🧾 | till rail | Today's bills |
| Today's sales report | 📊 | till menu, Bills dialog | Day report |
| Notifications / what needs you | 🔔 | till rail | Check |
| Counter health | 🩺 | till menu, line grid | Counter health |
| Labs | 🧪 | till menu (Lab section) | Labs |
| Expense register | 💰 | till rail, menu section | Expense |
| Layout: Desktop | 💻 | till rail (layout switch) | Layout: Desktop |
| Layout: Tablet | ▭ | till rail (layout switch) | Layout: Tablet |
| Layout: Phone | 📱 | till rail (layout switch) | Layout: Phone |
| To do | ☑ | till menu | To do |
| Customer screen | 📺 | till menu | Customer screen |
| Read the shop again | ↻ | till menu, Start the day row | Read the shop again |
| Repair this counter | ↺ | till menu | Repair this counter |
| Line / capability | 📶 | till menu | Capability health |
| Product Lab | 📋 | till menu | Product Lab |
| Offer Lab | 🧮 | till menu | Offer Lab |
| Combo Lab | 🧩 | till menu | Combo Lab |
| Take a break | ☕ | till menu | Take a break |
| Lock the counter | 🔒 | till bar, phone menu chip | Lock |
| Who is at the counter | 👤 | Start the day row, who pill | Pick who |
| Close the counter | 🚪 | till menu | Close this counter |
| Settings | ⚙ | till rail | Settings |
| Install as an app | ⤓ | till rail | Install as an app |
| Menu | ☰ | till bar, rail | Menu |
| Switches | ⚡ | till bar, phone menu chip | Switches |
| Quick keys (count) | ⊞ | till quick bar | Quick keys |
| All products as tiles | ▦ | till quick bar | Show all as tiles |
| Capability grid view | ▤ | till line dialog | Grid |
| Arrange keys | ⇄ | till quick bar | Arrange |
| Pictures view | 🖼 | till keys, bill | Pictures |
| Names view | ≡ | till keys, bill | Names |
| Park the bill | ⏸ | till bill foot | Park the bill |
| Clear the bill | 🗑 | till bill, receive, despatch foot | Clear the bill |
| Send to the kitchen (count) | the word "Kitchen" (🍳 renders as a purple circle that reads like 🔍 at this size) | till order bar | Kitchen |
| Basket / online orders (count) | 🛒 | till bar + phone (online orders), shop dock (basket) | Online orders / Your basket |
| Keyboard | ⌨ | till search | Show the on-screen keyboard |
| Speak | 🎤 | till to-do, customer | Speak |
| Dismiss / close / remove | ✕ | every dialog, search clear, to-do row | Close |
| Back | ← | till pay, shop checkout | Back |
| Shop categories (count) | 🗂 | online shop list | Categories |
| Pickup | 🏪 | online shop checkout | Pickup |
| Delivery | 🛵 | online shop checkout | Delivery |
| Add a person | ＋ | Employees list, till "Who is at the counter?" | Add a person |
| What they can do | 🔑 | Employees person sheet | What they can do |
| Reset code | 🔢 | Employees person sheet | Reset code |
| Switch a person on or off | ⏻ | Employees person sheet | Switch on / Switch off |
| Who stands in | 🤝 | Employees person sheet | Who stands in |
| Call: no answer | 📵 | CRM Calls row (outcome buttons, icon + word) | No answer |
| Call: call back | ↩ | CRM Calls row (outcome buttons, icon + word) | Call back |
| Call: interested | 👍 | CRM Calls row (outcome buttons, icon + word) | Interested |
| Call: demo booked | 📅 | CRM Calls row (outcome buttons, icon + word) | Demo booked |
| Call: not now | ⏳ | CRM Calls row (outcome buttons, icon + word) | Not now |
| Call: wrong number | 🚫 | CRM Calls row (outcome buttons, icon + word) | Wrong number |

## Conflicts found, and how the map resolves them

| conflict | was | now |
|---|---|---|
| one icon, two meanings | 🧾 = Sell mode AND Today's bills | Sell becomes 🛍️ (a bag, the act of selling); 🧾 stays Bills |
| one icon, two meanings | 🩺 = Check AND Counter health | Check becomes 🔔 (the notification door, TILL-179); 🩺 stays Counter health |
| one icon, two meanings | 🔒 = Lock AND Close this counter | Close becomes 🚪; 🔒 stays Lock |
| one icon, two meanings | ⊞ = Quick keys AND capability grid view | grid view becomes ▤ |
| one icon, two meanings | ➕ = Kitchen AND "add one" (+) | Kitchen becomes 🍳; + stays add |
| one meaning, two icons | Clear = ✕ on search, the word on the bill | search ✕ is "dismiss" (✕); bill Clear becomes 🗑 |
| near-twins (kept, flagged) | ↻ Read again vs ↺ Repair | different on purpose; the Menu keeps the word in the row |
| Basket vs Online orders | 🛒 on the till = Online orders; the shop basket chip (cart.js) is also 🛒 + count | one meaning, one icon: a customer's basket. cart.js already draws it, left as is |

## Left as words, deliberately
- **Save & print / Confirm receipt / Pack & despatch** — the actions that take money or move stock.
- Amounts, names, sentences ("3 need you", "no network · all sent"), the order-kind buttons (Dine in / Takeaway / Delivery — no one picture is unambiguous), "+ part", the Bills tabs (Today / Earlier).
- CB Accounts and CRM screens: a later round.
