// Wires lib/work.ts to the app. While a screen that shows a bot's Work is up (the Work list, a chat
// header's "Working on", a work session) it asks Hermes for that bot's sessions every few seconds.
// It stops with the last such screen and while the app is in the background, like the busy watch
// (components/busyWatch.ts), so nothing runs when nobody is looking.
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { fetch } from '@/components/net';
import { getConnection } from '@/lib/bots';
import { HermesClient, type FetchLike } from '@/lib/hermes';
import { runningWork, WorkList, type WorkItem } from '@/lib/work';

export const WORK_POLL_MS = 5000;

export interface WorkState {
  /** null until the first answer. */
  items: WorkItem[] | null;
  error: string | null;
}

class Feed {
  state: WorkState = { items: null, error: null };
  users = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();
  private list: WorkList | null = null;
  private loading = false;

  constructor(private readonly bot: string) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async refresh(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      if (!this.list) {
        const conn = await getConnection(this.bot);
        if (!conn) {
          this.set({ items: this.state.items, error: `No saved key for ${this.bot}.` });
          return;
        }
        const client = new HermesClient(conn, fetch as unknown as FetchLike);
        this.list = new WorkList(this.bot, { sessions: () => client.sessionRows(), messages: (id) => client.rawMessages(id), now: () => Date.now() });
      }
      this.set({ items: await this.list.load(), error: null });
    } catch (e) {
      this.set({ items: this.state.items, error: (e as Error).message }); // keep what is shown
    } finally {
      this.loading = false;
    }
  }

  private set(next: WorkState): void {
    this.state = next;
    this.listeners.forEach((fn) => fn());
  }

  /** Polls while someone is watching and the app is in the foreground. */
  sync(foreground: boolean): void {
    const want = this.users > 0 && foreground;
    if (want && !this.timer) {
      void this.refresh();
      this.timer = setInterval(() => void this.refresh(), WORK_POLL_MS);
    } else if (!want && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

const feeds = new Map<string, Feed>();
let foreground = AppState.currentState === 'active';
AppState.addEventListener('change', (s) => {
  foreground = s === 'active';
  feeds.forEach((f) => f.sync(foreground));
});

function feedOf(bot: string): Feed {
  let f = feeds.get(bot);
  if (!f) feeds.set(bot, (f = new Feed(bot)));
  return f;
}

/** The bot's Work, kept fresh while the calling screen is showing. `reload` asks right now (pull to refresh). */
export function useWork(bot: string): WorkState & { reload: () => Promise<void> } {
  const feed = feedOf(bot);
  const [state, setState] = useState<WorkState>(feed.state);
  useEffect(() => {
    setState(feed.state);
    const off = feed.subscribe(() => setState(feed.state));
    feed.users += 1;
    feed.sync(foreground);
    return () => {
      off();
      feed.users -= 1;
      feed.sync(foreground);
    };
  }, [feed]);
  return { ...state, reload: () => feed.refresh() };
}

/** The session the bot is working on right now that the app didn't start, for the chat header. */
export function useWorkingOn(bot: string): WorkItem | null {
  const { items } = useWork(bot);
  return items ? runningWork(items) : null;
}
