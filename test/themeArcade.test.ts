import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PICKER_THEMES, THEMES } from '../lib/themes';
import { capsText, depthStyle, pixelText, radiusMap, skinSheet, skinStyle } from '../lib/themeSkin';

const a = THEMES.arcade;
const classic = THEMES.classic;
const term = THEMES.terminal;

describe('Arcade tokens (themes.proposed.ts)', () => {
  it('has the spec colors', () => {
    expect(a.mixBase).toBe('#120F24');
    expect(a.statusBar).toBe('light');
    expect(a.colors).toMatchObject({ bg: '#120F24', card: '#1E1A3A', border: '#2A2552', text: '#F5F3FF', dim: '#A9A3CC', accent: '#3DE0FF', user: '#3DE0FF', userText: '#0A0817', badgeText: '#0A0817', send: '#FF5FA2', depth: '#0A0817', needsYou: '#FF5FA2', bad: '#FF6B7A', warn: '#FF9E5A' });
  });
  it('has every color key Classic has', () => {
    for (const k of Object.keys(classic.colors)) expect(a.colors).toHaveProperty(k);
  });
  it('no yellow or gold UI: warn stays orange', () => {
    expect(a.colors.warn).toBe('#FF9E5A');
  });
  it('bundles only the spec weights: Space Grotesk 400/600/700, Silkscreen Regular and Bold, JetBrains Mono 400 for code', () => {
    expect(a.fonts).toEqual({ regular: 'SpaceGrotesk-Regular', semibold: 'SpaceGrotesk-SemiBold', bold: 'SpaceGrotesk-Bold', mono: 'JetBrainsMono-Regular', label: 'Silkscreen-Regular', display: 'Silkscreen-Bold' });
    const dir = join(__dirname, '..', 'assets', 'fonts');
    for (const f of ['SpaceGrotesk-Regular', 'SpaceGrotesk-SemiBold', 'SpaceGrotesk-Bold', 'Silkscreen-Regular', 'Silkscreen-Bold']) expect(existsSync(join(dir, `${f}.ttf`))).toBe(true);
    for (const l of ['OFL-SpaceGrotesk.txt', 'OFL-Silkscreen.txt']) expect(readFileSync(join(dir, l), 'utf8')).toContain('SIL Open Font License');
  });
  it('every font family is registered in themeFonts', () => {
    const src = readFileSync(join(__dirname, '..', 'components', 'themeFonts.ts'), 'utf8');
    for (const name of new Set(Object.values(a.fonts ?? {}))) expect(src).toContain(`'${name}'`);
  });
  it('pixel shape: 3 pt edge, caps, tile avatar, spec radii', () => {
    expect(a.pixel).toMatchObject({ depth: 3, caps: true, tile: true, userDepth: '#1A7F96', replyBorder: '#4A3F8F', sendDepth: '#9C2D5E', titleShadow: '#FF5FA2' });
    expect(a.pixel?.radii).toEqual({ card: 18, row: 18, button: 14, small: 10, field: 14, bubble: 18, tail: 6, avatar: 15, menu: 14, sheet: 20 });
    expect(a.shape).toEqual({ square: false, lowercase: false, userRule: false, brackets: false, dashed: false });
  });
  it('Classic and Terminal have no pixel look, so nothing of Arcade leaks into them', () => {
    expect(classic.pixel).toBeUndefined();
    expect(term.pixel).toBeUndefined();
    expect(depthStyle(classic)).toBeUndefined();
    expect(pixelText(term)).toBeUndefined();
    expect(capsText(classic)).toBeUndefined();
    expect(radiusMap(term)).toBeNull();
  });
  it('is offered in the picker after Terminal, and Classic is still first', () => {
    expect(PICKER_THEMES).toEqual(['classic', 'terminal', 'arcade']);
  });
});

describe('Arcade skin', () => {
  it('maps Classic radii by value and leaves others', () => {
    expect(radiusMap(a)).toEqual({ 12: 18, 16: 18, 25: 14, 20: 14, 15: 10 });
    expect(skinStyle({ borderRadius: 12, borderTopLeftRadius: 25, width: 3 }, a)).toEqual({ borderRadius: 18, borderTopLeftRadius: 14, width: 3 });
    expect(skinStyle({ borderRadius: 26 }, a)).toEqual({ borderRadius: 26 });
  });
  it('swaps weights for Space Grotesk files and keeps code mono', () => {
    expect(skinStyle({ fontSize: 17, fontWeight: '600' }, a)).toEqual({ fontSize: 17, fontFamily: 'SpaceGrotesk-SemiBold' });
    expect(skinStyle({ fontFamily: 'Menlo', fontSize: 13 }, a)).toEqual({ fontSize: 13, fontFamily: 'JetBrainsMono-Regular' });
  });
  it('does not lowercase (that is Terminal)', () => {
    expect(skinStyle({ fontSize: 13, textTransform: 'uppercase' }, a)).toMatchObject({ textTransform: 'uppercase' });
  });
  it('depth is a hard shadow 3 pt down in the edge color, or a given one', () => {
    expect(depthStyle(a)).toEqual({ shadowColor: '#0A0817', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 1, shadowRadius: 0 });
    expect(depthStyle(a, '#1A7F96')?.shadowColor).toBe('#1A7F96');
  });
  it('pixel text is Silkscreen in caps; the display one is the bold file', () => {
    expect(pixelText(a)).toMatchObject({ fontFamily: 'Silkscreen-Regular', textTransform: 'uppercase' });
    expect(pixelText(a, 'display')).toMatchObject({ fontFamily: 'Silkscreen-Bold', textTransform: 'uppercase' });
    expect(capsText(a)).toEqual({ textTransform: 'uppercase' });
  });
  it('Classic sheets come back untouched', () => {
    const sheet = { a: { borderRadius: 12 } };
    expect(skinSheet(sheet, classic)).toBe(sheet);
  });
});

describe('Silkscreen text is capped through lib/type', () => {
  it('uses maxScale.mono, never a literal', () => {
    for (const f of ['components/BotList.tsx', 'components/Chips.tsx', 'components/Markdown.tsx', 'components/Grouped.tsx']) {
      const src = readFileSync(join(__dirname, '..', f), 'utf8');
      expect(src).toContain('maxScale.mono');
      expect(src).not.toMatch(/maxFontSizeMultiplier=\{\s*\d/);
    }
  });
});
