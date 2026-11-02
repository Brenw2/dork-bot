#!/usr/bin/env bash
# Lets the Dork Bot app create and delete bots. Runs the Hermes backend
# (`hermes serve`, the same server the Hermes desktop app uses) as a user
# service on 127.0.0.1:9119 and shares it with your own devices over
# Tailscale at https://<this machine>:8443.
#
# Hermes only accepts requests for a non-local hostname behind its login gate,
# so this turns on its username/password provider. The login lives in
# ~/.config/dork-bot/serve.env (mode 600), not in ~/.hermes.
#   scripts/setup-bot-manager.sh        # set up / repair (safe to re-run)
#   scripts/setup-bot-manager.sh off    # stop the service and the Tailscale share
set -euo pipefail
PORT=9119
TS_PORT=8443
CONF_DIR="$HOME/.config/dork-bot"
ENV_FILE="$CONF_DIR/serve.env"
UNIT=dork-bot-hermes-serve.service
UNIT_FILE="$HOME/.config/systemd/user/$UNIT"

if [[ "${1:-}" == "off" ]]; then
  systemctl --user disable --now "$UNIT" 2>/dev/null || true
  tailscale serve --https=$TS_PORT off 2>/dev/null || true
  echo "Bot manager is off. (Login kept in $ENV_FILE.)"
  exit 0
fi

HERMES_BIN=$(command -v hermes) || { echo "hermes isn't on PATH"; exit 1; }
HOST=$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')
[[ -n "$HOST" && "$HOST" != null ]] || { echo "Tailscale isn't up."; exit 1; }
PUBLIC_URL="https://$HOST:$TS_PORT"

mkdir -p "$CONF_DIR" && chmod 700 "$CONF_DIR"
if ! grep -q '^HERMES_DASHBOARD_BASIC_AUTH_PASSWORD=' "$ENV_FILE" 2>/dev/null; then
  echo "Creating the Hermes login in $ENV_FILE ..."
  (umask 077; {
    echo "HERMES_DASHBOARD_BASIC_AUTH_USERNAME=$USER"
    echo "HERMES_DASHBOARD_BASIC_AUTH_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')"
    echo "HERMES_DASHBOARD_BASIC_AUTH_SECRET=$(openssl rand -base64 32)"
  } > "$ENV_FILE")
fi
# The public URL is what lets Hermes accept the Tailscale hostname (and turns on the login gate).
(umask 077; { grep -v '^HERMES_DASHBOARD_PUBLIC_URL=\|^HERMES_DASHBOARD_SESSION_TOKEN=' "$ENV_FILE"; echo "HERMES_DASHBOARD_PUBLIC_URL=$PUBLIC_URL"; } > "$ENV_FILE.new")
mv "$ENV_FILE.new" "$ENV_FILE"

mkdir -p "$(dirname "$UNIT_FILE")"
cat > "$UNIT_FILE" <<EOF
[Unit]
Description=Hermes backend for the Dork Bot app (hermes serve, 127.0.0.1:$PORT)
After=network-online.target

[Service]
Environment="PATH=$(dirname "$HERMES_BIN"):$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
Environment="HERMES_HOME=${HERMES_HOME:-$HOME/.hermes}"
EnvironmentFile=$ENV_FILE
ExecStart=$HERMES_BIN serve --host 127.0.0.1 --port $PORT --skip-build
Restart=always
RestartSec=10
# 78 = Hermes refusing on purpose (another backend owns this host); don't loop on it.
RestartPreventExitStatus=78

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable "$UNIT" >/dev/null
systemctl --user restart "$UNIT"

if ! tailscale serve --bg --https=$TS_PORT "http://127.0.0.1:$PORT" >/dev/null 2>&1; then
  echo "Tailscale refused. If it says 'Access denied', run once: sudo tailscale set --operator=\$USER"
  exit 1
fi

echo "Waiting for Hermes on $PUBLIC_URL ..."
IP=$(tailscale ip -4 | head -n1)
for _ in $(seq 1 30); do
  STATUS=$(curl -s -m 10 --resolve "$HOST:$TS_PORT:$IP" "$PUBLIC_URL/api/status" || true)
  if [[ $(jq -r '.auth_required' <<<"$STATUS" 2>/dev/null) == true ]] && jq -e '.auth_providers | index("basic")' <<<"$STATUS" >/dev/null 2>&1; then
    echo "OK: the bot manager is up at $PUBLIC_URL (login required)."
    echo "Next: scripts/pair-hermes.sh, then scan the code with the iPhone camera."
    exit 0
  fi
  sleep 2
done
echo "Hermes didn't come up. Logs: journalctl --user -u $UNIT -n 50"
exit 1
