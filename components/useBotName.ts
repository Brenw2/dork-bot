import { useEffect, useState } from 'react';
import { Alert } from '@/components/alert';
import { loadManager } from '@/components/manager';
import { listBots, onBotsChanged, setDisplayName } from '@/lib/bots';
import { cleanDisplayName, MAX_NAME_LENGTH, nameOf } from '@/lib/names';

/** The name to show for a bot: the one set with Rename…, else its profile id. Never use it for ids. */
export function useBotName(bot: string): string {
  const [name, setName] = useState(bot);
  useEffect(() => {
    let live = true;
    const load = () =>
      listBots().then((list) => {
        if (live) setName(nameOf(bot, list.find((b) => b.bot === bot)?.displayName));
      });
    load();
    const off = onBotsChanged(load);
    return () => {
      live = false;
      off();
    };
  }, [bot]);
  return name;
}

/** Long-press → Rename… and the chat's ⋯ menu. Saves on Hermes first so every device gets it, then here. */
export function renameBot(bot: string, current: string): void {
  Alert.prompt(
    'Rename bot',
    `Now: ${current}. Only the name changes; its chats and routines stay.`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Rename',
        onPress: async (typed?: string) => {
          const name = cleanDisplayName(typed);
          if (!name) return Alert.alert("That name won't work", `Use 1 to ${MAX_NAME_LENGTH} characters.`);
          try {
            const manager = await loadManager();
            await manager?.setMeta(bot, { name });
            await setDisplayName(bot, name);
          } catch (e) {
            Alert.alert("Couldn't rename it", (e as Error).message);
          }
        },
      },
    ],
    'plain-text',
  );
}
