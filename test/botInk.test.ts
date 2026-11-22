import { describe, expect, it } from 'vitest';
import { contrastRatio, INK, PAPER_SURFACES, readableOn } from '../lib/botInk';
import { BOT_COLORS } from '../lib/sprites';
import { THEMES } from '../lib/themes';

describe('Paper: bot-colored text reads on white and the page', () => {
  it('there are 11 bot colors', () => expect(BOT_COLORS).toHaveLength(11));
  it('every bot color, darkened for Paper, reaches 4.5:1 on #FFFFFF and #F4F4F1', () => {
    for (const hex of BOT_COLORS) {
      const c = readableOn(hex);
      for (const s of PAPER_SURFACES) expect(contrastRatio(c, s), `${hex} -> ${c} on ${s}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('the 3:1 bar for bold names is met too', () => {
    for (const hex of BOT_COLORS) for (const s of PAPER_SURFACES) expect(contrastRatio(readableOn(hex, 3), s)).toBeGreaterThanOrEqual(3);
  });
  it('a color that already reads is kept, and nothing goes past the ink', () => {
    expect(readableOn('#141414')).toBe('#141414');
    expect(readableOn('#8A3FD1')).toBe('#8A3FD1');
    expect(readableOn('#FFFFFF')).not.toBe('#FFFFFF');
    expect(contrastRatio(INK, '#FFFFFF')).toBeGreaterThan(15);
  });
  it('keeps the hue family: the light yellow stays warm, not grey', () => {
    const n = parseInt(readableOn('#FFD447').slice(1), 16);
    expect((n >> 16) & 255).toBeGreaterThan(n & 255);
  });
});

describe('only Paper darkens bot text', () => {
  it('Classic and Terminal do not set the flag, Paper does', () => {
    expect(THEMES.classic.shape.inkBotText).toBeUndefined();
    expect(THEMES.terminal.shape.inkBotText).toBeUndefined();
    expect(THEMES.paper.shape.inkBotText).toBe(true);
  });
});
