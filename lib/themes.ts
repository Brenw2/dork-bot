// The app's themes (Appearance setting, docs: design-comps/dork-bot-redesign-2026-11-19/THEMES.md). Plain TypeScript, no
// React Native, so tests can import it. Classic equals the app as it was before themes: every value here is the old
// lib/theme.ts value. Terminal, Paper and Arcade are added by their own cards, each after Design's PASS.
export type ThemeId = 'classic' | 'terminal' | 'paper' | 'arcade';

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
  send: 'bot' | 'accent' | (string & {});
  // Arcade card (optional: the other themes don't set them):
  /** The 3 pt "pressable" bottom edge (shape.depth). */
  depth?: string;
  /** The "Needs you" badge fill, where it isn't `bad`. */
  needsYou?: string;
}

/** The font files a theme draws with (expo-font family names, see components/themeFonts.ts). null = the system fonts. */
export interface Fonts {
  regular: string;
  semibold: string;
  bold: string;
  /** Code blocks and inline code. */
  mono: string;
  /** Arcade: Silkscreen, the pixel face for small labels. */
  label?: string;
  /** The large-title face: Paper's serif, Arcade's Silkscreen Bold. Other themes have none. */
  display?: string;
}

/** Corner radii a theme sets in place of Classic's (Arcade). Keys follow themes.proposed.ts `radius`. */
export interface Radii {
  card: number;
  row: number;
  button: number;
  small: number;
  field: number;
  bubble: number;
  tail: number;
  avatar: number;
  menu: number;
  sheet: number;
}

/**
 * Arcade's extras (all optional, Classic, Terminal and Paper set none): `depth` is the bottom edge in pt (colors.depth is its
 * color), `caps` upper-cases labels, buttons, badges, names and headers (never message text, previews or
 * placeholders), `tile` makes the avatar a solid rounded tile. `radii` replaces Classic's corner radii by value (see
 * lib/themeSkin.ts radiusMap). The *Depth colors are the edges under your bubble and the Send button.
 */
export interface Pixel {
  depth: number;
  caps: boolean;
  tile: boolean;
  radii: Radii;
  titleShadow: string;
  userDepth: string;
  sendDepth: string;
  replyBorder: string;
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
  // Paper (optional: Classic and Terminal leave these out, so their styles are used exactly as written):
  /** Corner radii by Classic's value (12 -> 22): cards, groups and sheets are rounder. Applied to every radius with that exact value. */
  radii?: Record<number, number>;
  /** Your bubble is the theme's `user` color (not the bot's), and its bottom-right corner is `tail`. */
  solidBubble?: boolean;
  tail?: number;
  /** Bot avatars get a ring in the text color of this width. */
  ring?: number;
  /** The bot list sits in one rounded card (phone and desktop list). */
  listCard?: boolean;
  /** Header icon buttons sit in a circle: white with a hairline, and the primary one (+) in the accent. */
  circleButtons?: boolean;
  /** Bot-colored text (links, member names, @mentions, "Working on") is darkened until it reads on the light surfaces. */
  inkBotText?: boolean;
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
  /** Arcade's look beyond the shared shape flags. Absent in the other themes. */
  pixel?: Pixel;
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
  arcade: {
    id: 'arcade',
    name: 'Arcade',
    statusBar: 'light',
    mixBase: '#120F24',
    colors: {
      bg: '#120F24',
      card: '#1E1A3A',
      border: '#2A2552',
      text: '#F5F3FF',
      dim: '#A9A3CC',
      accent: '#3DE0FF',
      user: '#3DE0FF',
      ok: '#3DE0FF',
      bad: '#FF6B7A',
      warn: '#FF9E5A',
      raised: '#2A2552',
      hover: '#231E45',
      faint: '#7D77A3',
      sidebar: '#0E0B1D',
      chevron: '#4A4473',
      disclosure: '#7D77A3',
      code: '#0A0817',
      menuBorder: '#3A3470',
      menuHover: '#332D63',
      errorBg: '#2A1230',
      errorLine: '#4D1F45',
      errorText: '#FFC7D6',
      errorDetail: '#D9A3B8',
      badgeText: '#0A0817',
      dialog: '#1E1A3A',
      inlineCode: '#2A2552',
      codeText: '#F5F3FF',
      track: '#2A2552',
      scrollThumb: '#2A2552',
      scrollThumbHover: '#3A3470',
      userText: '#0A0817',
      send: '#FF5FA2',
      depth: '#0A0817',
      needsYou: '#FF5FA2',
    },
    fonts: { regular: 'SpaceGrotesk-Regular', semibold: 'SpaceGrotesk-SemiBold', bold: 'SpaceGrotesk-Bold', mono: 'JetBrainsMono-Regular', label: 'Silkscreen-Regular', display: 'Silkscreen-Bold' },
    shape: { square: false, lowercase: false, userRule: false, brackets: false, dashed: false },
    pixel: {
      depth: 3,
      caps: true,
      tile: true,
      radii: { card: 18, row: 18, button: 14, small: 10, field: 14, bubble: 18, tail: 6, avatar: 15, menu: 14, sheet: 20 },
      titleShadow: '#FF5FA2',
      userDepth: '#1A7F96',
      sendDepth: '#9C2D5E',
      replyBorder: '#4A3F8F',
    },
  },
  // Paper (kit-paper.png, b1/b2): light and calm. Warm off-white, white cards, black bubbles and buttons, Instrument
  // Serif titles, Inter UI, JetBrains Mono code. Values from themes.proposed.ts; `track` and the scrollbar (not in the
  // proposal) are the border family, one step darker for the thumb.
  paper: {
    id: 'paper',
    name: 'Paper',
    statusBar: 'dark',
    mixBase: '#FFFFFF',
    colors: {
      bg: '#F4F4F1',
      card: '#FFFFFF',
      border: '#E3E3DD',
      text: '#141414',
      dim: '#6E6E68',
      accent: '#141414',
      user: '#141414',
      ok: '#2F9E6A',
      bad: '#D63A2F',
      warn: '#C2610C',
      raised: '#EEEEEA',
      hover: '#F7F7F4',
      faint: '#A3A39C',
      sidebar: '#EDEDE8',
      chevron: '#C9C9C2',
      disclosure: '#A3A39C',
      code: '#FFFFFF',
      menuBorder: '#E3E3DD',
      menuHover: '#F0F0EB',
      errorBg: '#FBEAE8',
      errorLine: '#F1C7C2',
      errorText: '#8A1F17',
      errorDetail: '#A5524B',
      badgeText: '#FFFFFF',
      dialog: '#FFFFFF',
      inlineCode: '#EAEAE4',
      codeText: '#141414',
      track: '#E3E3DD',
      scrollThumb: '#D3D3CC',
      scrollThumbHover: '#C0C0B8',
      userText: '#FFFFFF',
      send: 'accent',
    },
    fonts: { regular: 'Inter-Regular', semibold: 'Inter-SemiBold', bold: 'Inter-Bold', mono: 'JetBrainsMono-Regular', display: 'InstrumentSerif-Regular' },
    shape: { square: false, lowercase: false, userRule: false, brackets: false, dashed: false, radii: { 12: 22, 14: 22, 16: 22, 18: 20 }, solidBubble: true, tail: 6, ring: 1.5, listCard: true, circleButtons: true, inkBotText: true },
  },
};

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];
/**
 * The themes the Appearance picker offers, in order. A theme joins this list only after Design's PASS on it
 * (THEMES.md); until then it is built but not offered. Terminal: the card is merged on Design's PASS.
 */
export const PICKER_THEMES: ThemeId[] = ['classic', 'terminal', 'paper', 'arcade'];
export const DEFAULT_THEME: ThemeId = 'classic';

/** A stored value as a theme id; anything unknown (a theme from a newer build, junk) is the default. */
export function parseTheme(value: unknown): ThemeId {
  return typeof value === 'string' && (THEME_IDS as string[]).includes(value) ? (value as ThemeId) : DEFAULT_THEME;
}
