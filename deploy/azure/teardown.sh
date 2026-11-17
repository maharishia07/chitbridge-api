#!/usr/bin/env bash
# deploy/azure/teardown.sh — DELETE EVERYTHING THE AZURE SPIN MADE (HX2): its one resource group, and only when the group's tag
# cb-spin names this spin (a group of the same name without that tag is left alone). Prints the cost estimate it ran up.
# CB_SPIN_ID=<id> to tear down a spin whose state file is gone. PLAN=1 / PARSE=1 as spin.sh.
. "$(dirname "$0")/../spin-lib.sh"
spin_load azure
G="cbspin-$CB_SPIN_ID"
say "teardown of spin $CB_SPIN_ID (resource group $G)"
if dry; then run az group show -n "$G" --query 'tags."cb-spin"' -o tsv; T=$CB_SPIN_ID
else T=$(az group show -n "$G" --query 'tags."cb-spin"' -o tsv 2>/dev/null || true); fi
if [ "$T" = "$CB_SPIN_ID" ]; then run az group delete -n "$G" --yes
elif [ -z "$T" ]; then say "no resource group $G tagged for this spin — nothing to delete"
else die "$G is tagged cb-spin=$T, not $CB_SPIN_ID — left alone"; fi
spin_parse_done
# ≈ Postgres B1ms + 32 GB $0.03 · Container Apps 1 vCPU/2 GiB in all, always on $0.10 · ACR Basic $0.007 · Log Analytics ~0
spin_cost azure 0.14 "Postgres B1ms · Container Apps ×3 · ACR Basic"
spin_forget azure
say "spin $CB_SPIN_ID removed"
