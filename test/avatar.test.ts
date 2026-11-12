import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  AVATAR_SIZE,
  AVATAR_VERSION,
  APP_GROUP,
  avatarKey,
  avatarPng,
  encodePng,
  exportAvatars,
  lookSignature,
  syncAvatars,
  toBase64,
  type AvatarBot,
  type AvatarStore,
} from '@/lib/avatar';
import { CHARACTER_IDS, looksOf, type Look } from '@/lib/sprites';

/** Reads a palette PNG back with Node's zlib: size, palette and the color of every pixel. */
function decode(png: Uint8Array) {
  const buf = Buffer.from(png);
  expect([...buf.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  let o = 8;
  let width = 0;
  let height = 0;
  let palette: number[] = [];
  const idat: Buffer[] = [];
  const types: string[] = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('latin1', o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    types.push(type);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect([...data.subarray(8)]).toEqual([8, 3, 0, 0, 0]);
    }
    if (type === 'PLTE') palette = [...data];
    if (type === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  expect(types).toEqual(['IHDR', 'PLTE', 'IDAT', 'IEND']);
  const raw = inflateSync(Buffer.concat(idat)); // throws on a bad zlib stream or Adler-32
  expect(raw.length).toBe(height * (width + 1));
  const pixel = (x: number, y: number) => {
    const i = raw[y * (width + 1) + 1 + x];
    return '#' + [0, 1, 2].map((k) => palette[i * 3 + k].toString(16).padStart(2, '0')).join('');
  };
  return { width, height, pixel };
}

class Store implements AvatarStore {
  data = new Map<string, string>();
  writes: string[] = [];
  get = (k: string) => this.data.get(k) ?? null;
  set = (k: string, v: string) => {
    this.writes.push(k);
    this.data.set(k, v);
  };
  remove = (k: string) => void this.data.delete(k);
  png(bot: string) {
    return Buffer.from(this.data.get(avatarKey(bot)) ?? '', 'base64');
  }
}

const chief: Look = { character: 'robot', variant: 0, color: '#8B7CF6' };
const bots = (...list: [string, Look][]): AvatarBot[] => list.map(([bot, look]) => ({ bot, look }));

describe('the avatar picture', () => {
  it('is a valid square PNG of the idle sprite in the bot color', () => {
    const img = decode(avatarPng(chief));
    expect([img.width, img.height]).toEqual([AVATAR_SIZE, AVATAR_SIZE]);
    expect(img.pixel(0, 0)).toBe('#1a1c20'); // background corner
    // The robot's body is #8B7CF6 (lighter along the top edge, darker along the bottom, outline around).
    const colors = new Set<string>();
    for (let y = 0; y < AVATAR_SIZE; y += 4) for (let x = 0; x < AVATAR_SIZE; x += 4) colors.add(img.pixel(x, y));
    expect(colors.has('#8b7cf6')).toBe(true);
    expect(colors.has('#16141f')).toBe(true); // outline
  });

  it('makes every look of every character, each different from the others', () => {
    const seen = new Set<string>();
    for (const id of CHARACTER_IDS) {
      looksOf(id).forEach((_, variant) => {
        const png = avatarPng({ character: id, variant, color: '#4CC38A' });
        decode(png);
        seen.add(toBase64(png));
      });
    }
    expect(seen.size).toBe(CHARACTER_IDS.reduce((n, id) => n + looksOf(id).length, 0));
  });

  it("draws the bot's color, not a fixed one", () => {
    expect(toBase64(avatarPng({ ...chief, color: '#F25F5C' }))).not.toBe(toBase64(avatarPng(chief)));
  });

  it('is the same bytes every time', () => {
    expect(toBase64(avatarPng(chief))).toBe(toBase64(avatarPng({ ...chief })));
  });

  it('stays small enough to keep in shared preferences', () => {
    expect(toBase64(avatarPng(chief)).length).toBeLessThan(40_000);
  });

  it('the PNG writer handles data bigger than one deflate block', () => {
    const w = 300;
    const idx = new Uint8Array(w * w).map((_, i) => i % 3);
    const img = decode(encodePng(w, w, [[0, 0, 0], [255, 0, 0], [0, 255, 0]], idx));
    expect(img.pixel(1, 0)).toBe('#ff0000');
    expect(img.pixel(299, 299)).toBe(['#000000', '#ff0000', '#00ff00'][(299 * 300 + 299) % 3]);
  });

  it('base64 matches Node', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 100]) {
      const b = new Uint8Array(n).map((_, i) => (i * 37 + 11) & 255);
      expect(toBase64(b)).toBe(Buffer.from(b).toString('base64'));
    }
  });

  it('uses the App Group the entitlements name', async () => {
    const app = (await import('../app.json')).default.expo;
    expect(app.ios.entitlements['com.apple.security.application-groups']).toContain(APP_GROUP);
  });
});

describe('the avatar file per bot', () => {
  it('writes one picture per bot, keyed by profile id', () => {
    const store = new Store();
    const r = syncAvatars(store, bots(['chief', chief], ['assistant', { character: 'cat', variant: 0, color: '#F2A65A' }]));
    expect(r.written.sort()).toEqual(['assistant', 'chief']);
    expect(decode(store.png('chief')).width).toBe(AVATAR_SIZE);
    expect(decode(store.png('assistant')).width).toBe(AVATAR_SIZE);
    expect(store.png('chief').equals(store.png('assistant'))).toBe(false);
    expect(store.png('nobody').length).toBe(0); // a bot with no file: the extension shows a plain notification
  });

  it("refreshes a bot's picture when its look changes, and only that bot's", () => {
    const store = new Store();
    const cat: Look = { character: 'cat', variant: 0, color: '#F2A65A' };
    syncAvatars(store, bots(['chief', chief], ['assistant', cat]));
    const before = { chief: store.png('chief'), assistant: store.png('assistant') };

    const r = syncAvatars(store, bots(['chief', { ...chief, color: '#F25F5C' }], ['assistant', cat]));
    expect(r.written).toEqual(['chief']);
    expect(store.png('chief').equals(before.chief)).toBe(false);
    expect(store.png('assistant').equals(before.assistant)).toBe(true);

    const r2 = syncAvatars(store, bots(['chief', { ...chief, color: '#F25F5C', variant: 1 }], ['assistant', cat]));
    expect(r2.written).toEqual(['chief']); // a different look of the same character counts too
  });

  it('leaves everything alone when nothing changed', () => {
    const store = new Store();
    syncAvatars(store, bots(['chief', chief]));
    store.writes.length = 0;
    expect(syncAvatars(store, bots(['chief', { ...chief, color: chief.color.toLowerCase() }])).written).toEqual([]);
    expect(store.writes).toEqual([]);
  });

  it('re-renders a missing file, and everything when the drawing version changes', () => {
    const store = new Store();
    syncAvatars(store, bots(['chief', chief]));
    store.data.delete(avatarKey('chief'));
    expect(syncAvatars(store, bots(['chief', chief])).written).toEqual(['chief']);
    store.data.set('avatar-sig.chief', lookSignature(chief).replace(`${AVATAR_VERSION}:`, '0:'));
    expect(syncAvatars(store, bots(['chief', chief])).written).toEqual(['chief']);
  });

  it('deletes the picture of a bot that is gone', () => {
    const store = new Store();
    syncAvatars(store, bots(['chief', chief], ['assistant', chief]));
    const r = syncAvatars(store, bots(['chief', chief]));
    expect(r.removed).toEqual(['assistant']);
    expect([...store.data.keys()].filter((k) => k.includes('assistant'))).toEqual([]);
    expect(store.data.has(avatarKey('chief'))).toBe(true);
  });

  it('survives a broken bot and still does the others', () => {
    const store = new Store();
    const r = syncAvatars(store, bots(['bad', { character: 'nope' as never, variant: 0, color: '#8B7CF6' }], ['chief', chief]));
    expect(Object.keys(r.errors)).toEqual(['bad']);
    expect(r.written).toEqual(['chief']);
  });
});

describe('exportAvatars (what runs when the bot list changes)', () => {
  it('writes on launch, then follows a look change made while it runs', async () => {
    const store = new Store();
    let list = bots(['chief', chief]);
    const deps = { store, bots: async () => list };
    expect((await exportAvatars(deps)).written).toEqual(['chief']);
    const first = store.png('chief');
    list = bots(['chief', { ...chief, character: 'owl' }]);
    expect((await exportAvatars(deps)).written).toEqual(['chief']);
    expect(store.png('chief').equals(first)).toBe(false);
  });

  it('a change that lands during a run gets one more pass, so the last look wins', async () => {
    const store = new Store();
    let list = bots(['chief', chief]);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const deps = {
      store,
      bots: async () => {
        calls++;
        if (calls === 1) await gate;
        return list;
      },
    };
    const a = exportAvatars(deps);
    list = bots(['chief', { ...chief, color: '#3FC1C9' }]);
    const b = exportAvatars(deps); // joins the run in flight
    release();
    await Promise.all([a, b]);
    expect(calls).toBe(2);
    expect(store.data.get('avatar-sig.chief')).toBe(lookSignature({ ...chief, color: '#3FC1C9' }));
  });
});
