// The theme at run time. A screen reads it with useTheme(); a file's styles are made with makeStyles(), which builds
// one StyleSheet per theme (once) and hands back the one for the current theme. Switching the theme changes the
// context value only: nothing remounts, so a streaming reply and a half-typed draft stay where they are.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { applyScrollbars } from '@/components/webStyles';
import { mix as mixOn } from '@/lib/color';
import * as SecureStore from '@/lib/secureStore';
import { DEFAULT_THEME, parseTheme, THEMES, type Theme, type ThemeId } from '@/lib/themes';

const KEY = 'appearance';

export interface ThemeApi {
  theme: Theme;
  colors: Theme['colors'];
  /** `hex` blended into this theme's background (0 = background, 1 = hex). */
  mix: (hex: string, t: number, base?: string) => string;
  /** Every switch: on = the theme's green, a white thumb, the same on the phone and the web. */
  switchProps: { trackColor: { true: string; false: string }; thumbColor: string; activeThumbColor: string; ios_backgroundColor: string };
  setTheme: (id: ThemeId) => void;
}

function api(theme: Theme, setTheme: (id: ThemeId) => void): ThemeApi {
  const { colors } = theme;
  return {
    theme,
    colors,
    mix: (hex, t, base = theme.mixBase) => mixOn(hex, t, base),
    switchProps: { trackColor: { true: colors.ok, false: colors.border }, thumbColor: '#FFFFFF', activeThumbColor: '#FFFFFF', ios_backgroundColor: colors.border },
    setTheme,
  };
}

const Ctx = createContext<ThemeApi>(api(THEMES[DEFAULT_THEME], () => undefined));

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<ThemeId>(DEFAULT_THEME);
  useEffect(() => {
    let live = true;
    SecureStore.getItemAsync(KEY)
      .then((v) => live && setId(parseTheme(v)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  const setTheme = useCallback((next: ThemeId) => {
    setId(next);
    void SecureStore.setItemAsync(KEY, next).catch(() => undefined);
  }, []);
  const value = useMemo(() => api(THEMES[id], setTheme), [id, setTheme]);
  useEffect(() => applyScrollbars(value.colors.scrollThumb, value.colors.scrollThumbHover), [value]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTheme = (): ThemeApi => useContext(Ctx);

/**
 * Styles that follow the theme: `const useStyles = makeStyles(({ colors }) => StyleSheet.create({...}))`, then
 * `const styles = useStyles()` in the component. One sheet is built per theme and kept.
 */
export function makeStyles<T>(factory: (t: ThemeApi) => T): () => T {
  const sheets = new Map<ThemeId, T>();
  return () => {
    const t = useTheme();
    let sheet = sheets.get(t.theme.id);
    if (!sheet) {
      sheet = factory(t);
      sheets.set(t.theme.id, sheet);
    }
    return sheet;
  };
}
