// Push notifications, the app's half. The Hermes plugin (hermes-plugin/dork-bot-push) sends a push
// when a bot finishes a reply, needs an approval or finishes a routine. It sends to the Expo push
// tokens in each bot's `dork_bot.push` config block, which this file keeps up to date through
// hermes serve, like looks and model picks (lib/sync.ts). It also decides what a tap opens and
// whether a push that arrives while the app is open shows.
// Plain TypeScript with injected effects, so it's unit-tested without React Native.
import { isBotChat } from './chats';
import { BOT_NAME } from './pairing';

/** `dork_bot.push` on Hermes. Shared by every device; each phone adds its own token. */
export interface PushMeta {
  tokens?: string[];
  /** The bot's mute switch, on every phone. */
  muted?: boolean;
}

const TOKEN = /^(Exponent|Expo)PushToken\[[^\]\s]+\]$/;

export function isPushToken(t: unknown): t is string {
  return typeof t === 'string' && TOKEN.test(t);
}

/** Keeps only well-formed fields (the block lives in a YAML file anyone can edit). */
export function cleanPush(raw: unknown): PushMeta | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: PushMeta = {};
  if (Array.isArray(r.tokens)) out.tokens = [...new Set(r.tokens.filter(isPushToken))];
  if (typeof r.muted === 'boolean') out.muted = r.muted;
  return out;
}

/** The patch that adds this phone's token, or null when it's already there. Other phones' tokens stay. */
export function addToken(push: PushMeta | undefined, token: string): PushMeta | null {
  const tokens = push?.tokens ?? [];
  if (tokens.includes(token)) return null;
  return { tokens: [...tokens, token] };
}

/** The patch that takes this phone's token out, or null when it isn't there. */
export function dropToken(push: PushMeta | undefined, token: string): PushMeta | null {
  const tokens = push?.tokens ?? [];
  if (!tokens.includes(token)) return null;
  return { tokens: tokens.filter((t) => t !== token) };
}

export interface PushDeps {
  getPush: (bot: string) => Promise<PushMeta | undefined>;
  setPush: (bot: string, patch: PushMeta) => Promise<void>;
}

/** Adds (or takes out) this phone's token on each bot. Per-bot failures don't stop the others. */
export async function setTokenOnBots(
  deps: PushDeps,
  bots: string[],
  token: string,
  on: boolean,
): Promise<{ changed: string[]; errors: Record<string, string> }> {
  const changed: string[] = [];
  const errors: Record<string, string> = {};
  for (const bot of bots) {
    try {
      const current = await deps.getPush(bot);
      const patch = on ? addToken(current, token) : dropToken(current, token);
      if (!patch) continue;
      await deps.setPush(bot, patch);
      changed.push(bot);
    } catch (e) {
      errors[bot] = e instanceof Error ? e.message : String(e);
    }
  }
  return { changed, errors };
}

/** What the plugin puts in a push's `data`. */
export type PushData =
  | { kind: 'reply' | 'approval'; bot: string; chat: string }
  | { kind: 'routine'; bot: string; job?: string }
  /** Outside work (lib/work.ts) that ended: `session` is the Hermes session id. */
  | { kind: 'work'; bot: string; session: string };

/** A push's data, checked. Null for anything that isn't one of ours. */
export function parsePushData(raw: unknown): PushData | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.bot !== 'string' || !BOT_NAME.test(r.bot)) return null;
  const bot = r.bot;
  if (r.kind === 'routine') return { kind: 'routine', bot, ...(typeof r.job === 'string' ? { job: r.job } : {}) };
  if (r.kind === 'work') {
    return typeof r.session === 'string' && r.session && r.session.length <= 200 && !isBotChat(bot, r.session) ? { kind: 'work', bot, session: r.session } : null;
  }
  if ((r.kind === 'reply' || r.kind === 'approval') && typeof r.chat === 'string' && isBotChat(bot, r.chat)) {
    return { kind: r.kind, bot, chat: r.chat };
  }
  return null;
}

export type PushRoute =
  | { pathname: '/chat/[bot]'; params: { bot: string; chat: string } }
  | { pathname: '/'; params: { bot: string; chat: string } }
  | { pathname: '/routine-results/[bot]'; params: { bot: string } }
  | { pathname: '/work-session/[bot]'; params: { bot: string; id: string } };

/** Where a tap goes: a routine's push opens that bot's Routine results chat, a finished work session opens that session. Two panes (open Duo in landscape, wide desktop): the chat opens in the right pane. */
export function routeFor(data: PushData, twoPane: boolean): PushRoute {
  if (data.kind === 'work') return { pathname: '/work-session/[bot]', params: { bot: data.bot, id: data.session } };
  if (data.kind === 'routine') return { pathname: '/routine-results/[bot]', params: { bot: data.bot } };
  const params = { bot: data.bot, chat: data.chat };
  return twoPane ? { pathname: '/', params } : { pathname: '/chat/[bot]', params };
}

/** The chat on screen right now, if any. */
export interface OnScreen {
  bot: string;
  chat: string | null;
}

/**
 * Whether a push that arrives while the app is open shows a banner. Not for a reply in the chat on
 * screen: it's already right there. An approval always shows: the card only appears on the device
 * that sent the message, so the chat on screen may not have it.
 */
export function showWhileOpen(data: PushData | null, onScreen: OnScreen | null): boolean {
  if (!data || !onScreen || data.kind !== 'reply') return true;
  return !(onScreen.bot === data.bot && onScreen.chat === data.chat);
}

/** The patch for one bot's notification switch. Muting keeps the tokens, so turning it back on is one tap. */
export function mutePatch(muted: boolean): PushMeta {
  return { muted };
}
