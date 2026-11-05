import { describe, expect, it } from 'vitest';
import type { BotConnection } from '@/lib/hermes';
import { cleanMeta, type BotMeta, type Profile } from '@/lib/manager';
import { cleanDisplayName, MAX_NAME_LENGTH, nameOf } from '@/lib/names';
import { syncBots, type LocalBot, type SyncDeps } from '@/lib/sync';

const CHAT = 'https://b-lab.tail7e27a7.ts.net';
const profile = (name: string): Profile => ({ name, description: '', model: 'm', provider: 'custom', isDefault: false });

function world(meta: Record<string, BotMeta>, local: LocalBot[]) {
  const m = structuredClone(meta);
  let l = structuredClone(local);
  const deps: SyncDeps = {
    chatUrl: CHAT,
    listProfiles: async () => [profile('chief')],
    getMeta: async (bot) => m[bot] ?? {},
    setMeta: async (bot, patch) => void (m[bot] = { ...m[bot], ...patch }),
    connect: async (bot) => ({ url: CHAT, bot, key: 'k'.repeat(64) }) satisfies BotConnection,
    local: async () => l,
    save: async (conn, x) => void l.push({ bot: conn.bot, url: conn.url, displayName: x.name }),
    update: async (bot, patch) => void (l = l.map((b) => (b.bot === bot ? { ...b, ...patch } : b))),
    remove: async (bot) => void (l = l.filter((b) => b.bot !== bot)),
  };
  return { deps, meta: m, local: () => l };
}

describe('display names', () => {
  it('trims, collapses spaces, and rejects empty or too long names', () => {
    expect(cleanDisplayName('  Big   Chief ')).toBe('Big Chief');
    expect(cleanDisplayName('')).toBeNull();
    expect(cleanDisplayName('   ')).toBeNull();
    expect(cleanDisplayName(undefined)).toBeNull();
    expect(cleanDisplayName('x'.repeat(MAX_NAME_LENGTH))).not.toBeNull();
    expect(cleanDisplayName('x'.repeat(MAX_NAME_LENGTH + 1))).toBeNull();
  });

  it('shows the profile id until a name is set', () => {
    expect(nameOf('chief')).toBe('chief');
    expect(nameOf('chief', 'The Boss')).toBe('The Boss');
  });

  it('is read from the dork_bot block, and bad values are dropped', () => {
    expect(cleanMeta({ name: ' The Boss ' })).toEqual({ name: 'The Boss' });
    expect(cleanMeta({ name: 7 })).toEqual({});
    expect(cleanMeta({ name: '' })).toEqual({});
  });

  it('a new device gets the name; a rename on another device comes down', async () => {
    const fresh = world({ chief: { name: 'The Boss' } }, []);
    await syncBots(fresh.deps);
    expect(fresh.local()).toMatchObject([{ bot: 'chief', displayName: 'The Boss' }]);

    const other = world({ chief: { name: 'Boss 2' } }, [{ bot: 'chief', url: CHAT, displayName: 'The Boss' }]);
    const r = await syncBots(other.deps);
    expect(r.updated).toEqual(['chief']);
    expect(other.local()[0]).toMatchObject({ bot: 'chief', displayName: 'Boss 2' }); // profile id unchanged
  });

  it("this device's name goes up when Hermes has none yet", async () => {
    const w = world({}, [{ bot: 'chief', url: CHAT, displayName: 'The Boss' }]);
    const r = await syncBots(w.deps);
    expect(r.pushed).toEqual(['chief']);
    expect(w.meta.chief).toEqual({ name: 'The Boss' });
  });
});
