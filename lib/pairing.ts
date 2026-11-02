// Pairing link: dorkbot://add?url=<hermes>&bot=<profile>&key=<API_SERVER_KEY>
// scripts/pair-bot.sh prints it as a QR code. Scanning it with the iPhone
// camera opens the app on the Add bot screen with everything filled in.
import { normalizeUrl, type BotConnection } from './hermes';

export const BOT_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isValidBotName(name: string): boolean {
  return BOT_NAME.test(name);
}

export function pairingLink(conn: BotConnection): string {
  const q = new URLSearchParams({ url: normalizeUrl(conn.url), bot: conn.bot, key: conn.key });
  return `dorkbot://add?${q.toString()}`;
}

/** Reads the fields from route params (expo-router hands them over already decoded). */
export function connectionFromParams(params: Record<string, string | string[] | undefined>): Partial<BotConnection> {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  return { url: one(params.url), bot: one(params.bot)?.toLowerCase(), key: one(params.key) };
}

export function validateConnection(c: Partial<BotConnection>): string | null {
  if (!c.url) return 'Enter the Hermes address.';
  try {
    const u = new URL(normalizeUrl(c.url));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'The address must start with https://';
  } catch {
    return "That address doesn't look right.";
  }
  if (!c.bot || !isValidBotName(c.bot)) return 'Bot names are lowercase letters, numbers, - and _.';
  if (!c.key || c.key.length < 16) return 'The key is too short (it should be 16+ characters).';
  return null;
}
