// Bot-colored text on a light theme (Paper). The bot colors are tuned for dark backgrounds: on white, yellow, silver and
// lime are 1.3-1.6:1. This darkens a bot color toward the ink (#141414) until it reaches the contrast asked for on every
// background it can sit on. Only Paper uses it (theme.shape.inkBotText); Classic and Terminal draw the bot color as is.
// Plain TypeScript (no React Native) so it is unit-tested.
import { mix } from './color';

export const INK = '#141414';
/** Paper's two surfaces: the card and the page. */
export const PAPER_SURFACES = ['#FFFFFF', '#F4F4F1'];

function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => v / 255)
    .map((s) => (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4))
    .reduce((sum, s, i) => sum + s * [0.2126, 0.7152, 0.0722][i], 0);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * `hex` itself when it already reads, else the smallest step toward the ink that does (hue kept as long as possible).
 * `min` 4.5 for body text and links, 3 for bold names. Checked on every surface in `surfaces`.
 */
export function readableOn(hex: string, min = 4.5, surfaces: string[] = PAPER_SURFACES): string {
  const ok = (c: string) => surfaces.every((s) => contrastRatio(c, s) >= min);
  if (ok(hex)) return hex;
  for (let step = 1; step <= 40; step++) {
    // t = 0 is the bot color, 1 is the ink. mix(hex, t, base): t = 1 gives `hex`, so pass the ink as the colour.
    const c = mix(INK, step / 40, hex);
    if (ok(c)) return c;
  }
  return INK;
}
