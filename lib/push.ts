// Push notifications, the app's half. The Hermes plugin (hermes-plugin/dork-bot-push) sends a push
// when a bot finishes a reply, needs an approval or finishes a routine. It sends to the Expo push
// tokens in each bot's `dork_bot.push` config block, which this file keeps up to date through
// hermes serve, like looks and model picks (lib/sync.ts). It also decides what a tap opens and
// whether a push that arrives while the app is open shows.
// Plain TypeScript with injected effects, so it's unit-tested without React Native.
import { isBotChat } from './chats';
import { BOT_NAME } from './pairing';
import { isNoteStamp } from './routineNotes';

/** `dork_bot.push` on Hermes. Shared by every device; each phone adds its own token. */
export interface PushMeta {
  tokens?: string[];
  /** The bot's mute switch, on every phone. */
  muted?: boolean;
  /** Ids of the routines marked "Notify me" (Hermes cron job ids). Off for every routine by default. */
  routines?: string[];
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
  if (Array.isArray(r.routines)) out.routines = [...new Set(r.routines.filter((j): j is string => typeof j === 'string' && j.length > 0 && j.length <= 200))];
  return out;
}

/** Whether a routine is marked "Notify me". */
export function notifyOn(push: PushMeta | undefined, jobId: string): boolean {
  return push?.routines?.includes(jobId) === true;
}

/**
 * The patch that marks (or unmarks) one routine, or null when it already is. It carries the whole
 * list (Hermes replaces lists when it merges), so the other routines' marks and the other devices'
 * changes made since `push` was read are only lost if two devices flip switches at the same moment.
 */
export function notifyPatch(push: PushMeta | undefined, jobId: string, on: boolean): PushMeta | null {
  const routines = push?.routines ?? [];
  if (routines.includes(jobId) === on) return null;
  return { routines: on ? [...routines, jobId] : routines.filter((j) => j !== jobId) };
}

/**
 * Marks or unmarks one routine on Hermes. Reads the bot's current list first, so a switch flipped
 * on another device a moment ago isn't undone. Returns the list as saved.
 */
export async function setNotify(deps: PushDeps, bot: string, jobId: string, on: boolean): Promise<string[]> {
  const current = await deps.getPush(bot);
  const patch = notifyPatch(current, jobId, on);
  if (patch) await deps.setPush(bot, patch);
  return patch?.routines ?? current?.routines ?? [];
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
  /** `chat` + `at`: a "Notify me" routine's result was added to that chat, stamped `at`. Without them, it's in Routine results only. */
  | { kind: 'routine'; bot: string; job?: string; chat?: string; at?: string }
  /** Outside work (lib/work.ts) that ended: `session` is the Hermes session id. */
  | { kind: 'work'; bot: string; session: string };

/** A push's data, checked. Null for anything that isn't one of ours. */
export function parsePushData(raw: unknown): PushData | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.bot !== 'string' || !BOT_NAME.test(r.bot)) return null;
  const bot = r.bot;
  if (r.kind === 'routine') {
    const chat = typeof r.chat === 'string' && isBotChat(bot, r.chat) ? r.chat : null;
    return {
      kind: 'routine',
      bot,
      ...(typeof r.job === 'string' ? { job: r.job } : {}),
      ...(chat ? { chat, ...(typeof r.at === 'string' && isNoteStamp(r.at) ? { at: r.at } : {}) } : {}),
    };
  }
  if (r.kind === 'work') {
    return typeof r.session === 'string' && r.session && r.session.length <= 200 && !isBotChat(bot, r.session) ? { kind: 'work', bot, session: r.session } : null;
  }
  if ((r.kind === 'reply' || r.kind === 'approval') && typeof r.chat === 'string' && isBotChat(bot, r.chat)) {
    return { kind: r.kind, bot, chat: r.chat };
  }
  return null;
}

export type PushRoute =
  | { pathname: '/chat/[bot]'; params: { bot: string; chat: string; at?: string } }
  | { pathname: '/'; params: { bot: string; chat: string; at?: string } }
  | { pathname: '/routine-results/[bot]'; params: { bot: string } }
  | { pathname: '/work-session/[bot]'; params: { bot: string; id: string } };

/**
 * Where a tap goes. A routine's push opens the chat its result was added to, at that message; with
 * no chat (the bot had none) it opens that bot's Routine results. A finished work session opens that
 * session. Two panes (open Duo in landscape, wide desktop): the chat opens in the right pane.
 */
export function routeFor(data: PushData, twoPane: boolean): PushRoute {
  if (data.kind === 'work') return { pathname: '/work-session/[bot]', params: { bot: data.bot, id: data.session } };
  if (data.kind === 'routine' && !data.chat) return { pathname: '/routine-results/[bot]', params: { bot: data.bot } };
  const chat = data.chat as string;
  const params = { bot: data.bot, chat, ...(data.kind === 'routine' && data.at ? { at: data.at } : {}) };
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
