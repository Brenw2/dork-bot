import { useSyncExternalStore } from 'react';
import { activity } from '@/lib/activity';
import type { Mood } from '@/lib/sprites';

/** The bot's live mood (thinking, working, talking, done…), from whichever screen runs its chat. */
export function useBotMood(bot: string): Mood {
  return useSyncExternalStore(
    (fn) => activity.subscribe(fn),
    () => activity.get(bot),
  );
}
