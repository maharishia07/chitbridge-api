# Assistant use-case media

Drop the use-case screenshots / short clips here. The floating assistant (`ASSIST_LIB` in `app.html`) references
them by these exact names; until a file exists, the assistant shows the text + a "screen clip coming" caption and
hides the missing image (no broken-image icon).

| Entry | File (png or mp4) | Shows |
|---|---|---|
| `uc_timber`     | `usecase-timber.png`     | a timber order being composed |
| `uc_pharma`     | `usecase-pharma.png`     | a pharma supply chit (batch/expiry fields) |
| `uc_services`   | `usecase-services.png`   | a service request chit (no line-item price) |
| `uc_aggregator` | `usecase-aggregator.png` | a network tree under a top node |
| `uc_compare`    | `usecase-compare.png`    | the SAME chit under two different schemas, side by side |

To use a clip instead of an image, set the entry's `media.type` to `"video"` and point `src` at an `.mp4`.
Keep them small (web-optimised). Captions live on the entry in `ASSIST_LIB`.
