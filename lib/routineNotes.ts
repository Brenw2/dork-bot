// A routine marked "Notify me" puts its result into the bot's chat. The dork-bot-push plugin adds
// it through Hermes's own no-turn mirror (gateway/mirror.py) as a user-role message, because it
// isn't the agent speaking, and starts it with a marker line:
//
//   [Routine · Morning news · 2026-11-12T15:04:05-05:00]
//   <the routine's output>
//
// This file recognises that marker so the chat draws the message as a routine card from the bot,
// not as one of Brennan's bubbles, and so nothing counts it as a message still waiting for a reply.
// The writer is hermes-plugin/dork-bot-push/push.py routine_message; keep the two in step.
// Plain TypeScript, unit-tested in Node.
export interface RoutineNote {
  /** The routine's name. */
  name: string;
  /** When the run finished, as the plugin stamped it (ISO with offset). Also how a push finds the message. */
  at: string;
  /** The routine's output. */
  text: string;
}

const NOTE = /^\[Routine · (.+) · ([^\s\]]+)\](?:\r?\n([\s\S]*))?$/;

/** The routine note a stored message is, or null for anything else (a normal message). */
export function parseRoutineNote(content: unknown): RoutineNote | null {
  if (typeof content !== 'string') return null;
  const m = NOTE.exec(content);
  if (!m) return null;
  return { name: m[1].trim(), at: m[2], text: (m[3] ?? '').trim() };
}

/** A routine note's time stamp as the plugin writes it: one token, no spaces or brackets. */
export function isNoteStamp(at: string): boolean {
  return /^[^\s\]]{1,40}$/.test(at);
}

/** The index of the note stamped `at` in a list of chat rows (any order), or -1. */
export function noteIndex(rows: { kind: string; message?: { routine?: { at: string } } }[], at: string): number {
  return rows.findIndex((r) => r.kind === 'message' && r.message?.routine?.at === at);
}

/** A chat's preview text when its first message is a routine note: "Routine · Morning news". */
export function notePreview(preview: string): string | null {
  const m = /^\[Routine · (.+?) · [^\s\]]+\]?/.exec(preview);
  return m ? `Routine · ${m[1]}` : null;
}
