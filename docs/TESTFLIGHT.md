# TestFlight

**The first release goes to TestFlight** (Brennan's call, 2026-11-02). TestFlight is how the app gets onto the iPhone Duo; there's no separate ad hoc build.

Same pipeline as Sports Week: Expo SDK 58, built on GitHub's `xcode-27` macOS runner with `eas build --local`, uploaded with `eas submit`. Workflow: `.github/workflows/ios-testflight.yml` (manual only).

| Field | Value |
| --- | --- |
| Expo project | `@brenw2/dork-bot` (`e19b3c18-96ee-45f3-8f71-0c6d52950c21`) |
| Bundle ID | `com.brenw2.dorkbot` |
| Apple team | `C7Z2H37BVG` (Brennan's **personal** team, never Sallie Mae `96L2D73W86`) |
| Version / build | `expo.version` / `ios.buildNumber` in `app.json` (`appVersionSource: local`, no auto-increment) |

## One-time setup (Brennan, in a normal terminal)

1. First build, which also creates everything on Apple's side. It asks you to log in with your Apple ID, then registers the bundle ID, makes the certificate and profile, stores them on EAS, creates the "Dork Bot" app in App Store Connect and uploads to TestFlight. It uses one EAS cloud build.

   ```bash
   cd ~/Work/dork-bot && npx eas-cli@23.2.0 build -p ios --profile production --auto-submit
   ```

   Pick team `C7Z2H37BVG` if asked. When it asks about an App Store Connect API key, reuse the existing one.

2. Let GitHub Actions build the next ones: add an Expo token (expo.dev → Account settings → Access tokens) as a repo secret.

   ```bash
   gh secret set EXPO_TOKEN -R Brenw2/dork-bot
   ```

   The ASC secrets (`ASC_API_KEY_P8`, `ASC_API_KEY_ID`, `ASC_API_ISSUER_ID`) are optional if the key is assigned to the app on EAS (step 1 does that).

3. Put the App Store Connect app ID (App Store Connect → Dork Bot → App Information → Apple ID) in `eas.json` under `submit.production.ios.ascAppId`.

## Every release after that

1. Bump `ios.buildNumber` in `app.json` in a PR (TestFlight rejects a reused number).
2. `gh workflow run ios-testflight.yml -R Brenw2/dork-bot` (or GitHub → Actions → "iOS build + TestFlight" → Run workflow on `main`).
3. About 15 minutes warm, 40 cold, then Apple processing (~10–15 min) before it shows in TestFlight.

Minutes: the free plan's 2,000 minutes a month (macOS billed at 10x) apply to private repos and are shared across the whole account, so Sports Week uses them. dork-bot is public, and GitHub doesn't bill standard hosted runners on public repos. Check the first run under Settings → Billing to confirm `xcode-27` counts as standard.

## Phone setup

1. `scripts/expose-hermes.sh` once on b-lab (needs `sudo tailscale set --operator=$USER` the first time).
2. `scripts/pair-bot.sh <bot>` and scan the QR code with the iPhone camera.
