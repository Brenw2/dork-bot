// Errors in plain words (docs/design/REVIEW.md, fix 6). Pure functions, so the copy table is unit-tested.
// Never paraphrase Hermes: its message is quoted after "Hermes said:", and the raw text stays under Details.

export interface Failure {
  /** The raw error text (kept for Details). */
  raw: string;
  /** HTTP status, when Hermes answered. */
  status?: number;
  /** The stream said the run failed or was cancelled by Hermes (there is no message to quote). */
  stopped?: boolean;
  /** Hermes itself reported it (an error event on the stream): quote it, don't call it a connection problem. */
  fromHermes?: boolean;
  /** The message never reached Hermes (no answer, no run started). */
  notSent?: boolean;
}

export type FailureView =
  /** A banner under the nav, like the model banner. */
  | { place: 'banner'; text: string; action: 'retry' | 'pair' }
  /** A card in the transcript. */
  | { place: 'card'; title: string; detail: string | null; actions: ('again' | 'details' | 'new-chat')[] }
  /** One line under your bubble. */
  | { place: 'unsent'; text: string };

/** Hermes's own message out of `HTTP 500 {"error":"model runner crashed"}` (or a plain text body). Null when there is none. */
export function hermesSaid(raw: string): string | null {
  const m = raw.match(/HTTP\s+\d{3}\s*:?\s*([\s\S]*)$/);
  const body = (m ? m[1] : raw).trim();
  if (!body) return null;
  try {
    const j = JSON.parse(body) as { error?: unknown; message?: unknown; detail?: unknown };
    const e = j.error;
    const text = typeof e === 'string' ? e : typeof e === 'object' && e && typeof (e as { message?: unknown }).message === 'string' ? (e as { message: string }).message : typeof j.message === 'string' ? j.message : typeof j.detail === 'string' ? j.detail : '';
    return text.trim() || null;
  } catch {
    // Not JSON: a plain line is fine to quote, a page of markup is not.
    return !body.startsWith('<') && body.length <= 300 ? body : null;
  }
}

/** The copy table of REVIEW.md fix 6. `name` is the bot's display name. */
export function describeFailure(f: Failure, name: string, secondsToRetry = 5): FailureView {
  const { status } = f;
  if (f.raw.startsWith('No saved key')) return { place: 'banner', text: `${name} has no saved key on this device.`, action: 'pair' };
  if (status === 401 || status === 403) return { place: 'banner', text: `${name}'s key was rejected.`, action: 'pair' };
  if (status === undefined && f.notSent) return { place: 'unsent', text: 'Not sent. Tap to retry.' };
  if (status === undefined && !f.stopped && !f.fromHermes) return { place: 'banner', text: `Can't reach b-lab. Trying again in ${secondsToRetry} s.`, action: 'retry' };
  if (status === 404) return { place: 'card', title: "This chat isn't on Hermes anymore.", detail: null, actions: ['new-chat'] };
  if (status === 429) return { place: 'card', title: 'Hermes is busy.', detail: null, actions: ['again'] };
  if (f.stopped) return { place: 'card', title: `${name}'s reply stopped.`, detail: null, actions: ['again', 'details'] };
  const said = hermesSaid(f.raw);
  const detail = said ? `Hermes said: ${said}${status ? ` (HTTP ${status})` : ''}` : status ? `HTTP ${status}` : null;
  return { place: 'card', title: `${name} hit an error`, detail, actions: ['again', 'details'] };
}

/** A connection or key problem: it goes away by itself once a load succeeds. Card failures stay until the next send. */
export function isBanner(f: Failure): boolean {
  return describeFailure(f, '').place === 'banner';
}
