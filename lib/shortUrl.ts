/** Longest a bare link may be drawn (design fix 7). */
export const URL_MAX = 40;

/**
 * A bare URL as the transcript shows it: no scheme, one line, cut with "…" past 40 characters.
 * Tap still opens the full address (the caller keeps `href`).
 */
export function shortUrl(href: string, max = URL_MAX): string {
  const bare = href.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const chars = [...bare];
  return chars.length <= max ? bare : `${chars.slice(0, max - 1).join('').replace(/[?&#]+$/, '')}…`;
}

/** True for a link written bare: its text is the address itself (an autolink), not words. */
export function isBareLink(text: string, href: string): boolean {
  return text === href || text === href.replace(/^mailto:/, '');
}
