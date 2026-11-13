// Bot-level actions from the bot sheet: hide a bot from this app, or delete its profile on Hermes.
// (Moved out of the bot list, whose long-press menu is now the bot sheet.)
import { Alert } from '@/components/alert';
import { loadManager } from '@/components/manager';
import { pushMeta } from '@/components/sync';
import { removeBot } from '@/lib/bots';

/** Hide: it goes from Dork Bot on every device, but stays on Hermes. `done` runs after it's hidden. */
export function hideBot(bot: string, shown: string, done?: () => void): void {
  Alert.alert(`Hide ${shown}?`, 'It goes from Dork Bot on your phone and desktop, but stays on Hermes. Add it back from New bot.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Hide', style: 'destructive', onPress: () => removeBot(bot).then(() => pushMeta(bot, { hidden: true })).then(done) },
  ]);
}

/** Deleting a Hermes profile wipes its memory, chats and routines, so make him type the name. */
export function deleteBotFromHermes(bot: string, done?: () => void): void {
  Alert.prompt(
    `Delete ${bot}?`,
    `This deletes the bot on Hermes for good: its memory, chats and routines. Type ${bot} to confirm.`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async (typed?: string) => {
          if (typed?.trim().toLowerCase() !== bot) return Alert.alert('Not deleted', "The name didn't match.");
          try {
            const manager = await loadManager();
            if (!manager) return Alert.alert('Connect to Hermes first', 'Run scripts/pair-hermes.sh on b-lab and scan the code.');
            await manager.deleteBot(bot);
            await removeBot(bot);
            done?.();
          } catch (e) {
            Alert.alert(`Couldn't delete ${bot}`, (e as Error).message);
          }
        },
      },
    ],
    'plain-text',
  );
}
