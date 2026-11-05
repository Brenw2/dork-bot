import { describe, expect, it } from 'vitest';
import { awaitingReply, chatReducer, initialChat } from '@/lib/chatState';
import { toChatMessages, type BotConnection, type FetchLike, type FetchResponse } from '@/lib/hermes';
import { cleanMeta, HermesManager, type BotMeta, type Profile } from '@/lib/manager';
import { sameHost, syncBots, type LocalBot, type SyncDeps } from '@/lib/sync';

const CHAT = 'https://b-lab.tail7e27a7.ts.net';
const tabby = { character: 'cat' as const, variant: 1, color: '#ff8800' };
const robot = { character: 'robot' as const, variant: 0, color: '#3366ff' };
const profile = (name: string, isDefault = false): Profile => ({ name, description: '', model: 'gemma4:31b', provider: 'custom', isDefault });

/** A fake Hermes + device store; records what sync did. */
function world(opts: { profiles: Profile[]; meta?: Record<string, BotMeta>; local?: LocalBot[]; failConnect?: string[] }) {
  const meta: Record<string, BotMeta> = structuredClone(opts.meta ?? {});
  let local: LocalBot[] = structuredClone(opts.local ?? []);
  const deps: SyncDeps = {
    chatUrl: CHAT,
    listProfiles: async () => opts.profiles,
    getMeta: async (bot) => meta[bot] ?? {},
    setMeta: async (bot, patch) => void (meta[bot] = { ...meta[bot], ...patch }),
    connect: async (bot) => {
      if (opts.failConnect?.includes(bot)) throw new Error('429 too many reveals');
      return { url: CHAT, bot, key: 'k'.repeat(64) } satisfies BotConnection;
    },
    local: async () => local,
    save: async (conn, m) => void local.push({ bot: conn.bot, url: conn.url, look: m.look, model: m.model, displayName: m.name }),
    update: async (bot, m) => void (local = local.map((b) => (b.bot === bot ? { ...b, ...m } : b))),
    remove: async (bot) => void (local = local.filter((b) => b.bot !== bot)),
  };
  return { deps, meta, local: () => local };
}

describe('syncBots', () => {
  it('a new device gets every bot on Hermes, with the looks and models picked on the phone', async () => {
    const w = world({
      profiles: [profile('default', true), profile('assistant'), profile('chief')],
      meta: { chief: { look: tabby, model: { provider: 'anthropic', model: 'claude-opus-5-5' } } },
    });
    const r = await syncBots(w.deps);
    expect(r.added).toEqual(['assistant', 'chief']);
    expect(w.local().map((b) => b.bot)).toEqual(['assistant', 'chief']); // not the default profile
    expect(w.local()[1]).toMatchObject({ look: tabby, model: { provider: 'anthropic', model: 'claude-opus-5-5' } });
  });

  it('removes a bot deleted on another device, but not one added by hand from another Hermes', async () => {
    const w = world({
      profiles: [profile('assistant')],
      local: [
        { bot: 'assistant', url: CHAT },
        { bot: 'scout', url: `${CHAT}/` },
        { bot: 'elsewhere', url: 'https://other-host.example' },
      ],
    });
    const r = await syncBots(w.deps);
    expect(r.removed).toEqual(['scout']);
    expect(w.local().map((b) => b.bot)).toEqual(['assistant', 'elsewhere']);
  });

  it('keeps the default profile only where it was added by hand', async () => {
    const w = world({ profiles: [profile('default', true)], local: [{ bot: 'default', url: CHAT }] });
    await syncBots(w.deps);
    expect(w.local().map((b) => b.bot)).toEqual(['default']);
  });

  it('a look changed on another device comes down; Hermes wins over the local copy', async () => {
    const w = world({ profiles: [profile('chief')], meta: { chief: { look: tabby } }, local: [{ bot: 'chief', url: CHAT, look: robot }] });
    const r = await syncBots(w.deps);
    expect(r.updated).toEqual(['chief']);
    expect(w.local()[0].look).toEqual(tabby);
  });

  it("the first sync pushes this device's picks up when Hermes has none yet", async () => {
    const model = { provider: 'anthropic', model: 'claude-opus-5-5' };
    const w = world({ profiles: [profile('chief')], local: [{ bot: 'chief', url: CHAT, look: robot, model }] });
    const r = await syncBots(w.deps);
    expect(r.pushed).toEqual(['chief']);
    expect(w.meta.chief).toEqual({ look: robot, model });
    expect(r.updated).toEqual([]);
  });

  it('a bot hidden on another device goes away here and is not re-added', async () => {
    const w = world({ profiles: [profile('assistant'), profile('chief')], meta: { chief: { hidden: true } }, local: [{ bot: 'chief', url: CHAT }] });
    const r = await syncBots(w.deps);
    expect(r.removed).toEqual(['chief']);
    expect(w.local().map((b) => b.bot)).toEqual(['assistant']);
    expect((await syncBots(w.deps)).added).toEqual([]);
  });

  it("one bot failing (Hermes's 5-per-30-s key limit) doesn't stop the rest", async () => {
    const w = world({ profiles: [profile('a'), profile('b')], failConnect: ['a'] });
    const r = await syncBots(w.deps);
    expect(r.added).toEqual(['b']);
    expect(r.errors.a).toMatch(/429/);
  });

  it('sameHost ignores slashes and paths', () => {
    expect(sameHost('https://b-lab.tail7e27a7.ts.net/', 'https://b-lab.tail7e27a7.ts.net')).toBe(true);
    expect(sameHost('https://b-lab.tail7e27a7.ts.net:8443', 'https://b-lab.tail7e27a7.ts.net')).toBe(false);
  });
});

describe('cleanMeta', () => {
  it('keeps well-formed fields and drops the rest (the block is hand-editable YAML)', () => {
    expect(cleanMeta({ look: tabby, model: { provider: 'custom', model: 'gemma4:31b' }, hidden: false, junk: 1 })).toEqual({
      look: tabby,
      model: { provider: 'custom', model: 'gemma4:31b' },
      hidden: false,
    });
    expect(cleanMeta({ look: { character: 'dragon', variant: 0, color: '#fff' }, hidden: 'yes' })).toEqual({});
    expect(cleanMeta(null)).toEqual({});
  });
});

describe('HermesManager meta', () => {
  it('reads dork_bot from the profile config and writes a dork_bot patch', async () => {
    const calls: { method: string; url: string; body?: unknown }[] = [];
    const res = (status: number, body: unknown): FetchResponse => ({
      ok: status < 300,
      status,
      text: async () => JSON.stringify(body),
      json: async () => body,
      body: null,
    });
    const fetch: FetchLike = async (url, init = {}) => {
      calls.push({ method: init.method ?? 'GET', url, body: init.body ? JSON.parse(init.body) : undefined });
      if (url.endsWith('/auth/native/refresh')) return res(200, { access_token: 'at', refresh_token: 'rt', expires_at: 9e9 });
      // Shape seen on b-lab (hermes serve 0.22.5): the config's top-level keys, dork_bot among them.
      if (url.includes('/api/config') && (init.method ?? 'GET') === 'GET') return res(200, { model: { default: 'gemma4:31b' }, dork_bot: { look: tabby } });
      return res(200, { ok: true });
    };
    const m = new HermesManager({ adminUrl: `${CHAT}:8443`, chatUrl: CHAT, refreshToken: 'rt' }, fetch);
    expect(await m.getMeta('chief')).toEqual({ look: tabby });
    await m.setMeta('chief', { hidden: true });
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}${new URL(c.url).search}`)).toEqual([
      'POST /auth/native/refresh',
      'GET /api/config?profile=chief&include_defaults=false',
      'PUT /api/config?profile=chief',
    ]);
    expect(calls[2].body).toEqual({ config: { dork_bot: { hidden: true } } });
  });
});

describe('chat from another device', () => {
  const msgs = toChatMessages([
    { id: 1, role: 'user', content: 'hi', timestamp: 1000 },
    { id: 2, role: 'assistant', content: 'hello', timestamp: 1010 },
    { id: 3, role: 'user', content: 'what is on today?', timestamp: 2000 },
    { id: 4, role: 'tool', content: '{}', tool_name: 'web_search', timestamp: 2005 },
  ]);

  it('keeps when Hermes saved each message', () => {
    expect(msgs[0]).toEqual({ id: '1', role: 'user', content: 'hi', at: 1000 });
  });

  it('a message with no reply yet (tool steps only) means the bot is still on it, for 15 minutes', () => {
    expect(awaitingReply(msgs, 2030)).toBe(2000);
    expect(awaitingReply(msgs, 2000 + 16 * 60)).toBeNull();
    expect(awaitingReply(msgs.slice(0, 2), 2030)).toBeNull();
    expect(awaitingReply([{ id: 'local-1', role: 'user', content: 'x' }], 2030)).toBeNull(); // not reloaded yet
  });

  it("shows working for a reply running elsewhere, without a Stop (there's no run id here)", () => {
    const s = chatReducer({ ...initialChat, messages: msgs }, { type: 'remote' });
    expect(s.pending).toMatchObject({ remote: true, resumed: true });
    expect(s.runId).toBeNull();
    // Sending from here takes over.
    const sent = chatReducer(s, { type: 'send', text: 'never mind' });
    expect(sent.pending?.remote).toBeUndefined();
    // A remote marker never replaces this device's own reply.
    expect(chatReducer(sent, { type: 'remote' })).toBe(sent);
  });
});
