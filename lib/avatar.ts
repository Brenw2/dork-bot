// A bot's notification avatar: its idle sprite as a PNG, kept where the Notification Service Extension
// (targets/notification-service) can read it without any network. Whenever a bot's look changes or
// syncs, the app re-renders that bot's picture and stores it, base64, in the shared App Group under
// `avatar.<profile id>`; the extension looks it up with the `bot` field the push already carries.
// Plain TypeScript (own PNG writer, no canvas, no zlib), so it is unit-tested in Node and runs in Hermes.
import { CANVAS, frameSpec, renderFrame, type Look } from './sprites';

/** Pixels per sprite pixel; the 20x20 canvas becomes 160x160, sharp at 3x on a 53 pt avatar. */
export const SCALE = 8;
export const AVATAR_SIZE = CANVAS * SCALE;
/** Behind the sprite. Communication Notifications crop the picture to a circle, so it is opaque. */
export const AVATAR_BG = '#1A1C20';
/** Bump when the drawing changes, so every bot's picture is re-rendered once. */
export const AVATAR_VERSION = 1;
/** The App Group shared with the extension (app.json entitlements, targets/notification-service). */
export const APP_GROUP = 'group.com.brenw2.dorkbot';

export const avatarKey = (bot: string) => `avatar.${bot}`;
const sigKey = (bot: string) => `avatar-sig.${bot}`;
const INDEX_KEY = 'avatar-index';

// ---- PNG -----------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  out.set(u32(data.length), 0);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  out.set(u32(crc32(out, 4, 8 + data.length)), 8 + data.length);
  return out;
}

/** zlib stream of stored (uncompressed) deflate blocks: valid everywhere, no compressor needed. */
function zlibStored(raw: Uint8Array): Uint8Array {
  const MAX = 65535;
  const blocks = Math.max(1, Math.ceil(raw.length / MAX));
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let o = 2;
  for (let i = 0; i < blocks; i++) {
    const part = raw.subarray(i * MAX, Math.min(raw.length, (i + 1) * MAX));
    out[o++] = i === blocks - 1 ? 1 : 0;
    out[o++] = part.length & 255;
    out[o++] = part.length >>> 8;
    out[o++] = ~part.length & 255;
    out[o++] = (~part.length >>> 8) & 255;
    out.set(part, o);
    o += part.length;
  }
  out.set(u32(adler32(raw)), o);
  return out;
}

/** An 8-bit palette PNG (color type 3). `indices` is width*height palette indexes, row by row. */
export function encodePng(width: number, height: number, palette: [number, number, number][], indices: Uint8Array): Uint8Array {
  if (indices.length !== width * height) throw new Error('encodePng: pixel count does not match the size');
  if (palette.length < 1 || palette.length > 256) throw new Error('encodePng: palette must have 1 to 256 colors');
  const ihdr = new Uint8Array([...u32(width), ...u32(height), 8, 3, 0, 0, 0]);
  const plte = new Uint8Array(palette.flat());
  const raw = new Uint8Array(height * (width + 1)); // each row starts with filter type 0 (None)
  for (let y = 0; y < height; y++) raw.set(indices.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    chunk('IDAT', zlibStored(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** The bot's idle sprite (its character, look and color; the still frame Reduce Motion shows) as a PNG. */
export function avatarPng(look: Look): Uint8Array {
  const frame = renderFrame(look.character, look.color, frameSpec('idle', 1), look.variant);
  const palette: [number, number, number][] = [rgb(AVATAR_BG)];
  const grid = new Uint8Array(CANVAS * CANVAS); // 0 = background
  for (const [hex, pixels] of frame) {
    palette.push(rgb(hex));
    for (const [x, y] of pixels) grid[y * CANVAS + x] = palette.length - 1;
  }
  const indices = new Uint8Array(AVATAR_SIZE * AVATAR_SIZE);
  for (let y = 0; y < AVATAR_SIZE; y++) {
    const row = Math.floor(y / SCALE) * CANVAS;
    for (let x = 0; x < AVATAR_SIZE; x++) indices[y * AVATAR_SIZE + x] = grid[row + Math.floor(x / SCALE)];
  }
  return encodePng(AVATAR_SIZE, AVATAR_SIZE, palette, indices);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return out;
}

// ---- Keeping the shared store up to date ------------------------------------------------------

/** The App Group's shared storage (components/avatars.ts: ExtensionStorage). */
export interface AvatarStore {
  get(key: string): string | null | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface AvatarBot {
  bot: string;
  look: Look;
}

export interface AvatarSyncResult {
  /** Bots whose picture was (re)rendered: new, or the look or the drawing changed. */
  written: string[];
  /** Bots that are gone (deleted, hidden): their picture is deleted. */
  removed: string[];
  errors: Record<string, string>;
}

export function lookSignature(look: Look): string {
  return `${AVATAR_VERSION}:${look.character}:${look.variant}:${look.color.toLowerCase()}`;
}

function readIndex(store: AvatarStore): string[] {
  try {
    const parsed: unknown = JSON.parse(store.get(INDEX_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((b): b is string => typeof b === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Makes the shared store hold one current PNG per bot, keyed by profile id. Only bots whose look
 * changed (or whose file is missing) are re-rendered. One bot failing doesn't stop the others.
 */
export function syncAvatars(store: AvatarStore, bots: AvatarBot[]): AvatarSyncResult {
  const result: AvatarSyncResult = { written: [], removed: [], errors: {} };
  const keep = new Set<string>();
  for (const { bot, look } of bots) {
    try {
      const sig = lookSignature(look);
      if (store.get(sigKey(bot)) !== sig || !store.get(avatarKey(bot))) {
        store.set(avatarKey(bot), toBase64(avatarPng(look)));
        store.set(sigKey(bot), sig);
        result.written.push(bot);
      }
      keep.add(bot);
    } catch (e) {
      result.errors[bot] = e instanceof Error ? e.message : String(e);
    }
  }
  for (const bot of readIndex(store)) {
    if (keep.has(bot) || result.errors[bot]) continue;
    store.remove(avatarKey(bot));
    store.remove(sigKey(bot));
    result.removed.push(bot);
  }
  const previous = readIndex(store);
  // A bot whose render failed keeps its old picture (and its place in the index) until it renders.
  const index = JSON.stringify([...keep, ...previous.filter((b) => result.errors[b] !== undefined)]);
  if (index !== (store.get(INDEX_KEY) || '[]')) store.set(INDEX_KEY, index);
  return result;
}

export interface AvatarDeps {
  store: AvatarStore;
  /** The saved bots on this phone, with the look each shows (picked, else the default from its name). */
  bots: () => Promise<AvatarBot[]>;
}

let running: Promise<AvatarSyncResult> | null = null;
let again = false;

/**
 * Brings the shared pictures in line with the bot list. Called on launch and on every change to the
 * list (a look picked here, a look or rename synced from Hermes). Runs one at a time; a change that
 * lands mid-run triggers one more pass, so the last look always wins.
 */
export async function exportAvatars(deps: AvatarDeps): Promise<AvatarSyncResult> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    let result: AvatarSyncResult = { written: [], removed: [], errors: {} };
    do {
      again = false;
      const next = syncAvatars(deps.store, await deps.bots());
      result = {
        written: [...new Set([...result.written, ...next.written])],
        removed: [...new Set([...result.removed, ...next.removed])],
        errors: { ...result.errors, ...next.errors },
      };
    } while (again);
    return result;
  })().finally(() => {
    running = null;
  });
  return running;
}
