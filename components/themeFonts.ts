// A theme's font files, loaded when the theme is picked (or when the app starts on it), so Classic, which uses the
// system fonts, pays nothing. Only the weights the spec lists are bundled (assets/fonts: JetBrains Mono 400, 600, 700,
// Latin subset, OFL). The family names are the font files' own names, so the same string works on iOS, Android and web.
import * as Font from 'expo-font';
import type { Theme } from '@/lib/themes';

const FILES: Record<string, number> = {
  'JetBrainsMono-Regular': require('../assets/fonts/JetBrainsMono-Regular.ttf'),
  'JetBrainsMono-SemiBold': require('../assets/fonts/JetBrainsMono-SemiBold.ttf'),
  'JetBrainsMono-Bold': require('../assets/fonts/JetBrainsMono-Bold.ttf'),
};

const loading = new Map<string, Promise<boolean>>();

/** Loads the theme's fonts (nothing for Classic). Resolves false if a file would not load, so the caller keeps its theme. */
export function loadThemeFonts(theme: Theme): Promise<boolean> {
  if (!theme.fonts) return Promise.resolve(true);
  const names = [...new Set(Object.values(theme.fonts))];
  return Promise.all(
    names.map((name) => {
      let p = loading.get(name);
      if (!p) {
        p = Font.loadAsync({ [name]: FILES[name] }).then(
          () => true,
          () => {
            loading.delete(name); // a later pick may try again
            return false;
          },
        );
        loading.set(name, p);
      }
      return p;
    }),
  ).then((all) => all.every(Boolean));
}
