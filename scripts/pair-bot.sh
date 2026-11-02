#!/usr/bin/env bash
# Show a QR code that adds a bot (a Hermes profile) to the Dork Bot app.
# Scan it with the iPhone camera. The code contains the bot's API key, so
# only show it on your own screen.
#   scripts/pair-bot.sh assistant
set -euo pipefail
BOT="${1:?usage: scripts/pair-bot.sh <bot>}"
HERMES_ROOT="${HERMES_HOME:-$HOME/.hermes}"
if [[ "$BOT" == "default" ]]; then ENV_FILE="$HERMES_ROOT/.env"; else ENV_FILE="$HERMES_ROOT/profiles/$BOT/.env"; fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "No Hermes profile '$BOT' (missing $ENV_FILE). Create it with: hermes profile create $BOT"
  exit 1
fi

KEY=$(grep -m1 '^API_SERVER_KEY=' "$ENV_FILE" | cut -d= -f2- | tr -d "\"'" || true)
if [[ -z "$KEY" ]]; then
  echo "Giving '$BOT' its own API server key..."
  hermes -p "$BOT" config set API_SERVER_KEY "$(openssl rand -hex 32)" >/dev/null
  KEY=$(grep -m1 '^API_SERVER_KEY=' "$ENV_FILE" | cut -d= -f2- | tr -d "\"'")
fi

HOST=$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')
URL="https://$HOST"
LINK=$(node -e 'const [u,b,k]=process.argv.slice(1);console.log("dorkbot://add?"+new URLSearchParams({url:u,bot:b,key:k}))' "$URL" "$BOT" "$KEY")

# Prove the key works through Tailscale before showing the code.
CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 20 -H "Authorization: Bearer $KEY" "$URL/p/$BOT/api/sessions?limit=1" || true)
[[ "$BOT" == "default" ]] && CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 20 -H "Authorization: Bearer $KEY" "$URL/api/sessions?limit=1" || true)
if [[ "$CODE" != "200" ]]; then
  echo "Warning: $URL answered HTTP $CODE for '$BOT' (expected 200)."
  echo "Is Hermes shared over Tailscale? Run scripts/expose-hermes.sh. A brand-new key may also need a gateway restart."
fi

qrencode -t ansiutf8 -m 2 "$LINK"
echo "Scan with the iPhone camera to add '$BOT' to Dork Bot ($URL)."
