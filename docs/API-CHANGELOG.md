# API changelog

One line per deprecation (API-STANDARD S13, S28): date, route, replacement, sunset.

| Date | Route | Change | Replacement | Sunset |
| --- | --- | --- | --- | --- |
| 2026-11-20 | GET /api/books-grants/practice | answer key `band.bas_due_30` deprecated, still sent with the same value (marked `deprecated` in the output shape) | `band.return_due_30` | 2027-02-18 (90 days) |
