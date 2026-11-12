// Is a bot busy right now, whoever started the work? The chat screen only knows about replies it
// streams itself; this asks Hermes about everything else, from the bot's session list
// (GET /p/<bot>/api/sessions, newest activity first; measured on b-lab 2026-11-05):
//  - A terminal run (`hermes -p <bot> chat -q`, source "oneshot"/"cli"), a routine (source "cron")
//    or any other non-chat session shows up the moment it starts, with ended_at null, and gets an
//    ended_at when it finishes. last_active only moves when a message is saved, so a long model call
//    looks idle for 30 s or more: ended_at, not last_active, says it is running. A session whose
//    process died never gets an ended_at, so one untouched for STALE_S is not counted.
//  - The app's own chats (source "api_server") never get an ended_at. A chat is busy when its last
//    saved message is the user's, recently (the same rule as a reply sent from the other device,
//    lib/chatState.ts awaitingReply). That takes one extra request, only for a chat active lately.
// Plain TypeScript with injected effects, so it's unit-tested without React Native.
import type { Mood } from './sprites';
import { parseRoutineNote } from './routineNotes';

/** A session nobody has touched for this long, with no end, is a crashed process, not work. */
export const STALE_S = 15 * 60;
/** A chat whose last message is the user's counts as waiting for a reply for this long. */
export const CHAT_WINDOW_S = 15 * 60;
export const CHAT_SOURCE = 'api_server';

export interface SessionRow {
  id: string;
  source: string;
  endedAt: number | null;
  lastActive: number;
  messageCount: number;
}

/** The fields of GET /api/sessions rows that matter here; anything malformed is skipped. */
export function parseSessionRows(data: unknown): SessionRow[] {
  if (!Array.isArray(data)) return [];
  const out: SessionRow[] = [];
  for (const r of data as Record<string, unknown>[]) {
    if (typeof r?.id !== 'string' || typeof r.last_active !== 'number') continue;
    out.push({
      id: r.id,
      source: typeof r.source === 'string' ? r.source : '',
      endedAt: typeof r.ended_at === 'number' ? r.ended_at : null,
      lastActive: r.last_active,
      messageCount: typeof r.message_count === 'number' ? r.message_count : 0,
    });
  }
  return out;
}

/** A session that is running now and isn't one of the app's chats. */
export function runningOutsideChat(rows: SessionRow[], nowS: number): boolean {
  return rows.some((r) => r.source !== CHAT_SOURCE && r.endedAt === null && nowS - r.lastActive <= STALE_S);
}

/** How many of a bot's most recent chats are looked at; a bot has a handful, and only the active ones cost a request. */
export const MAX_CHATS = 3;

/** The chats touched lately, newest first, whose last message might be waiting for a reply. */
export function recentChats(rows: SessionRow[], nowS: number, max = MAX_CHATS): SessionRow[] {
  return rows
    .filter((r) => r.source === CHAT_SOURCE && r.messageCount > 0 && nowS - r.lastActive <= CHAT_WINDOW_S)
    .sort((a, b) => b.lastActive - a.lastActive)
    .slice(0, max);
}

/** How long a bot is held as working for a reply Hermes hasn't shown yet (a chat left right after sending). */
export const ADOPT_GRACE_MS = 20_000;

/**
 * Whether a chat's saved messages (raw, as GET /api/sessions/<id>/messages sends them) end in the
 * middle of a turn: the last message is the user's, a tool result, or an assistant step that
 * called tools (it may say "let me check…" first, so having text doesn't mean it's the answer).
 * A finished turn ends in an assistant message with no tool calls (then a session_meta row).
 * Only counts while that last message is recent.
 */
export function turnPending(raw: unknown, nowS: number, windowS = CHAT_WINDOW_S): boolean {
  if (!Array.isArray(raw)) return false;
  for (let i = raw.length - 1; i >= 0; i--) {
    const m = raw[i] as { role?: unknown; tool_calls?: unknown; timestamp?: unknown } | null;
    if (!m || typeof m.role !== 'string' || m.role === 'session_meta') continue;
    const recent = typeof m.timestamp === 'number' && nowS - m.timestamp <= windowS;
    if (m.role === 'user' || m.role === 'tool') {
      // A routine's result added to the chat is a user-role row but not a message waiting for a reply.
      if (m.role === 'user' && parseRoutineNote((m as { content?: unknown }).content)) continue;
      return recent;
    }
    if (m.role === 'assistant') return recent && Array.isArray(m.tool_calls) && m.tool_calls.length > 0;
    return false;
  }
  return false;
}

/** What a chat does with the bot's mood when it is left: keep it working (Hermes is tracking the run), hand it to the busy watch (a reply is in flight but not tracked yet), or go idle. */
export function leaveAction(opts: { runTracked: boolean; replying: boolean }): 'hold' | 'adopt' | 'idle' {
  return opts.runTracked ? 'hold' : opts.replying ? 'adopt' : 'idle';
}

export interface BusyDeps {
  bots: () => Promise<string[]>;
  /** The bot's newest sessions. Throwing means "couldn't tell", which keeps the last answer. */
  sessions: (bot: string) => Promise<SessionRow[]>;
  /** Whether the chat's saved messages end mid-turn (HermesClient.turnPending). */
  chatWaiting: (bot: string, chatId: string) => Promise<boolean>;
  getMood: (bot: string) => Mood;
  setMood: (bot: string, mood: Mood) => void;
  /** Back to idle with no "done" flash: the work this showed never turned out to exist. */
  clearMood: (bot: string) => void;
  /** This device already has the bot working (a run it started and is checking on). */
  heldHere: (bot: string) => boolean;
  now: () => number;
}

const IDLE_LIKE: Mood[] = ['idle', 'done'];

export class BusyWatch {
  private busy = new Map<string, boolean>();
  /** Bots whose "working" mood this watcher set, so it only ever takes back its own. */
  private mine = new Set<string>();
  /** Bots handed over by a screen that was left mid-reply, until Hermes has confirmed the work (bot → when). */
  private adopted = new Map<string, number>();
  /** Per chat: the answer for the message count it was asked at, so a quiet chat costs nothing. */
  private chats = new Map<string, { key: string; waiting: boolean }>();
  private running = false;

  constructor(private readonly deps: BusyDeps) {}

  isBusy(bot: string): boolean {
    return this.busy.get(bot) ?? false;
  }

  /** Asks Hermes about every bot once and updates their moods. Overlapping calls are skipped. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const bots = await this.deps.bots();
      for (const gone of [...this.busy.keys()]) if (!bots.includes(gone)) this.forget(gone);
      await Promise.all(bots.map((bot) => this.check(bot)));
    } catch {
      // can't list the bots: try again next time
    } finally {
      this.running = false;
    }
  }

  /**
   * A chat was left while the bot was still replying. Keep it working until Hermes says it is over,
   * with no "done" before that. The reply may not be saved on Hermes yet, so give it a moment to show
   * up; if it never does, drop the mood without a "done".
   */
  adopt(bot: string): void {
    this.deps.setMood(bot, 'working');
    this.mine.add(bot);
    this.adopted.set(bot, this.deps.now());
  }

  /** Stops showing outside work (the watch is switched off): moods this watcher set go back to idle. */
  reset(): void {
    for (const bot of [...this.busy.keys()]) this.forget(bot);
    this.chats.clear();
  }

  private forget(bot: string): void {
    this.busy.delete(bot);
    this.apply(bot, false);
  }

  private async check(bot: string): Promise<void> {
    let busy: boolean;
    try {
      const nowS = this.deps.now() / 1000;
      const rows = await this.deps.sessions(bot);
      busy = runningOutsideChat(rows, nowS);
      if (!busy) {
        for (const chat of recentChats(rows, nowS)) {
          if (await this.waiting(bot, chat)) {
            busy = true;
            break;
          }
        }
      }
    } catch {
      return; // offline or Hermes restarting: keep what is shown
    }
    this.busy.set(bot, busy);
    this.apply(bot, busy);
  }

  private async waiting(bot: string, chat: SessionRow): Promise<boolean> {
    const key = `${chat.id}:${chat.messageCount}`;
    const seen = this.chats.get(chat.id);
    // Same message count as the last look: nothing was added, so only the time window can change it.
    if (seen?.key === key && !seen.waiting) return false;
    const waiting = await this.deps.chatWaiting(bot, chat.id);
    this.chats.set(chat.id, { key, waiting });
    return waiting;
  }

  private apply(bot: string, busy: boolean): void {
    const mood = this.deps.getMood(bot);
    if (busy) {
      this.adopted.delete(bot); // Hermes has it: from here a finish is real
      // Don't talk over the chat screen's own mood (thinking, talking…); fill in only when it shows nothing.
      if (IDLE_LIKE.includes(mood)) {
        this.deps.setMood(bot, 'working');
        this.mine.add(bot);
      }
      return;
    }
    const since = this.adopted.get(bot);
    if (since !== undefined) {
      if (this.deps.now() - since < ADOPT_GRACE_MS) return; // Hermes may not have saved the message yet
      this.adopted.delete(bot);
      this.mine.delete(bot);
      if (mood === 'working' && !this.deps.heldHere(bot)) this.deps.clearMood(bot);
      return;
    }
    if (this.mine.delete(bot) && mood === 'working' && !this.deps.heldHere(bot)) this.deps.setMood(bot, 'idle');
  }
}
