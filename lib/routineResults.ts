// A bot's "Routine results" chat: every routine run's full output in one place, oldest at the top,
// newest at the bottom. It is not a normal chat and not a new store: each run is already a Hermes
// session (source "cron", titled "<routine> · Nov 04 11:32"), so this reads those sessions, takes
// each run's final reply and skips runs that said nothing (empty or [SILENT]), the same runs that
// send no push. Every device shows the same thing.
// Plain TypeScript with the bot's HermesClient, so it's unit-tested in Node.
import { HermesError, type HermesClient } from './hermes';

export interface RoutineResult {
  sessionId: string;
  /** The routine's name, from the run's title. */
  name: string;
  /** When the run happened, seconds since epoch. */
  at: number;
  /** The run's full final reply. */
  text: string;
}

/** How many recent runs the chat reads. */
export const RESULTS_LIMIT = 30;

/** "daily_digest · Nov 04 11:32" → "daily_digest". A title without the time is the name. */
export function routineNameOf(title: unknown): string {
  if (typeof title !== 'string' || !title.trim()) return 'Routine';
  const t = title.trim();
  const i = t.lastIndexOf(' · ');
  return (i > 0 ? t.slice(0, i) : t).trim() || 'Routine';
}

/** A run with nothing to say: no entry here and no push (matches the plugin's rule). */
export function isSilent(text: string): boolean {
  const t = text.trim();
  return !t || t === '[SILENT]';
}

interface RawSession {
  id?: unknown;
  title?: unknown;
  last_active?: unknown;
  started_at?: unknown;
}

/** The most recent cron sessions, newest first. */
export function recentRuns(raw: RawSession[], limit = RESULTS_LIMIT): { sessionId: string; name: string; at: number }[] {
  return raw
    .filter((s) => typeof s.id === 'string')
    .map((s) => ({
      sessionId: s.id as string,
      name: routineNameOf(s.title),
      at: typeof s.last_active === 'number' ? s.last_active : typeof s.started_at === 'number' ? s.started_at : 0,
    }))
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}

export class RoutineResults {
  constructor(private readonly client: HermesClient) {}

  /** The latest runs that said something, oldest first (the newest is last, at the bottom). */
  async load(limit = RESULTS_LIMIT): Promise<RoutineResult[]> {
    const res = await this.client.call('/api/sessions?source=cron&limit=100');
    if (!res.ok) throw new HermesError(`Couldn't load the routine results: HTTP ${res.status}`, res.status);
    const body = (await res.json()) as { data?: RawSession[] };
    const runs = recentRuns(body.data ?? [], limit);
    const found = await Promise.all(
      runs.map(async (run): Promise<RoutineResult | null> => {
        const messages = await this.client.messages(run.sessionId);
        const text = messages.filter((m) => m.role === 'assistant').at(-1)?.content ?? '';
        return isSilent(text) ? null : { ...run, text };
      }),
    );
    return found.filter((r): r is RoutineResult => !!r).sort((a, b) => a.at - b.at);
  }
}
