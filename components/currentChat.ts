// Which chat is open for each bot. Nothing is saved on the device: when a bot's chat opens and no
// chat was picked yet, it's the bot's most recently used chat on Hermes, whichever device used it
// last. So the phone picks up where the desktop left off, and the other way round.
import { useEffect, useState } from 'react';
import { fetch } from '@/components/net';
import { getConnection } from '@/lib/bots';
import { firstChatId, newChatId } from '@/lib/chats';
import { HermesClient, type FetchLike } from '@/lib/hermes';

const open = new Map<string, string>();
const listeners = new Set<(bot: string) => void>();
const resolving = new Map<string, Promise<string>>();

export function currentChat(bot: string): string | null {
  return open.get(bot) ?? null;
}

export function openChat(bot: string, chat: string): void {
  if (open.get(bot) === chat) return;
  open.set(bot, chat);
  listeners.forEach((fn) => fn(bot));
}

/** Opens a new, empty chat. Hermes only creates it when the first message is sent. */
export function startNewChat(bot: string): string {
  const id = newChatId(bot);
  openChat(bot, id);
  return id;
}

/** The bot's most recently used chat, or its first chat when it has none (or Hermes can't be reached). */
export async function latestChat(bot: string): Promise<string> {
  const conn = await getConnection(bot);
  if (!conn) return firstChatId(bot);
  try {
    const chats = await new HermesClient(conn, fetch as unknown as FetchLike).listChats();
    return chats[0]?.id ?? firstChatId(bot);
  } catch {
    return firstChatId(bot);
  }
}

/** The open chat for a bot, picking the latest one on Hermes the first time. Null while it looks. */
export function useCurrentChat(bot: string): string | null {
  const [chat, setChat] = useState<string | null>(() => currentChat(bot));
  useEffect(() => {
    setChat(currentChat(bot));
    const off = subscribe((b) => b === bot && setChat(currentChat(bot)));
    if (!currentChat(bot)) {
      let p = resolving.get(bot);
      if (!p) {
        p = latestChat(bot).finally(() => resolving.delete(bot));
        resolving.set(bot, p);
      }
      void p.then((id) => {
        if (!currentChat(bot)) openChat(bot, id);
      });
    }
    return off;
  }, [bot]);
  return chat;
}

export function subscribe(fn: (bot: string) => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
