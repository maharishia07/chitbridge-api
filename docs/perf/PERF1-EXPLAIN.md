# PERF1 · EXPLAIN (ANALYZE) — the top five reads, before / after (local Postgres 16, the 100k shop of docs/SIM-LOAD.md "Scale")

Run by a throwaway script over `lib/books-store.js` at main (3efa3539) and at PERF1, both against the same database with b406 applied — so
**1 · BEFORE** below already has the reversal index; the real before (no b406) is the first plan, from auto_explain during the before run:

### 0 · TB / P&L / BS month lines (ledgerLines), main WITHOUT b406 — 1,604 ms: a Seq Scan of journal_entry per entry for "reversed by" (1,289 loops) + 333 ms of JIT
```
Nested Loop Left Join  (cost=6382.42..1461544.75 rows=4686 width=240) (actual time=186.003..1596.034 rows=5156 loops=1)
  ->  Memoize  (cost=1103.80..1103.82 rows=1 width=52) (actual time=0.273..0.273 rows=0 loops=5156)
        ->  Subquery Scan on rv  (cost=1103.79..1103.81 rows=1 width=52) (actual time=1.091..1.091 rows=0 loops=1289)
                          ->  Seq Scan on journal_entry x  (cost=0.00..1103.78 rows=1 width=60) (actual time=1.086..1.086 rows=0 loops=1289)
                                Rows Removed by Filter: 27703
  Timing: Generation 1.923 ms, Inlining 43.283 ms, Optimization 171.697 ms, Emission 115.738 ms, Total 332.641 ms
```

### 1 · Day book, one fortnight (entryLines) — BEFORE: a LATERAL per line
```
Nested Loop Left Join  (cost=6841.94..401262.92 rows=4186 width=653) (actual rows=5156 loops=1)
  ->  Nested Loop Left Join  (cost=6834.16..16304.34 rows=4186 width=1681) (actual rows=5156 loops=1)
        ->  Gather Merge  (cost=6833.86..7321.39 rows=4186 width=325) (actual rows=5156 loops=1)
              Workers Planned: 2
              Workers Launched: 2
              ->  Sort  (cost=5833.84..5838.20 rows=1744 width=325) (actual rows=1719 loops=3)
                    Sort Key: h.posting_date, h.entry_no, l.line_no
                    Sort Method: quicksort  Memory: 251kB
                    Worker 0:  Sort Method: quicksort  Memory: 398kB
                    Worker 1:  Sort Method: quicksort  Memory: 506kB
                    ->  Nested Loop Left Join  (cost=1481.29..5739.94 rows=1744 width=325) (actual rows=1719 loops=3)
                          ->  Hash Join  (cost=1481.00..5693.94 rows=1744 width=321) (actual rows=1719 loops=3)
                                Hash Cond: (l.account_id = a.account_id)
                                ->  Parallel Hash Join  (cost=1459.10..5667.42 rows=1744 width=286) (actual rows=1719 loops=3)
  …
Planning Time: 1.328 ms · Execution Time: 79.456 ms
```

### 1 · Day book, one fortnight (entryLines) — AFTER: reversals joined once (b406 journal_entry_reverses_idx)
```
Nested Loop Left Join  (cost=6499.89..244642.27 rows=2609 width=653) (actual rows=5156 loops=1)
  ->  Gather Merge  (cost=6499.60..6803.46 rows=2609 width=359) (actual rows=5156 loops=1)
        Workers Planned: 2
        Workers Launched: 2
        ->  Sort  (cost=5499.57..5502.29 rows=1087 width=359) (actual rows=1719 loops=3)
              Sort Key: h.posting_date, h.entry_no, l.line_no
              Sort Method: quicksort  Memory: 750kB
              Worker 0:  Sort Method: quicksort  Memory: 180kB
              Worker 1:  Sort Method: quicksort  Memory: 177kB
              ->  Nested Loop Left Join  (cost=1200.86..5444.75 rows=1087 width=359) (actual rows=1719 loops=3)
                    ->  Hash Left Join  (cost=1200.58..5414.62 rows=1087 width=355) (actual rows=1719 loops=3)
                          Hash Cond: (h.entry_id = rv.reverses_entry_id)
                          ->  Hash Join  (cost=1192.73..5403.92 rows=1087 width=321) (actual rows=1719 loops=3)
                                Hash Cond: (l.account_id = a.account_id)
  …
Planning Time: 0.834 ms · Execution Time: 60.245 ms
```

### 2 · Cash ledger, FY page 1 of 100 (entryLines + keyset) — AFTER
```
Sort  (cost=2708.19..2708.22 rows=12 width=653) (actual rows=101 loops=1)
  Sort Key: h.posting_date, h.entry_no, l.line_no
  Sort Method: quicksort  Memory: 44kB
  ->  Nested Loop Left Join  (cost=721.79..2707.98 rows=12 width=653) (actual rows=101 loops=1)
        ->  Hash Left Join  (cost=721.50..1643.30 rows=12 width=1711) (actual rows=101 loops=1)
              Hash Cond: (h.entry_id = rv.reverses_entry_id)
              ->  Nested Loop Left Join  (cost=713.65..1635.42 rows=12 width=1677) (actual rows=101 loops=1)
                    ->  Nested Loop  (cost=713.37..1535.52 rows=12 width=321) (actual rows=101 loops=1)
                          ->  Index Scan using ledger_account_pkey on ledger_account a  (cost=0.27..8.29 rows=1 width=51) (actual rows=1 loops=1)
                                Index Cond: (account_id = 'fc743c70-a640-40aa-8b2e-815d7f88e13d'::uuid)
                          ->  Nested Loop  (cost=713.09..1527.11 rows=12 width=286) (actual rows=101 loops=1)
                                ->  Nested Loop  (cost=712.67..1465.27 rows=53 width=241) (actual rows=101 loops=1)
                                      ->  HashAggregate  (cost=712.38..713.39 rows=101 width=16) (actual rows=101 loops=1)
                                            Group Key: p.entry_id
  …
Planning Time: 1.286 ms · Execution Time: 1.631 ms
```

### 3 · Cash ledger, the SUM before the cursor + the range (pageSums) — AFTER
```
Aggregate  (cost=6069.26..6069.28 rows=1 width=132) (actual rows=1 loops=1)
  ->  Sort  (cost=5946.43..5958.71 rows=4913 width=54) (actual rows=14442 loops=1)
        Sort Key: h.entry_id
        Sort Method: quicksort  Memory: 1513kB
        ->  Hash Join  (cost=2236.06..5645.20 rows=4913 width=54) (actual rows=14442 loops=1)
              Hash Cond: (l.entry_id = h.entry_id)
              ->  Bitmap Heap Scan on journal_line l  (cost=136.34..3520.89 rows=9370 width=32) (actual rows=15836 loops=1)
                    Recheck Cond: ((entity_id = 'b539764e-33fd-4743-9833-4c5e652edf3e'::uuid) AND (account_id = 'fc743c70-a640-40aa-8b2e-815d7f88e13d'::uuid))
                    Heap Blocks: exact=1977
                    ->  Bitmap Index Scan on journal_line_account_idx  (cost=0.00..133.99 rows=9370 width=0) (actual rows=15836 loops=1)
                          Index Cond: ((entity_id = 'b539764e-33fd-4743-9833-4c5e652edf3e'::uuid) AND (account_id = 'fc743c70-a640-40aa-8b2e-815d7f88e13d'::uuid))
              ->  Hash  (cost=1818.35..1818.35 rows=22510 width=38) (actual rows=24163 loops=1)
                    Buckets: 32768  Batches: 1  Memory Usage: 1908kB
                    ->  Seq Scan on journal_entry h  (cost=0.00..1818.35 rows=22510 width=38) (actual rows=24163 loops=1)
  …
Planning Time: 0.261 ms · Execution Time: 19.137 ms
```

### 4 · Party names — BEFORE: from identities (the platform), both lists outer-joined
```
Hash Left Join  (cost=61.20..179.96 rows=1512 width=558) (actual rows=501 loops=1)
  Hash Cond: (i.identity_id = s.supplier_entity_id)
  Filter: ((c.customer_identity_id IS NOT NULL) OR (s.supplier_entity_id IS NOT NULL))
  Rows Removed by Filter: 1011
  ->  Hash Left Join  (cost=53.03..145.13 rows=1512 width=2846) (actual rows=1512 loops=1)
        Hash Cond: (i.identity_id = c.customer_identity_id)
        ->  Seq Scan on identities i  (cost=0.00..88.12 rows=1512 width=2568) (actual rows=1512 loops=1)
        ->  Hash  (cost=46.78..46.78 rows=500 width=278) (actual rows=500 loops=1)
              Buckets: 1024  Batches: 1  Memory Usage: 36kB
              ->  Seq Scan on customer_list c  (cost=0.00..46.78 rows=500 width=278) (actual rows=500 loops=1)
                    Filter: (owner_entity_id = 'b539764e-33fd-4743-9833-4c5e652edf3e'::uuid)
                    Rows Removed by Filter: 1002
  ->  Hash  (cost=8.16..8.16 rows=1 width=302) (actual rows=1 loops=1)
        Buckets: 1024  Batches: 1  Memory Usage: 9kB
  …
Planning Time: 0.664 ms · Execution Time: 2.142 ms
```

### 4 · Party names — AFTER: from the shop's two lists, only the page's ids
```
Nested Loop Left Join  (cost=48.87..151.37 rows=17 width=558) (actual rows=49 loops=1)
  ->  Nested Loop Left Join  (cost=48.73..147.76 rows=17 width=2846) (actual rows=49 loops=1)
        ->  Hash Join  (cost=48.45..140.55 rows=17 width=2568) (actual rows=49 loops=1)
              Hash Cond: (i.identity_id = customer_list.customer_identity_id)
              ->  Seq Scan on identities i  (cost=0.00..88.12 rows=1512 width=2568) (actual rows=1512 loops=1)
              ->  Hash  (cost=48.23..48.23 rows=17 width=16) (actual rows=49 loops=1)
                    Buckets: 1024  Batches: 1  Memory Usage: 11kB
                    ->  HashAggregate  (cost=48.06..48.23 rows=17 width=16) (actual rows=49 loops=1)
                          Group Key: customer_list.customer_identity_id
                          Batches: 1  Memory Usage: 24kB
                          ->  Append  (cost=0.40..48.02 rows=17 width=16) (actual rows=49 loops=1)
                                ->  Index Only Scan using customer_list_owner_entity_id_customer_identity_id_key on customer_list  (cost=0.40..39.65 rows=16 width=16) (actual rows=49 loops=1)
                                      Index Cond: (owner_entity_id = 'b539764e-33fd-4743-9833-4c5e652edf3e'::uuid)
                                      Filter: (customer_identity_id = ANY ('{02d9938b-2652-486f-885e-4c4beacc195b,0adcd144-da33-4114-8f0c-885976a1bd71,142f362b-478a-42e1-aad6-6a21f1ed2086,154386d6-b528-41c9-89f1-e1f4100db868,24acc29a-b290-4a45-ac5b-058efeffc5fc,2dc5966d-1196-4e74-ab79-8726e5ddfeb3,2f8dba11-cf46-46a9-a0d2-70a6e429db14,38928758-6e7a-4928-ad21-da4fb3d5c8ca,390ca41c-bd66-49dd-90da-bc902346ac73,3dac32b3-0263-4af9-af24-33db041fe518,44b3c01c-928b-4ccb-9c6f-b3a5cc51d046,44d4c338-a69e-466f-be0f-07665f643433,4de1bd39-699b-4630-b62f-127c7ccb0367,4f9ecb56-de4c-49fc-ac65-b8cc5df8f6a8,4fbb3b51-fe28-42b8-9e55-b2eeb8eba874,518cc999-3896-4481-bf92-61100d10a015,54ded753-2474-439e-a108-8ac3f24202e0,58b3e7cd-1a64-4c90-b1c7-98768017f293,631b537a-d0e2-4181-b5bb-27fd72343a2e,6a22263f-87f2-4f9c-b90e-e93820030dfb,6f7e9e84-1af4-45db-92bf-5ee5cd57aeb3,6fdcbe4a-352d-4972-9858-69887ac0abd6,706e8940-9b93-4dbd-9ce9-5e145718c63b,724a54cb-df06-4ddc-ae72-0d92fd7066ea,7a2af2b4-e327-4069-9f5c-a4f1e554ec34,7ad266c3-79a3-4745-8d99-c51a2e36478c,7e5e4301-7924-4fda-b3cd-e11607da7aa6,87cd9a2e-4f0a-426c-9f9c-eae8f74dd8d4,9331c0d2-76c8-4c55-87df-2a09d0a53a26,99f064f7-ae39-4a48-990f-b9ab8ce58203,9f8eb3f6-9469-4e9b-9c3b-870583f681f9,a1aa89ca-9cc7-438d-b480-ae50f893cf91,ada045bc-a9ee-4914-9431-3f04dc8e7f8b,bca2d71e-69aa-44f1-b15b-dbcdf52c170d,bde60d5d-2a80-4b7b-b071-84f2a41bca6b,be3aee0c-8982-44ce-916d-8900dcbbfc9f,beef8dfe-930a-4c65-a06e-26cd088d3e74,c55a6021-7a57-4e24-8435-09f9625da1bb,c8d4aff4-2de1-4576-aaba-6d5690af98b6,ca7c7b74-4bd4-4ea4-a0e6-594ccb21d3af,d0e7494a-82f6-4688-a766-366cd8de5c1f,d23c8000-2225-41c6-a627-bfcd48e12c58,dc368082-85cf-4a57-b94c-7166db3bca8d,dea07516-ffcb-435c-a727-5ab5ab753889,e68b6999-13df-4de9-85ad-928e78115d15,e7168b0c-f13f-42ff-b537-94bac9d9b3a8,e9a49f9c-8deb-49be-a6c5-d84445d9bd98,f0e17be7-2c10-41c6-8249-225fc474c74b,faa02444-a6c5-4b44-96a0-ff2ad73ceabb}'::uuid[]))
  …
Planning Time: 0.337 ms · Execution Time: 1.806 ms
```

### 5 · Year rows for the carry-forward — BEFORE: one statement per year (this is one of 4)
```
Hash Join  (cost=27.68..137.35 rows=146 width=49) (actual rows=182 loops=1)
  Hash Cond: (b.account_id = a.account_id)
  ->  Bitmap Heap Scan on account_balance b  (cost=5.78..115.07 rows=146 width=60) (actual rows=182 loops=1)
        Recheck Cond: ((entity_id = 'b539764e-33fd-4743-9833-4c5e652edf3e'::uuid) AND (fiscal_year = '2023-24'::text))
        Heap Blocks: exact=10
        ->  Bitmap Index Scan on account_balance_year_idx  (cost=0.00..5.74 rows=146 width=0) (actual rows=182 loops=1)
              Index Cond: ((entity_id = 'b539764e-33fd-4743-9833-4c5e652edf3e'::uuid) AND (fiscal_year = '2023-24'::text))
  ->  Hash  (cost=16.40..16.40 rows=440 width=21) (actual rows=440 loops=1)
        Buckets: 1024  Batches: 1  Memory Usage: 31kB
        ->  Seq Scan on ledger_account a  (cost=0.00..16.40 rows=440 width=21) (actual rows=440 loops=1)
Planning Time: 0.156 ms
Execution Time: 0.171 ms
  …
Planning Time: 0.156 ms · Execution Time: 0.171 ms
```

### 5 · Year rows — AFTER: every year in ONE statement (b406 account_balance_year_idx)
```
Hash Join  (cost=56.20..205.05 rows=2325 width=49) (actual rows=2325 loops=1)
  Hash Cond: (b.account_id = a.account_id)
  ->  Bitmap Heap Scan on account_balance b  (cost=34.30..176.99 rows=2325 width=60) (actual rows=2325 loops=1)
        Recheck Cond: (entity_id = 'b539764e-33fd-4743-9833-4c5e652edf3e'::uuid)
        Filter: (fiscal_year = ANY ('{2023-24,2024-25,2025-26,2026-27}'::text[]))
        Heap Blocks: exact=45
        ->  Bitmap Index Scan on account_balance_year_idx  (cost=0.00..33.72 rows=2325 width=0) (actual rows=2325 loops=1)
              Index Cond: (entity_id = 'b539764e-33fd-4743-9833-4c5e652edf3e'::uuid)
  ->  Hash  (cost=16.40..16.40 rows=440 width=21) (actual rows=440 loops=1)
        Buckets: 1024  Batches: 1  Memory Usage: 31kB
        ->  Seq Scan on ledger_account a  (cost=0.00..16.40 rows=440 width=21) (actual rows=440 loops=1)
Planning Time: 0.095 ms
Execution Time: 0.901 ms
  …
Planning Time: 0.095 ms · Execution Time: 0.901 ms
```

