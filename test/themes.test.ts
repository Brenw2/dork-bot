import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, parseTheme, PICKER_THEMES, THEME_IDS, THEMES } from '../lib/themes';
import { PROMPT, skinSheet, skinStyle, themed, weightFamily } from '../lib/themeSkin';

// What lib/theme.ts held before themes existed (main d15cfe1). Classic must stay exactly this.
const OLD = {
  bg: '#0F1012', card: '#1A1C20', border: '#2A2D33', text: '#ECEDEF', dim: '#9298A0', accent: '#8B7CF6', user: '#3B3470',
  ok: '#4CC38A', bad: '#F06A6A', warn: '#F2A65A', raised: '#22252A', hover: '#1C1E22', faint: '#6B7078', sidebar: '#0D0E10',
  chevron: '#4B4F56', disclosure: '#5D626A', code: '#0B0C0E', menuBorder: '#343840', menuHover: '#2E3238', errorBg: '#24171A',
  errorLine: '#4A2A2E', errorText: '#F0C7C9', errorDetail: '#C9A9AC',
  // the values that used to be written into components
  badgeText: '#1A0B0B', dialog: '#1A1C21', inlineCode: '#24272D', codeText: '#E7E9EC', track: '#2A2D33', scrollThumb: '#2A2D33', scrollThumbHover: '#3A3E45',
  // text in your own message was colors.text; Send was the bot's color
  userText: '#ECEDEF', send: 'bot',
};

describe('themes', () => {
  it('Classic is exactly the look before themes', () => {
    expect(THEMES.classic.colors).toEqual(OLD);
    expect(THEMES.classic.mixBase).toBe('#0F1012');
    expect(THEMES.classic.statusBar).toBe('light');
    expect(THEMES.classic.fonts).toBeNull();
    expect(THEMES.classic.shape).toEqual({ square: false, lowercase: false, userRule: false, brackets: false, dashed: false });
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
  it('the picker offers Classic first, and only themes that exist', () => {
    expect(PICKER_THEMES[0]).toBe('classic');
    for (const id of PICKER_THEMES) expect(THEME_IDS).toContain(id);
  });
});

describe('Terminal tokens (themes.proposed.ts)', () => {
  const t = THEMES.terminal;
  it('has the spec colors', () => {
    expect(t.mixBase).toBe('#050607');
    expect(t.statusBar).toBe('light');
    expect(t.colors).toMatchObject({ bg: '#050607', card: '#0B0E0F', border: '#1B2224', text: '#D7E3DD', dim: '#738580', accent: '#7CF5B0', bad: '#FF6B6B', warn: '#F2A65A', raised: '#12171A', code: '#000000', badgeText: '#050607', userText: '#FFFFFF', send: 'accent' });
  });
  it('has every color key Classic has', () => {
    expect(Object.keys(t.colors).sort()).toEqual(Object.keys(THEMES.classic.colors).sort());
  });
  it('is square, lowercase, rule rows, brackets, dashed', () => expect(t.shape).toEqual({ square: true, lowercase: true, userRule: true, brackets: true, dashed: true }));
  it('uses one mono family in three weights, nothing else', () => {
    expect([...new Set(Object.values(t.fonts ?? {}))].sort()).toEqual(['JetBrainsMono-Bold', 'JetBrainsMono-Regular', 'JetBrainsMono-SemiBold']);
  });
});

describe('skin: a theme drawn from Classic styles', () => {
  const classic = THEMES.classic;
  const term = THEMES.terminal;
  const sheet = {
    title: { fontSize: 17, fontWeight: '600', color: '#fff' },
    card: { borderRadius: 12, borderTopLeftRadius: 8, backgroundColor: '#000', padding: 4 },
    section: { fontSize: 13, textTransform: 'uppercase' },
    code: { fontFamily: 'Menlo', fontSize: 13 },
    plain: { padding: 8 },
  } as const;

  it('Classic returns the very same objects (it cannot move)', () => {
    expect(skinSheet(sheet, classic)).toBe(sheet);
    expect(skinStyle(sheet.title, classic)).toBe(sheet.title);
  });
  it('Terminal squares every corner', () => {
    expect(skinStyle(sheet.card, term)).toEqual({ borderRadius: 0, borderTopLeftRadius: 0, backgroundColor: '#000', padding: 4 });
  });
  it('Terminal swaps fontWeight for the weight’s font file', () => {
    expect(skinStyle(sheet.title, term)).toEqual({ fontSize: 17, fontFamily: 'JetBrainsMono-SemiBold', color: '#fff' });
    expect(skinStyle({ fontSize: 12 }, term)).toEqual({ fontSize: 12, fontFamily: 'JetBrainsMono-Regular' });
    expect(skinStyle({ fontWeight: '700' }, term)).toEqual({ fontFamily: 'JetBrainsMono-Bold' });
  });
  it('Terminal keeps code as the mono file, lowercases section headers, leaves layout-only styles alone', () => {
    expect(skinStyle(sheet.code, term)).toEqual({ fontSize: 13, fontFamily: 'JetBrainsMono-Regular' });
    expect(skinStyle(sheet.section, term)).toMatchObject({ textTransform: 'lowercase' });
    expect(skinStyle(sheet.plain, term)).toEqual({ padding: 8 });
  });
  it('weights map to the three files', () => {
    const f = term.fonts!;
    expect([400, '400', '500', '600', 600, '700', 'bold', '800'].map((w) => weightFamily(f, w))).toEqual([f.regular, f.regular, f.regular, f.semibold, f.semibold, f.bold, f.bold, f.bold]);
  });
  it('labels are lowercase in Terminal only', () => {
    expect(themed(term, 'New Chat')).toBe('new chat');
    expect(themed(classic, 'New Chat')).toBe('New Chat');
    expect(PROMPT).toBe('\u203A');
  });
});
