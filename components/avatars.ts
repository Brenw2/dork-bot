// Keeps each bot's notification avatar (lib/avatar.ts) up to date in the App Group, where the
// Notification Service Extension reads it (targets/notification-service). Runs on launch and every
// time the bot list changes: a look picked here, or a look synced from another device (lib/sync.ts).
// The web build (desktop app) gets avatars.web.ts, where it does nothing.
import { ExtensionStorage } from '@bacons/apple-targets';
import { useEffect } from 'react';
import { lookFor } from '@/components/useBotLook';
import { APP_GROUP, exportAvatars, type AvatarStore } from '@/lib/avatar';
import { listBots, onBotsChanged } from '@/lib/bots';

const group = new ExtensionStorage(APP_GROUP);
const store: AvatarStore = {
  get: (key) => group.get(key),
  set: (key, value) => group.set(key, value),
  remove: (key) => group.remove(key),
};

async function run(): Promise<void> {
  try {
    await exportAvatars({
      store,
      bots: async () => (await listBots()).map((b) => ({ bot: b.bot, look: lookFor(b.bot, b.look) })),
    });
  } catch {
    // The picture is a nicety: a notification without it shows as before. The next change retries.
  }
}

/** Mounted once in the root layout. */
export function AvatarExport(): null {
  useEffect(() => {
    void run();
    return onBotsChanged(() => void run());
  }, []);
  return null;
}
