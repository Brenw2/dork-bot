import { describe, expect, it } from 'vitest';
import { cleanMeta, type BotMeta, type Profile } from '@/lib/manager';
import {
  addToken,
  cleanPush,
  dropToken,
  mutePatch,
  parsePushData,
  routeFor,
  setTokenOnBots,
  showWhileOpen,
  type PushMeta,
} from '@/lib/push';
import { syncBots, type LocalBot, type SyncDeps } from '@/lib/sync';

const PHONE = 'ExponentPushToken[phone-1]';
const OTHER = 'ExponentPushToken[ipad-2]';
const CHAT = 'https://b-lab.tail7e27a7.ts.net';

/** Hermes's PUT /api/config deep-merges dicts and replaces lists; the fake does the same for dork_bot. */
function hermes(initial: Record<string, BotMeta>) {
  const meta: Record<string, BotMeta> = structuredClone(initial);
  const puts: { bot: string; patch: BotMeta }[] = [];
  const setMeta = async (bot: string, patch: BotMeta) => {
    puts.push({ bot, patch });
    const cur = meta[bot] ?? {};
    meta[bot] = { ...cur, ...patch, ...(patch.push ? { push: { ...cur.push, ...patch.push } } : {}) };
  };
  return { meta, puts, setMeta, getMeta: async (bot: string) => meta[bot] ?? {} };
}

describe('push tokens in dork_bot.push', () => {
  it('cleanPush keeps well-formed tokens once and the mute switch', () => {
    expect(cleanPush({ tokens: [PHONE, PHONE, 'nope', 3, 'ExponentPushToken[]', OTHER], muted: true, x: 1 })).toEqual({ tokens: [PHONE, OTHER], muted: true });
    expect(cleanPush({ muted: 'yes' })).toEqual({});
    expect(cleanPush(null)).toBeUndefined();
    expect(cleanMeta({ hidden: false, push: { tokens: [PHONE] } })).toEqual({ hidden: false, push: { tokens: [PHONE] } });
  });

  it("adding this phone's token keeps the other phones' tokens; nothing to do when it's there", () => {
    expect(addToken(undefined, PHONE)).toEqual({ tokens: [PHONE] });
    expect(addToken({ tokens: [OTHER], muted: true }, PHONE)).toEqual({ tokens: [OTHER, PHONE] });
    expect(addToken({ tokens: [PHONE] }, PHONE)).toBeNull();
    expect(dropToken({ tokens: [OTHER, PHONE] }, PHONE)).toEqual({ tokens: [OTHER] });
    expect(dropToken({ tokens: [OTHER] }, PHONE)).toBeNull();
  });

  it('turning notifications on and off writes only bots that need it, and the mute switch survives', async () => {
    const h = hermes({ chief: { push: { tokens: [OTHER], muted: true } }, assistant: { push: { tokens: [PHONE] } }, scout: {} });
    const deps = { getPush: async (b: string) => (await h.getMeta(b)).push, setPush: (b: string, p: PushMeta) => h.setMeta(b, { push: p }) };
    const on = await setTokenOnBots(deps, ['chief', 'assistant', 'scout'], PHONE, true);
    expect(on).toEqual({ changed: ['chief', 'scout'], errors: {} });
    expect(h.meta.chief.push).toEqual({ tokens: [OTHER, PHONE], muted: true });
    const off = await setTokenOnBots(deps, ['chief', 'assistant', 'scout'], PHONE, false);
    expect(off.changed).toEqual(['chief', 'assistant', 'scout']);
    expect(h.meta.chief.push).toEqual({ tokens: [OTHER], muted: true });
  });

  it('one bot failing does not stop the rest', async () => {
    const deps = {
      getPush: async (b: string) => {
        if (b === 'a') throw new Error("Couldn't read a's settings");
        return undefined;
      },
      setPush: async () => {},
    };
    const r = await setTokenOnBots(deps, ['a', 'b'], PHONE, true);
    expect(r.changed).toEqual(['b']);
    expect(r.errors.a).toMatch(/settings/);
  });
});

describe('sync adds the token to bots that lack it', () => {
  const profile = (name: string): Profile => ({ name, description: '', model: 'm', provider: 'p', isDefault: false });
  function world(meta: Record<string, BotMeta>, local: LocalBot[], pushToken: string | null) {
    const h = hermes(meta);
    let saved = [...local];
    const deps: SyncDeps = {
      chatUrl: CHAT,
      listProfiles: async () => Object.keys(meta).map(profile),
      getMeta: h.getMeta,
      setMeta: h.setMeta,
      connect: async (bot) => ({ url: CHAT, bot, key: 'k'.repeat(64) }),
      local: async () => saved,
      save: async (conn) => void saved.push({ bot: conn.bot, url: conn.url }),
      update: async () => {},
      remove: async (bot) => void (saved = saved.filter((b) => b.bot !== bot)),
      pushToken,
    };
    return { h, deps };
  }

  it('a bot made on the desktop gets the phone token on the next sync; one that has it is left alone', async () => {
    const w = world({ chief: { push: { tokens: [PHONE] } }, fresh: {} }, [{ bot: 'chief', url: CHAT }], PHONE);
    const r = await syncBots(w.deps);
    expect(r.added).toEqual(['fresh']);
    expect(r.notify).toEqual(['fresh']);
    expect(w.h.puts).toEqual([{ bot: 'fresh', patch: { push: { tokens: [PHONE] } } }]);
  });

  it('notifications off on this phone: sync writes no tokens; hidden bots get none', async () => {
    expect((await syncBots(world({ chief: {} }, [{ bot: 'chief', url: CHAT }], null).deps)).notify).toEqual([]);
    const w = world({ chief: { hidden: true } }, [], PHONE);
    expect((await syncBots(w.deps)).notify).toEqual([]);
    expect(w.h.puts).toEqual([]);
  });
});

describe('what a push opens', () => {
  it('reads only data the plugin sends, for chats the app made', () => {
    expect(parsePushData({ bot: 'chief', kind: 'reply', chat: 'dork-bot-chief--abc' })).toEqual({ kind: 'reply', bot: 'chief', chat: 'dork-bot-chief--abc' });
    expect(parsePushData({ bot: 'chief', kind: 'approval', chat: 'dork-bot-chief' })).toEqual({ kind: 'approval', bot: 'chief', chat: 'dork-bot-chief' });
    expect(parsePushData({ bot: 'chief', kind: 'routine', job: 'j1' })).toEqual({ kind: 'routine', bot: 'chief', job: 'j1' });
    expect(parsePushData({ bot: 'chief', kind: 'reply', chat: 'dork-bot-assistant' })).toBeNull();
    expect(parsePushData({ bot: '../x', kind: 'routine' })).toBeNull();
    expect(parsePushData({ bot: 'chief', kind: 'other', chat: 'dork-bot-chief' })).toBeNull();
    expect(parsePushData(undefined)).toBeNull();
  });

  it('a reply or approval opens that chat (in the right pane with two panes); a routine opens Routine results', () => {
    const reply = { kind: 'reply' as const, bot: 'chief', chat: 'dork-bot-chief--abc' };
    expect(routeFor(reply, false)).toEqual({ pathname: '/chat/[bot]', params: { bot: 'chief', chat: 'dork-bot-chief--abc' } });
    expect(routeFor(reply, true)).toEqual({ pathname: '/', params: { bot: 'chief', chat: 'dork-bot-chief--abc' } });
    expect(routeFor({ kind: 'routine', bot: 'chief' }, false)).toEqual({ pathname: '/routine-results/[bot]', params: { bot: 'chief' } });
  });

  it("while the app is open, a reply in the chat on screen doesn't pop a banner; everything else does", () => {
    const reply = { kind: 'reply' as const, bot: 'chief', chat: 'dork-bot-chief' };
    expect(showWhileOpen(reply, { bot: 'chief', chat: 'dork-bot-chief' })).toBe(false);
    expect(showWhileOpen(reply, { bot: 'chief', chat: 'dork-bot-chief--other' })).toBe(true);
    expect(showWhileOpen(reply, { bot: 'assistant', chat: 'dork-bot-assistant' })).toBe(true);
    expect(showWhileOpen(reply, null)).toBe(true);
    expect(showWhileOpen({ ...reply, kind: 'approval' }, { bot: 'chief', chat: 'dork-bot-chief' })).toBe(true);
    expect(showWhileOpen(null, null)).toBe(true);
  });
});

describe('per-bot switch', () => {
  it('muting one bot leaves its phones and the other bots alone', async () => {
    const h = hermes({ chief: { push: { tokens: [PHONE] } }, assistant: { push: { tokens: [PHONE] } } });
    await h.setMeta('chief', { push: mutePatch(true) });
    expect(h.meta.chief.push).toEqual({ tokens: [PHONE], muted: true });
    expect(h.meta.assistant.push).toEqual({ tokens: [PHONE] });
    await h.setMeta('chief', { push: mutePatch(false) });
    expect(h.meta.chief.push).toEqual({ tokens: [PHONE], muted: false });
  });
});
