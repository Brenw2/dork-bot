// Wires lib/sync.ts to the app: runs when the bot list shows and when the app comes back, at
// most every few seconds, and pushes look/model/hidden changes made on this device to Hermes.
// Without the Hermes sign-in (scripts/pair-hermes.sh) there's nothing to sync with: the bot list
// stays this device's own, as before.
import { AppState } from 'react-native';
import { loadManager, randomKey } from '@/components/manager';
import { listBots, removeBot, saveBot, updateBot } from '@/lib/bots';
import type { BotMeta } from '@/lib/manager';
import { syncBots, type SyncResult } from '@/lib/sync';

const MIN_GAP_MS = 5000;
let running: Promise<SyncResult | null> | null = null;
let lastRun = 0;

/** Brings this device's bot list in line with Hermes. Concurrent calls share one run. */
export function syncNow(force = false): Promise<SyncResult | null> {
  if (running) return running;
  if (!force && Date.now() - lastRun < MIN_GAP_MS) return Promise.resolve(null);
  running = (async () => {
    try {
      const manager = await loadManager();
      if (!manager) return null;
      return await syncBots({
        chatUrl: manager.chatUrl,
        listProfiles: () => manager.listProfiles(),
        getMeta: (bot) => manager.getMeta(bot),
        setMeta: (bot, patch) => manager.setMeta(bot, patch),
        connect: (bot) => manager.connectExisting(bot, randomKey),
        local: listBots,
        save: (conn, meta) => saveBot(conn, meta.look, meta.model),
        update: (bot, meta) => updateBot(bot, meta),
        remove: removeBot,
      });
    } catch {
      // Hermes unreachable or signed out: keep what's on the device; the next sync tries again.
      return null;
    } finally {
      lastRun = Date.now();
      running = null;
    }
  })();
  return running;
}

/** Saves a change made on this device for the other devices. Best effort: the bot list sync retries looks/models that never made it up. */
export async function pushMeta(bot: string, patch: BotMeta): Promise<void> {
  try {
    const manager = await loadManager();
    await manager?.setMeta(bot, patch);
  } catch {
    // offline; the local copy still has it
  }
}

AppState.addEventListener('change', (state) => {
  if (state === 'active') void syncNow();
});
