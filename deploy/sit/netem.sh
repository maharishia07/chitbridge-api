#!/bin/sh
# deploy/sit/netem.sh on|off|status - add or remove a network delay and packet loss on this VM's outgoing traffic.
# Used on sit-au to feel like a shop in Sydney talking to a server in Mumbai (about 150 ms round trip, 1% loss). Only what LEAVES the
# machine is delayed, so every answer to a browser takes 150 ms longer; SSH feels it too. Changes nothing on disk: a reboot clears it.
#   ./netem.sh on                 150 ms + 1% loss on the interface the default route uses
#   NETEM_DELAY=200ms NETEM_LOSS=2% ./netem.sh on
#   NETEM_IF=enp0s6 ./netem.sh on   name the interface yourself
#   ./netem.sh off | status
set -eu

ACTION=${1:-}
DELAY=${NETEM_DELAY:-150ms}
LOSS=${NETEM_LOSS:-1%}

die() { echo "netem: $*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || exec sudo -E sh "$0" "$@"
command -v tc >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq iproute2; }

# the interface the machine reaches the internet through (not docker0 or a bridge)
IFACE=${NETEM_IF:-$(ip -o route get 1.1.1.1 | sed -n 's/.* dev \([^ ]*\).*/\1/p' | head -n 1)}
[ -n "$IFACE" ] || die "could not find the egress interface; set NETEM_IF"

# Oracle's Ubuntu kernel may ship without the netem module: install the extra modules once
load_netem() {
  modprobe sch_netem 2>/dev/null && return 0
  apt-get install -y -qq "linux-modules-extra-$(uname -r)" >/dev/null 2>&1 || true
  modprobe sch_netem 2>/dev/null || die "the sch_netem kernel module is not available (try: apt install linux-modules-extra-$(uname -r))"
}

case "$ACTION" in
  on)
    load_netem
    tc qdisc replace dev "$IFACE" root netem delay "$DELAY" loss "$LOSS"
    echo "netem: ON for $IFACE: delay $DELAY, loss $LOSS"
    tc qdisc show dev "$IFACE" | head -n 2
    ;;
  off)
    tc qdisc del dev "$IFACE" root 2>/dev/null || true
    echo "netem: OFF for $IFACE"
    ;;
  status)
    echo "netem: $IFACE"
    tc qdisc show dev "$IFACE"
    ;;
  *) die "usage: netem.sh on|off|status" ;;
esac
