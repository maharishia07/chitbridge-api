#!/bin/sh
# deploy/sit/box-check.sh - the box's own alarm for the two failures /health cannot see (break test 21 Nov, rows 5 and 8).
# OWNS      ~/net/box-status.json: {at, project, flags[], web, ask, api, caddy}. flags is empty when all is well, else any of
#           web_down (the web container does not answer: visitors get the "we are updating" page), ask_down (the on-demand TLS gate does not
#           answer: a storefront subdomain gives a browser TLS error), api_down, caddy_down.
# CALLED BY cron every minute (up.sh installs it); READ BY toolset/coverage/servers-probe.cjs (box_status), which the map's Servers tab shows.
# WHY       /health is the api's, so it stays green with the web down; and the TLS error of a down `ask` shows only in the Caddy log.
# HOW       probes from INSIDE the caddy container (the compose network is the path Caddy itself uses): web:8080/healthz, ask:9123/ask?domain=<SIT_HOST>,
#           api:3000/health. Read-only apart from the one status file. No secrets are read: SIT_HOST is a public name.
# USAGE     box-check.sh <compose project>   (default: chitbridge)         STATUS_FILE=... overrides the output path.
P="${1:-chitbridge}"
HERE=$(cd "$(dirname "$0")" && pwd)
OUT="${STATUS_FILE:-$HOME/net/box-status.json}"
HOST=$(sed -n 's/^SIT_HOST=//p' "$HERE/.env" 2>/dev/null | head -n 1)
C="$P-caddy-1"
probe() { docker exec "$C" wget -q -T 4 -O /dev/null "$1" >/dev/null 2>&1 && echo ok || echo down; }
if docker exec "$C" true >/dev/null 2>&1; then
  caddy=ok
  web=$(probe http://web:8080/healthz)
  ask=$(probe "http://ask:9123/ask?domain=$HOST")
  api=$(probe http://api:3000/health)
else
  caddy=down; web=unknown; ask=unknown; api=unknown
fi
flags=
[ "$caddy" = down ] && flags="$flags\"caddy_down\","
[ "$web" = down ] && flags="$flags\"web_down\","
[ "$ask" = down ] && flags="$flags\"ask_down\","
[ "$api" = down ] && flags="$flags\"api_down\","
flags=${flags%,}
mkdir -p "$(dirname "$OUT")"
printf '{"at":"%s","project":"%s","flags":[%s],"caddy":"%s","web":"%s","ask":"%s","api":"%s"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$P" "$flags" "$caddy" "$web" "$ask" "$api" > "$OUT.tmp" && mv "$OUT.tmp" "$OUT"
