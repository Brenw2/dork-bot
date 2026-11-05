// Keeps the app's bot list the same on every device (phone, desktop). Hermes is the source of
// truth: every profile on it is a bot, and each bot's look, model pick and "hidden" flag live in
// its profile config (`dork_bot:`, see HermesManager.getMeta). The chats themselves are already
// shared: each bot has one Hermes session (chatSessionId), whichever device sends.
// Plain TypeScript with injected effects, so it's unit-tested without React Native.
import type { BotConnection } from './hermes';
import type { BotMeta, Profile } from './manager';
import type { ModelChoice } from './models';
import type { Look } from './sprites';

/** The saved-bot fields sync reads (lib/bots.ts SavedBot). */
export interface LocalBot {
  bot: string;
  url: string;
  look?: Look;
  model?: ModelChoice;
  displayName?: string;
}

export interface SyncDeps {
  chatUrl: string;
  listProfiles: () => Promise<Profile[]>;
  getMeta: (bot: string) => Promise<BotMeta>;
  setMeta: (bot: string, patch: BotMeta) => Promise<void>;
  /** Fetches (or makes) the bot's key and checks it, like New bot → add existing. */
  connect: (bot: string) => Promise<BotConnection>;
  local: () => Promise<LocalBot[]>;
  save: (conn: BotConnection, meta: BotMeta) => Promise<void>;
  /** Stores a look/model that came from another device. */
  update: (bot: string, patch: { look?: Look; model?: ModelChoice; displayName?: string }) => Promise<void>;
  remove: (bot: string) => Promise<void>;
}

export interface SyncResult {
  added: string[];
  removed: string[];
  updated: string[];
  /** Pushed this device's look/model up because Hermes had none yet (first sync after the update). */
  pushed: string[];
  /** Per-bot problems; the rest of the sync still ran. */
  errors: Record<string, string>;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export async function syncBots(deps: SyncDeps): Promise<SyncResult> {
  const result: SyncResult = { added: [], removed: [], updated: [], pushed: [], errors: {} };
  const [profiles, local] = await Promise.all([deps.listProfiles(), deps.local()]);
  const onHermes = new Set(profiles.map((p) => p.name));
  const localByName = new Map(local.map((b) => [b.bot, b]));
  // Bots on this Hermes. One added by hand from another address is left alone.
  const ours = (b: LocalBot) => sameHost(b.url, deps.chatUrl);

  // Deleted on another device (or in Hermes itself).
  for (const b of local) {
    if (ours(b) && !onHermes.has(b.bot) && b.bot !== 'default') {
      await deps.remove(b.bot);
      result.removed.push(b.bot);
    }
  }

  // The default profile is a bot only where it was added by hand.
  const candidates = profiles.filter((p) => !p.isDefault || localByName.has(p.name));
  for (const p of candidates) {
    const mine = localByName.get(p.name);
    if (mine && !ours(mine)) continue;
    try {
      const meta = await deps.getMeta(p.name);
      if (meta.hidden) {
        if (mine) {
          await deps.remove(p.name);
          result.removed.push(p.name);
        }
        continue;
      }
      if (!mine) {
        const conn = await deps.connect(p.name);
        await deps.save(conn, meta);
        result.added.push(p.name);
        continue;
      }
      // Hermes wins; but the first time, it has nothing yet, so this device's picks go up.
      const up: BotMeta = {};
      if (!meta.look && mine.look) up.look = mine.look;
      if (!meta.model && mine.model) up.model = mine.model;
      if (!meta.name && mine.displayName) up.name = mine.displayName;
      if (up.look || up.model || up.name) {
        await deps.setMeta(p.name, up);
        result.pushed.push(p.name);
      }
      const down: { look?: Look; model?: ModelChoice; displayName?: string } = {};
      if (meta.look && !same(meta.look, mine.look)) down.look = meta.look;
      if (meta.model && !same(meta.model, mine.model)) down.model = meta.model;
      if (meta.name && meta.name !== mine.displayName) down.displayName = meta.name;
      if (down.look || down.model || down.displayName) {
        await deps.update(p.name, down);
        result.updated.push(p.name);
      }
    } catch (e) {
      result.errors[p.name] = e instanceof Error ? e.message : String(e);
    }
  }
  return result;
}

/** Same Hermes, whatever the trailing slash or a default port. */
export function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return a === b;
  }
}
