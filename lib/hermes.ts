// Client for one bot (= one Hermes profile) on the Hermes API server.
// Plain TypeScript with an injectable fetch, so it runs in the app (expo/fetch,
// which can stream) and in Node tests and scripts (global fetch).
import { splitStoredImages, type ContentPart } from './attachments';
import { parseSessionRows, turnPending, type SessionRow } from './busy';
import { firstChatId, toChatSummaries, type ChatSummary } from './chats';
import { parseModelOptions, type ModelCatalog, type ModelChoice } from './models';
import { parseRoutineNote, type RoutineNote } from './routineNotes';
import { SseParser } from './sse';

export interface BotConnection {
  /** Hermes API server base URL, e.g. https://b-lab.tail7e27a7.ts.net */
  url: string;
  /** Hermes profile name. "default" means the root profile (no /p/ prefix). */
  bot: string;
  /** That profile's own API_SERVER_KEY. */
  key: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  /** When Hermes saved it (seconds since epoch). Unset for messages this device hasn't reloaded yet. */
  at?: number;
  /** Pictures sent with it, as files on Hermes (load with HermesManager.image). */
  images?: string[];
  /** Pictures this device just sent, as data URLs, until the history reloads. */
  localImages?: string[];
  /** Set when this is a routine's result added to the chat (a "Notify me" routine): drawn as a card from the bot. */
  routine?: RoutineNote;
}

export type ChatEvent =
  | { type: 'started'; runId: string }
  | { type: 'delta'; text: string }
  | { type: 'tool'; phase: 'started' | 'completed' | 'failed'; name: string; preview: string | null }
  | { type: 'thinking' }
  | { type: 'approval'; request: ApprovalRequest }
  | { type: 'completed'; content: string }
  | { type: 'finished'; status: 'completed' | 'cancelled' | 'failed' }
  | { type: 'error'; message: string };

/**
 * Hermes stopped a reply to ask before running a risky command (approvals.mode smart/manual).
 * Answer with HermesClient.approve; unanswered, Hermes denies it after approvals.timeout (300 s).
 */
export interface ApprovalRequest {
  requestId?: string;
  /** The command, with secrets redacted by Hermes. */
  command: string;
  /** Why it was flagged ("recursive delete", …). */
  description: string;
  /** What Hermes accepts: once, session, always, deny (smart denials only allow once/deny). */
  choices: ApprovalChoice[];
}
export type ApprovalChoice = 'once' | 'session' | 'always' | 'deny';

export function toApproval(p: unknown): ApprovalRequest | null {
  if (!p || typeof p !== 'object') return null;
  const r = p as Record<string, unknown>;
  const command = typeof r.command === 'string' ? r.command : '';
  const description = typeof r.description === 'string' ? r.description : '';
  if (!command && !description) return null;
  const all: ApprovalChoice[] = ['once', 'session', 'always', 'deny'];
  const choices = Array.isArray(r.choices) ? all.filter((c) => (r.choices as unknown[]).includes(c)) : ['once' as const, 'deny' as const];
  const id = typeof r.request_id === 'string' && r.request_id ? r.request_id : typeof r.prompt_id === 'string' && r.prompt_id ? r.prompt_id : null;
  return {
    ...(id ? { requestId: id } : {}),
    command,
    description,
    choices: choices.length ? choices : ['once', 'deny'],
  };
}

export class HermesError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'HermesError';
  }
}

// Only the parts of fetch/Response we use, so expo/fetch and the global fetch both fit.
export interface FetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
  body: ReadableStream<Uint8Array> | null;
}
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<FetchResponse>;

/** What the app says when b-lab doesn't answer at all (no network, Tailscale off, b-lab asleep). */
export const UNREACHABLE = "Can't reach b-lab. Check that Tailscale is on and b-lab is awake; this retries by itself.";

export function normalizeUrl(url: string): string {
  let u = url.trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

export function botBase(conn: BotConnection): string {
  const base = normalizeUrl(conn.url);
  return conn.bot === 'default' ? base : `${base}/p/${encodeURIComponent(conn.bot)}`;
}

/** The chat every bot started with. Bots can have more now: see lib/chats.ts. */
export function chatSessionId(bot: string): string {
  return firstChatId(bot);
}

export class HermesClient {
  constructor(
    readonly conn: BotConnection,
    private readonly fetchImpl: FetchLike,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.conn.key}`, ...extra };
  }

  private async request(path: string, init: Parameters<FetchLike>[1] = {}): Promise<FetchResponse> {
    let res: FetchResponse;
    try {
      // Called unbound: the browser's fetch throws "Illegal invocation" when called as a method.
      const fetchImpl = this.fetchImpl;
      res = await fetchImpl(`${botBase(this.conn)}${path}`, {
        ...init,
        headers: this.headers(init.headers),
      });
    } catch (err) {
      throw new HermesError(`${UNREACHABLE} (${errMessage(err)})`);
    }
    if (res.status === 401) throw new HermesError(`The key for "${this.conn.bot}" was rejected (401).`, 401);
    return res;
  }

  /** Proves the server is up and the key works for this bot. */
  async check(): Promise<void> {
    const res = await this.request('/api/sessions?limit=1');
    if (res.status === 404) throw new HermesError(`No bot "${this.conn.bot}" on this Hermes (404).`, 404);
    if (!res.ok) throw new HermesError(`Hermes answered HTTP ${res.status}: ${await safeText(res)}`, res.status);
  }

  /** Creates the chat's Hermes session if it doesn't exist yet. Without a title, Hermes names it after the first reply. */
  async ensureSession(id: string, title?: string): Promise<void> {
    const create = (body: Record<string, string>) =>
      this.request('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    let res = await create(title ? { id, title, source: 'dork-bot' } : { id, source: 'dork-bot' });
    // Hermes titles are unique per profile. If another session already has
    // this one, create the chat without a title rather than fail.
    if (title && res.status === 400 && (await safeText(res)).includes('invalid_title')) {
      res = await create({ id, source: 'dork-bot' });
    }
    if (res.status === 201 || res.status === 200 || res.status === 409) return;
    throw new HermesError(`Couldn't create the chat: HTTP ${res.status} ${await safeText(res)}`, res.status);
  }

  /** This bot's chats, most recently used first (empty ones left out). */
  async listChats(): Promise<ChatSummary[]> {
    const res = await this.request('/api/sessions?source=api_server&limit=200');
    if (!res.ok) throw new HermesError(`Couldn't list the chats: HTTP ${res.status}`, res.status);
    const body = (await res.json()) as { data?: Parameters<typeof toChatSummaries>[1] };
    return toChatSummaries(this.conn.bot, body.data ?? []);
  }

  /** The newest sessions of every kind (chats, terminal runs, routines), for lib/busy.ts. */
  async recentSessions(limit = 8): Promise<SessionRow[]> {
    const res = await this.request(`/api/sessions?limit=${limit}`);
    if (!res.ok) throw new HermesError(`Couldn't list the sessions: HTTP ${res.status}`, res.status);
    return parseSessionRows(((await res.json()) as { data?: unknown }).data);
  }

  /** Whether this chat's saved messages end mid-turn, i.e. a reply is still being worked on (lib/busy.ts). */
  async turnPending(id: string): Promise<boolean> {
    const res = await this.request(`/api/sessions/${encodeURIComponent(id)}/messages`);
    if (res.status === 404) return false;
    if (!res.ok) throw new HermesError(`Couldn't load the chat: HTTP ${res.status}`, res.status);
    return turnPending(((await res.json()) as { data?: unknown }).data, Date.now() / 1000);
  }

  /** Renames a chat. An empty title clears it (Hermes titles it again by itself). */
  async renameChat(id: string, title: string): Promise<void> {
    const res = await this.request(`/api/sessions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim() || null }),
    });
    if (res.status === 400) throw new HermesError(`Couldn't rename the chat: ${await errorText(res)}`, 400);
    if (!res.ok) throw new HermesError(`Couldn't rename the chat: HTTP ${res.status}`, res.status);
  }

  /** Deletes a chat and its history on Hermes. Refused (409) while a reply is still running in it. */
  async deleteChat(id: string): Promise<void> {
    const res = await this.request(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.status === 404) return;
    if (res.status === 409) throw new HermesError('A reply is still running in that chat. Stop it first.', 409);
    if (!res.ok) throw new HermesError(`Couldn't delete the chat: HTTP ${res.status}`, res.status);
  }

  async messages(id: string): Promise<ChatMessage[]> {
    const res = await this.request(`/api/sessions/${encodeURIComponent(id)}/messages`);
    if (res.status === 404) return [];
    if (!res.ok) throw new HermesError(`Couldn't load the chat: HTTP ${res.status}`, res.status);
    const body = (await res.json()) as { data?: RawMessage[] };
    return toChatMessages(body.data ?? []);
  }

  /**
   * Sends one message and streams the reply. `instructions` is a system note for this turn only
   * (Hermes's ephemeral `system_message`): it isn't saved in the chat's history.
   */
  async chat(
    id: string,
    message: string | ContentPart[],
    onEvent: (e: ChatEvent) => void,
    signal?: AbortSignal,
    opts: { instructions?: string } = {},
  ): Promise<void> {
    const res = await this.request(`/api/sessions/${encodeURIComponent(id)}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(opts.instructions ? { message, system_message: opts.instructions } : { message }),
      signal,
    });
    if (!res.ok || !res.body) {
      throw new HermesError(`Chat failed: HTTP ${res.status} ${await safeText(res)}`, res.status);
    }
    const parser = new SseParser();
    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const ev of parser.push(decoder.decode(value, { stream: true }))) {
        const mapped = mapEvent(ev.event, ev.data);
        if (mapped) onEvent(mapped);
      }
    }
  }

  /** Every model this bot can use (Hermes's own model picker list). Can take a few seconds. */
  async modelOptions(): Promise<ModelCatalog> {
    const res = await this.request('/api/model/options?include_unconfigured=false');
    if (!res.ok) throw new HermesError(`Couldn't list models: HTTP ${res.status} ${await safeText(res)}`, res.status);
    return parseModelOptions(await res.json());
  }

  /** The model name the chat is on (Hermes doesn't say which provider). Null for a chat that doesn't exist yet. */
  async sessionModel(id: string): Promise<string | null> {
    const res = await this.request(`/api/sessions/${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new HermesError(`Couldn't read the chat: HTTP ${res.status}`, res.status);
    const body = (await res.json()) as { session?: { model?: unknown } };
    return typeof body.session?.model === 'string' && body.session.model ? body.session.model : null;
  }

  /**
   * How many messages the chat has: a cheap way to see that another device (or a routine) added
   * to it, without downloading the whole history. Null for a chat that doesn't exist yet.
   */
  async messageCount(id: string): Promise<number | null> {
    const res = await this.request(`/api/sessions/${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new HermesError(`Couldn't read the chat: HTTP ${res.status}`, res.status);
    const body = (await res.json()) as { session?: { message_count?: unknown } };
    return typeof body.session?.message_count === 'number' ? body.session.message_count : null;
  }

  /**
   * Locks the chat to a model; the next message uses it. Pass the lock's provider id
   * (models.lockProvider), and normally use models.switchModel, which sets the bot first.
   */
  async setModel(id: string, choice: ModelChoice): Promise<void> {
    const res = await this.request(`/api/sessions/${encodeURIComponent(id)}/model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: choice.model, provider: choice.provider }),
    });
    if (!res.ok) throw new HermesError(`Couldn't switch to ${choice.model}: HTTP ${res.status} ${await safeText(res)}`, res.status);
  }

  /**
   * Where a run is: running, completed, failed, cancelled, interrupted, or 'gone' when Hermes no
   * longer knows it (restarted, or too old). The run keeps going on Hermes when the app hangs up,
   * so a chat that was left or backgrounded mid-reply checks this until it's done.
   */
  async runStatus(runId: string): Promise<string> {
    return (await this.runInfo(runId)).status;
  }

  /** The run's status, plus what it's asking when it's waiting for an approval. */
  async runInfo(runId: string): Promise<{ status: string; approval: ApprovalRequest | null; generation?: number }> {
    const res = await this.request(`/v1/runs/${encodeURIComponent(runId)}`);
    if (res.status === 404) return { status: 'gone', approval: null };
    if (!res.ok) throw new HermesError(`Couldn't check the reply: HTTP ${res.status}`, res.status);
    const body = (await res.json()) as { status?: unknown; approval?: unknown; pending_controls?: unknown; execution_generation?: unknown };
    // Older gateways put the request in `approval`; with the session authority it's one of the
    // run's `pending_controls` (kind "approval"), answered with the run's execution_generation.
    const pending = Array.isArray(body.pending_controls)
      ? body.pending_controls.find((p) => (p as { kind?: unknown })?.kind === 'approval')
      : undefined;
    return {
      status: typeof body.status === 'string' ? body.status : 'running',
      approval: toApproval(body.approval) ?? toApproval(pending),
      ...(typeof body.execution_generation === 'number' ? { generation: body.execution_generation } : {}),
    };
  }

  /** Answers an approval the run is waiting on. 409 means it was already answered or timed out. */
  async approve(runId: string, choice: ApprovalChoice, requestId?: string): Promise<void> {
    const info = await this.runInfo(runId);
    const id = requestId ?? info.approval?.requestId;
    const body =
      info.generation !== undefined && id
        ? { request_id: id, execution_generation: info.generation, choice }
        : id
          ? { choice, request_id: id }
          : { choice };
    const res = await this.request(`/v1/runs/${encodeURIComponent(runId)}/approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 409 || (res.status === 400 && (await safeText(res)).includes('not_pending'))) {
      throw new HermesError('That request already ended (answered, or it timed out).', 409);
    }
    if (!res.ok) throw new HermesError(`Couldn't answer: HTTP ${res.status} ${await errorText(res)}`, res.status);
  }

  async stop(runId: string): Promise<void> {
    await this.request(`/v1/runs/${encodeURIComponent(runId)}/stop`, { method: 'POST' });
  }

  /** A plain call on the bot's API server (routines use it, lib/routines.ts). */
  async call(path: string, method = 'GET', body?: unknown): Promise<FetchResponse> {
    return this.request(path, {
      method,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
  }
}

interface RawMessage {
  id?: string | number;
  role?: string;
  content?: unknown;
  tool_name?: string | null;
  timestamp?: number | null;
}

export function toChatMessages(raw: RawMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  raw.forEach((m, i) => {
    const content = typeof m.content === 'string' ? m.content : '';
    const id = String(m.id ?? i);
    const at = typeof m.timestamp === 'number' ? { at: m.timestamp } : {};
    const note = m.role === 'user' ? parseRoutineNote(content) : null;
    if (note) {
      // A routine's result added to this chat (lib/routineNotes.ts): the bot's, not Brennan's bubble.
      out.push({ id, role: 'assistant', content: note.text, routine: note, ...at });
    } else if (m.role === 'user' && content) {
      const { text, images } = splitStoredImages(content);
      out.push({ id, role: 'user', content: text, ...at, ...(images.length ? { images } : {}) });
    }
    else if (m.role === 'assistant' && content.trim()) out.push({ id, role: 'assistant', content: content.trim(), ...at });
    else if (m.role === 'tool' && m.tool_name) out.push({ id, role: 'tool', content: '', toolName: m.tool_name });
  });
  return out;
}

export function mapEvent(event: string, data: string): ChatEvent | null {
  let p: Record<string, unknown>;
  try {
    p = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  switch (event) {
    case 'run.started':
      return { type: 'started', runId: str(p.run_id) };
    case 'assistant.delta':
      return { type: 'delta', text: str(p.delta) };
    case 'tool.started':
    case 'tool.completed':
    case 'tool.failed':
      return {
        type: 'tool',
        phase: event.slice(5) as 'started' | 'completed' | 'failed',
        name: str(p.tool_name) || 'tool',
        preview: typeof p.preview === 'string' ? p.preview : null,
      };
    case 'tool.progress':
      return { type: 'thinking' };
    case 'approval.request': {
      const request = toApproval(p);
      return request ? { type: 'approval', request } : null;
    }
    case 'assistant.completed':
      return { type: 'completed', content: str(p.content) };
    case 'run.completed':
      return { type: 'finished', status: 'completed' };
    case 'run.cancelled':
      return { type: 'finished', status: 'cancelled' };
    case 'run.failed':
      return { type: 'finished', status: 'failed' };
    case 'error': {
      const err = p.error as { message?: string } | string | undefined;
      return { type: 'error', message: typeof err === 'string' ? err : err?.message || str(p.message) || 'Hermes error' };
    }
    default:
      return null;
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function safeText(res: FetchResponse): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '';
  }
}

/** Hermes's error message from a JSON error body, else the raw text. */
async function errorText(res: FetchResponse): Promise<string> {
  const text = await safeText(res);
  try {
    const body = JSON.parse(text) as { error?: { message?: string } | string };
    return typeof body.error === 'string' ? body.error : body.error?.message || text;
  } catch {
    return text;
  }
}
