// A bot's routines: Hermes cron jobs in the bot's profile (GET/POST /p/<bot>/api/jobs). Each run
// of a routine is its own Hermes session (source "cron", titled "<name> · Nov 04 11:32"), so the
// latest result is the last reply in the newest of those sessions.
// Plain TypeScript with the bot's HermesClient, so it's unit-tested in Node.
import { HermesError, type HermesClient } from './hermes';

export interface Routine {
  id: string;
  name: string;
  prompt: string;
  /** What Hermes shows for the schedule ("0 8 * * *", "every 2h"). */
  schedule: string;
  enabled: boolean;
  /** "scheduled", "paused", "running", "completed"… */
  state: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  /** "ok" or "error" after a run. */
  lastStatus: string | null;
  lastError: string | null;
}

export interface RoutineRun {
  sessionId: string;
  /** Seconds since epoch. */
  at: number;
  /** The run's final reply (empty when it didn't write one). */
  text: string;
}

/** Ready-made schedules (Hermes takes cron expressions, "every 2h", "30m" or an ISO time). */
export const SCHEDULES: { label: string; value: string }[] = [
  { label: 'Every morning at 8', value: '0 8 * * *' },
  { label: 'Weekdays at 9', value: '0 9 * * 1-5' },
  { label: 'Every evening at 6', value: '0 18 * * *' },
  { label: 'Every hour', value: 'every 1h' },
  { label: 'Mondays at 9', value: '0 9 * * 1' },
];

/** "Every morning at 8" for a schedule we offer, else Hermes's own text. */
export function scheduleLabel(schedule: string): string {
  return SCHEDULES.find((s) => s.value === schedule)?.label ?? schedule;
}

export function toRoutine(raw: unknown): Routine | null {
  if (!raw || typeof raw !== 'object') return null;
  const j = raw as Record<string, unknown>;
  if (typeof j.id !== 'string') return null;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  const sched = j.schedule as { display?: unknown; expr?: unknown } | undefined;
  return {
    id: j.id,
    name: str(j.name) ?? j.id,
    prompt: str(j.prompt) ?? '',
    schedule: str(j.schedule_display) ?? str(sched?.display) ?? str(sched?.expr) ?? '',
    enabled: j.enabled !== false,
    state: str(j.state) ?? (j.enabled === false ? 'paused' : 'scheduled'),
    nextRunAt: str(j.next_run_at),
    lastRunAt: str(j.last_run_at),
    lastStatus: str(j.last_status),
    lastError: str(j.last_error),
  };
}

async function errorOf(res: { status: number; text(): Promise<string> }, what: string): Promise<HermesError> {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const body = JSON.parse(text) as { error?: unknown; message?: unknown };
      detail = typeof body.error === 'string' ? body.error : typeof body.message === 'string' ? body.message : text;
    } catch {
      detail = text;
    }
  } catch {
    // no body
  }
  return new HermesError(`${what}: ${detail.slice(0, 200) || `HTTP ${res.status}`}`, res.status);
}

export class Routines {
  constructor(private readonly client: HermesClient) {}

  async list(): Promise<Routine[]> {
    const res = await this.client.call('/api/jobs?include_disabled=true');
    if (!res.ok) throw await errorOf(res, "Couldn't load the routines");
    const body = (await res.json()) as { jobs?: unknown[] };
    return (body.jobs ?? []).map(toRoutine).filter((r): r is Routine => !!r);
  }

  async create(r: { name: string; prompt: string; schedule: string }): Promise<Routine> {
    const name = r.name.trim();
    const prompt = r.prompt.trim();
    const schedule = r.schedule.trim();
    if (!name) throw new HermesError('Give the routine a name.');
    if (!prompt) throw new HermesError('Say what the bot should do.');
    if (!schedule) throw new HermesError('Pick when it runs.');
    const res = await this.client.call('/api/jobs', 'POST', { name, prompt, schedule });
    if (!res.ok) throw await errorOf(res, "Couldn't add the routine");
    const job = toRoutine(((await res.json()) as { job?: unknown }).job);
    if (!job) throw new HermesError('Hermes added the routine but sent back nothing readable.');
    return job;
  }

  async update(id: string, patch: Partial<{ name: string; prompt: string; schedule: string }>): Promise<void> {
    const res = await this.client.call(`/api/jobs/${encodeURIComponent(id)}`, 'PATCH', patch);
    if (!res.ok) throw await errorOf(res, "Couldn't save the routine");
  }

  async pause(id: string): Promise<void> {
    const res = await this.client.call(`/api/jobs/${encodeURIComponent(id)}/pause`, 'POST');
    if (!res.ok) throw await errorOf(res, "Couldn't pause it");
  }

  async resume(id: string): Promise<void> {
    const res = await this.client.call(`/api/jobs/${encodeURIComponent(id)}/resume`, 'POST');
    if (!res.ok) throw await errorOf(res, "Couldn't turn it back on");
  }

  /** Runs it now (in the background on Hermes); the result shows up as a new run. */
  async runNow(id: string): Promise<void> {
    const res = await this.client.call(`/api/jobs/${encodeURIComponent(id)}/run`, 'POST');
    if (!res.ok) throw await errorOf(res, "Couldn't start it");
  }

  async remove(id: string): Promise<void> {
    const res = await this.client.call(`/api/jobs/${encodeURIComponent(id)}`, 'DELETE');
    if (res.status === 404) return;
    if (!res.ok) throw await errorOf(res, "Couldn't delete it");
  }

  /** The routine's recent runs, newest first (each run is a "cron" session titled after it). */
  async runs(name: string, limit = 5): Promise<{ sessionId: string; at: number }[]> {
    const res = await this.client.call('/api/sessions?source=cron&limit=100');
    if (!res.ok) throw await errorOf(res, "Couldn't load its runs");
    const body = (await res.json()) as { data?: { id?: unknown; title?: unknown; last_active?: unknown; started_at?: unknown }[] };
    return runsOf(name, body.data ?? []).slice(0, limit);
  }

  /** What a run said in the end. */
  async result(sessionId: string): Promise<string> {
    const messages = await this.client.messages(sessionId);
    return messages.filter((m) => m.role === 'assistant').at(-1)?.content ?? '';
  }
}

/** Cron sessions that are runs of this routine ("<name> · Nov 04 11:32"), newest first. */
export function runsOf(name: string, sessions: { id?: unknown; title?: unknown; last_active?: unknown; started_at?: unknown }[]) {
  return sessions
    .filter((s) => typeof s.id === 'string' && typeof s.title === 'string' && (s.title === name || s.title.startsWith(`${name} · `)))
    .map((s) => ({
      sessionId: s.id as string,
      at: typeof s.last_active === 'number' ? s.last_active : typeof s.started_at === 'number' ? s.started_at : 0,
    }))
    .sort((a, b) => b.at - a.at);
}

/** "Tomorrow 8:00 AM", "Today 6:00 PM", "Nov 9, 9:00 AM". */
export function whenLabel(iso: string | null, now = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((day(d) - day(now)) / 86_400_000);
  if (diffDays === 0) return `Today ${time}`;
  if (diffDays === 1) return `Tomorrow ${time}`;
  if (diffDays === -1) return `Yesterday ${time}`;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`;
}
