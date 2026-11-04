#!/usr/bin/env bash
# Builds the Dork Bot desktop app and installs it for this user (no sudo needed):
#   ~/.local/share/dork-bot/                        the app
#   ~/.local/share/applications/dork-bot.desktop    in the app menu (Super+Space → "Dork Bot"); opens dorkbot:// links
# Re-run it after pulling to update the installed app.
#   scripts/install-desktop.sh             build and install
#   scripts/install-desktop.sh --pair      ...then sign it in to Hermes (first install; brings in your bots)
#   scripts/install-desktop.sh --uninstall
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DEST="$HOME/.local/share/dork-bot"
APPS="$HOME/.local/share/applications"
ENTRY="$APPS/dork-bot.desktop"

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -rf "$DEST" "$ENTRY"
  update-desktop-database "$APPS" 2>/dev/null || true
  echo "Removed Dork Bot from this desktop. Its saved sign-in is in ~/.config/Dork Bot (delete it to forget the keys)."
  exit 0
fi

cd "$ROOT"
[[ -d node_modules ]] || npm ci
echo "==> Building the app (web build)"
rm -rf desktop/web
cp assets/icon.png desktop/icon.png
npx expo export --platform web --output-dir desktop/web >/dev/null
echo "==> Packaging (Electron)"
cd desktop
[[ -d node_modules ]] || npm ci
npx electron --version >/dev/null   # fetches the Electron binary on first use
npx electron-builder --linux dir --publish never >/dev/null
cd "$ROOT"

echo "==> Installing to $DEST"
mkdir -p "$DEST" "$APPS"
rsync -a --delete desktop/dist/linux-unpacked/ "$DEST/"
cp desktop/icon.png "$DEST/icon.png"
cat >"$ENTRY" <<EOF
[Desktop Entry]
Type=Application
Name=Dork Bot
Comment=Your AI teammates on Hermes
Exec="$DEST/dork-bot" %u
Icon=$DEST/icon.png
Terminal=false
Categories=Network;Chat;
MimeType=x-scheme-handler/dorkbot;
StartupWMClass=dork-bot
EOF
xdg-mime default dork-bot.desktop x-scheme-handler/dorkbot
update-desktop-database "$APPS" 2>/dev/null || true
echo "Installed Dork Bot $(node -p "require('./desktop/package.json').version") ($(git rev-parse --short HEAD))."
echo "Open it from the app menu (Super+Space, type Dork Bot)."

if [[ "${1:-}" == "--pair" ]]; then
  "$ROOT/scripts/pair-hermes.sh" --desktop
fi
