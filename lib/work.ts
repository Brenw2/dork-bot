// A bot's Work: the Hermes sessions it runs that the app didn't start. A terminal run
// (`hermes -p <bot> chat -q`, source "oneshot"/"cli"), another bot or app calling its API server,
// anything else that isn't one of the app's own chats (lib/chats.ts isBotChat) or a routine run
// (source "cron", those have Routine results, lib/routineResults.ts).
// Everything comes from the session list and history the app already reads (GET /api/sessions,
// GET /api/sessions/<id>/messages); no state.db, no Hermes patches. Measured on b-lab 2026-11-12,
// a row has: id, source, user_id ("uid:1000", the OS user, not who asked), title (Hermes names it
// after the first reply), preview, started_at, ended_at, end_reason, last_active, message_count,
// parent_session_id, hidden, archived, is_internal_child. Hermes does NOT say who started a session
// (Chief, another bot or the terminal all look like source "oneshot"), so "started by" shows the
// source only.
// Plain TypeScript with injected effects, so it's unit-tested in Node.
import { cleanPreview, isBotChat } from './chats';
import { STALE_S } from './busy';

export type WorkStatus = 'working' | 'done' | 'failed';

export interface WorkSession {
  id: string;
  /** Hermes's title, else how the task starts. */
  title: string;
  source: string;
  /** What Hermes records about who started it, in words; null when it says nothing useful. */
  startedBy: string | null;
  startedAt: number;
  endedAt: number | null;
  lastActive: number;
  messageCount: number;
  endReason: string | null;
  /** Not ended, and untouched for STALE_S: the process is gone, or it is a chat left open. */
  stale: boolean;
}

export interface WorkItem extends WorkSession {
  status: WorkStatus;
  /** One line: the last thing the bot said in it. Empty when it hasn't said anything yet. */
  outcome: string;
}

const NOT_WORK_SOURCES = new Set(['cron', 'dork-bot']);
const TITLE_CHARS = 70;

/** A session end reason that means it did not finish its job. */
const FAILED_REASON = /error|fail|crash|timeout|timed.?out|abort|kill|interrupt|exception/i;

/** "Terminal", "Telegram"…: the source in words. Null for a source Hermes doesn't describe. */
export function startedByLabel(source: string): string | null {
  switch (source) {
    case 'oneshot':
    case 'cli':
    case 'tui':
      return 'Terminal';
    case 'api_server':
      return 'Another app or bot';
    case '':
      return null;
    default:
      return source.charAt(0).toUpperCase() + source.slice(1);
  }
}

/** The title Hermes gave it, else the start of the task, cut to fit a row. */
export function workTitle(title: unknown, preview: unknown): string {
  const t = typeof title === 'string' ? title.trim() : '';
  const fromPreview = cleanPreview(typeof preview === 'string' ? preview : '');
  const text = t || fromPreview;
  if (!text) return 'Untitled work';
  return text.length > TITLE_CHARS ? `${text.slice(0, TITLE_CHARS - 1).trimEnd()}…` : text;
}

/** This bot's non-app, non-routine sessions with something in them, newest first. Malformed rows are skipped. */
export function toWorkSessions(bot: string, raw: unknown, nowS: number): WorkSession[] {
  if (!Array.isArray(raw)) return [];
  const out: WorkSession[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    const s = parseWorkRow(bot, r, nowS);
    if (s) out.push(s);
  }
  return out.sort((a, b) => b.startedAt - a.startedAt || b.lastActive - a.lastActive);
}

/** One row of the session list as Work, or null when it isn't (an app chat, a routine run, a sub-session, empty…). */
export function parseWorkRow(bot: string, r: unknown, nowS: number): WorkSession | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id || isBotChat(bot, o.id)) return null;
  const source = typeof o.source === 'string' ? o.source : '';
  if (NOT_WORK_SOURCES.has(source)) return null;
  if (o.hidden === true || o.archived === true || o.is_internal_child === true) return null;
  if (typeof o.parent_session_id === 'string' && o.parent_session_id) return null; // a sub-session of other work
  const messageCount = typeof o.message_count === 'number' ? o.message_count : 0;
  if (messageCount <= 0) return null;
  const startedAt = typeof o.started_at === 'number' ? o.started_at : typeof o.last_active === 'number' ? o.last_active : 0;
  const lastActive = typeof o.last_active === 'number' ? o.last_active : startedAt;
  const endedAt = typeof o.ended_at === 'number' ? o.ended_at : null;
  return {
    id: o.id,
    title: workTitle(o.title, o.preview),
    source,
    startedBy: startedByLabel(source),
    startedAt,
    endedAt,
    lastActive,
    messageCount,
    endReason: typeof o.end_reason === 'string' && o.end_reason ? o.end_reason : null,
    stale: endedAt === null && nowS - lastActive > STALE_S,
  };
}

/**
 * working / done / failed. Hermes marks a session ended (ended_at) when its run finishes; a session
 * with no end that nothing has touched for STALE_S is not running: if it stopped after the bot's own
 * reply it is a chat left open (done), otherwise the process died mid-way (failed).
 */
export function workStatus(s: Pick<WorkSession, 'endedAt' | 'endReason' | 'stale'>, lastRole: string | null): WorkStatus {
  if (s.endedAt !== null) return s.endReason && FAILED_REASON.test(s.endReason) ? 'failed' : 'done';
  if (!s.stale) return 'working';
  return lastRole === 'assistant' ? 'done' : 'failed';
}

/** Who spoke last in the raw history (ignoring Hermes's session_meta rows). */
export function lastRoleOf(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  for (let i = raw.length - 1; i >= 0; i--) {
    const role = (raw[i] as { role?: unknown } | null)?.role;
    if (typeof role === 'string' && role !== 'session_meta') return role;
  }
  return null;
}

/** The outcome line: the last assistant message with text, on one line without markdown marks. */
export function outcomeOf(raw: unknown, limit = 160): string {
  if (!Array.isArray(raw)) return '';
  for (let i = raw.length - 1; i >= 0; i--) {
    const m = raw[i] as { role?: unknown; content?: unknown } | null;
    if (m?.role !== 'assistant' || typeof m.content !== 'string') continue;
    const line = oneLine(m.content, limit);
    if (line) return line;
  }
  return '';
}

/** Text on one line: picture markers, code fences and markdown marks dropped, cut with "…". */
export function oneLine(text: string, limit: number): string {
  const t = cleanPreview(text)
    .replace(/```[^\s]*/g, '')
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > limit ? `${t.slice(0, limit - 1).trimEnd()}…` : t;
}

/** The session that is running right now, newest first; null when the bot has none. */
export function runningWork(items: Pick<WorkItem, 'status'>[]): WorkItem | null {
  return (items as WorkItem[]).find((i) => i.status === 'working') ?? null;
}

export interface WorkDeps {
  /** GET /api/sessions rows, newest first. */
  sessions: () => Promise<unknown>;
  /** GET /api/sessions/<id>/messages rows. */
  messages: (id: string) => Promise<unknown>;
  now: () => number;
}

/** How many sessions get an outcome line (one history request each, only when they changed). */
export const OUTCOME_LIMIT = 15;

/** A bot's Work list, rebuilt from Hermes on each load. Outcomes are cached per session until it changes. */
export class WorkList {
  private cache = new Map<string, { key: string; outcome: string; lastRole: string | null }>();

  constructor(
    private readonly bot: string,
    private readonly deps: WorkDeps,
  ) {}

  async load(): Promise<WorkItem[]> {
    const nowS = this.deps.now() / 1000;
    const sessions = toWorkSessions(this.bot, await this.deps.sessions(), nowS);
    return Promise.all(
      sessions.map(async (s, i): Promise<WorkItem> => {
        if (i >= OUTCOME_LIMIT) return { ...s, status: workStatus(s, null), outcome: '' };
        const key = `${s.messageCount}:${s.endedAt ?? ''}`;
        let hit = this.cache.get(s.id);
        if (hit?.key !== key) {
          try {
            const raw = await this.deps.messages(s.id);
            hit = { key, outcome: outcomeOf(raw), lastRole: lastRoleOf(raw) };
            this.cache.set(s.id, hit);
          } catch {
            hit = hit ?? { key: '', outcome: '', lastRole: null }; // couldn't read it now: try again next time
          }
        }
        return { ...s, status: workStatus(s, hit.lastRole), outcome: hit.outcome };
      }),
    );
  }
}

export interface WorkSessionDeps {
  /** GET /api/sessions/<id>: the row, or null when it's gone. */
  row: () => Promise<unknown>;
  messages: () => Promise<unknown>;
  now: () => number;
}

/** One work session opened read-only: its row now, and its messages whenever they changed. */
export class WorkSessionView {
  private key = '';
  private raw: unknown[] = [];
  private lastRole: string | null = null;

  constructor(
    private readonly bot: string,
    private readonly deps: WorkSessionDeps,
  ) {}

  /** The session's state and raw messages; null when it isn't Work (gone, or an app chat). The history is only fetched again when the session changed. */
  async load(): Promise<{ item: WorkItem; raw: unknown[]; changed: boolean } | null> {
    const s = parseWorkRow(this.bot, await this.deps.row(), this.deps.now() / 1000);
    if (!s) return null;
    const key = `${s.messageCount}:${s.endedAt ?? ''}`;
    const changed = key !== this.key;
    if (changed) {
      const raw = await this.deps.messages();
      this.raw = Array.isArray(raw) ? raw : [];
      this.lastRole = lastRoleOf(this.raw);
      this.key = key;
    }
    return { item: { ...s, status: workStatus(s, this.lastRole), outcome: outcomeOf(this.raw) }, raw: this.raw, changed };
  }
}

/** How often an open work session that is still running is looked at again. */
export const SESSION_POLL_MS = 3000;

/** "Working", "Done", "Failed" for a row. */
export function statusLabel(status: WorkStatus): string {
  return status === 'working' ? 'Working' : status === 'done' ? 'Done' : 'Failed';
}

/** "Working on: <title>" under the bot's name. */
export function workingOnLine(title: string): string {
  return `Working on: ${title}`;
}
