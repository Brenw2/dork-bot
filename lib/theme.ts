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
  // Card 19 tokens (docs/design/REVIEW.md)
  raised: '#22252A', // selected or pressed row, menus, popovers
  hover: '#1C1E22', // hovered row (desktop)
  faint: '#6B7078', // placeholder, disabled text, hints
  sidebar: '#0D0E10', // desktop and Duo sidebar
  chevron: '#4B4F56', // bot list row chevron
  disclosure: '#5D626A', // grouped-list disclosure ›
  code: '#0B0C0E', // code blocks and commands
  menuBorder: '#343840',
  menuHover: '#2E3238',
  errorBg: '#24171A',
  errorLine: '#4A2A2E',
  errorText: '#F0C7C9',
  errorDetail: '#C9A9AC', // the "Hermes said" line
};

export const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

/**
 * Dork Bot's one button set (docs/design/REVIEW.md, fix 9). iPhone: primary and secondary 50 tall pills, small row
 * buttons 30 tall. Desktop: 40 (forms), 32 (panel headers) and 28 (small). Disabled is flat: #1A1C20, #6B7078 text, no border.
 */
export const button = {
  primary: { height: 50, borderRadius: 25, paddingHorizontal: 24, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  disabled: { backgroundColor: colors.card },
  text: { color: '#fff', fontSize: 17, fontWeight: '600' },
  disabledText: { color: colors.faint },
} as const;

/** Every switch: the iOS default with on = #4CC38A and a white thumb, the same on the web (fix 9). */
export const switchProps = { trackColor: { true: colors.ok, false: colors.border }, thumbColor: '#FFFFFF', activeThumbColor: '#FFFFFF', ios_backgroundColor: colors.border } as const;

/** Avatar color from the bot's name, so each bot keeps its own. */
export function botColor(name: string): string {
  const palette = ['#8B7CF6', '#4CC38A', '#F2A65A', '#5AB0F2', '#F06A9A', '#C8D35A'];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

// Readable text on a bot color, and dark tints of it (lib/color.ts, plain TypeScript for tests).
export { mix, onColor } from './color';
