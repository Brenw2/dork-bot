// Web and desktop only (design fix 3): app-wide scrollbars are 8 px with a transparent track, a themed thumb
// (Classic: #2A2D33, #3A3E45 on hover) and no arrow buttons, instead of Chromium's default grey bars. Does nothing on the phone.
import { Platform } from 'react-native';
import { THEMES } from '@/lib/themes';

export const scrollbarCss = (thumb: string, hover: string) => `
::-webkit-scrollbar { width: 8px; height: 8px; background: transparent; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: ${thumb}; border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: ${hover}; }
::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
::-webkit-scrollbar-corner { background: transparent; }
`;

/** Draws the scrollbars in the theme's colors (called at start with Classic, and again when the theme changes). */
export function applyScrollbars(thumb: string, hover: string): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  let style = document.getElementById('dork-scrollbars');
  if (!style) {
    style = document.createElement('style');
    style.id = 'dork-scrollbars';
    document.head.appendChild(style);
  }
  style.textContent = scrollbarCss(thumb, hover);
}

applyScrollbars(THEMES.classic.colors.scrollThumb, THEMES.classic.colors.scrollThumbHover);
