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
};

export const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

/** Avatar color from the bot's name, so each bot keeps its own. */
export function botColor(name: string): string {
  const palette = ['#8B7CF6', '#4CC38A', '#F2A65A', '#5AB0F2', '#F06A9A', '#C8D35A'];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}
