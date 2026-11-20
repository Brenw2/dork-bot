// The app's themes (Appearance setting, docs: design-comps/dork-bot-redesign-2026-11-19/THEMES.md). Plain TypeScript, no
// React Native, so tests can import it. Classic equals the app as it was before themes: every value here is the old
// lib/theme.ts value. Terminal, Paper and Arcade are added by their own cards, each after Design's PASS.
export type ThemeId = 'classic';

export interface Colors {
  bg: string;
  card: string;
  border: string;
  text: string;
  dim: string;
  accent: string;
  user: string;
  ok: string;
  bad: string;
  warn: string;
  raised: string; // selected or pressed row, menus, popovers
  hover: string; // hovered row (desktop)
  faint: string; // placeholder, disabled text, hints
  sidebar: string; // desktop and Duo sidebar
  chevron: string; // bot list row chevron
  disclosure: string; // grouped-list disclosure ›
  code: string; // code blocks and commands
  menuBorder: string;
  menuHover: string;
  errorBg: string;
  errorLine: string;
  errorText: string;
  errorDetail: string; // the "Hermes said" line
  // Moved off hard-coded values (the theme plumbing card):
  badgeText: string; // text on a red "needs you" badge
  dialog: string; // the dialog panel
  inlineCode: string; // `inline code` background
  codeText: string; // text in code blocks and inline code
  track: string; // usage bar track
  scrollThumb: string; // desktop scrollbar thumb
  scrollThumbHover: string;
}

export interface Theme {
  id: ThemeId;
  name: string;
  /** The status bar's text: Paper (light) is the only one that needs `dark`. */
  statusBar: 'light' | 'dark';
  /** What `mix()` tints blend into: the app background. */
  mixBase: string;
  colors: Colors;
}

export const THEMES: Record<ThemeId, Theme> = {
  classic: {
    id: 'classic',
    name: 'Classic',
    statusBar: 'light',
    mixBase: '#0F1012',
    colors: {
      bg: '#0F1012',
      card: '#1A1C20',
      border: '#2A2D33',
      text: '#ECEDEF',
      dim: '#9298A0',
      accent: '#8B7CF6',
      user: '#3B3470',
      ok: '#4CC38A',
      bad: '#F06A6A',
      warn: '#F2A65A',
      raised: '#22252A',
      hover: '#1C1E22',
      faint: '#6B7078',
      sidebar: '#0D0E10',
      chevron: '#4B4F56',
      disclosure: '#5D626A',
      code: '#0B0C0E',
      menuBorder: '#343840',
      menuHover: '#2E3238',
      errorBg: '#24171A',
      errorLine: '#4A2A2E',
      errorText: '#F0C7C9',
      errorDetail: '#C9A9AC',
      badgeText: '#1A0B0B',
      dialog: '#1A1C21',
      inlineCode: '#24272D',
      codeText: '#E7E9EC',
      track: '#2A2D33',
      scrollThumb: '#2A2D33',
      scrollThumbHover: '#3A3E45',
    },
  },
};

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];
export const DEFAULT_THEME: ThemeId = 'classic';

/** A stored value as a theme id; anything unknown (a theme from a newer build, junk) is the default. */
export function parseTheme(value: unknown): ThemeId {
  return typeof value === 'string' && (THEME_IDS as string[]).includes(value) ? (value as ThemeId) : DEFAULT_THEME;
}
