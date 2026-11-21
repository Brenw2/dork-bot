// Dynamic Type (card 33). The one place that decides how far text may grow with iOS Settings > Display > Text Size
// (and Android's font scale). Components never write `allowFontScaling={false}` or a number for
// `maxFontSizeMultiplier`; they pass one of these (test/dynamicType.test.ts scans for violations).
//
// Reading text follows the system size with no cap: message bodies, list names and previews, sheet rows, Usage
// numbers, routine cards, the composer. Rows grow in height and long text wraps or truncates; nothing has a fixed height.
// Chrome (header titles, tab or segment labels, badges, chips) is capped, because a bar or a pill has one line to live in.
// On desktop the browser does the work: Ctrl +/- and the OS zoom change the page, and RN-web ignores these props.

/** Largest multiplier per kind of text. `undefined` means no cap (the system's own limit, up to the accessibility sizes). */
export const maxScale = {
  /** Reading text: follows the system size all the way. */
  body: undefined,
  /** Header titles, segment and tab labels, badges, chips, status pills. */
  chrome: 1.3,
  /** Silkscreen and mono faces are wide (THEMES.md): 1.3 keeps a line of them inside its column. */
  mono: 1.3,
} as const;

export type MaxScaleKind = keyof typeof maxScale;

/** The multiplier a Text of this kind gets, for code that builds props instead of writing JSX. */
export const maxScaleFor = (kind: MaxScaleKind): number | undefined => maxScale[kind];

/**
 * A length that has to follow its text (a slot an absolutely placed label lives in): `px` at the default size, times
 * the user's font scale, held to the cap that text has. Pass `PixelRatio.getFontScale()` from the component.
 * Prefer `minHeight` on a row; use this only where the text can't push the box (absolute children).
 */
export const scaled = (px: number, fontScale: number, cap: number = Infinity): number => px * Math.min(Math.max(fontScale, 1), cap);

/** The smallest touch target the kit allows (phone and Duo), at any text size. */
export const MIN_HIT = 44;
