// Client for one bot (= one Hermes profile) on the Hermes API server.
// Plain TypeScript with an injectable fetch, so it runs in the app (expo/fetch,
// which can stream) and in Node tests and scripts (global fetch).
import { parseModelOptions, type ModelCatalog, type ModelChoice } from './models';
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
}

export type ChatEvent =
  | { type: 'started'; runId: string }
  | { type: 'delta'; text: string }
  | { type: 'tool'; phase: 'started' | 'completed' | 'failed'; name: string; preview: string | null }
  | { type: 'thinking' }
  | { type: 'completed'; content: string }
  | { type: 'finished'; status: 'completed' | 'cancelled' | 'failed' }
  | { type: 'error'; message: string };

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

export function normalizeUrl(url: string): string {
  let u = url.trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

export function botBase(conn: BotConnection): string {
  const base = normalizeUrl(conn.url);
  return conn.bot === 'default' ? base : `${base}/p/${encodeURIComponent(conn.bot)}`;
}

/** The one ongoing chat per bot lives in this Hermes session. */
export function chatSessionId(bot: string): string {
  return `dork-bot-${bot}`;
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
      throw new HermesError(`Can't reach Hermes at ${normalizeUrl(this.conn.url)}: ${errMessage(err)}`);
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

  /** Creates the bot's chat session if it doesn't exist yet. */
  async ensureSession(id: string, title: string): Promise<void> {
    const create = (body: Record<string, string>) =>
      this.request('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    let res = await create({ id, title, source: 'dork-bot' });
    // Hermes titles are unique per profile. If another session already has
    // this one, create the chat without a title rather than fail.
    if (res.status === 400 && (await safeText(res)).includes('invalid_title')) {
      res = await create({ id, source: 'dork-bot' });
    }
    if (res.status === 201 || res.status === 200 || res.status === 409) return;
    throw new HermesError(`Couldn't create the chat: HTTP ${res.status} ${await safeText(res)}`, res.status);
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
    message: string,
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
    const res = await this.request(`/v1/runs/${encodeURIComponent(runId)}`);
    if (res.status === 404) return 'gone';
    if (!res.ok) throw new HermesError(`Couldn't check the reply: HTTP ${res.status}`, res.status);
    const body = (await res.json()) as { status?: unknown };
    return typeof body.status === 'string' ? body.status : 'running';
  }

  async stop(runId: string): Promise<void> {
    await this.request(`/v1/runs/${encodeURIComponent(runId)}/stop`, { method: 'POST' });
  }
}

interface RawMessage {
  id?: string | number;
  role?: string;
  content?: unknown;
  tool_name?: string | null;
}

export function toChatMessages(raw: RawMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  raw.forEach((m, i) => {
    const content = typeof m.content === 'string' ? m.content : '';
    const id = String(m.id ?? i);
    if (m.role === 'user' && content) out.push({ id, role: 'user', content });
    else if (m.role === 'assistant' && content.trim()) out.push({ id, role: 'assistant', content: content.trim() });
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
