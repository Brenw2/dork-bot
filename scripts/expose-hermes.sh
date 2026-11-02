#!/usr/bin/env bash
# Share the Hermes API server with your own Tailscale devices over HTTPS.
# Hermes itself stays bound to 127.0.0.1; Tailscale proxies to it, so only
# devices on your tailnet can reach it, and every bot still needs its own key.
#   scripts/expose-hermes.sh        # turn on (survives reboots)
#   scripts/expose-hermes.sh off    # turn off
set -euo pipefail
HERMES="${DORK_HERMES_LOCAL:-http://127.0.0.1:8642}"

if [[ "${1:-}" == "off" ]]; then
  tailscale serve --https=443 off
  echo "Hermes is no longer shared over Tailscale."
  exit 0
fi

if ! tailscale serve --bg --https=443 "$HERMES" 2>&1; then
  echo
  echo "Tailscale refused. If it says 'Access denied', run this once and try again:"
  echo "  sudo tailscale set --operator=\$USER"
  exit 1
fi

HOST=$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')
IP=$(tailscale ip -4 | head -n1)
echo
echo "Checking https://$HOST/health ..."
# Pin the name to our own Tailscale IP: b-lab may not use MagicDNS itself
# (--accept-dns=false), but the phone does. The first call can be slow while
# Tailscale fetches the HTTPS certificate.
curl -fsS -m 60 --resolve "$HOST:443:$IP" "https://$HOST/health" && echo && echo "OK: the app can use https://$HOST"
