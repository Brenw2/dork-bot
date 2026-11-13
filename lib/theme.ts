import { Platform } from 'react-native';

export const colors = {
  bg: '#0F1012',
  card: '#1A1C20',
  border: '#2A2D33',
  text: '#ECEDEF',
  dim: '#9298A0',
  accent: '#8B7CF6',
  user: '#3B3470',
  ok: '#4CC38A',
  bad: '#F06A6A',
  // Design tokens (docs/design/REVIEW.md): raised surfaces, placeholders/disabled text, disclosure chevrons.
  raised: '#22252A',
  faint: '#6B7078',
  disclosure: '#5D626A',
  code: '#0B0C0E',
};

export const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

/** Dork Bot's one button shape: a pill. Disabled buttons go flat grey instead of see-through purple. */
export const button = {
  primary: { height: 48, borderRadius: 24, paddingHorizontal: 24, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  disabled: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  text: { color: '#fff', fontSize: 16, fontWeight: '600' },
  disabledText: { color: colors.dim },
} as const;

/** Avatar color from the bot's name, so each bot keeps its own. */
export function botColor(name: string): string {
  const palette = ['#8B7CF6', '#4CC38A', '#F2A65A', '#5AB0F2', '#F06A9A', '#C8D35A'];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

// Readable text on a bot color, and dark tints of it (lib/color.ts, plain TypeScript for tests).
export { mix, onColor } from './color';
