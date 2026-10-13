#!/usr/bin/env bash
# deploy/railway/teardown.sh — DELETE THE RAILWAY SPIN'S PROJECT (HX2), and only when Railway says that project is named cbspin-<id>
# (a Railway project has no tags: its name is the tag). Everything the spin made lives inside it. Prints the cost estimate it ran up.
# Railway's public GraphQL API (the CLI deletes only interactively). RAILWAY_PROJECT_ID + CB_SPIN_ID when the state file is gone.
. "$(dirname "$0")/../spin-lib.sh"
[ -n "${PARSE:-}" ] && { PLAN=1; PARSE=; }
spin_load railway
SPIN_SECRETS+=(RAILWAY_API_TOKEN)
[ -n "${RAILWAY_API_TOKEN:-}" ] || dry || die "set RAILWAY_API_TOKEN"
GQL=${RAILWAY_GRAPHQL:-https://backboard.railway.com/graphql/v2}
RAILWAY_PROJECT_ID=${RAILWAY_PROJECT_ID:-plan-project-id}
gql() { out '{"data":{"project":{"name":"cbspin-'"$CB_SPIN_ID"'"}}}' curl -fsS "$GQL" -H "Authorization: Bearer ${RAILWAY_API_TOKEN:-plan-token}" -H 'content-type: application/json' \
  -d "{\"query\":\"$1\",\"variables\":{\"id\":\"$RAILWAY_PROJECT_ID\"}}"; }
say "teardown of spin $CB_SPIN_ID (Railway project $RAILWAY_PROJECT_ID)"
# shellcheck disable=SC2016  # $id is a GraphQL variable, not a shell one
NAME=$(gql 'query($id:String!){project(id:$id){name}}' | node -e 'let s="";process.stdin.on("data",(c)=>s+=c).on("end",()=>{try{console.log(JSON.parse(s).data.project.name)}catch(_){console.log("")}})')
# shellcheck disable=SC2016
if [ "$NAME" = "cbspin-$CB_SPIN_ID" ]; then gql 'mutation($id:String!){projectDelete(id:$id)}' >/dev/null
else die "project $RAILWAY_PROJECT_ID is named '${NAME:-?}', not cbspin-$CB_SPIN_ID — left alone"; fi
# ≈ usage pricing: 4 small services (Postgres, api, web, sink) ~1 GB RAM + a little CPU in all
spin_cost railway 0.02 "Postgres · api · web · sink (usage)"
spin_forget railway
say "spin $CB_SPIN_ID removed"
