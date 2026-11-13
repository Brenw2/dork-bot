// Chat screen state as a pure reducer, so the streaming logic is unit-tested
// without React Native.
import type { ApprovalChoice, ApprovalRequest, ChatEvent, ChatMessage } from './hermes';
import { isBanner, type Failure } from './errors';
import { doneToolName, liveToolName } from './toolNames';

export interface ToolCall {
  name: string;
  preview: string | null;
  status: 'running' | 'done' | 'failed';
}

export interface ChatState {
  messages: ChatMessage[];
  /** The reply being streamed right now, if any. `resumed`: picked up after the stream was lost. */
  pending: { text: string; tools: ToolCall[]; thinking: boolean; resumed?: boolean; remote?: boolean } | null;
  runId: string | null;
  error: string | null;
  /** The last turn's failure, shown in plain words (lib/errors.ts): a banner, a card in the transcript, or a line under your bubble. */
  failure: Failure | null;
  /** The reply is paused until Brennan allows or denies a command. */
  approval: ApprovalRequest | null;
  /** Approvals answered during the running reply; each shows as a one-line chip until the reply is done. */
  decisions: Decision[];
}

export interface Decision {
  choice: ApprovalChoice;
  command: string;
}

export const initialChat: ChatState = { messages: [], pending: null, runId: null, error: null, failure: null, approval: null, decisions: [] };

export type ChatAction =
  | { type: 'loaded'; messages: ChatMessage[] }
  | { type: 'send'; text: string; images?: string[]; /** Try again: the failed message is replaced, not repeated. */ retry?: boolean }
  | { type: 'event'; event: ChatEvent }
  | { type: 'resumed'; runId: string }
  /** The last message was sent from another device and its reply isn't in yet. */
  | { type: 'remote' }
  /** A resumed reply finished: the reloaded history already has it, so drop the partial copy. */
  | { type: 'settled' }
  | { type: 'failed'; message: string; status?: number; notSent?: boolean }
  /** What the run is waiting on, from a status check (null: nothing any more). */
  | { type: 'approval'; request: ApprovalRequest | null }
  /** The approval card was answered: it collapses to a chip. */
  | { type: 'answered'; choice: ApprovalChoice }
  | { type: 'ended' };

let localId = 0;
const nextId = () => `local-${++localId}`;

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'loaded':
      return { ...state, messages: action.messages, error: null, failure: state.failure && isBanner(state.failure) ? null : state.failure };
    case 'send':
      return {
        ...state,
        messages: [
          ...(action.retry ? state.messages.slice(0, Math.max(0, state.messages.map((m) => m.role).lastIndexOf('user'))) : state.messages),
          { id: nextId(), role: 'user', content: action.text, ...(action.images?.length ? { localImages: action.images } : {}) },
        ],
        pending: { text: '', tools: [], thinking: true },
        runId: null,
        error: null,
        failure: null,
        approval: null,
        decisions: [],
      };
    case 'event':
      return applyEvent(state, action.event);
    case 'resumed':
      // The reply is still running on Hermes, but this screen isn't getting its stream (it was
      // reopened, or the stream dropped). Keep any partial reply; the history fills in when it's done.
      return {
        ...state,
        runId: action.runId,
        pending: { ...(state.pending ?? { text: '', tools: [], thinking: true }), resumed: true },
        error: null,
        failure: null,
      };
    case 'remote':
      if (state.pending && !state.pending.remote) return state;
      return { ...state, runId: null, pending: { text: '', tools: [], thinking: true, resumed: true, remote: true }, error: null, failure: null };
    case 'settled':
      return { ...state, pending: null, runId: null, approval: null, decisions: [], failure: null };
    case 'approval':
      return { ...state, approval: action.request };
    case 'answered':
      if (!state.approval) return state;
      return { ...state, approval: null, decisions: [...state.decisions, { choice: action.choice, command: state.approval.command }] };
    case 'failed':
      return finish({ ...state, error: action.message, failure: { raw: action.message, status: action.status, notSent: action.notSent } });
    case 'ended':
      return state.pending ? finish(state) : state;
  }
}

function applyEvent(state: ChatState, e: ChatEvent): ChatState {
  const p = state.pending ?? { text: '', tools: [], thinking: true };
  switch (e.type) {
    case 'started':
      return { ...state, runId: e.runId, pending: p };
    case 'delta':
      return { ...state, pending: { ...p, text: p.text + e.text, thinking: false } };
    case 'thinking':
      return { ...state, pending: { ...p, thinking: true } };
    case 'approval':
      return { ...state, approval: e.request, pending: p };
    case 'tool': {
      const tools = [...p.tools];
      if (e.phase === 'started') tools.push({ name: e.name, preview: e.preview, status: 'running' });
      else {
        const i = findLastIndex(tools, (t) => t.name === e.name && t.status === 'running');
        const status = e.phase === 'failed' ? 'failed' : 'done';
        if (i >= 0) tools[i] = { ...tools[i], status };
        else tools.push({ name: e.name, preview: e.preview, status });
      }
      // Once a tool reports back, the command it asked about went through (or was refused).
      const approval = e.phase === 'started' ? state.approval : null;
      return { ...state, approval, pending: { ...p, tools } };
    }
    case 'completed':
      return { ...state, pending: { ...p, text: e.content || p.text, thinking: false } };
    case 'finished':
      return finish(e.status === 'failed' ? { ...state, error: 'The bot hit an error on that one.', failure: { raw: 'The bot hit an error on that one.', stopped: true } } : state);
    case 'error':
      return { ...state, error: e.message, failure: { raw: e.message, fromHermes: true } };
  }
}

function finish(state: ChatState): ChatState {
  const p = state.pending;
  if (!p) return { ...state, runId: null, approval: null, decisions: [] };
  const messages = [...state.messages];
  for (const t of p.tools) messages.push({ id: nextId(), role: 'tool', content: t.preview ?? '', toolName: t.name });
  const text = p.text.trim();
  if (text) messages.push({ id: nextId(), role: 'assistant', content: text });
  return { ...state, messages, pending: null, runId: null, approval: null, decisions: [] };
}

function findLastIndex<T>(arr: T[], pred: (t: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return i;
  return -1;
}

// What the chat list shows. Runs of tool calls (terminal, skills, searches...) collapse into one
// "activity" row that updates in place instead of stacking a row per call down the screen.
export type ChatRow =
  | { kind: 'message'; id: string; message: ChatMessage }
  | { kind: 'activity'; id: string; tools: ToolCall[]; live: boolean }
  | { kind: 'pending'; id: 'pending'; text: string }
  /** The card for an approval Hermes is waiting on: the last thing in the transcript (design fix 5). */
  | { kind: 'approval'; id: 'approval'; request: ApprovalRequest }
  /** An answered approval, collapsed to a chip. */
  | { kind: 'decision'; id: string; decision: Decision }
  /** A failed turn: a card (or the "Not sent" line under your bubble). Connection and key problems are banners, not rows. */
  | { kind: 'failure'; id: 'failure'; failure: Failure }
  /** A message typed while a reply was running; it goes out when that reply is done. */
  | { kind: 'queued'; id: string; text: string };

/**
 * Rows oldest first. The in-flight reply ends with its live activity and its text (or the typing
 * bubble); an approval Hermes is waiting on comes last, and the typing bubble steps aside for it.
 */
export function chatRows(state: Pick<ChatState, 'messages' | 'pending'> & Partial<Pick<ChatState, 'approval' | 'decisions' | 'failure'>>, queued: string[] = []): ChatRow[] {
  const rows: ChatRow[] = [];
  let run: ToolCall[] | null = null;
  for (const m of state.messages) {
    if (m.role === 'tool') {
      if (!run) {
        run = [];
        rows.push({ kind: 'activity', id: `tools-${m.id}`, tools: run, live: false });
      }
      run.push({ name: m.toolName ?? 'tool', preview: m.content || null, status: 'done' });
      continue;
    }
    run = null;
    rows.push({ kind: 'message', id: m.id, message: m });
  }
  const p = state.pending;
  if (p) {
    if (p.tools.length) rows.push({ kind: 'activity', id: 'pending-tools', tools: p.tools, live: !p.text });
    state.decisions?.forEach((decision, i) => rows.push({ kind: 'decision', id: `decision-${i}`, decision }));
    if (p.text || !state.approval) rows.push({ kind: 'pending', id: 'pending', text: p.text });
  }
  if (state.approval) rows.push({ kind: 'approval', id: 'approval', request: state.approval });
  if (state.failure && !isBanner(state.failure)) rows.push({ kind: 'failure', id: 'failure', failure: state.failure });
  queued.forEach((text, i) => rows.push({ kind: 'queued', id: `queued-${i}`, text }));
  return rows;
}

/** Who a row belongs to, for spacing: you, or the bot (its chips, replies and routine cards). */
function side(row: ChatRow): 'me' | 'bot' {
  if (row.kind === 'queued' || (row.kind === 'failure' && row.failure.notSent)) return 'me';
  return row.kind === 'message' && row.message.role === 'user' && !row.message.routine ? 'me' : 'bot';
}

/**
 * Space above a row in pt (design fix 7): 4 inside one sender's run, 16 from your bubble to the bot's
 * chip or reply, 20 from a bot reply to your next bubble, 10 from a chip to its reply.
 */
export function rowGap(prev: ChatRow | undefined, row: ChatRow): number {
  if (!prev) return 0;
  const a = side(prev);
  const b = side(row);
  if (a === 'me' && b === 'bot') return 16;
  if (a === 'bot' && b === 'me') return 20;
  if (a === 'bot' && prev.kind === 'activity') return 10;
  return 4;
}

/**
 * The step chip's text (design fix 4), without its icon. While it runs: the friendly name of the
 * latest step ("Searching the web…") plus a step count. Done: "Used Trello, Web search · 4 steps".
 */
export function activityLine(tools: ToolCall[], live: boolean): string {
  const last = tools[tools.length - 1];
  if (!last) return '';
  const failed = tools.filter((t) => t.status === 'failed').length;
  const steps = tools.length === 1 ? '' : ` · ${tools.length} steps`;
  if (live) return `${liveToolName(last.name)}${steps}`;
  const names = [...new Set(tools.map((t) => doneToolName(t.name)))];
  const shown = names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '');
  return `Used ${shown}${steps}${failed ? ` · ${failed} failed` : ''}`;
}

/** "Still working · 48 s" (nothing before 10 s); a run seen from another device or after leaving: "· 2 min". */
export function stillWorking(ms: number): string | null {
  const s = Math.floor(ms / 1000);
  if (s < 10) return null;
  return `Still working · ${s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`}`;
}

/** Hermes denies an unanswered approval after this many seconds (approvals.timeout). */
export const APPROVAL_TIMEOUT_S = 300;

/** The approval card's countdown: "4:32". */
export function countdown(secondsLeft: number): string {
  const s = Math.max(0, Math.ceil(secondsLeft));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** How long a message from another device with no reply yet counts as "the bot is still on it". */
export const REMOTE_REPLY_WINDOW_S = 15 * 60;

/**
 * When the chat's last message is the user's and has no reply yet (sent from another device, the
 * reply still running there), the time it was sent, in seconds. Null when nothing is waiting.
 * Tool steps saved while the reply runs don't count as a reply.
 */
export function awaitingReply(messages: ChatMessage[], nowS: number, windowS = REMOTE_REPLY_WINDOW_S): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'tool') continue;
    if (m.role !== 'user' || m.at === undefined) return null;
    return nowS - m.at <= windowS ? m.at : null;
  }
  return null;
}
