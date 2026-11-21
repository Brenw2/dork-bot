// The theme at run time. A screen reads it with useTheme(); a file's styles are made with makeStyles(), which builds
// one StyleSheet per theme (once) and hands back the one for the current theme. Switching the theme changes the
// context value only: nothing remounts, so a streaming reply and a half-typed draft stay where they are.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { applyScrollbars } from '@/components/webStyles';
import { loadThemeFonts } from '@/components/themeFonts';
import { mix as mixOn } from '@/lib/color';
import * as SecureStore from '@/lib/secureStore';
import { DEFAULT_THEME, parseTheme, THEMES, type Theme, type ThemeId } from '@/lib/themes';
import { skinSheet, skinStyle, themed } from '@/lib/themeSkin';

const KEY = 'appearance';

export interface ThemeApi {
  theme: Theme;
  colors: Theme['colors'];
  /** `hex` blended into this theme's background (0 = background, 1 = hex). */
  mix: (hex: string, t: number, base?: string) => string;
  /** Every switch: on = the theme's green, a white thumb, the same on the phone and the web. */
  switchProps: { trackColor: { true: string; false: string }; thumbColor: string; activeThumbColor: string; ios_backgroundColor: string };
  setTheme: (id: ThemeId) => void;
  /** A UI label as the theme writes it (lowercase in Terminal). Not for message text. */
  label: (text: string) => string;
  /** An inline style (one written in a component, not in makeStyles) drawn for this theme: its font, its corners. */
  skin: <T>(style: T) => T;
}

function api(theme: Theme, setTheme: (id: ThemeId) => void): ThemeApi {
  const { colors } = theme;
  return {
    theme,
    colors,
    mix: (hex, t, base = theme.mixBase) => mixOn(hex, t, base),
    switchProps: { trackColor: { true: colors.ok, false: colors.border }, thumbColor: '#FFFFFF', activeThumbColor: '#FFFFFF', ios_backgroundColor: colors.border },
    setTheme,
    label: (text) => themed(theme, text),
    skin: (style) => skinStyle(style, theme),
  };
}

const Ctx = createContext<ThemeApi>(api(THEMES[DEFAULT_THEME], () => undefined));

// For code that isn't a component (the phone's action sheet): the theme the app is showing now.
let showing: Theme = THEMES[DEFAULT_THEME];
export const currentTheme = (): Theme => showing;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<ThemeId>(DEFAULT_THEME);
  // Nothing is drawn until the stored choice (and its fonts) are known, so a Terminal user never sees Classic first.
  const [ready, setReady] = useState(false);
  const latest = useRef(id);
  useEffect(() => {
    let live = true;
    SecureStore.getItemAsync(KEY)
      .then(async (v) => {
        const stored = parseTheme(v);
        if (stored !== DEFAULT_THEME && !(await loadThemeFonts(THEMES[stored]))) return; // fonts failed: stay on Classic
        if (live) {
          latest.current = stored;
          setId(stored);
        }
      })
      .catch(() => undefined)
      .finally(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, []);
  const setTheme = useCallback((next: ThemeId) => {
    latest.current = next;
    // The fonts load first, then the context changes once: no flash of the new look in the old font.
    void loadThemeFonts(THEMES[next]).then((ok) => {
      if (!ok || latest.current !== next) return;
      setId(next);
      void SecureStore.setItemAsync(KEY, next).catch(() => undefined);
    });
  }, []);
  const value = useMemo(() => api(THEMES[id], setTheme), [id, setTheme]);
  showing = value.theme;
  useEffect(() => applyScrollbars(value.colors.scrollThumb, value.colors.scrollThumbHover), [value]);
  if (!ready) return null;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTheme = (): ThemeApi => useContext(Ctx);

/**
 * Styles that follow the theme: `const useStyles = makeStyles(({ colors }) => StyleSheet.create({...}))`, then
 * `const styles = useStyles()` in the component. One sheet is built per theme and kept; a non-Classic theme's sheet is
 * the Classic one drawn for that theme (lib/themeSkin.ts: its font, its corners).
 */
export function makeStyles<T>(factory: (t: ThemeApi) => T): () => T {
  const sheets = new Map<ThemeId, T>();
  return () => {
    const t = useTheme();
    let sheet = sheets.get(t.theme.id);
    if (!sheet) {
      sheet = skinSheet(factory(t), t.theme);
      sheets.set(t.theme.id, sheet);
    }
    return sheet;
  };
}
