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
   cd ~/Work/dork-bot && npx eas-cli@27.2.0 build -p ios --profile production --auto-submit
   ```

   Pick team `C7Z2H37BVG` if asked. When it asks about an App Store Connect API key, reuse the existing one.

2. Let GitHub Actions build the next ones: add an Expo token (expo.dev → Account settings → Access tokens) as a repo secret.

   ```bash
   gh secret set EXPO_TOKEN -R Brenw2/dork-bot
   ```

   The ASC secrets (`ASC_API_KEY_P8`, `ASC_API_KEY_ID`, `ASC_API_ISSUER_ID`) are optional if the key is assigned to the app on EAS (step 1 does that).

3. **Notification avatars** (the Notification Service Extension is a second App ID with its own profile): run `EXPO_APPLE_TEAM_ID=C7Z2H37BVG npx eas-cli@27.2.0 credentials:configure-build -p ios -e production` once and log in with the Apple ID. Steps and prompts: docs/NOTIFICATION-AVATARS.md. The workflow below needs no change.

4. ~~Put the App Store Connect app ID in `eas.json`~~ Done: `submit.production.ios.ascAppId` is `6829938917`.

## Every release after that

1. Bump `ios.buildNumber` in `app.json` in a PR (TestFlight rejects a reused number).
   If the version changes, update `expo.version` in `app.json`, `version` in `package.json` and `version` in `desktop/package.json` together. `npm test` (test/versions.test.ts) fails when they differ.
2. `gh workflow run ios-testflight.yml -R Brenw2/dork-bot` (or GitHub → Actions → "iOS build + TestFlight" → Run workflow on `main`).
3. About 15 minutes warm, 40 cold, then Apple processing (~10–15 min) before it shows in TestFlight.

Minutes: the free plan's 2,000 minutes a month (macOS billed at 10x) apply to private repos and are shared across the whole account, so Sports Week uses them. dork-bot is public, and GitHub doesn't bill standard hosted runners on public repos. Check the first run under Settings → Billing to confirm `xcode-27` counts as standard.

## Release log

- 0.10.1 (build 15): Dynamic Type, so text follows the system text size (card 33, #70), and the Terminal (#71), Paper (#72) and Arcade (#73) themes in the Appearance sheet. Same version, new build number. Not built yet.
- 0.10.1 (build 14): photo paste into chat (card 30, #65), select part of a message (card 32, #67), uniform UI kit across screens (card 31, #66, #68), theme plumbing + Appearance sheet, Classic only (#64). Same version, new build number. Not built yet.
- 0.10.1 (build 13): DM streaming polish and the Jump to latest pill (#58), routine card opens at natural height (#59). Same version, new build number. Not built yet.
- 0.10.1 (build 12): group chat keyboard offset for the native header and shared message box (card 28, #56), Usage screen (25), Enter sends in group chat on desktop (#54). Same version, new build number. Uploaded to TestFlight.
- 0.10.1 (build 11): no liquid-glass capsules on sheet and New group chat headers (22), group chat keyboard and Members title fixes (#45, #46). Not built yet.
- 0.10.0 (build 10): notification avatars (15), desktop message box (16), Notify me routines (17), Work view (20), UI polish (19), group chat rooms (8). Last uploaded before it: 0.9.0 (9). Not built yet.

## Phone setup

1. `scripts/expose-hermes.sh` once on b-lab (needs `sudo tailscale set --operator=$USER` the first time).
2. `scripts/setup-bot-manager.sh` once, then `scripts/pair-hermes.sh` and scan the QR code with the iPhone camera. Create bots in the app.
