// Wires lib/busy.ts to the app. While a screen that shows a bot's character is up (the bot list,
// a chat), every few seconds it asks Hermes whether each bot is busy with anything, whoever
// started it, and shows that as the "working" mood. It stops with the last such screen and while
// the app is in the background, so nothing runs when nobody is looking.
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { fetch } from '@/components/net';
import { liveRuns } from '@/components/liveRuns';
import { activity } from '@/lib/activity';
import { BusyWatch } from '@/lib/busy';
import { getConnection, listBots } from '@/lib/bots';
import { HermesClient, type FetchLike } from '@/lib/hermes';

/** Short enough to notice a finish within ~10 s (with the 1.8 s "done"), light enough for a handful of bots. */
const POLL_MS = 5000;

async function client(bot: string): Promise<HermesClient> {
  const conn = await getConnection(bot);
  if (!conn) throw new Error(`No saved key for ${bot}.`);
  return new HermesClient(conn, fetch as unknown as FetchLike);
}

const watch = new BusyWatch({
  bots: async () => (await listBots()).map((b) => b.bot),
  sessions: async (bot) => (await client(bot)).recentSessions(),
  chatWaiting: async (bot, chatId) => (await client(bot)).turnPending(chatId),
  getMood: (bot) => activity.get(bot),
  setMood: (bot, mood) => activity.set(bot, mood),
  clearMood: (bot) => activity.clear(bot),
  heldHere: (bot) => liveRuns.botBusy(bot),
  now: () => Date.now(),
});

let users = 0;
let foreground = AppState.currentState === 'active';
let timer: ReturnType<typeof setInterval> | null = null;

function sync(): void {
  const want = users > 0 && foreground;
  if (want && !timer) {
    void watch.tick();
    timer = setInterval(() => void watch.tick(), POLL_MS);
  } else if (!want && timer) {
    clearInterval(timer);
    timer = null;
    watch.reset();
  }
}

AppState.addEventListener('change', (state) => {
  foreground = state === 'active';
  sync();
});

/** A chat was left mid-reply: the bot stays "working" until Hermes says the reply is over (no "done" before). */
export function keepWorking(bot: string): void {
  watch.adopt(bot);
}

/** Keeps bots' busy state fresh while the calling screen is showing. */
export function useBusyWatch(): void {
  useEffect(() => {
    users += 1;
    sync();
    return () => {
      users -= 1;
      sync();
    };
  }, []);
}
