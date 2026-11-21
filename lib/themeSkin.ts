// Draws a theme's component styles from the styles written for Classic (plain TypeScript, no React Native, so it is
// unit-tested). makeStyles (components/theme.tsx) runs every style sheet through skinSheet for the current theme:
//  - Classic (no fonts, not square, not lowercase): the sheet comes back untouched, so Classic cannot move.
//  - square: every corner radius becomes 0.
//  - fonts: a text style (it sets a size or a weight) gets the theme's font file for its weight, and loses
//    `fontWeight` (a custom font file is already the weight; React Native would synthesize a second one over it).
//  - lowercase: `textTransform: 'uppercase'` (section headers) becomes lowercase.
import type { Fonts, Theme } from './themes';

type Style = Record<string, unknown>;

const RADII = ['borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius'];

/** Which of the theme's font files a `fontWeight` value picks. */
export function weightFamily(fonts: Fonts, weight: unknown): string {
  const w = typeof weight === 'string' ? (weight === 'bold' ? 700 : Number(weight) || 400) : typeof weight === 'number' ? weight : 400;
  return w >= 700 ? fonts.bold : w >= 600 ? fonts.semibold : fonts.regular;
}

/** The font family for a style that already names one (Menlo / monospace in code): code stays code. */
const isMono = (family: unknown) => typeof family === 'string' && /mono|menlo|courier/i.test(family);

export function skinStyle<T>(style: T, theme: Theme): T {
  if (!style || typeof style !== 'object' || Array.isArray(style)) return style;
  const { fonts, shape } = theme;
  if (!fonts && !shape.square && !shape.lowercase) return style;
  const s = style as Style;
  const out: Style = { ...s };
  if (shape.square) for (const k of RADII) if (typeof s[k] === 'number') out[k] = 0;
  if (fonts && (s.fontSize !== undefined || s.fontWeight !== undefined || s.fontFamily !== undefined)) {
    out.fontFamily = s.fontFamily !== undefined && isMono(s.fontFamily) ? fonts.mono : weightFamily(fonts, s.fontWeight);
    delete out.fontWeight;
  }
  if (shape.lowercase && s.textTransform === 'uppercase') out.textTransform = 'lowercase';
  return out as T;
}

/** A whole `StyleSheet.create` result through skinStyle. Classic returns the very same object. */
export function skinSheet<T>(sheet: T, theme: Theme): T {
  const { fonts, shape } = theme;
  if (!fonts && !shape.square && !shape.lowercase) return sheet;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(sheet as Record<string, unknown>)) out[k] = skinStyle(v, theme);
  return out as T;
}

/** A label as the theme writes it: lowercase in Terminal, as given otherwise. Never for message text. */
export const themed = (theme: Theme, label: string): string => (theme.shape.lowercase ? label.toLowerCase() : label);

/** Terminal's prompt mark (a single right angle quote), in front of your messages and the message box. Text, not an icon. */
export const PROMPT = '\u203A';
