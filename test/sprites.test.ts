import { describe, expect, it } from 'vitest';
import { ActivityStore, DONE_MS } from '@/lib/activity';
import { CANVAS, CHARACTER_IDS, CHARACTERS, MOODS, characterFor, framePaths, frameSpec, moodFromChat, renderFrame, shift } from '@/lib/sprites';

describe('sprites', () => {
  it('every character is a 16x16 grid with its face inside', () => {
    for (const id of CHARACTER_IDS) {
      const c = CHARACTERS[id];
      expect(c.rows, id).toHaveLength(16);
      for (const r of c.rows) expect(r, id).toHaveLength(16);
      for (const [x, y] of c.eyes) {
        expect(x >= 0 && x + 3 <= 16 && y >= 0 && y + 2 <= 16, `${id} eye`).toBe(true);
        // Eyes sit on the face, not on the outline or outside it.
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 3; dx++) expect('BW', `${id} eye at ${x + dx},${y + dy}`).toContain(c.rows[y + dy][x + dx]);
      }
      if (c.mouth) {
        const [x, y] = c.mouth;
        for (let dx = 0; dx < 4; dx++) expect('BC', `${id} mouth`).toContain(c.rows[y][x + dx]);
      }
    }
  });

  it('renders every mood of every character within the canvas, for a whole loop', () => {
    for (const id of CHARACTER_IDS)
      for (const m of MOODS)
        for (let t = 0; t < 24; t++) {
          const frame = renderFrame(id, '#8B7CF6', frameSpec(m, t, 3));
          const px = [...frame.values()].flat();
          expect(px.length, `${id} ${m}`).toBeGreaterThan(60);
          for (const [x, y] of px) expect(x >= 0 && y >= 0 && x < CANVAS && y < CANVAS).toBe(true);
        }
  });

  it('animates: busy moods change between frames, idle blinks', () => {
    const paths = (m: (typeof MOODS)[number], t: number) => JSON.stringify(framePaths(renderFrame('robot', '#5AB0F2', frameSpec(m, t))));
    for (const m of ['thinking', 'working', 'talking', 'done', 'error'] as const) {
      const distinct = new Set([...Array(8)].map((_, t) => paths(m, t)));
      expect(distinct.size, m).toBeGreaterThan(2);
    }
    const idle = [...Array(22)].map((_, t) => frameSpec('idle', t).eyes);
    expect(idle.filter((e) => e === 'blink')).toHaveLength(1);
  });

  it('shades the body color', () => {
    expect(shift('#808080', 0.5)).toBe('#c0c0c0');
    expect(shift('#808080', -0.5)).toBe('#404040');
    const frame = renderFrame('slime', '#808080', frameSpec('idle', 1));
    expect(frame.has('#808080') && frame.has(shift('#808080', 0.28)) && frame.has(shift('#808080', -0.25))).toBe(true);
  });

  it('gives each name a stable default character', () => {
    expect(characterFor('scout')).toBe(characterFor('scout'));
    const spread = new Set(['assistant', 'scout', 'chief', 'mets', 'news', 'chef', 'coach', 'dj', 'tutor', 'pal'].map(characterFor));
    expect(spread.size).toBeGreaterThan(3);
  });

  it('maps chat state to a mood', () => {
    const p = (o: Partial<{ text: string; tools: { status: string }[]; thinking: boolean }>) => ({ text: '', tools: [], thinking: true, ...o });
    expect(moodFromChat({ pending: null, error: null })).toBe('idle');
    expect(moodFromChat({ pending: null, error: 'boom' })).toBe('error');
    expect(moodFromChat({ pending: p({}), error: null })).toBe('thinking');
    expect(moodFromChat({ pending: p({ tools: [{ status: 'running' }] }), error: null })).toBe('working');
    expect(moodFromChat({ pending: p({ tools: [{ status: 'done' }] }), error: null })).toBe('thinking');
    expect(moodFromChat({ pending: p({ text: 'Hi', thinking: false }), error: null })).toBe('talking');
  });
});

describe('activity store', () => {
  function store() {
    const timers: { fn: () => void; ms: number }[] = [];
    const s = new ActivityStore(
      (fn, ms) => (timers.push({ fn, ms }), timers.length as unknown as ReturnType<typeof setTimeout>),
      () => {},
    );
    return { s, timers };
  }

  it('celebrates a finished run, then goes idle', () => {
    const { s, timers } = store();
    let emits = 0;
    s.subscribe(() => emits++);
    s.set('scout', 'thinking');
    s.set('scout', 'talking');
    s.set('scout', 'idle');
    expect(s.get('scout')).toBe('done');
    expect(timers.at(-1)?.ms).toBe(DONE_MS);
    s.set('scout', 'idle'); // the chat unmounting doesn't cut it short
    expect(s.get('scout')).toBe('done');
    timers.at(-1)!.fn();
    expect(s.get('scout')).toBe('idle');
    expect(emits).toBe(4);
    expect(s.get('other')).toBe('idle');
  });

  it('a new run during the celebration takes over', () => {
    const { s, timers } = store();
    s.set('scout', 'working');
    s.set('scout', 'idle');
    s.set('scout', 'thinking');
    timers.at(-1)!.fn();
    expect(s.get('scout')).toBe('thinking');
  });
});
