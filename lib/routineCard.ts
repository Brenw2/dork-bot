// The routine card in the chat (card 24, docs/design/REVIEW.md "Fix 11"): its colours, its one-line
// preview, and the rules for landing on it from a notification. Plain TypeScript, unit-tested in Node;
// components/RoutineCard.tsx draws it.
import { stripMarkdown } from './botList';
import { mix } from './color';

/** The card's colours for a bot colour `c`, over the app background: every tint is mix(c, t). */
export function routineTints(c: string) {
  return {
    fill: mix(c, 0.08),
    pressed: mix(c, 0.12), // header pressed (and desktop hover)
    border: mix(c, 0.22), // the hairline and the divider
    disc: mix(c, 0.18), // the icon disc, same as the avatar disc
    highlightFill: mix(c, 0.22),
    highlightBorder: mix(c, 0.6),
  };
}

/** Timings, in ms (Fix 11). */
export const ROUTINE_MOTION = {
  expand: 200,
  collapse: 180,
  fade: 150,
  highlightHold: 600,
  highlightFade: 400,
  /** Reduce Motion: no fade, the colours hold this long, then snap back. */
  highlightHoldStill: 1000,
} as const;

/** The collapsed row's one line: the output's first text with Markdown stripped. */
export function routinePreview(text: string): string {
  return stripMarkdown(text);
}

/** The card's accessibility label, and the hint for what a tap does next. */
export function routineLabel(name: string, when: string): string {
  return when ? `Routine ${name}, ${when}` : `Routine ${name}`;
}
export function routineHint(expanded: boolean): string {
  return expanded ? 'Double tap to collapse' : 'Double tap to expand';
}

/** A routine with no output text has no body and no chevron. */
export function routineHasBody(text: string): boolean {
  return text.trim().length > 0;
}

/**
 * Landing on a routine card from a notification. The chat's history is one load, so "not loaded yet"
 * means the push beat the message into Hermes's history: reload a few times (bounded), then give up.
 */
export const ROUTINE_FOCUS = { retries: 5, everyMs: 2000 } as const;

export type FocusStep = 'go' | 'reload' | 'fallback';

/** What to do about a tapped routine: `found` it in the loaded rows, after `reloads` extra loads. */
export function focusStep(found: boolean, reloads: number, max = ROUTINE_FOCUS.retries): FocusStep {
  if (found) return 'go';
  return reloads < max ? 'reload' : 'fallback';
}

/**
 * Where a routine card lands when scrolled to: its top 16 below the header, or centred when the card is
 * taller than the visible list. A FlatList `viewPosition` and `viewOffset` for scrollToIndex. An inverted
 * list (the phone) is drawn upside down, so its "end" edge is the one at the top of the screen.
 */
export function focusPosition(cardHeight: number, listHeight: number, inverted: boolean): { viewPosition: number; viewOffset: number } {
  if (cardHeight > listHeight - 32) return { viewPosition: 0.5, viewOffset: 0 };
  return inverted ? { viewPosition: 1, viewOffset: -16 } : { viewPosition: 0, viewOffset: 16 };
}
