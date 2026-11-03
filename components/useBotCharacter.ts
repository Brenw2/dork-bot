import { useEffect, useState } from 'react';
import { listBots, onBotsChanged } from '@/lib/bots';
import { characterFor, type CharacterId } from '@/lib/sprites';

/** The bot's pixel character: the one picked for it, else the default from its name. */
export function useBotCharacter(bot: string): CharacterId {
  const [id, setId] = useState<CharacterId>(() => characterFor(bot));
  useEffect(() => {
    let live = true;
    const load = () =>
      listBots().then((list) => {
        if (live) setId(list.find((b) => b.bot === bot)?.character ?? characterFor(bot));
      });
    load();
    const off = onBotsChanged(load);
    return () => {
      live = false;
      off();
    };
  }, [bot]);
  return id;
}
