import { useCallback, useEffect, useState } from 'react';
import { fetch } from '@/components/net';
import { getConnection, listBots, onBotsChanged } from '@/lib/bots';
import { chatSessionId, HermesClient, type FetchLike } from '@/lib/hermes';
import { chatModel, type ChatModel, type ModelCatalog } from '@/lib/models';

export interface ChatModelState extends ChatModel {
  catalog: ModelCatalog | null;
  client: HermesClient | null;
  error: string | null;
  reload: () => void;
}

/**
 * The bot's chat model, its model list, and a client to switch it. Re-reads when the bot list
 * changes (setModelChoice fires that), so the chat's model line updates after a pick.
 */
export function useChatModel(bot: string): ChatModelState {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [client, setClient] = useState<HermesClient | null>(null);
  const [sessionModel, setSessionModel] = useState<string | null>(null);
  const [saved, setSaved] = useState<ChatModel['choice']>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => onBotsChanged(reload), [reload]);

  useEffect(() => {
    let live = true;
    (async () => {
      const conn = await getConnection(bot);
      if (!conn) return;
      const c = new HermesClient(conn, fetch as unknown as FetchLike);
      if (live) setClient(c);
      try {
        const [list, model, bots] = await Promise.all([c.modelOptions(), c.sessionModel(chatSessionId(bot)), listBots()]);
        if (!live) return;
        setCatalog(list);
        setSessionModel(model);
        setSaved(bots.find((b) => b.bot === bot)?.model ?? null);
        setError(null);
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    })();
    return () => {
      live = false;
    };
  }, [bot, tick]);

  return { ...chatModel(sessionModel, saved, catalog), catalog, client, error, reload };
}
