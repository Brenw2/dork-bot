import { describe, expect, it } from 'vitest';
import type { FetchLike, FetchResponse } from '@/lib/hermes';
import { HermesManager, soulFor, waitForBot } from '@/lib/manager';
import { managerFromParams, managerLink } from '@/lib/pairing';

// A fake `hermes serve` + gateway, shaped like the real responses seen on b-lab.
interface Call {
  method: string;
  url: string;
  auth?: string;
  body?: unknown;
}

function res(status: number, body: unknown = {}): FetchResponse {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text), body: null };
}

function fakeHermes(opts: { keyLiveAfter?: number; templateProvider?: string } = {}) {
  const calls: Call[] = [];
  const profiles = [
    { name: 'default', is_default: true, model: 'claude-opus-5-5', provider: 'anthropic', description: '' },
    { name: 'assistant', model: 'gemma4:31b', provider: opts.templateProvider ?? 'custom', description: 'Personal assistant' },
  ];
  const keys: Record<string, string> = { assistant: 'a'.repeat(64) };
  let issued = 0;
  let checks = 0;
  const fetch: FetchLike = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    const auth = init.headers?.Authorization;
    calls.push({ method, url, auth, body });
    const u = new URL(url);
    if (u.port === '8443') {
      if (u.pathname === '/auth/native/refresh') {
        if (body.refresh_token === 'expired-refresh-token') return res(401, { error: 'session_expired' });
        issued += 1;
        return res(200, { access_token: `at-${issued}`, refresh_token: `rt-${issued}-xxxxxxxxxxxxxxxx`, expires_at: 1000 + 43200 });
      }
      if (!auth?.startsWith('Bearer at-')) return res(401, { error: 'session_expired' });
      if (u.pathname === '/api/profiles' && method === 'GET') return res(200, { profiles });
      if (u.pathname === '/api/profiles' && method === 'POST') {
        if (profiles.some((p) => p.name === body.name)) {
          return res(400, { detail: `A profile named '${body.name}' already exists. Switch to it with \`hermes profile use ${body.name}\`.` });
        }
        profiles.push({ name: body.name, model: 'gemma4:31b', provider: 'custom', description: body.description });
        return res(200, { ok: true, name: body.name, soul_set: true });
      }
      if (u.pathname === '/api/env' && method === 'PUT') {
        keys[u.searchParams.get('profile')!] = body.value;
        return res(200, { ok: true, key: body.key });
      }
      if (u.pathname === '/api/env/reveal') {
        const k = keys[u.searchParams.get('profile')!];
        return k ? res(200, { key: body.key, value: k }) : res(404, { detail: 'API_SERVER_KEY not found in .env' });
      }
      const del = u.pathname.match(/^\/api\/profiles\/(.+)$/);
      if (del && method === 'DELETE') {
        const i = profiles.findIndex((p) => p.name === decodeURIComponent(del[1]));
        if (i < 0) return res(404, { detail: 'not found' });
        profiles.splice(i, 1);
        return res(200, { ok: true });
      }
      return res(404, { detail: 'Not Found' });
    }
    // Gateway API server: /p/<bot>/api/sessions?limit=1 with the bot's own key.
    const m = u.pathname.match(/^\/p\/([^/]+)\/api\/sessions$/);
    if (m) {
      const bot = decodeURIComponent(m[1]);
      checks += 1;
      if (!(bot in keys)) return res(404);
      if (checks <= (opts.keyLiveAfter ?? 0)) return res(401); // gateway hasn't seen the new key yet
      return auth === `Bearer ${keys[bot]}` ? res(200, { data: [] }) : res(401);
    }
    return res(404);
  };
  return { fetch, calls, profiles, keys };
}

const auth = { adminUrl: 'https://b-lab.example.ts.net:8443', chatUrl: 'https://b-lab.example.ts.net', refreshToken: 'rt-0-xxxxxxxxxxxxxxxx' };
const noWait = { sleep: async () => {}, intervalMs: 0 };
const key = () => 'k'.repeat(64);

describe('HermesManager', () => {
  it('trades the refresh token for a bearer token, reuses it, and keeps the newest refresh token', async () => {
    const h = fakeHermes();
    const saved: string[] = [];
    const m = new HermesManager(auth, h.fetch, (rt) => void saved.push(rt), () => 1000);
    await m.listProfiles();
    await m.listProfiles();
    expect(h.calls.filter((c) => c.url.endsWith('/auth/native/refresh'))).toHaveLength(1);
    expect(h.calls.filter((c) => c.url.endsWith('/api/profiles')).map((c) => c.auth)).toEqual(['Bearer at-1', 'Bearer at-1']);
    expect(saved).toEqual(['rt-1-xxxxxxxxxxxxxxxx']);
  });

  it('refreshes again when the access token is about to expire', async () => {
    const h = fakeHermes();
    let t = 1000;
    const m = new HermesManager(auth, h.fetch, () => {}, () => t);
    await m.listProfiles();
    t = 1000 + 43200 - 30;
    await m.listProfiles();
    expect(h.calls.filter((c) => c.url.endsWith('/auth/native/refresh'))).toHaveLength(2);
    expect(h.calls.at(-1)?.body).toBeUndefined();
    expect(h.calls.at(-2)?.body).toEqual({ refresh_token: 'rt-1-xxxxxxxxxxxxxxxx', provider: 'basic' });
  });

  it('says to re-pair when the sign-in has expired', async () => {
    const h = fakeHermes();
    const m = new HermesManager({ ...auth, refreshToken: 'expired-refresh-token' }, h.fetch);
    await expect(m.listProfiles()).rejects.toThrow(/pair-hermes\.sh/);
  });

  it('creates a bot cloned from the template, with its own key, and waits for the gateway', async () => {
    const h = fakeHermes({ keyLiveAfter: 2 });
    const m = new HermesManager(auth, h.fetch, () => {}, () => 1000);
    const conn = await m.createBot({ name: 'Scout', job: 'Finds Mets news' }, key, noWait);
    expect(conn).toEqual({ url: auth.chatUrl, bot: 'scout', key: key() });
    const create = h.calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/profiles'));
    expect(create?.body).toMatchObject({ name: 'scout', clone_from: 'assistant', description: 'Finds Mets news' });
    expect((create?.body as { soul: string }).soul).toContain('Your job: Finds Mets news');
    expect(h.keys.scout).toBe(key());
    // Two 401s while the gateway catches up, then 200.
    expect(h.calls.filter((c) => c.url.includes('/p/scout/api/sessions'))).toHaveLength(3);
  });

  it('creates bots from a template on a frontier model too', async () => {
    const h = fakeHermes({ templateProvider: 'anthropic', keyLiveAfter: 0 });
    const m = new HermesManager(auth, h.fetch, () => {}, () => 1000);
    const conn = await m.createBot({ name: 'scout', job: 'x' }, key, noWait);
    expect(conn.bot).toBe('scout');
    expect(h.calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/profiles'))).toBe(true);
  });

  it('turns name problems into plain messages', async () => {
    const h = fakeHermes();
    const m = new HermesManager(auth, h.fetch);
    await expect(m.createBot({ name: 'assistant', job: 'x' }, key, noWait)).rejects.toThrow("There's already a bot called assistant.");
    await expect(m.createBot({ name: 'bad name!', job: 'x' }, key, noWait)).rejects.toThrow(/lowercase/);
    await expect(m.createBot({ name: 'ok', job: '  ' }, key, noWait)).rejects.toThrow(/what the bot does/);
  });

  it('connects an existing bot with its own key, or gives it one', async () => {
    const h = fakeHermes();
    h.profiles.push({ name: 'nokey', model: 'gemma4:31b', provider: 'custom', description: '' });
    const m = new HermesManager(auth, h.fetch);
    expect((await m.connectExisting('assistant', key, noWait)).key).toBe('a'.repeat(64));
    expect(h.keys.assistant).toBe('a'.repeat(64)); // untouched
    expect((await m.connectExisting('nokey', key, noWait)).key).toBe(key());
  });

  it('deletes a bot, and treats an already-gone bot as deleted', async () => {
    const h = fakeHermes();
    const m = new HermesManager(auth, h.fetch);
    await m.createBot({ name: 'temp', job: 'x' }, key, noWait);
    await m.deleteBot('temp');
    expect(h.profiles.map((p) => p.name)).not.toContain('temp');
    await expect(m.deleteBot('temp')).resolves.toBeUndefined();
    await expect(m.deleteBot('default')).rejects.toThrow(/can't be deleted/);
  });

  it('gives up waiting with a clear message if the gateway never accepts the key', async () => {
    const h = fakeHermes({ keyLiveAfter: 1000 });
    await expect(
      waitForBot({ url: auth.chatUrl, bot: 'assistant', key: 'a'.repeat(64) }, h.fetch, { ...noWait, timeoutMs: 0 }),
    ).rejects.toThrow(/hasn't picked up its key/);
  });
});

describe('helpers', () => {
  it('writes a SOUL.md from the job', () => {
    expect(soulFor('scout', 'Finds Mets news')).toMatch(/^You are Scout, one of Brennan's AI teammates/);
  });

  it('round-trips the Hermes sign-in link', () => {
    const link = managerLink({ adminUrl: auth.adminUrl, chatUrl: auth.chatUrl, refreshToken: 'r/t+=' + 'x'.repeat(20) });
    expect(link.startsWith('dorkbot://connect?')).toBe(true);
    const params = Object.fromEntries(new URL(link.replace('dorkbot://', 'https://x/')).searchParams);
    expect(managerFromParams(params)).toEqual({ adminUrl: auth.adminUrl, chatUrl: auth.chatUrl, refreshToken: 'r/t+=' + 'x'.repeat(20) });
    expect(managerFromParams({ admin: auth.adminUrl, chat: auth.chatUrl, rt: 'short' })).toBeNull();
    expect(managerFromParams({ admin: 'ftp://x', chat: auth.chatUrl, rt: 'x'.repeat(20) })).toBeNull();
  });
});
