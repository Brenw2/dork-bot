// Replies still being worked on, per bot. Hermes keeps a reply running when the app hangs up
// (the chat was left, the phone backgrounded the app, the network dropped), so the app remembers
// the run and checks GET /v1/runs/<id> until it's done. Re-attaching to the live stream isn't an
// option: /v1/runs/<id>/events has no events for chat-started runs (tested on b-lab 2026-11-03).
// Plain TypeScript with injected effects, so it's unit-tested without React Native.
import type { Mood } from './sprites';

export const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted', 'gone']);

export interface LiveRun {
  runId: string;
  /** ms since epoch, for the "still working… 45s" timer. */
  startedAt: number;
}

export interface LiveRunDeps {
  /** The run's status (see HermesClient.runStatus). Throwing means "couldn't tell", not "done". */
  check: (bot: string, runId: string) => Promise<string>;
  save: (runs: Record<string, LiveRun>) => void | Promise<void>;
  setMood: (bot: string, mood: Mood) => void;
  now: () => number;
}

type Listener = (bot: string) => void;

export class LiveRuns {
  private runs = new Map<string, LiveRun>();
  /** Bots whose chat screen is streaming the run itself, so there's nothing to poll. */
  private streaming = new Set<string>();
  private listeners = new Set<Listener>();
  private polling = false;

  constructor(private readonly deps: LiveRunDeps) {}

  /** Runs saved before the app was closed. */
  restore(saved: Record<string, LiveRun> | null | undefined): void {
    for (const [bot, run] of Object.entries(saved ?? {})) if (run?.runId) this.runs.set(bot, run);
  }

  get(bot: string): LiveRun | null {
    return this.runs.get(bot) ?? null;
  }

  isStreaming(bot: string): boolean {
    return this.streaming.has(bot);
  }

  /** The chat started streaming a run. */
  start(bot: string, runId: string): void {
    this.runs.set(bot, { runId, startedAt: this.runs.get(bot)?.runId === runId ? this.runs.get(bot)!.startedAt : this.deps.now() });
    this.streaming.add(bot);
    void this.deps.save(this.snapshot());
  }

  /** The stream is gone (screen left, app backgrounded, network) but the run may still be going. */
  detach(bot: string): void {
    if (!this.streaming.delete(bot) || !this.runs.has(bot)) return;
    this.deps.setMood(bot, 'working');
  }

  /** The run is over (the stream said so, or a check did). */
  finish(bot: string): void {
    this.streaming.delete(bot);
    if (!this.runs.delete(bot)) return;
    void this.deps.save(this.snapshot());
    this.listeners.forEach((fn) => fn(bot));
  }

  /** Called when a run of this bot finishes while nobody was streaming it. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  /** Checks every run nobody is streaming. Safe to call often; overlapping calls are skipped. */
  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      for (const [bot, run] of [...this.runs]) {
        if (this.streaming.has(bot)) continue;
        let status: string;
        try {
          status = await this.deps.check(bot, run.runId);
        } catch {
          continue; // offline or Hermes restarting: ask again next time
        }
        if (this.runs.get(bot)?.runId !== run.runId || this.streaming.has(bot)) continue;
        if (TERMINAL.has(status)) {
          this.deps.setMood(bot, 'idle'); // after 'working' this shows 'done' for a moment
          this.finish(bot);
        } else {
          this.deps.setMood(bot, 'working');
        }
      }
    } finally {
      this.polling = false;
    }
  }

  private snapshot(): Record<string, LiveRun> {
    return Object.fromEntries(this.runs);
  }
}

/** "45s", "1m 05s". */
export function elapsedLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}
