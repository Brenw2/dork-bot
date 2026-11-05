#!/usr/bin/env bash
# Install the dork-bot-push Hermes plugin (hermes-plugin/dork-bot-push) into bots' profiles, so a
# finished reply, an approval or a routine result reaches the phone as a push.
#
#   scripts/install-push-plugin.sh chief assistant   # these bots
#   scripts/install-push-plugin.sh --all             # every profile on this Hermes, default included
#   scripts/install-push-plugin.sh --remove chief    # take it out again
#
# Copies the plugin into ~/.hermes/profiles/<bot>/plugins/dork-bot-push, then turns it on with
# `hermes -p <bot> plugins enable`. Enabling nudges the running gateway to rescan its plugins, so
# the hooks work from the next turn without a gateway restart. Re-run after changing the plugin.
# Nothing is pushed until the app has turned notifications on (it stores the phone's push token
# in the bot's dork_bot config through hermes serve).
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="hermes-plugin/dork-bot-push"
NAME="dork-bot-push"
# The real Hermes root, not the active profile: inside a profile session HERMES_HOME points at that
# profile, which made --all install "default" into it. hermes -p <bot> needs it unset too.
unset HERMES_HOME
HERMES_ROOT="$HOME/.hermes"

remove=0
bots=()
for arg in "$@"; do
  case "$arg" in
    --remove) remove=1 ;;
    --all)
      bots+=(default)
      for d in "$HERMES_ROOT"/profiles/*/; do [[ -f "$d/config.yaml" ]] && bots+=("$(basename "$d")"); done
      ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) bots+=("$arg") ;;
  esac
done
[[ ${#bots[@]} -gt 0 ]] || { echo "usage: scripts/install-push-plugin.sh [--remove] <bot>... | --all"; exit 1; }

home_of() { [[ "$1" == "default" ]] && echo "$HERMES_ROOT" || echo "$HERMES_ROOT/profiles/$1"; }

for bot in "${bots[@]}"; do
  home="$(home_of "$bot")"
  if [[ ! -f "$home/config.yaml" ]]; then
    echo "✗ $bot: no Hermes profile at $home"
    continue
  fi
  if (( remove )); then
    # Hermes's own remove: deletes the folder and drops it from plugins.enabled.
    hermes -p "$bot" plugins remove "$NAME" && echo "✓ $bot: removed (its hooks stay wired until the gateway next restarts)"
    continue
  fi
  dest="$home/plugins/$NAME"
  mkdir -p "$dest"
  # A copy, not a symlink: the gateway keeps running the installed version whatever branch this
  # checkout is on. Tests and caches stay behind.
  cp "$SRC/plugin.yaml" "$SRC/__init__.py" "$SRC/push.py" "$dest/"
  rm -rf "$dest/__pycache__"
  hermes -p "$bot" plugins enable "$NAME" --no-allow-tool-override
  echo "✓ $bot: $NAME installed and enabled"
done
