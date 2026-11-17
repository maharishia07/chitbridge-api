#!/bin/sh
# HX1 · point the site at ITS api: write /config.js — the ONE place every page reads its api from (window.CB_API) — from CB_API_BASE.
# Unset = the committed public/config.js stays (the production api). No page names a host any more (e2e/guard-static.cjs).
set -eu
CONF=/usr/share/nginx/html/config.js
[ -n "${CB_API_BASE:-}" ] || { echo "cb-api-base: CB_API_BASE unset — /config.js keeps its committed api"; exit 0; }
case "$CB_API_BASE" in http://*|https://*) ;; *) echo "cb-api-base: CB_API_BASE must start with http:// or https://" >&2; exit 1 ;; esac
case "$CB_API_BASE" in *\"*|*\\*|*\<*|*\>*|*\ *) echo "cb-api-base: CB_API_BASE holds a character a URL cannot" >&2; exit 1 ;; esac
BASE=$(printf '%s' "$CB_API_BASE" | sed 's#/*$##')
printf '/* written at start by deploy/40-cb-api-base.sh from CB_API_BASE (HX1) — see public/config.js */\nwindow.CB_API = window.CB_API || "%s";\n' "$BASE" > "$CONF"
echo "cb-api-base: /config.js now names $BASE"
