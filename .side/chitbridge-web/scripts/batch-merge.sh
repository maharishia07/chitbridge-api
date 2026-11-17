#!/bin/sh
# scripts/batch-merge.sh — the BATCH MERGE, run by .github/workflows/batch-merge.yml (04:00 + 16:00 IST, or by hand). Athi 13 Oct: merge to main in
# batches, never continuously; nothing important may depend on the owner's PC (its background jobs get killed when memory runs low).
# Lands every OPEN PR labelled `ready-to-land` (and not `hold`) in the three repos, in the order engines → web → api (14 Oct: twins land web first), oldest first. For each:
# bring it up to date with main, wait for its checks ON that base, merge only if every check is green — the ONLY tolerated red is a check named
# Vercel whose message says "rate limited" (Athi's decision, 13 Oct) — then delete its branch (a merged twin branch must never pair again).
# A red, a conflict or a timeout is reported and skipped; the batch moves on. Writes batch-report.md (uploaded by the workflow).
set -u
OWNER=maharishia07; REPORT=${REPORT:-batch-report.md}
echo "# Batch merge · $(date -u '+%Y-%m-%d %H:%M UTC')" > "$REPORT"; echo "" >> "$REPORT"; echo "| repo | PR | title | result |" >> "$REPORT"; echo "|---|---|---|---|" >> "$REPORT"
row() { echo "| $1 | #$2 | $(echo "$3" | cut -c1-70 | tr '|' '/') | $4 |" >> "$REPORT"; echo "$1 #$2 → $4"; }
reds() { gh pr checks "$2" -R "$OWNER/$1" 2>/dev/null | grep -E '\sfail\s' | grep -vE '^Vercel\s.*[Rr]ate limited' | cut -f1 | tr '\n' ',' ; }
pending() { gh pr checks "$2" -R "$OWNER/$1" 2>/dev/null | grep -cE '\s(pending|queued|in_progress)\s'; }
behind() { b=$(gh pr view "$2" -R "$OWNER/$1" --json baseRefName,headRefOid -q '.baseRefName+"..."+.headRefOid'); gh api "repos/$OWNER/$1/compare/$b" -q .behind_by 2>/dev/null || echo 0; }
# 14 Oct: WEB BEFORE API — a twin api PR is checked against WEB MAIN (till-vendor, the contract), so its web half must land first;
# and an api PR gets a FRESH run of its checks (its last run may have compared against a twin branch that has since merged).
for repo in chitbridge-engines chitbridge-web chitbridge-api; do
  for pr in $(gh pr list -R "$OWNER/$repo" --state open --label ready-to-land --json number,labels,createdAt \
              -q '[.[] | select([.labels[].name] | index("hold") | not)] | sort_by(.createdAt) | .[].number'); do
    title=$(gh pr view "$pr" -R "$OWNER/$repo" --json title -q .title)
    ok=""
    # 14 Oct night (twice in one day: INT6a, ENG-REW1): an api PR whose WEB TWIN (same branch name) is still open never lands alone —
    # api main ahead of web main breaks the pins/contract/snapshot guards for every other PR. It waits for the next batch.
    if [ "$repo" = chitbridge-api ]; then
      hb=$(gh pr view "$pr" -R "$OWNER/$repo" --json headRefName -q .headRefName)
      tw=$(gh pr list -R "$OWNER/chitbridge-web" --state open --head "$hb" --json number -q '.[0].number // empty')
      [ -n "$tw" ] && { row "$repo" "$pr" "$title" "⏸ waits for its web twin #$tw"; continue; }
    fi
    if [ "$repo" = chitbridge-api ] && [ "$(behind "$repo" "$pr")" = 0 ]; then
      br=$(gh pr view "$pr" -R "$OWNER/$repo" --json headRefName -q .headRefName)
      for id in $(gh run list -R "$OWNER/$repo" --branch "$br" --limit 2 --json databaseId -q ".[].databaseId"); do gh run rerun "$id" -R "$OWNER/$repo" >/dev/null 2>&1; done; sleep 60
    fi
    for attempt in 1 2 3; do
      if [ "$(behind "$repo" "$pr")" != 0 ]; then gh pr update-branch "$pr" -R "$OWNER/$repo" >/dev/null 2>&1 || { ok="CONFLICT with main"; break; }; sleep 60; fi
      for i in $(seq 1 60); do [ "$(pending "$repo" "$pr")" = 0 ] && break; sleep 30; done
      [ "$(pending "$repo" "$pr")" != 0 ] && { ok="checks still running after 30 min"; break; }
      r=$(reds "$repo" "$pr"); [ -n "$r" ] && { ok="RED: $r"; break; }
      [ "$(behind "$repo" "$pr")" = 0 ] && { ok=go; break; }
    done
    if [ "$ok" = go ]; then
      if gh pr merge "$pr" -R "$OWNER/$repo" --merge --delete-branch >/dev/null 2>&1; then row "$repo" "$pr" "$title" "✅ merged"; else row "$repo" "$pr" "$title" "⚠️ merge refused"; fi
    else row "$repo" "$pr" "$title" "⏸ ${ok:-not merged}"; fi
  done
done
echo "" >> "$REPORT"; echo "main walks after the batch: $(gh run list -R $OWNER/chitbridge-web --workflow walks.yml --branch main --limit 1 --json conclusion -q '.[0].conclusion')" >> "$REPORT"
cat "$REPORT"
