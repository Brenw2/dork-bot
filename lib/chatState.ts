// Chat screen state as a pure reducer, so the streaming logic is unit-tested
// without React Native.
import type { ChatEvent, ChatMessage } from './hermes';

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
}

export const initialChat: ChatState = { messages: [], pending: null, runId: null, error: null };

export type ChatAction =
  | { type: 'loaded'; messages: ChatMessage[] }
  | { type: 'send'; text: string }
  | { type: 'event'; event: ChatEvent }
  | { type: 'resumed'; runId: string }
  /** The last message was sent from another device and its reply isn't in yet. */
  | { type: 'remote' }
  /** A resumed reply finished: the reloaded history already has it, so drop the partial copy. */
  | { type: 'settled' }
  | { type: 'failed'; message: string }
  | { type: 'ended' };

let localId = 0;
const nextId = () => `local-${++localId}`;

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'loaded':
      return { ...state, messages: action.messages, error: null };
    case 'send':
      return {
        ...state,
        messages: [...state.messages, { id: nextId(), role: 'user', content: action.text }],
        pending: { text: '', tools: [], thinking: true },
        runId: null,
        error: null,
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
      };
    case 'remote':
      if (state.pending && !state.pending.remote) return state;
      return { ...state, runId: null, pending: { text: '', tools: [], thinking: true, resumed: true, remote: true }, error: null };
    case 'settled':
      return { ...state, pending: null, runId: null };
    case 'failed':
      return finish({ ...state, error: action.message });
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
    case 'tool': {
      const tools = [...p.tools];
      if (e.phase === 'started') tools.push({ name: e.name, preview: e.preview, status: 'running' });
      else {
        const i = findLastIndex(tools, (t) => t.name === e.name && t.status === 'running');
        const status = e.phase === 'failed' ? 'failed' : 'done';
        if (i >= 0) tools[i] = { ...tools[i], status };
        else tools.push({ name: e.name, preview: e.preview, status });
      }
      return { ...state, pending: { ...p, tools } };
    }
    case 'completed':
      return { ...state, pending: { ...p, text: e.content || p.text, thinking: false } };
    case 'finished':
      return finish(e.status === 'failed' ? { ...state, error: 'The bot hit an error on that one.' } : state);
    case 'error':
      return { ...state, error: e.message };
  }
}

function finish(state: ChatState): ChatState {
  const p = state.pending;
  if (!p) return { ...state, runId: null };
  const messages = [...state.messages];
  for (const t of p.tools) messages.push({ id: nextId(), role: 'tool', content: t.preview ?? '', toolName: t.name });
  const text = p.text.trim();
  if (text) messages.push({ id: nextId(), role: 'assistant', content: text });
  return { ...state, messages, pending: null, runId: null };
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
  | { kind: 'pending'; id: 'pending'; text: string };

/** Rows oldest first. The in-flight reply ends with its live activity and its text (or thinking line). */
export function chatRows(state: Pick<ChatState, 'messages' | 'pending'>): ChatRow[] {
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
    rows.push({ kind: 'pending', id: 'pending', text: p.text });
  }
  return rows;
}

/** One line for a run of tool calls: the latest one while it works, a count when it's done. */
export function activityLine(tools: ToolCall[], live: boolean): string {
  const last = tools[tools.length - 1];
  if (!last) return '';
  const failed = tools.filter((t) => t.status === 'failed').length;
  const steps = tools.length === 1 ? '' : ` · ${tools.length} steps`;
  if (live) return `${last.status === 'running' ? '…' : last.status === 'failed' ? '✕' : '✓'} ${last.name}${steps}`;
  const names = [...new Set(tools.map((t) => t.name))];
  const shown = names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '');
  return `${failed ? '✕' : '✓'} ${shown}${steps}${failed ? ` · ${failed} failed` : ''}`;
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
