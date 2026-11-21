// The app's themes (Appearance setting, docs: design-comps/dork-bot-redesign-2026-11-19/THEMES.md). Plain TypeScript, no
// React Native, so tests can import it. Classic equals the app as it was before themes: every value here is the old
// lib/theme.ts value. Terminal, Paper and Arcade are added by their own cards, each after Design's PASS.
export type ThemeId = 'classic' | 'terminal';

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
  // Terminal card:
  userText: string; // text in your own message
  /** Send/Stop: `bot` = the bot's color (Classic, as before), `accent` = this theme's accent. */
  send: 'bot' | 'accent';
}

/** The font files a theme draws with (expo-font family names, see components/themeFonts.ts). null = the system fonts. */
export interface Fonts {
  regular: string;
  semibold: string;
  bold: string;
  /** Code blocks and inline code. */
  mono: string;
}

/**
 * How a theme's components are drawn beyond colors. Classic is all false: its styles are used exactly as written.
 * square: every corner radius is 0. lowercase: titles, buttons and menu items are lowercase (not message text).
 * userRule: your messages are full-width rows with a left rule and a prompt, not bubbles. brackets: enabled
 * buttons read `[ label ]`. dashed: list separators are dashed.
 */
export interface Shape {
  square: boolean;
  lowercase: boolean;
  userRule: boolean;
  brackets: boolean;
  dashed: boolean;
}

export interface Theme {
  id: ThemeId;
  name: string;
  /** The status bar's text: Paper (light) is the only one that needs `dark`. */
  statusBar: 'light' | 'dark';
  /** What `mix()` tints blend into: the app background. */
  mixBase: string;
  colors: Colors;
  fonts: Fonts | null;
  shape: Shape;
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
      userText: '#ECEDEF',
      send: 'bot',
    },
    fonts: null,
    shape: { square: false, lowercase: false, userRule: false, brackets: false, dashed: false },
  },
  // Terminal (design-comps/dork-bot-redesign-2026-11-19, kit-terminal.png): near-black console, mint accent, one mono
  // font, square corners. Values from themes.proposed.ts; `track` and the scrollbar are the Terminal border family.
  terminal: {
    id: 'terminal',
    name: 'Terminal',
    statusBar: 'light',
    mixBase: '#050607',
    colors: {
      bg: '#050607',
      card: '#0B0E0F',
      border: '#1B2224',
      text: '#D7E3DD',
      dim: '#738580',
      accent: '#7CF5B0',
      user: '#0B0E0F',
      ok: '#7CF5B0',
      bad: '#FF6B6B',
      warn: '#F2A65A',
      raised: '#12171A',
      hover: '#0E1214',
      faint: '#4A5754',
      sidebar: '#030404',
      chevron: '#2F3A3C',
      disclosure: '#4A5754',
      code: '#000000',
      menuBorder: '#24302F',
      menuHover: '#162020',
      errorBg: '#170B0B',
      errorLine: '#3A1A1A',
      errorText: '#FFC9C9',
      errorDetail: '#C99F9F',
      badgeText: '#050607',
      dialog: '#0B0E0F',
      inlineCode: '#12171A',
      codeText: '#D7E3DD',
      track: '#1B2224',
      scrollThumb: '#1B2224',
      scrollThumbHover: '#2F3A3C',
      userText: '#FFFFFF',
      send: 'accent',
    },
    fonts: { regular: 'JetBrainsMono-Regular', semibold: 'JetBrainsMono-SemiBold', bold: 'JetBrainsMono-Bold', mono: 'JetBrainsMono-Regular' },
    shape: { square: true, lowercase: true, userRule: true, brackets: true, dashed: true },
  },
};

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];
/**
 * Terminal's mono text grows with Dynamic Type up to this (Design: 1.3 on Silkscreen and Terminal mono). One place to
 * change: when the text-scale helper from the Dynamic Type card (lib/type.ts, maxScale.mono) is on main, point this at it.
 */
export const MONO_MAX_FONT_SCALE = 1.3;
/**
 * The themes the Appearance picker offers, in order. A theme joins this list only after Design's PASS on it
 * (THEMES.md); until then it is built but not offered. Terminal: the card is merged on Design's PASS.
 */
export const PICKER_THEMES: ThemeId[] = ['classic', 'terminal'];
export const DEFAULT_THEME: ThemeId = 'classic';

/** A stored value as a theme id; anything unknown (a theme from a newer build, junk) is the default. */
export function parseTheme(value: unknown): ThemeId {
  return typeof value === 'string' && (THEME_IDS as string[]).includes(value) ? (value as ThemeId) : DEFAULT_THEME;
}
