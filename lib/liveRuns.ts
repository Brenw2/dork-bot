// Replies still being worked on, per chat. Hermes keeps a reply running when the app hangs up
// (the chat was left, the phone backgrounded the app, the network dropped), so the app remembers
// the run and checks GET /v1/runs/<id> until it's done. Re-attaching to the live stream isn't an
// option: /v1/runs/<id>/events has no events for chat-started runs (tested on b-lab 2026-11-03).
// Plain TypeScript with injected effects, so it's unit-tested without React Native.
import { firstChatId } from './chats';
import type { ApprovalRequest } from './hermes';
import type { Mood } from './sprites';

export const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted', 'gone']);

export interface LiveRun {
  bot: string;
  runId: string;
  /** ms since epoch, for the "still working… 45s" timer. */
  startedAt: number;
  /** Hermes is waiting for Brennan to allow or deny a command (seen in the run's status). */
  approval?: ApprovalRequest;
}

export interface RunInfo {
  status: string;
  approval?: ApprovalRequest | null;
}

export interface LiveRunDeps {
  /** The run's status (see HermesClient.runInfo). Throwing means "couldn't tell", not "done". */
  check: (bot: string, runId: string) => Promise<RunInfo>;
  save: (runs: Record<string, LiveRun>) => void | Promise<void>;
  setMood: (bot: string, mood: Mood) => void;
  now: () => number;
}

/**
 * Called with the chat id when a run nobody streams changes: `null` when it finished, the run
 * when it started or stopped waiting for an approval.
 */
type Listener = (chat: string, run: LiveRun | null) => void;

export class LiveRuns {
  private runs = new Map<string, LiveRun>();
  /** Chats whose screen is streaming the run itself, so there's nothing to poll. */
  private streaming = new Set<string>();
  private listeners = new Set<Listener>();
  private polling = false;

  constructor(private readonly deps: LiveRunDeps) {}

  /**
   * Runs saved before the app was closed. Older versions saved them per bot ({bot: {runId,
   * startedAt}}), when every bot had one chat: those belong to the bot's first chat.
   */
  restore(saved: Record<string, Partial<LiveRun>> | null | undefined): void {
    for (const [key, run] of Object.entries(saved ?? {})) {
      if (!run?.runId) continue;
      const bot = run.bot ?? key;
      const chat = run.bot ? key : firstChatId(key);
      this.runs.set(chat, { bot, runId: run.runId, startedAt: run.startedAt ?? this.deps.now() });
    }
  }

  get(chat: string): LiveRun | null {
    return this.runs.get(chat) ?? null;
  }

  /** Whether any chat of this bot has a reply running. */
  botBusy(bot: string): boolean {
    for (const r of this.runs.values()) if (r.bot === bot) return true;
    return false;
  }

  isStreaming(chat: string): boolean {
    return this.streaming.has(chat);
  }

  /** The chat started streaming a run. */
  start(bot: string, chat: string, runId: string): void {
    const prev = this.runs.get(chat);
    this.runs.set(chat, { bot, runId, startedAt: prev?.runId === runId ? prev.startedAt : this.deps.now() });
    this.streaming.add(chat);
    void this.deps.save(this.snapshot());
  }

  /** The stream is gone (screen left, app backgrounded, network) but the run may still be going. */
  detach(chat: string): void {
    const run = this.runs.get(chat);
    if (!this.streaming.delete(chat) || !run) return;
    this.deps.setMood(run.bot, 'working');
  }

  /** The run is over (the stream said so, or a check did). */
  finish(chat: string): void {
    this.streaming.delete(chat);
    if (!this.runs.delete(chat)) return;
    void this.deps.save(this.snapshot());
    this.listeners.forEach((fn) => fn(chat, null));
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  /** Checks every run nobody is streaming. Safe to call often; overlapping calls are skipped. */
  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      for (const [chat, run] of [...this.runs]) {
        if (this.streaming.has(chat)) continue;
        let info: RunInfo;
        try {
          info = await this.deps.check(run.bot, run.runId);
        } catch {
          continue; // offline or Hermes restarting: ask again next time
        }
        if (this.runs.get(chat)?.runId !== run.runId || this.streaming.has(chat)) continue;
        if (TERMINAL.has(info.status)) {
          this.deps.setMood(run.bot, 'idle'); // after 'working' this shows 'done' for a moment
          this.finish(chat);
          continue;
        }
        this.deps.setMood(run.bot, 'working');
        const approval = info.status === 'waiting_for_approval' && info.approval ? info.approval : undefined;
        if ((approval?.requestId ?? approval?.command) !== (run.approval?.requestId ?? run.approval?.command)) {
          const next: LiveRun = { ...run, approval };
          if (!approval) delete next.approval;
          this.runs.set(chat, next);
          this.listeners.forEach((fn) => fn(chat, next));
        }
      }
    } finally {
      this.polling = false;
    }
  }

  private snapshot(): Record<string, LiveRun> {
    const out: Record<string, LiveRun> = {};
    for (const [chat, { bot, runId, startedAt }] of this.runs) out[chat] = { bot, runId, startedAt };
    return out;
  }
}

/** "45s", "1m 05s". */
export function elapsedLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}
