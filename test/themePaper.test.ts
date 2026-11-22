import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CODE_COLORS, colorFor, LIGHT_CODE_COLORS } from '../lib/highlight';
import { DEFAULT_THEME, parseTheme, PICKER_THEMES, THEMES } from '../lib/themes';
import { skinSheet, skinStyle, weightFamily } from '../lib/themeSkin';

const paper = THEMES.paper;
const classic = THEMES.classic;
const fonts = join(__dirname, '..', 'assets', 'fonts');

const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255).map((s) => (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4)).reduce((a, s, i) => a + s * [0.2126, 0.7152, 0.0722][i], 0);
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe('Paper tokens (themes.proposed.ts)', () => {
  it('has the spec colors', () => {
    expect(paper.statusBar).toBe('dark');
    expect(paper.mixBase).toBe('#FFFFFF');
    expect(paper.colors).toMatchObject({
      bg: '#F4F4F1', card: '#FFFFFF', border: '#E3E3DD', text: '#141414', dim: '#6E6E68', accent: '#141414', user: '#141414', ok: '#2F9E6A', bad: '#D63A2F', warn: '#C2610C',
      raised: '#EEEEEA', hover: '#F7F7F4', faint: '#A3A39C', sidebar: '#EDEDE8', chevron: '#C9C9C2', disclosure: '#A3A39C', code: '#FFFFFF', menuBorder: '#E3E3DD', menuHover: '#F0F0EB',
      errorBg: '#FBEAE8', errorLine: '#F1C7C2', errorText: '#8A1F17', errorDetail: '#A5524B', badgeText: '#FFFFFF', dialog: '#FFFFFF', inlineCode: '#EAEAE4', codeText: '#141414', userText: '#FFFFFF', send: 'accent',
    });
  });
  it('has every color key Classic has, and Classic has none of Paper’s extras', () => {
    expect(Object.keys(paper.colors).sort()).toEqual(Object.keys(classic.colors).sort());
    expect(classic.shape).toEqual({ square: false, lowercase: false, userRule: false, brackets: false, dashed: false });
    expect(classic.fonts).toBeNull();
  });
  it('draws a light page with black bubbles, a tail corner, ring avatars and one list card', () => {
    expect(paper.shape).toMatchObject({ square: false, solidBubble: true, tail: 6, ring: 1.5, listCard: true, circleButtons: true });
    expect(paper.shape.radii).toEqual({ 12: 22, 14: 22, 16: 22, 18: 20 });
  });
  it('is offered in the picker after Classic, and Classic stays the default', () => {
    expect(PICKER_THEMES.slice(0, 2)).toEqual(['classic', 'terminal']);
    expect(PICKER_THEMES).toContain('paper');
    expect(DEFAULT_THEME).toBe('classic');
    expect(parseTheme('paper')).toBe('paper');
  });
  it('reads: every text color passes 4.5:1 on the surface it sits on', () => {
    const c = paper.colors;
    for (const [fg, bg] of [[c.text, c.bg], [c.text, c.card], [c.dim, c.card], [c.dim, c.bg], [c.userText, c.user], [c.badgeText, c.bad], [c.errorText, c.errorBg], [c.codeText, c.code], [c.codeText, c.inlineCode]] as const) {
      expect(contrast(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    // `warn` is orange by spec (THEMES.md) and is used for icons and bold status text: 3:1, the large-text/graphics bar.
    expect(contrast(c.warn, c.card)).toBeGreaterThanOrEqual(3);
  });
});

describe('Paper fonts', () => {
  it('names only the weights the spec lists', () => {
    expect(paper.fonts).toEqual({ regular: 'Inter-Regular', semibold: 'Inter-SemiBold', bold: 'Inter-Bold', mono: 'JetBrainsMono-Regular', display: 'InstrumentSerif-Regular' });
  });
  it('bundles those files (Latin subsets, small) with their OFL licenses, and no italic', () => {
    for (const f of ['Inter-Regular', 'Inter-SemiBold', 'Inter-Bold', 'InstrumentSerif-Regular', 'JetBrainsMono-Regular']) {
      expect(existsSync(join(fonts, `${f}.ttf`)), f).toBe(true);
      expect(statSync(join(fonts, `${f}.ttf`)).size, f).toBeLessThan(60_000);
    }
    for (const l of ['OFL-Inter.txt', 'OFL-InstrumentSerif.txt', 'OFL-JetBrainsMono.txt']) expect(readFileSync(join(fonts, l), 'utf8')).toContain('SIL OPEN FONT LICENSE');
    expect(existsSync(join(fonts, 'InstrumentSerif-Italic.ttf'))).toBe(false);
  });
  it('the font loader has a file for every family Paper names', () => {
    const src = readFileSync(join(__dirname, '..', 'components', 'themeFonts.ts'), 'utf8');
    for (const name of new Set(Object.values(paper.fonts!))) expect(src).toContain(`'${name}':`);
  });
});

describe('skin: Paper drawn from Classic styles', () => {
  it('rounds the radii Paper names and leaves the rest', () => {
    expect(skinStyle({ borderRadius: 12, borderTopLeftRadius: 18, borderBottomRightRadius: 10, padding: 4 }, paper)).toEqual({ borderRadius: 22, borderTopLeftRadius: 20, borderBottomRightRadius: 10, padding: 4 });
    expect(skinStyle({ borderRadius: 25, minHeight: 50 }, paper)).toEqual({ borderRadius: 25, minHeight: 50 });
  });
  it('picks Inter by weight and keeps code in JetBrains Mono', () => {
    expect(skinStyle({ fontSize: 17, fontWeight: '600' }, paper)).toEqual({ fontSize: 17, fontFamily: 'Inter-SemiBold' });
    expect(skinStyle({ fontSize: 15 }, paper)).toEqual({ fontSize: 15, fontFamily: 'Inter-Regular' });
    expect(skinStyle({ fontSize: 13, fontFamily: 'Menlo' }, paper)).toEqual({ fontSize: 13, fontFamily: 'JetBrainsMono-Regular' });
    expect([400, 500, 600, 700, 'bold'].map((w) => weightFamily(paper.fonts!, w))).toEqual(['Inter-Regular', 'Inter-Regular', 'Inter-SemiBold', 'Inter-Bold', 'Inter-Bold']);
  });
  it('does not make letters uppercase or lowercase (Paper keeps the text as written)', () => {
    expect(skinStyle({ fontSize: 13, textTransform: 'uppercase' }, paper)).toMatchObject({ textTransform: 'uppercase' });
  });
  it('Classic still comes back untouched', () => {
    const sheet = { a: { borderRadius: 12, fontSize: 17, fontWeight: '600' } };
    expect(skinSheet(sheet, classic)).toBe(sheet);
  });
});

describe('Paper syntax colors', () => {
  it('use the kit’s keyword, function and number colors on a light block', () => {
    expect(colorFor('keyword', true)).toBe('#8A3FD1');
    expect(colorFor('title.function', true)).toBe('#1F5FD1');
    expect(colorFor('number', true)).toBe('#C2410C');
  });
  it('every scope has a light color that reads on white, and none is yellow or gold', () => {
    expect(Object.keys(LIGHT_CODE_COLORS).sort()).toEqual(Object.keys(CODE_COLORS).sort());
    for (const [scope, hex] of Object.entries(LIGHT_CODE_COLORS)) {
      if (scope === 'comment' || scope === 'quote' || scope === 'punctuation') continue; // quiet by design
      expect(contrast(hex, '#FFFFFF'), `${scope} ${hex}`).toBeGreaterThanOrEqual(4.5);
      const n = parseInt(hex.slice(1), 16);
      const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      expect(r > 200 && g > 160 && b < 120, `${scope} looks yellow`).toBe(false);
    }
  });
  it('Classic and Terminal keep today’s colors', () => {
    expect(colorFor('keyword')).toBe('#C792EA');
    expect(colorFor('keyword', false)).toBe('#C792EA');
  });
});
