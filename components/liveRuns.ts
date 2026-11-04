// The app's one LiveRuns (lib/liveRuns.ts): saved in the Keychain so a reply that was still running
// when the app closed is picked up again, checked every few seconds and whenever the app comes back.
import { AppState } from 'react-native';
import { fetch } from '@/components/net';
import { activity } from '@/lib/activity';
import { getConnection } from '@/lib/bots';
import { HermesClient, type FetchLike } from '@/lib/hermes';
import { LiveRuns, type LiveRun } from '@/lib/liveRuns';
import * as SecureStore from '@/lib/secureStore';

const KEY = 'dork-live-runs';
const POLL_MS = 3000;

export const liveRuns = new LiveRuns({
  check: async (bot, runId) => {
    const conn = await getConnection(bot);
    if (!conn) return 'gone';
    return new HermesClient(conn, fetch as unknown as FetchLike).runStatus(runId);
  },
  save: (runs) => SecureStore.setItemAsync(KEY, JSON.stringify(runs)),
  setMood: (bot, mood) => activity.set(bot, mood),
  now: () => Date.now(),
});

/** Resolves once saved runs are loaded, so a chat opened at launch knows its bot is still busy. */
export const liveRunsReady: Promise<void> = SecureStore.getItemAsync(KEY)
  .then((raw) => {
    try {
      liveRuns.restore(raw ? (JSON.parse(raw) as Record<string, LiveRun>) : null);
    } catch {
      // a bad save just means nothing to resume
    }
  })
  .catch(() => undefined)
  .then(() => void liveRuns.poll());

setInterval(() => void liveRuns.poll(), POLL_MS);
AppState.addEventListener('change', (state) => {
  if (state === 'active') void liveRuns.poll();
});
