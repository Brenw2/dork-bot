import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { HermesClient, type FetchLike } from '../lib/hermes';
import { chatModel, filterCatalog, lockProvider, parseModelOptions, providerName, switchModel } from '../lib/models';

// Real GET /p/chief/api/model/options?include_unconfigured=false from b-lab (2026-11-03), trimmed to the fields we read.
const RAW = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'model-options.json'), 'utf8'));
// The same list as the assistant bot sees it: Dork is its provider.
const AS_ASSISTANT = {
  ...RAW,
  model: 'gemma4:31b',
  provider: 'custom',
  providers: RAW.providers.map((p: { slug: string }) => ({ ...p, is_current: p.slug === 'custom:dork' })),
};

describe('parseModelOptions', () => {
  const cat = parseModelOptions(RAW);

  it("puts the bot's provider first, then Dork, and drops the -acp duplicate", () => {
    expect(cat.providers.map((g) => g.slug)).toEqual(['anthropic', 'custom:dork', 'nous', 'copilot']);
    expect(cat.providers[0]).toMatchObject({ name: 'Anthropic', current: true });
    expect(cat.providers[1]).toMatchObject({ name: 'Dork', userDefined: true, models: ['gemma4:31b'] });
  });

  it('leaves out models Hermes says are unavailable', () => {
    const nous = cat.providers.find((g) => g.slug === 'nous')!;
    expect(nous.models).not.toContain('anthropic/claude-opus-5.5');
    expect(nous.models.length).toBe(4);
  });

  it("reads the bot's default, with the real slug for a custom provider", () => {
    expect(cat.botDefault).toEqual({ provider: 'anthropic', model: 'claude-opus-5-5' });
    expect(parseModelOptions(AS_ASSISTANT).botDefault).toEqual({ provider: 'custom:dork', model: 'gemma4:31b' });
  });

  it('copes with junk', () => {
    expect(parseModelOptions(null)).toEqual({ botDefault: null, providers: [] });
    expect(parseModelOptions({ providers: [{ slug: 'x', models: 'nope' }] }).providers).toEqual([]);
  });
});

describe('chatModel', () => {
  const cat = parseModelOptions(RAW);

  it("flags the chief bug: the bot moved to Anthropic but its chat still says gemma4:31b", () => {
    const m = chatModel('gemma4:31b', null, cat);
    expect(m.problem).toMatch(/gemma4:31b.*Anthropic/);
    expect(m.choice).toEqual({ provider: 'custom:dork', model: 'gemma4:31b' });
  });

  it("is fine once the chat is switched from this phone, even to another provider", () => {
    expect(chatModel('gemma4:31b', { provider: 'custom:dork', model: 'gemma4:31b' }, cat)).toEqual({
      choice: { provider: 'custom:dork', model: 'gemma4:31b' },
      problem: null,
    });
  });

  it("uses the bot's own provider when it has the model (Anthropic and Copilot both list claude-fable-5.1)", () => {
    expect(chatModel('claude-fable-5.1', null, cat).choice).toEqual({ provider: 'anthropic', model: 'claude-fable-5.1' });
  });

  it("a new chat is on the bot's default", () => {
    expect(chatModel(null, null, cat)).toEqual({ choice: { provider: 'anthropic', model: 'claude-opus-5-5' }, problem: null });
  });

  it('ignores a saved pick that someone else has since changed', () => {
    expect(chatModel('claude-opus-5-5', { provider: 'custom:dork', model: 'gemma4:31b' }, cat).choice?.provider).toBe('anthropic');
  });

  it('names providers', () => {
    expect(providerName(cat, 'custom:dork')).toBe('Dork');
    expect(providerName(null, 'anthropic')).toBe('anthropic');
  });
});

describe('filterCatalog', () => {
  const cat = parseModelOptions(RAW);
  it('matches model names and provider names', () => {
    expect(filterCatalog(cat, 'gemma').map((g) => g.slug)).toEqual(['custom:dork']);
    expect(filterCatalog(cat, 'dork')[0].models).toEqual(['gemma4:31b']);
    expect(filterCatalog(cat, 'haiku-5').every((g) => g.models.every((m) => m.includes('haiku-5')))).toBe(true);
    expect(filterCatalog(cat, '  ')).toBe(cat.providers);
  });
});

describe('switchModel', () => {
  const dork = { provider: 'custom:dork', model: 'gemma4:31b' };
  const haiku = { provider: 'anthropic', model: 'claude-haiku-5-5' };
  const deps = (manager: boolean) => {
    const calls: string[] = [];
    return {
      calls,
      d: {
        setBotModel: manager ? async (c: { provider: string; model: string }) => void calls.push(`bot ${c.provider}/${c.model}`) : null,
        setChatModel: async (c: { provider: string; model: string }) => void calls.push(`chat ${c.provider}/${c.model}`),
      },
    };
  };

  it('sets the bot first, then locks the chat; Dork is locked as plain "custom"', async () => {
    const { calls, d } = deps(true);
    await switchModel(haiku, dork, d);
    await switchModel(dork, haiku, d);
    expect(calls).toEqual(['bot anthropic/claude-haiku-5-5', 'chat anthropic/claude-haiku-5-5', 'bot custom:dork/gemma4:31b', 'chat custom/gemma4:31b']);
  });

  it('without the Hermes sign-in, only the chat switches, and Dork only for a Dork bot', async () => {
    const { calls, d } = deps(false);
    await switchModel(haiku, dork, d);
    await switchModel(dork, dork, d);
    await expect(switchModel(dork, haiku, d)).rejects.toThrow(/pair-hermes/);
    expect(calls).toEqual(['chat anthropic/claude-haiku-5-5', 'chat custom/gemma4:31b']);
  });

  it('lockProvider', () => {
    expect(lockProvider('custom:dork')).toBe('custom');
    expect(lockProvider('anthropic')).toBe('anthropic');
  });
});

describe('HermesClient models', () => {
  const conn = { url: 'https://h.test', bot: 'chief', key: 'k' };
  const reply = (status: number, body: unknown) => ({
    ok: status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
    body: null,
  });

  it('lists, reads and switches through the right endpoints', async () => {
    const calls: { url: string; method?: string; body?: string }[] = [];
    const f = vi.fn<FetchLike>(async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body });
      if (url.includes('/api/model/options')) return reply(200, RAW);
      if (url.endsWith('/model')) return reply(200, { object: 'hermes.session.model_lock' });
      return reply(200, { session: { id: 'dork-bot-chief', model: 'claude-opus-5-5' } });
    });
    const c = new HermesClient(conn, f);
    expect((await c.modelOptions()).providers).toHaveLength(4);
    expect(await c.sessionModel('dork-bot-chief')).toBe('claude-opus-5-5');
    await c.setModel('dork-bot-chief', { provider: 'custom:dork', model: 'gemma4:31b' });
    expect(calls.map((x) => x.url)).toEqual([
      'https://h.test/p/chief/api/model/options?include_unconfigured=false',
      'https://h.test/p/chief/api/sessions/dork-bot-chief',
      'https://h.test/p/chief/api/sessions/dork-bot-chief/model',
    ]);
    expect(calls[2]).toMatchObject({ method: 'POST', body: JSON.stringify({ model: 'gemma4:31b', provider: 'custom:dork' }) });
  });

  it("a chat that doesn't exist yet has no model; a failed switch says which model", async () => {
    const c = new HermesClient(conn, async (url) => (url.endsWith('/model') ? reply(400, { error: 'bad' }) : reply(404, {})));
    expect(await c.sessionModel('nope')).toBeNull();
    await expect(c.setModel('x', { provider: 'a', model: 'm' })).rejects.toThrow(/Couldn't switch to m: HTTP 400/);
  });
});
