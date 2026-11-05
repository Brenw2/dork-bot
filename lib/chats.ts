// A bot's chats. Each chat is one Hermes session in the bot's profile. The first one a bot ever
// had is `dork-bot-<bot>` (from when each bot had one chat); new ones are `dork-bot-<bot>--<id>`.
// Hermes keeps them, so every device sees the same list, ordered by when each was last used,
// and Hermes titles a new chat by itself after its first reply.
// Plain TypeScript: the list logic is unit-tested in Node.

export interface ChatSummary {
  id: string;
  /** Hermes's title, or null when it has none yet. */
  title: string | null;
  /** Start of the first message, from Hermes. */
  preview: string;
  /** Seconds since epoch. */
  lastActive: number;
  messageCount: number;
}

/** The chat every bot started with (and the one older app versions still use). */
export function firstChatId(bot: string): string {
  return `dork-bot-${bot}`;
}

/** A fresh chat id for this bot. Hermes creates the session when the first message is sent. */
export function newChatId(bot: string, now = Date.now(), rand = Math.random): string {
  const tail = Math.floor(rand() * 36 ** 4)
    .toString(36)
    .padStart(4, '0');
  return `dork-bot-${bot}--${now.toString(36)}${tail}`;
}

/** Whether a session id is one of this bot's app chats (not a routine run, a CLI chat or a test). */
export function isBotChat(bot: string, id: string): boolean {
  const first = firstChatId(bot);
  return id === first || id.startsWith(`${first}--`);
}

interface RawSession {
  id?: unknown;
  title?: unknown;
  preview?: unknown;
  last_active?: unknown;
  started_at?: unknown;
  message_count?: unknown;
}

/** This bot's chats with something in them, most recently used first. */
export function toChatSummaries(bot: string, raw: RawSession[]): ChatSummary[] {
  const out: ChatSummary[] = [];
  for (const s of raw) {
    if (typeof s.id !== 'string' || !isBotChat(bot, s.id)) continue;
    const count = typeof s.message_count === 'number' ? s.message_count : 0;
    if (count === 0) continue;
    const title = typeof s.title === 'string' && s.title.trim() ? s.title.trim() : null;
    const last = typeof s.last_active === 'number' ? s.last_active : typeof s.started_at === 'number' ? s.started_at : 0;
    out.push({ id: s.id, title, preview: typeof s.preview === 'string' ? s.preview : '', lastActive: last, messageCount: count });
  }
  return out.sort((a, b) => b.lastActive - a.lastActive);
}

/** What the chat list calls a chat: its title, else how it starts. The old default title doesn't count. */
export function chatName(bot: string, chat: Pick<ChatSummary, 'title' | 'preview'>): string {
  const title = chat.title && chat.title !== `Dork Bot: ${bot}` ? chat.title : null;
  if (title) return title;
  const preview = cleanPreview(chat.preview);
  return preview || 'New chat';
}

/** A preview without the picture markers Hermes stores in the text. */
export function cleanPreview(preview: string): string {
  return preview
    .replace(/\[Image attached at:[^\]]*\]/g, '')
    .replace(/\[screenshot\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "now", "5m", "3h", "Tue", "Oct 30": how long ago a chat was used. */
export function agoLabel(seconds: number, nowMs = Date.now()): string {
  const diff = Math.max(0, nowMs / 1000 - seconds);
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  const d = new Date(seconds * 1000);
  if (diff < 6 * 86400) return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
