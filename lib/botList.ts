// What the bot list shows for each bot, like Messages: the newest message, when it was, and what
// the bot is doing or what's wrong. Plain TypeScript, unit-tested in Node (docs/design/REVIEW.md, fix 1).
import { cleanPreview, type ChatSummary } from './chats';
import type { ChatMessage } from './hermes';
import { parseRoutineNote } from './routineNotes';

/** Markdown reduced to the plain words it shows, on one line. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[a-z0-9_+-]*\n?([\s\S]*?)```/gi, ' $1 ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/^\s*\|?[\s:|-]{3,}\|?\s*$/gm, ' ')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const IMAGE_MARKER = /\[Image attached[^\]]*\]/g;

/** A message as a row preview: markdown stripped, a picture alone shown as "Picture". Null with nothing to show. */
export function previewOf(content: string): string | null {
  const note = parseRoutineNote(content);
  const hadImage = IMAGE_MARKER.test(content);
  IMAGE_MARKER.lastIndex = 0;
  const text = stripMarkdown((note ? `Routine · ${note.name}: ${note.text}` : content).replace(IMAGE_MARKER, ' ').replace(/\[screenshot\]/g, ' '));
  if (text) return text;
  return hadImage ? 'Picture' : null;
}

/** The newest message worth showing from a chat's history (tool rows and empty ones skipped). */
export function lastMessagePreview(messages: ChatMessage[]): { text: string; at?: number } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'tool') continue;
    const text = previewOf(m.content ?? '');
    if (text) return { text, at: m.at };
  }
  return null;
}

export interface BotPreview {
  /** The text for line 2, or null when the bot has no messages yet. */
  text: string | null;
  /** Seconds since epoch of the newest message, or null. */
  at: number | null;
}

/** The slice of HermesClient this needs, so tests can pass a fake. */
export interface PreviewSource {
  listChats(): Promise<ChatSummary[]>;
  messages(id: string): Promise<ChatMessage[]>;
}

/**
 * The newest message in the bot's most recent chat. If only the chat's own preview comes back (the
 * messages request failed), that is shown instead; never invented text.
 */
export async function latestPreview(source: PreviewSource): Promise<BotPreview> {
  const chats = await source.listChats();
  const chat = chats[0];
  if (!chat) return { text: null, at: null };
  try {
    const last = lastMessagePreview(await source.messages(chat.id));
    if (last) return { text: last.text, at: chat.lastActive || last.at || null };
  } catch {
    // fall through to Hermes's own preview
  }
  const fallback = previewOf(cleanPreview(chat.preview));
  return { text: fallback, at: chat.lastActive || null };
}

const DAY = 86400_000;

/** "now", "9:41 AM", "Yesterday", "Tue", "Oct 30": when the newest message was. Empty with no time. */
export function rowTime(seconds: number | null | undefined, nowMs = Date.now()): string {
  if (!seconds) return '';
  const at = new Date(seconds * 1000);
  const now = new Date(nowMs);
  const diff = nowMs - at.getTime();
  if (diff < 60_000) return 'now';
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY);
  if (days <= 0) return at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  if (days < 7) return at.toLocaleDateString('en-US', { weekday: 'short' });
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export type ConnectState = 'checking' | 'ok' | { error: 'key' | 'network' | 'other'; detail: string };

/** Sorts what a failed check says into the three cases the list has copy for. */
export function connectError(status: number | undefined, message: string): { error: 'key' | 'network' | 'other'; detail: string } {
  if (status === 401 || status === 403) return { error: 'key', detail: message };
  if (/can't reach b-lab/i.test(message)) return { error: 'network', detail: message };
  return { error: 'other', detail: message };
}

/** Line 2 when the bot can't be reached. */
export function errorLine(state: Exclude<ConnectState, 'checking' | 'ok'>): string {
  if (state.error === 'key') return 'Key rejected. Tap to pair again.';
  if (state.error === 'network') return "Can't reach b-lab.";
  return "Can't connect. Tap for details.";
}

/** What the bot is doing right now, in the words line 2 uses. Null for idle (and done, error). */
export function doingLine(mood: string): string | null {
  return ({ thinking: 'Thinking…', working: 'Working…', talking: 'Replying…' } as Record<string, string>)[mood] ?? null;
}

export interface SortableRow {
  bot: string;
  needsYou: boolean;
  at: number | null;
}

/** Most recent activity first; a bot that needs you goes to the top; no messages last, by name. */
export function sortRows<T extends SortableRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.needsYou !== b.needsYou) return a.needsYou ? -1 : 1;
    if ((a.at ?? -1) !== (b.at ?? -1)) return (b.at ?? -1) - (a.at ?? -1);
    return a.bot.localeCompare(b.bot);
  });
}
