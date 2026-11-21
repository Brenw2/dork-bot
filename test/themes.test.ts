import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, parseTheme, THEME_IDS, THEMES } from '../lib/themes';

// What lib/theme.ts held before themes existed (main d15cfe1). Classic must stay exactly this.
const OLD = {
  bg: '#0F1012', card: '#1A1C20', border: '#2A2D33', text: '#ECEDEF', dim: '#9298A0', accent: '#8B7CF6', user: '#3B3470',
  ok: '#4CC38A', bad: '#F06A6A', warn: '#F2A65A', raised: '#22252A', hover: '#1C1E22', faint: '#6B7078', sidebar: '#0D0E10',
  chevron: '#4B4F56', disclosure: '#5D626A', code: '#0B0C0E', menuBorder: '#343840', menuHover: '#2E3238', errorBg: '#24171A',
  errorLine: '#4A2A2E', errorText: '#F0C7C9', errorDetail: '#C9A9AC',
  // the values that used to be written into components
  badgeText: '#1A0B0B', dialog: '#1A1C21', inlineCode: '#24272D', codeText: '#E7E9EC', track: '#2A2D33', scrollThumb: '#2A2D33', scrollThumbHover: '#3A3E45',
};

describe('themes', () => {
  it('Classic is exactly the look before themes', () => {
    expect(THEMES.classic.colors).toEqual(OLD);
    expect(THEMES.classic.mixBase).toBe('#0F1012');
    expect(THEMES.classic.statusBar).toBe('light');
  });
  it('the default is Classic, so an update changes nothing', () => expect(DEFAULT_THEME).toBe('classic'));
  it('parseTheme keeps a known id and falls back for anything else', () => {
    for (const id of THEME_IDS) expect(parseTheme(id)).toBe(id);
    for (const junk of [null, undefined, '', 'neon', 42, {}]) expect(parseTheme(junk)).toBe('classic');
  });
  it('every theme has its own id and name', () => {
    for (const [id, t] of Object.entries(THEMES)) {
      expect(t.id).toBe(id);
      expect(t.name.length).toBeGreaterThan(0);
    }
  });
});
