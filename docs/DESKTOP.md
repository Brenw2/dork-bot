# Dork Bot on the Linux desktop

The same app as on the phone: the Expo web build inside an Electron window (`desktop/`). Same bots, same chats, same looks (docs/HERMES.md → Same bots and chats on every device).

## Install / update

```bash
scripts/install-desktop.sh --pair   # first time: build, install, sign in to Hermes (brings in your bots)
scripts/install-desktop.sh          # after pulling: rebuild and reinstall
scripts/install-desktop.sh --uninstall
```

It installs to `~/.local/share/dork-bot/` and adds `~/.local/share/applications/dork-bot.desktop`, so it's in the app menu (Super+Space → Dork Bot) and opens `dorkbot://` links. No sudo needed. `scripts/pair-hermes.sh --desktop` signs it in again without the QR code.

## Why Electron, not a browser tab

- **Network.** Hermes's API server refuses browser requests (its CORS preflight answers 403). The app's fetch (`components/net.web.ts`) goes over IPC to the main process, which makes the request with `net.fetch` and streams the body back, so replies still arrive word by word.
- **Keys.** `lib/secureStore.web.ts` → the main process keeps each value encrypted with `safeStorage` (system keyring) in `~/.config/Dork Bot/store.json` (mode 600).
- **Tailscale name.** On b-lab itself, `b-lab.<tailnet>.ts.net` doesn't resolve (MagicDNS is off on the host). `desktop/main.mjs` maps this machine's own Tailscale name to its Tailscale IP (`host-resolver-rules`), so the desktop app uses the same `https://…ts.net` addresses as the phone and the bots match.
- **Sign-ins and dialogs.** Connector OAuth opens in a pop-up window that closes itself once Hermes reports the sign-in approved. Alerts use native dialogs (`components/alert.web.ts`).

## Desktop-only behavior

- Bot list and chat side by side from 720 px wide. Pop-ups (Look, Model, Connectors, New bot) open as panels over the dimmed app (`components/Overlay.tsx`). Esc, ✕ or a click outside closes them.
- The chat isn't an inverted list on web: react-native-web scrolls inverted lists in script (jumpy wheel, no momentum, backwards scrollbar). It's a normal list that stays pinned to the bottom while you're at the bottom.
- Enter sends, Shift+Enter makes a new line. ⋯ on each bot opens the menu that long-press opens on the phone.

## Developing

```bash
npx expo export --platform web --output-dir desktop/web && (cd desktop && npx electron .)
DORK_DESKTOP_PROFILE=test npx electron . --remote-debugging-port=9334   # a second copy with its own sign-in, drivable over CDP
```

Code in Chromium is stricter than on the phone: browser built-ins like `setTimeout`/`clearTimeout`/`fetch` throw "Illegal invocation" when called as a method of another object. Wrap them (see `lib/activity.ts`). A screen that throws now shows expo-router's error page instead of a black window.
