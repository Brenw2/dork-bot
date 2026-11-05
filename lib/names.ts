// A bot's display name. Only what the app shows: the Hermes profile id (and so the chat session
// id, the API path and the saved key) never changes. It lives in the bot's `dork_bot:` block on
// Hermes, like look/model/hidden, and falls back to the profile id when unset.

export const MAX_NAME_LENGTH = 30;

/** Trimmed, inner whitespace collapsed; null if empty or too long. */
export function cleanDisplayName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim();
  return name && name.length <= MAX_NAME_LENGTH ? name : null;
}

/** What to show for a bot: its display name, else the profile id. */
export function nameOf(bot: string, displayName?: string): string {
  return displayName || bot;
}
