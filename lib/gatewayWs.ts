// SPIKE (card 14): a minimal client for `hermes serve`'s /api/ws JSON-RPC session gateway, the same
// socket the Hermes desktop uses. Not wired into the app. Plain TypeScript with an injectable
// WebSocket constructor (the app's and Node's global WebSocket both fit).
//
// Wire (tui_gateway/ws.py, tui_gateway/contracts/): newline-free JSON-RPC 2.0 text frames.
//  - client -> server: {id, method, params}; reply {id, result|error}
//  - server -> client events: {method: 'event', params: {type, session_id, payload}}
//  - server -> client REQUESTS (sudo, secret, approval, clarify): {id: 'srq-…', method, params}; the
//    client answers with {jsonrpc, id, result: {value}} (sudo/secret) or {result: {choice}} (approval).
//    Only sent to a connection that said `client.capabilities {server_requests: true}`.
//
// Secrets: a sudo/secret answer is produced by a callback, sent once, and never stored, logged or
// put in an Error here. `describeFrame` is the only thing meant for logs and it redacts `value`.

export interface WsLike {
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}
export type WsCtor = new (url: string) => WsLike;

/** `ws(s)://<serve>/api/ws?token=<access token>` (the gate accepts a native bearer token as `?token=`). */
export function gatewayWsUrl(adminUrl: string, accessToken: string): string {
  const base = adminUrl.trim().replace(/\/+$/, '').replace(/^http/i, 'ws');
  return `${base}/api/ws?token=${encodeURIComponent(accessToken)}`;
}

export interface GatewayEvent {
  type: string;
  session_id?: string;
  payload?: Record<string, unknown>;
}

/** A server->client question the user has to answer. */
export type PrivateRequest =
  | { kind: 'sudo'; id: string; sessionId: string; command: string }
  | { kind: 'secret'; id: string; sessionId: string; envVar: string; prompt: string }
  | { kind: 'approval'; id: string; sessionId: string; command: string; description: string; choices: string[]; requestId: string }
  | { kind: 'other'; id: string; method: string };

/** Parses a server->client request frame (null when the frame isn't one). Never reads a `value`. */
export function parseServerRequest(frame: unknown): PrivateRequest | null {
  if (!frame || typeof frame !== 'object') return null;
  const f = frame as Record<string, unknown>;
  if (typeof f.id !== 'string' || !f.id.startsWith('srq-') || typeof f.method !== 'string') return null;
  const p = (f.params && typeof f.params === 'object' ? f.params : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const sessionId = str(p.session_id);
  if (f.method === 'sudo') return { kind: 'sudo', id: f.id, sessionId, command: str(p.command) };
  if (f.method === 'secret') return { kind: 'secret', id: f.id, sessionId, envVar: str(p.env_var), prompt: str(p.prompt) };
  if (f.method === 'approval') {
    return {
      kind: 'approval',
      id: f.id,
      sessionId,
      command: str(p.command),
      description: str(p.description),
      choices: Array.isArray(p.choices) ? p.choices.filter((c): c is string => typeof c === 'string') : [],
      requestId: str(p.request_id),
    };
  }
  return { kind: 'other', id: f.id, method: f.method };
}

/** A frame as a log line, with every `value` (a typed password) blanked. */
export function describeFrame(raw: string): string {
  return raw.replace(/("value"\s*:\s*)"(?:[^"\\]|\\.)*"/g, '$1"<hidden>"').slice(0, 300);
}

export class GatewayError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
    this.name = 'GatewayError';
  }
}

/** What answers a request: a string for sudo/secret ('' = skip), a choice for approvals. */
export type RequestAnswer = { value: string } | { choice: string };

export class GatewaySocket {
  private ws: WsLike | null = null;
  private next = 1;
  private readonly pending = new Map<number, { resolve: (r: unknown) => void; reject: (e: Error) => void }>();
  private closed = false;

  constructor(
    private readonly url: string,
    private readonly Ctor: WsCtor,
    private readonly handlers: {
      onEvent?: (e: GatewayEvent) => void;
      /** Answer a server request. The returned value is sent once and not kept. */
      onRequest?: (r: PrivateRequest) => Promise<RequestAnswer>;
      onClose?: (code?: number) => void;
    } = {},
  ) {}

  /** Opens the socket and waits for `gateway.ready`. */
  open(timeoutMs = 15_000): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new this.Ctor(this.url);
      this.ws = ws;
      const timer = setTimeout(() => reject(new GatewayError('gateway.ready timed out')), timeoutMs);
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new GatewayError("Can't open the Hermes session socket."));
      };
      ws.onclose = (ev) => {
        clearTimeout(timer);
        this.closed = true;
        for (const p of this.pending.values()) p.reject(new GatewayError('socket closed', ev.code));
        this.pending.clear();
        this.handlers.onClose?.(ev.code);
        reject(new GatewayError(`socket closed before ready (${ev.code ?? '?'})`, ev.code));
      };
      ws.onmessage = (ev) => {
        const frame = this.parse(ev.data);
        if (frame?.method === 'event' && (frame.params as GatewayEvent | undefined)?.type === 'gateway.ready') {
          clearTimeout(timer);
          ws.onmessage = (m) => this.onMessage(m.data);
          resolve();
        }
      };
    }).then(() =>
      // Without this the server never sends sudo/secret/approval requests (it fails them fast).
      this.call('client.capabilities', { server_requests: true }).then(() => undefined),
    );
  }

  private parse(data: unknown): Record<string, unknown> | null {
    try {
      const v = JSON.parse(typeof data === 'string' ? data : String(data));
      return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  private onMessage(data: unknown) {
    const frame = this.parse(data);
    if (!frame) return;
    const req = parseServerRequest(frame);
    if (req) {
      void this.answer(req);
      return;
    }
    if (typeof frame.id === 'number' && this.pending.has(frame.id)) {
      const p = this.pending.get(frame.id)!;
      this.pending.delete(frame.id);
      if (frame.error && typeof frame.error === 'object') {
        const e = frame.error as { message?: string; code?: number };
        p.reject(new GatewayError(e.message ?? 'request failed', e.code));
      } else p.resolve(frame.result);
      return;
    }
    if (frame.method === 'event' && frame.params) this.handlers.onEvent?.(frame.params as GatewayEvent);
  }

  private async answer(req: PrivateRequest) {
    let result: RequestAnswer = req.kind === 'approval' ? { choice: 'deny' } : { value: '' }; // no handler = skip/deny
    try {
      if (this.handlers.onRequest) result = await this.handlers.onRequest(req);
    } catch {
      // keep the safe default; never put the error (or answer) in a log
    }
    this.sendRaw({ jsonrpc: '2.0', id: req.id, result });
  }

  private sendRaw(obj: unknown) {
    if (this.ws && !this.closed) this.ws.send(JSON.stringify(obj));
  }

  call<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = this.next++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new GatewayError(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      try {
        this.sendRaw({ jsonrpc: '2.0', id, method, params });
      } catch (e) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }
}
