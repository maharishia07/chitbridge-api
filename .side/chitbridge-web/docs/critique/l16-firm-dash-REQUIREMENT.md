# REQUIREMENT l16/firm-dash — the first screen of an accounting firm (8 lines)
1. JOB: a firm (auditor or adviser) with about 150 clients opens Home and sees, without opening any shop, which clients need action and which are doing well or badly.
2. WHO: a login holding live received books grants (Coastal, Bayside shape). Entity holds grants and has no trade = firm; the data decides, no trade switch.
3. PRACTICE BAND (counts across ALL clients, each a filter): unreconciled bank (n, amount unexplained) · open queries (waiting on client / on us) · BAS due 30 days / overdue · months not locked · entries checked n of m · grants ending 30 days · Doing well / Watch / Needs help.
4. HEALTH per client from that client's own books (read, never recomputed): sales last month vs 3-month average (arrow) · gross margin · cash vs next 30 days of bills · receivables over 60 days (amount, share) · profit this quarter. One status Doing well / Watch / Needs help; rule printed on screen; thresholds in ONE setting; a Needs help row says why in few words.
5. LIST (one list control): client, role, status, bank, queries, BAS due, checked n/m, health figures, last look; sort+filter every column+search; default Needs help first then most action; Open books per row; 390px cards, nothing dropped (R74).
6. API: ONE read GET /api/books-grants/practice, live grants only, one trip for 150 clients (target under 1.5 s on SIT), each client's look logged as today; contract + api-register entries.
7. Shop cards (Till, Marketing, Online shop) hidden on a firm Home by data; the firm's own settings stay reachable.
8. OUT: no deploy, no production, no edits to the books' engines, no per-client page changes; a firm-editable threshold screen is a follow-up.
Baseline (cited, not copied): Xero Practice Manager / Xero HQ, MYOB Practice, Karbon work-and-client dashboards: counts of work by status + client list; ours adds business health from the clients' own books.
