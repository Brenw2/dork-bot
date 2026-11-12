import { useEffect, useState } from 'react';
import { listBots, onBotsChanged } from '@/lib/bots';
import { characterFor, looksOf, type Look } from '@/lib/sprites';
import { botColor } from '@/lib/theme';

/** Default look for a name: a character picked from the name, its first look, and the name's color. */
export function defaultLook(name: string): Look {
  return { character: characterFor(name), variant: 0, color: botColor(name) };
}

/** Saved looks may name a look that no longer exists; fall back to the character's first one. */
export function cleanLook(look: Look): Look {
  return look.variant < looksOf(look.character).length ? look : { ...look, variant: 0 };
}

/** The look to show for a bot: the one saved for it, else the default from its name. */
export function lookFor(bot: string, saved?: Look): Look {
  return saved ? cleanLook({ ...defaultLook(bot), ...saved }) : defaultLook(bot);
}

/** The bot's look (character, which version of it, color): the one picked for it, else the default. */
export function useBotLook(bot: string): Look {
  const [look, setLook] = useState<Look>(() => defaultLook(bot));
  useEffect(() => {
    let live = true;
    const load = () =>
      listBots().then((list) => {
        const saved = list.find((b) => b.bot === bot)?.look;
        if (live) setLook(lookFor(bot, saved));
      });
    load();
    const off = onBotsChanged(load);
    return () => {
      live = false;
      off();
    };
  }, [bot]);
  return look;
}
