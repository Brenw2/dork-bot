// Connectors: MCP servers a bot can use (Notion, Linear, Strava...), managed through
// `hermes serve`'s MCP API, the same one the Hermes dashboard uses. Each bot (profile)
// has its own connectors and its own sign-ins.
//
// Signing in needs no copy-pasting: Hermes starts the OAuth flow and hands back the
// provider's sign-in page; the app opens it in an in-app browser. The provider sends the
// browser back to Hermes's own callback on b-lab (over Tailscale), Hermes stores the
// token, and the app, polling the flow, closes the browser as soon as it's approved.
// The gateway is meant to pick up the new server on its MCP reconcile tick, but on Hermes 0.22.5
// a bot created after the gateway started never got it (test/live-connectors.test.ts, docs/HERMES.md).
import { HermesError } from './hermes';
import { fail, type HermesManager } from './manager';

export interface Connector {
  name: string;
  url: string | null;
  auth: 'oauth' | 'header' | 'none' | null;
  enabled: boolean;
  /** Added by a plugin: can't be removed from the app. */
  fromPlugin: boolean;
}

export interface CatalogEntry {
  name: string;
  description: string;
  url: string | null;
  auth: 'oauth' | 'none' | string;
  /** Values the user has to supply first (e.g. an OAuth client id), names and prompts only. */
  needs: { name: string; prompt: string; required: boolean }[];
  /** Entries that clone and build a local server: not offered on the phone. */
  needsInstall: boolean;
  installed: boolean;
}

export interface Tool {
  name: string;
  description: string;
}

export type FlowStatus = 'starting' | 'authorization_required' | 'approved' | 'error';

export interface Flow {
  id: string;
  status: FlowStatus;
  authorizationUrl: string | null;
  error: string | null;
  tools: Tool[];
}

/** What the screen does with the browser: open the sign-in page, close it when Hermes says it's done. */
export interface SignInBrowser {
  /** Opens the page. Resolves when the browser goes away (closed by the user or by close()). */
  open(url: string): Promise<void>;
  close(): void;
}

export interface ConnectOptions {
  pollMs?: number;
  /** Hermes forgets a flow after 15 minutes. */
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onStatus?: (status: string) => void;
}

const q = (profile: string) => `profile=${encodeURIComponent(profile)}`;
export const CONNECTOR_NAME = /^[a-z0-9][a-z0-9_-]{0,47}$/;

export class Connectors {
  constructor(
    private readonly manager: HermesManager,
    readonly bot: string,
  ) {}

  async list(): Promise<Connector[]> {
    const res = await this.manager.api(`/api/mcp/servers?${q(this.bot)}`);
    if (!res.ok) throw await fail(res, "Couldn't list connectors");
    const body = (await res.json()) as { servers?: RawServer[] };
    return (body.servers ?? []).map((s) => ({
      name: s.name,
      url: s.url ?? null,
      auth: (s.auth as Connector['auth']) ?? null,
      enabled: s.enabled !== false,
      fromPlugin: s.source === 'plugin',
    }));
  }

  /** Hermes's approved catalog, minus entries the phone can't set up (local builds, localhost servers). */
  async catalog(): Promise<CatalogEntry[]> {
    const res = await this.manager.api(`/api/mcp/catalog?${q(this.bot)}`);
    if (!res.ok) throw await fail(res, "Couldn't load the connector list");
    const body = (await res.json()) as { entries?: RawEntry[] };
    return (body.entries ?? [])
      .filter((e) => e.transport === 'http' && !e.needs_install && !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(e.url ?? ''))
      .map((e) => ({
        name: e.name,
        description: e.description ?? '',
        url: e.url ?? null,
        auth: e.auth_type ?? 'none',
        needs: (e.required_env ?? []).map((v) => ({ name: v.name, prompt: v.prompt ?? v.name, required: v.required !== false })),
        needsInstall: !!e.needs_install,
        installed: !!e.installed,
      }));
  }

  /** Tools the connector offers; throws if it can't connect or isn't signed in. */
  async test(name: string): Promise<Tool[]> {
    const res = await this.manager.api(`/api/mcp/servers/${encodeURIComponent(name)}/test?${q(this.bot)}`, 'POST');
    if (!res.ok) throw await fail(res, `Couldn't check ${name}`);
    const body = (await res.json()) as { ok?: boolean; error?: string; tools?: Tool[] };
    if (!body.ok) throw new HermesError(body.error || `${name} didn't answer.`);
    return body.tools ?? [];
  }

  async remove(name: string): Promise<void> {
    const res = await this.manager.api(`/api/mcp/servers/${encodeURIComponent(name)}?${q(this.bot)}`, 'DELETE');
    if (res.status === 404) return;
    if (!res.ok) throw await fail(res, `Couldn't remove ${name}`);
  }

  /**
   * Adds a connector and signs in to it. One call from a Connect button:
   * catalog entry or custom URL → (OAuth: in-app browser, closed automatically when approved) → its tools.
   * If anything fails or the user closes the browser, a connector this call added is removed again.
   */
  async connect(
    target: { entry: CatalogEntry; values?: Record<string, string> } | { name: string; url: string },
    browser: SignInBrowser,
    opts: ConnectOptions = {},
  ): Promise<Tool[]> {
    const status = opts.onStatus ?? (() => {});
    const name = 'entry' in target ? target.entry.name : target.name.trim().toLowerCase();
    if (!CONNECTOR_NAME.test(name)) throw new HermesError('Connector names are lowercase letters, numbers, - and _.');
    const existing = (await this.list()).find((c) => c.name === name);
    let added = false;

    status('Adding…');
    if (!existing) {
      if ('entry' in target) {
        const res = await this.manager.api(`/api/mcp/catalog/install?${q(this.bot)}`, 'POST', {
          name,
          env: target.values ?? {},
          enable: true,
          profile: this.bot,
        });
        if (!res.ok) throw await fail(res, `Couldn't add ${name}`);
      } else {
        const url = target.url.trim();
        if (!/^https:\/\//i.test(url)) throw new HermesError('The connector URL must start with https://');
        const res = await this.manager.api(`/api/mcp/servers?${q(this.bot)}`, 'POST', { name, url, auth: 'oauth', profile: this.bot });
        if (!res.ok) throw await fail(res, `Couldn't add ${name}`);
      }
      added = true;
    }

    try {
      const oauth = 'entry' in target ? target.entry.auth === 'oauth' : true;
      if (!oauth) {
        status('Checking…');
        return await this.test(name);
      }
      // A custom URL may not need a sign-in at all: if it already answers, we're done.
      if (!('entry' in target)) {
        const tools = await this.test(name).catch(() => null);
        if (tools) return tools;
      }
      return await this.signIn(name, browser, opts);
    } catch (err) {
      if (added) await this.remove(name).catch(() => undefined);
      throw err;
    }
  }

  /** (Re)signs in to an OAuth connector. */
  async signIn(name: string, browser: SignInBrowser, opts: ConnectOptions = {}): Promise<Tool[]> {
    const { pollMs = 1500, timeoutMs = 14 * 60_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = opts;
    const status = opts.onStatus ?? (() => {});
    status('Opening the sign-in page…');
    const res = await this.manager.api(`/api/mcp/servers/${encodeURIComponent(name)}/auth?${q(this.bot)}`, 'POST');
    if (!res.ok) throw await fail(res, `Couldn't start the sign-in for ${name}`);
    let flow = toFlow(await res.json());
    if (flow.status === 'error') throw new HermesError(flow.error || `${name} sign-in failed.`);
    if (flow.status === 'approved') return flow.tools;
    if (!flow.authorizationUrl) throw new HermesError(`${name} didn't give a sign-in page.`);

    let closed = false;
    browser.open(flow.authorizationUrl).then(() => {
      closed = true;
    });
    status('Waiting for you to approve…');
    const deadline = Date.now() + timeoutMs;
    try {
      for (;;) {
        await sleep(pollMs);
        flow = await this.flow(flow.id);
        if (flow.status === 'approved') return flow.tools;
        if (flow.status === 'error') throw new HermesError(flow.error || `${name} sign-in failed.`);
        // The user closed the browser. Give a callback that's already on its way a moment to land.
        if (closed) {
          await sleep(pollMs);
          flow = await this.flow(flow.id);
          if (flow.status === 'approved') return flow.tools;
          throw new HermesError('Sign-in cancelled.');
        }
        if (Date.now() > deadline) throw new HermesError('The sign-in took too long. Try again.');
      }
    } catch (err) {
      await this.manager.api(`/api/mcp/oauth/flows/${encodeURIComponent(flow.id)}`, 'DELETE').catch(() => undefined);
      throw err;
    } finally {
      if (!closed) browser.close();
    }
  }

  private async flow(id: string): Promise<Flow> {
    const res = await this.manager.api(`/api/mcp/oauth/flows/${encodeURIComponent(id)}`);
    if (res.status === 404) throw new HermesError('The sign-in expired. Try again.', 404);
    if (!res.ok) throw await fail(res, 'Sign-in check failed');
    return toFlow(await res.json());
  }
}

function toFlow(raw: unknown): Flow {
  const f = raw as { flow_id?: string; status?: string; authorization_url?: string | null; error?: string | null; tools?: Tool[] };
  return {
    id: f.flow_id ?? '',
    status: (f.status as FlowStatus) ?? 'error',
    authorizationUrl: f.authorization_url ?? null,
    error: f.error ?? null,
    tools: f.tools ?? [],
  };
}

interface RawServer {
  name: string;
  url?: string | null;
  auth?: string | null;
  enabled?: boolean;
  source?: string;
}

interface RawEntry {
  name: string;
  description?: string;
  transport?: string;
  auth_type?: string;
  url?: string | null;
  needs_install?: boolean;
  installed?: boolean;
  required_env?: { name: string; prompt?: string; required?: boolean }[];
}
