#!/usr/bin/env bash
# Shows a QR code that signs the Dork Bot app in to Hermes, so it can create
# and delete bots. Run scripts/setup-bot-manager.sh once first. Scan the code
# with the iPhone camera. It contains a sign-in token, so only show it on your
# own screen.
#   scripts/pair-hermes.sh
set -euo pipefail
ENV_FILE="$HOME/.config/dork-bot/serve.env"
[[ -f "$ENV_FILE" ]] || { echo "Run scripts/setup-bot-manager.sh first."; exit 1; }
set -a; . "$ENV_FILE"; set +a

ADMIN="${HERMES_DASHBOARD_PUBLIC_URL:?missing in $ENV_FILE; re-run scripts/setup-bot-manager.sh}"
HOST=$(sed -E 's#^https?://([^:/]+).*#\1#' <<<"$ADMIN")
PORT=$(sed -nE 's#^https?://[^:/]+:([0-9]+).*#\1#p' <<<"$ADMIN"); PORT=${PORT:-443}
IP=$(tailscale ip -4 | head -n1)
CHAT="https://$HOST"

# Sign in through Tailscale, like the phone will. b-lab may not resolve its own
# MagicDNS name, so pin it to our Tailscale IP.
JAR=$(mktemp); trap 'rm -f "$JAR"' EXIT
BODY=$(jq -n --arg u "$HERMES_DASHBOARD_BASIC_AUTH_USERNAME" --arg p "$HERMES_DASHBOARD_BASIC_AUTH_PASSWORD" '{provider:"basic", username:$u, password:$p}')
CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 30 --resolve "$HOST:$PORT:$IP" -c "$JAR" \
  -H 'Content-Type: application/json' --data "$BODY" "$ADMIN/auth/password-login" || true)
[[ "$CODE" == 200 ]] || { echo "Sign-in failed (HTTP $CODE). Is it up? scripts/setup-bot-manager.sh"; exit 1; }

# The refresh token is in a cookie, possibly quoted the way Python's http.cookies quotes values.
RT=$(python3 -c '
import sys, http.cookies
for line in open(sys.argv[1]):
    f = line.rstrip("\n").split("\t")
    if len(f) == 7 and f[5].endswith("hermes_session_rt"):
        print(http.cookies._unquote(f[6]))
' "$JAR")
[[ -n "$RT" ]] || { echo "Signed in, but Hermes returned no refresh token."; exit 1; }

# Prove the token works before showing it.
REFRESH=$(jq -n --arg r "$RT" '{refresh_token:$r, provider:"basic"}')
CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 30 --resolve "$HOST:$PORT:$IP" \
  -H 'Content-Type: application/json' --data "$REFRESH" "$ADMIN/auth/native/refresh" || true)
[[ "$CODE" == 200 ]] || { echo "The refresh token didn't work (HTTP $CODE)."; exit 1; }

LINK=$(node -e 'const [a,c,r]=process.argv.slice(1);console.log("dorkbot://connect?"+new URLSearchParams({admin:a,chat:c,rt:r}))' "$ADMIN" "$CHAT" "$RT")
qrencode -t ansiutf8 -m 2 "$LINK"
echo "Scan with the iPhone camera to let Dork Bot create bots on $ADMIN."
echo "(Stays signed in while you use it at least once every 30 days.)"
