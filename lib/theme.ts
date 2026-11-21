import { Platform } from 'react-native';

export const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

/** Avatar color from the bot's name, so each bot keeps its own. */
export function botColor(name: string): string {
  const palette = ['#8B7CF6', '#4CC38A', '#F2A65A', '#5AB0F2', '#F06A9A', '#C8D35A'];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

// Readable text on a bot color (lib/color.ts, plain TypeScript for tests). The theme's colors, `mix` and
// `switchProps` come from useTheme() / makeStyles (components/theme.tsx); the values are in lib/themes.ts.
export { onColor } from './color';
