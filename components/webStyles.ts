// Web and desktop only (design fix 3): app-wide scrollbars are 8 px with a transparent track, a #2A2D33 thumb
// (#3A3E45 on hover) and no arrow buttons, instead of Chromium's default grey bars. Does nothing on the phone.
import { Platform } from 'react-native';

export const SCROLLBAR_CSS = `
::-webkit-scrollbar { width: 8px; height: 8px; background: transparent; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #2A2D33; border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: #3A3E45; }
::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
::-webkit-scrollbar-corner { background: transparent; }
`;

if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById('dork-scrollbars')) {
  const style = document.createElement('style');
  style.id = 'dork-scrollbars';
  style.textContent = SCROLLBAR_CSS;
  document.head.appendChild(style);
}
