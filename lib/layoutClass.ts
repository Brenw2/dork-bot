/**
 * Window layout classes for iPhone Duo, same thresholds as Sports Week (data/layoutClass.ts there).
 *
 *   shortSide = min(window width, window height)
 *   compact          shortSide < 600                      every iPhone, the folded Duo, Split View
 *   expanded-narrow  shortSide >= 600 and usableW < 840   open Duo, portrait  (669 × 951)
 *   expanded-wide    shortSide >= 600 and usableW >= 840  open Duo, landscape (951 × 669, 867 usable)
 *
 * Decided from the window, never from device idiom or orientation.
 */
export type LayoutClass = 'compact' | 'expanded-narrow' | 'expanded-wide';

export const COMPACT_MAX_SHORT_SIDE = 600;
/** Two panes fit at this usable width: bot list + fold gutter + a readable chat. */
export const WIDE_MIN_USABLE_WIDTH = 840;
/** Open Duo, landscape: the list pane ends at the fold, then a 40 pt gutter (Sports Week's design default). */
export const FOLD = { listSize: 455.5, gutterSize: 40 } as const;
/**
 * Two panes (open Duo in landscape, wide desktop window): the bot list is a sidebar this wide,
 * and the chat gets the rest of the window. Hiding the list gives the chat the whole width.
 * On the Duo the chat crosses the fold, the same way every screen does in open portrait.
 */
export const SIDEBAR_WIDTH = 300;
/** The desktop app's sidebar (docs/design/REVIEW.md, fix 1). */
export const DESKTOP_SIDEBAR_WIDTH = 320;
/** Chat column cap on expanded-narrow, so lines stay readable on the 669 pt wide inner screen. */
export const CHAT_MAX_WIDTH = 640;

export interface WindowShape {
  width: number;
  height: number;
  insetLeft?: number;
  insetRight?: number;
}

export function layoutClassFor({ width, height, insetLeft = 0, insetRight = 0 }: WindowShape): LayoutClass {
  if (Math.min(width, height) < COMPACT_MAX_SHORT_SIDE) return 'compact';
  return width - insetLeft - insetRight >= WIDE_MIN_USABLE_WIDTH ? 'expanded-wide' : 'expanded-narrow';
}

export type OrientationAction = 'lock-portrait' | 'unlock';

/** Compact windows stay portrait. Only an open Duo (expanded, iOS) may rotate. */
export function orientationActionFor(cls: LayoutClass, os: string): OrientationAction {
  return os === 'ios' && cls !== 'compact' ? 'unlock' : 'lock-portrait';
}

/**
 * What to do with the open chat when the window changes class.
 * - Unfolding to two panes while a chat screen is pushed: go back to the list with that bot selected.
 * - Folding to one pane with a bot selected in the two-pane view: open its chat full screen.
 */
export function foldNavFor(
  prev: LayoutClass,
  next: LayoutClass,
  where: { pushedChat: string | null; selected: string | null },
): { type: 'show-in-pane'; bot: string } | { type: 'push-chat'; bot: string } | null {
  const wasWide = prev === 'expanded-wide';
  const isWide = next === 'expanded-wide';
  if (!wasWide && isWide && where.pushedChat) return { type: 'show-in-pane', bot: where.pushedChat };
  if (wasWide && !isWide && where.selected && !where.pushedChat) return { type: 'push-chat', bot: where.selected };
  return null;
}
