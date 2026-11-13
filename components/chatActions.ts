// Chat-level actions shared by the chat's ⋯ menu and the Chats screen: rename, delete, and the
// signal that the chat list changed. (Moved out of ChatView so the header can use them.)
import { fetch } from '@/components/net';
import { Alert } from '@/components/alert';
import { currentChat, latestChat, openChat, startNewChat } from '@/components/currentChat';
import { getConnection } from '@/lib/bots';
import { chatName } from '@/lib/chats';
import { HermesClient, type FetchLike } from '@/lib/hermes';

async function chatClient(bot: string): Promise<HermesClient | null> {
  const conn = await getConnection(bot);
  return conn ? new HermesClient(conn, fetch as unknown as FetchLike) : null;
}

/** Renames the open chat (an empty name hands naming back to Hermes). */
export async function renameChat(bot: string, chat: string): Promise<void> {
  const client = await chatClient(bot);
  if (!client) return;
  const current = (await client.listChats().catch(() => [])).find((c) => c.id === chat);
  if (!current) return Alert.alert('Nothing to rename yet', 'Send a message first; the chat starts then.');
  Alert.prompt(
    'Rename chat',
    `Now: ${chatName(bot, current)}`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Rename',
        onPress: (title?: string) => {
          client.renameChat(chat, title ?? '').then(notifyChatsChanged, (e: Error) => Alert.alert("Couldn't rename it", e.message));
        },
      },
    ],
    'plain-text',
  );
}

/** Deletes a chat on Hermes (after a confirm) and opens the bot's next most recent one. */
export async function deleteChat(bot: string, chat: string): Promise<void> {
  const client = await chatClient(bot);
  if (!client) return;
  Alert.alert('Delete this chat?', 'Its messages are deleted on Hermes, on every device. The bot keeps its memory.', [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Delete',
      style: 'destructive',
      onPress: async () => {
        try {
          await client.deleteChat(chat);
          notifyChatsChanged();
          if (currentChat(bot) === chat) {
            const next = (await client.listChats().catch(() => [])).find((c) => c.id !== chat);
            if (next) openChat(bot, next.id);
            else startNewChat(bot);
          }
        } catch (e) {
          Alert.alert("Couldn't delete it", (e as Error).message);
        }
      },
    },
  ]);
}

export const renameOpenChat = async (bot: string) => renameChat(bot, currentChat(bot) ?? (await latestChat(bot)));
export const deleteOpenChat = async (bot: string) => deleteChat(bot, currentChat(bot) ?? (await latestChat(bot)));

const chatsListeners = new Set<() => void>();
/** The chat list re-reads when a chat is renamed or deleted from a menu. */
export function onChatsChanged(fn: () => void): () => void {
  chatsListeners.add(fn);
  return () => void chatsListeners.delete(fn);
}
function notifyChatsChanged() {
  chatsListeners.forEach((fn) => fn());
}

