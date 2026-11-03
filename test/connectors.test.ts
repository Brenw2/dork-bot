import { describe, expect, it } from 'vitest';
import { Connectors, type CatalogEntry, type SignInBrowser } from '@/lib/connectors';
import type { FetchLike, FetchResponse } from '@/lib/hermes';
import { HermesManager } from '@/lib/manager';

// A fake `hermes serve` MCP API, shaped like the real responses on b-lab
// (GET /api/mcp/servers?profile=assistant, /api/mcp/catalog, the dashboard OAuth flow).
function res(status: number, body: unknown = {}): FetchResponse {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text), body: null };
}

const NOTION: CatalogEntry = {
  name: 'notion',
  description: 'Pages and databases.',
  url: 'https://mcp.notion.com/mcp',
  auth: 'oauth',
  needs: [],
  needsInstall: false,
  installed: false,
};

function fakeServe(opts: { approveAfter?: number; flowError?: string; startError?: string } = {}) {
  const servers: Record<string, { url: string; auth?: string }> = {
    trello: { url: 'https://mcp.trello.com/v1', auth: 'oauth' },
  };
  const calls: string[] = [];
  let polls = 0;
  let flowCancelled = false;
  const fetch: FetchLike = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    const u = new URL(url);
    calls.push(`${method} ${u.pathname}${u.search}`);
    if (u.pathname === '/auth/native/refresh')
      return res(200, { access_token: 'at', refresh_token: 'rt-xxxxxxxxxxxxxxxx', expires_at: 1e12 });
    if (u.searchParams.get('profile') && u.searchParams.get('profile') !== 'assistant') return res(404, { detail: 'no profile' });
    if (u.pathname === '/api/mcp/servers' && method === 'GET') {
      return res(200, {
        servers: Object.entries(servers).map(([name, s]) => ({
          name,
          transport: 'http',
          url: s.url,
          auth: s.auth ?? null,
          enabled: true,
          source: 'config',
        })),
      });
    }
    if (u.pathname === '/api/mcp/catalog') {
      return res(200, {
        entries: [
          {
            name: 'notion',
            description: 'Pages and databases.',
            transport: 'http',
            auth_type: 'oauth',
            url: 'https://mcp.notion.com/mcp',
            required_env: [],
            needs_install: false,
            installed: false,
          },
          {
            name: 'deepwiki',
            description: 'Docs for any repo.',
            transport: 'http',
            auth_type: 'none',
            url: 'https://mcp.deepwiki.com/mcp',
            required_env: [],
          },
          { name: 'unreal-engine', transport: 'http', auth_type: 'none', url: 'http://127.0.0.1:8000/mcp', required_env: [] },
          { name: 'blender', transport: 'stdio', auth_type: 'none', url: null, needs_install: true, required_env: [] },
        ],
      });
    }
    if (u.pathname === '/api/mcp/catalog/install') {
      servers[body.name] = {
        url: body.name === 'deepwiki' ? 'https://mcp.deepwiki.com/mcp' : 'https://mcp.notion.com/mcp',
        auth: body.name === 'deepwiki' ? undefined : 'oauth',
      };
      return res(200, { ok: true, name: body.name, background: false });
    }
    if (u.pathname === '/api/mcp/servers' && method === 'POST') {
      if (servers[body.name]) return res(409, { detail: `Server '${body.name}' already exists` });
      servers[body.name] = { url: body.url, auth: body.auth };
      return res(200, { name: body.name });
    }
    const m = u.pathname.match(/^\/api\/mcp\/servers\/([^/]+)(\/test|\/auth)?$/);
    if (m && method === 'DELETE') {
      delete servers[m[1]];
      return res(200, { ok: true });
    }
    if (m?.[2] === '/test') {
      return m[1] === 'deepwiki'
        ? res(200, { ok: true, tools: [{ name: 'ask_question', description: 'Ask' }] })
        : res(200, { ok: false, error: 'OAuth authentication required — no token found.', tools: [] });
    }
    if (m?.[2] === '/auth') {
      if (opts.startError)
        return res(200, { flow_id: 'f1', server_name: m[1], status: 'error', authorization_url: null, error: opts.startError });
      return res(200, {
        flow_id: 'f1',
        server_name: m[1],
        status: 'authorization_required',
        authorization_url: 'https://notion.so/oauth/authorize?state=s',
        error: null,
      });
    }
    if (u.pathname === '/api/mcp/oauth/flows/f1' && method === 'DELETE') {
      flowCancelled = true;
      return res(200, { ok: true });
    }
    if (u.pathname === '/api/mcp/oauth/flows/f1') {
      polls += 1;
      if (opts.flowError && polls >= 2)
        return res(200, { flow_id: 'f1', status: 'error', authorization_url: null, error: opts.flowError, tools: [] });
      const approved = opts.approveAfter !== undefined && polls >= opts.approveAfter;
      return res(200, {
        flow_id: 'f1',
        status: approved ? 'approved' : 'authorization_required',
        authorization_url: 'https://notion.so/oauth/authorize?state=s',
        error: null,
        tools: approved ? [{ name: 'notion-search', description: 'Search' }] : [],
      });
    }
    return res(404, { detail: `no fake for ${method} ${u.pathname}` });
  };
  const manager = new HermesManager(
    { adminUrl: 'https://b-lab.test:8443', chatUrl: 'https://b-lab.test', refreshToken: 'r'.repeat(40) },
    fetch,
  );
  return { connectors: new Connectors(manager, 'assistant'), servers, calls, cancelled: () => flowCancelled };
}

function fakeBrowser(opts: { userClosesAfterMs?: number } = {}) {
  const b = { opened: [] as string[], closedByApp: 0 };
  let done: () => void = () => {};
  const browser: SignInBrowser = {
    open: (url) => {
      b.opened.push(url);
      return new Promise<void>((resolve) => {
        done = resolve;
        if (opts.userClosesAfterMs !== undefined) setTimeout(resolve, opts.userClosesAfterMs);
      });
    },
    close: () => {
      b.closedByApp += 1;
      done();
    },
  };
  return { browser, b };
}

const fast = { pollMs: 1, sleep: () => new Promise<void>((r) => setTimeout(r, 1)) };

describe('connectors', () => {
  it('lists connectors and the catalog the phone can set up', async () => {
    const { connectors } = fakeServe();
    expect(await connectors.list()).toEqual([
      { name: 'trello', url: 'https://mcp.trello.com/v1', auth: 'oauth', enabled: true, fromPlugin: false },
    ]);
    expect((await connectors.catalog()).map((e) => e.name)).toEqual(['notion', 'deepwiki']); // no localhost, no local builds
  });

  it('OAuth connect: opens the sign-in page, closes it by itself when Hermes says approved', async () => {
    const { connectors, servers } = fakeServe({ approveAfter: 3 });
    const { browser, b } = fakeBrowser();
    const steps: string[] = [];
    const tools = await connectors.connect({ entry: NOTION }, browser, { ...fast, onStatus: (s) => steps.push(s) });
    expect(tools).toEqual([{ name: 'notion-search', description: 'Search' }]);
    expect(b.opened).toEqual(['https://notion.so/oauth/authorize?state=s']);
    expect(b.closedByApp).toBe(1);
    expect(servers.notion).toBeDefined();
    expect(steps).toEqual(['Adding…', 'Opening the sign-in page…', 'Waiting for you to approve…']);
  });

  it('no-auth connect: adds and checks, no browser', async () => {
    const { connectors } = fakeServe();
    const { browser, b } = fakeBrowser();
    const entry: CatalogEntry = { ...NOTION, name: 'deepwiki', auth: 'none', url: 'https://mcp.deepwiki.com/mcp' };
    expect(await connectors.connect({ entry }, browser, fast)).toEqual([{ name: 'ask_question', description: 'Ask' }]);
    expect(b.opened).toEqual([]);
  });

  it('closing the browser cancels the flow and removes the half-added connector', async () => {
    const { connectors, servers, cancelled } = fakeServe();
    const { browser } = fakeBrowser({ userClosesAfterMs: 5 });
    await expect(connectors.connect({ entry: NOTION }, browser, fast)).rejects.toThrow('Sign-in cancelled.');
    expect(cancelled()).toBe(true);
    expect(servers.notion).toBeUndefined();
  });

  it("a provider that refuses the sign-in shows Hermes's reason and cleans up", async () => {
    const { connectors, servers } = fakeServe({ startError: 'notion requires a manually-registered OAuth client' });
    const { browser, b } = fakeBrowser();
    await expect(connectors.connect({ entry: NOTION }, browser, fast)).rejects.toThrow('manually-registered');
    expect(b.opened).toEqual([]);
    expect(servers.notion).toBeUndefined();
  });

  it('an error during the flow closes the browser', async () => {
    const { connectors } = fakeServe({ flowError: 'access_denied' });
    const { browser, b } = fakeBrowser();
    await expect(connectors.connect({ entry: NOTION }, browser, fast)).rejects.toThrow('access_denied');
    expect(b.closedByApp).toBe(1);
  });

  it('custom URL: https only, valid name, and keeps an existing connector on failure', async () => {
    const { connectors, servers } = fakeServe();
    const { browser } = fakeBrowser({ userClosesAfterMs: 5 });
    await expect(connectors.connect({ name: 'mine', url: 'http://x.test/mcp' }, browser, fast)).rejects.toThrow('https://');
    await expect(connectors.connect({ name: 'Bad Name!', url: 'https://x.test/mcp' }, browser, fast)).rejects.toThrow('lowercase');
    // trello already exists: re-signing in and cancelling must not delete it.
    await expect(connectors.connect({ name: 'trello', url: 'https://mcp.trello.com/v1' }, browser, fast)).rejects.toThrow('cancelled');
    expect(servers.trello).toBeDefined();
  });

  it('remove', async () => {
    const { connectors, servers } = fakeServe();
    await connectors.remove('trello');
    expect(servers.trello).toBeUndefined();
  });
});
