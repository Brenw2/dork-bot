// Retro pixel characters for the bots. Pure data + frame logic (no React), so it is
// unit-tested and shared by the app (components/BotSprite.tsx) and the icon script.
//
// Each character is a 16x16 grid drawn in a 20x20 canvas (2 px margin left/right, 3 px on
// top) so effects like sparks and "..." have room. Body pixels ('B') take the bot's color
// and get automatic retro shading: lighter along the top edge, darker along the bottom.

export type CharacterId = 'robot' | 'cat' | 'ghost' | 'frog' | 'slime' | 'owl' | 'alien' | 'bear';
export type Mood = 'idle' | 'thinking' | 'working' | 'talking' | 'done' | 'error' | 'sleeping';

export const CANVAS = 20;
const OX = 2;
const OY = 3;

interface Character {
  name: string;
  rows: string[];
  /** Top-left of each 3x2 eye. */
  eyes: [number, number][];
  /** Top-left of the 4-wide mouth, or null (the owl has a beak). */
  mouth: [number, number] | null;
}

// K outline, B body, W white, P pink, A yellow, G gray, C cream, '.' empty.
export const CHARACTERS: Record<CharacterId, Character> = {
  robot: {
    name: 'Robot',
    rows: [
      '.......AA.......',
      '.......GG.......',
      '..KKKKKKKKKKKK..',
      '.KBBBBBBBBBBBBK.',
      '.KBBBBBBBBBBBBK.',
      '.KBBBBBBBBBBBBK.',
      '.KBBBBBBBBBBBBK.',
      'KKBBBBBBBBBBBBKK',
      'KGBBBBBBBBBBBBGK',
      'KKBBBBBBBBBBBBKK',
      '.KBBBBBBBBBBBBK.',
      '.KBBBBBBBBBBBBK.',
      '.KBBBBBBBBBBBBK.',
      '..KKKKKKKKKKKK..',
      '.....KGGGGK.....',
      '....KKKKKKKK....',
    ],
    eyes: [[4, 5], [9, 5]],
    mouth: [6, 10],
  },
  cat: {
    name: 'Cat',
    rows: [
      '................',
      '.KK..........KK.',
      '.KBK........KBK.',
      '.KBPK......KPBK.',
      '.KBBBKKKKKKBBBK.',
      'KBBBBBBBBBBBBBBK',
      'KBBBBBBBBBBBBBBK',
      'KBBBBBBBBBBBBBBK',
      'KBBBBBBBBBBBBBBK',
      'KPBBBBBBBBBBBBPK',
      'KBBBBBBBBBBBBBBK',
      '.KBBBBBBBBBBBBK.',
      '..KKBBBBBBBBKK..',
      '...KBBKKKKBBK...',
      '...KKK....KKK...',
      '................',
    ],
    eyes: [[3, 6], [10, 6]],
    mouth: [6, 9],
  },
  ghost: {
    name: 'Ghost',
    rows: [
      '................',
      '.....KKKKKK.....',
      '...KKBBBBBBKK...',
      '..KBBBBBBBBBBK..',
      '.KBBBBBBBBBBBBK.',
      '.KBBBBBBBBBBBBK.',
      '.KBBBBBBBBBBBBK.',
      '.KBBBBBBBBBBBBK.',
      '.KBBBBBBBBBBBBK.',
      '.KBBBBBBBBBBBBK.',
      '.KBBBBBBBBBBBBK.',
      '.KBBBBBBBBBBBBK.',
      '.KBBBBBBBBBBBBK.',
      '.KBBKBBBBBBKBBK.',
      '.KBK.KBBBBK.KBK.',
      '..K...KKKK...K..',
    ],
    eyes: [[4, 6], [9, 6]],
    mouth: [6, 9],
  },
  frog: {
    name: 'Frog',
    rows: [
      '................',
      '..KKK......KKK..',
      '.KBBBK....KBBBK.',
      'KBBBBBK..KBBBBBK',
      'KBBBBBKKKKBBBBBK',
      'KBBBBBBBBBBBBBBK',
      'KBBBBBBBBBBBBBBK',
      'KBBBBBBBBBBBBBBK',
      'KBBBBBBBBBBBBBBK',
      'KBBBBBBBBBBBBBBK',
      '.KBBBBBBBBBBBBK.',
      '..KKBBBBBBBBKK..',
      '.KBBKKKKKKKKBBK.',
      '.KKK........KKK.',
      '................',
      '................',
    ],
    eyes: [[2, 3], [11, 3]],
    mouth: [6, 7],
  },
  slime: {
    name: 'Slime',
    rows: [
      '................',
      '................',
      '................',
      '......KKKK......',
      '....KKBBBBKK....',
      '...KBBBBBBBBK...',
      '..KBBBBBBBBBBK..',
      '.KBBBBBBBBBBBBK.',
      '.KBBBBBBBBBBBBK.',
      'KBBBBBBBBBBBBBBK',
      'KBBBBBBBBBBBBBBK',
      'KBBBBBBBBBBBBBBK',
      'KBBBBBBBBBBBBBBK',
      '.KBBBBBBBBBBBBK.',
      '..KKKKKKKKKKKK..',
      '................',
    ],
    eyes: [[4, 8], [9, 8]],
    mouth: [6, 11],
  },
  owl: {
    name: 'Owl',
    rows: [
      '................',
      '.KK..........KK.',
      '.KBK........KBK.',
      '..KBKKKKKKKKBK..',
      '..KBBBBBBBBBBK..',
      '.KBWWWWBBWWWWBK.',
      '.KWWWWWBBWWWWWK.',
      '.KBWWWWBBWWWWBK.',
      '.KBBBBBAABBBBBK.',
      '.KBBBBBAABBBBBK.',
      '.KBBBBBBBBBBBBK.',
      '.KBBCBCBBCBCBBK.',
      '..KBBBBBBBBBBK..',
      '...KKKKKKKKKK...',
      '....AAA..AAA....',
      '................',
    ],
    eyes: [[3, 5], [10, 5]],
    mouth: null,
  },
  alien: {
    name: 'Alien',
    rows: [
      '..A..........A..',
      '...G........G...',
      '....GKKKKKKG....',
      '..KKBBBBBBBBKK..',
      '.KBBBBBBBBBBBBK.',
      'KBBBBBBBBBBBBBBK',
      'KBBBBBBBBBBBBBBK',
      'KBBBBBBBBBBBBBBK',
      '.KBBBBBBBBBBBBK.',
      '..KBBBBBBBBBBK..',
      '...KBBBBBBBBK...',
      '....KBBBBBBK....',
      '.....KKKKKK.....',
      '......KBBK......',
      '.....KBBBBK.....',
      '.....KKKKKK.....',
    ],
    eyes: [[3, 6], [10, 6]],
    mouth: [6, 9],
  },
  bear: {
    name: 'Bear',
    rows: [
      '................',
      '..KKK......KKK..',
      '.KBPBK....KBPBK.',
      '.KBBBKKKKKKBBBK.',
      '..KBBBBBBBBBBK..',
      '.KBBBBBBBBBBBBK.',
      '.KBBBBBBBBBBBBK.',
      '.KBBBBBBBBBBBBK.',
      '.KBBBBCCCCBBBBK.',
      '.KBBBCCKKCCBBBK.',
      '.KBBBCCCCCCBBBK.',
      '..KBBBBBBBBBBK..',
      '...KKKKKKKKKK...',
      '....KBBKKBBK....',
      '....KKK..KKK....',
      '................',
    ],
    eyes: [[3, 6], [10, 6]],
    mouth: [6, 10],
  },
};

export const CHARACTER_IDS = Object.keys(CHARACTERS) as CharacterId[];
export const MOODS: Mood[] = ['idle', 'thinking', 'working', 'talking', 'done', 'error', 'sleeping'];

/** Default character from the bot's name, so every bot has one before it is picked. */
export function characterFor(name: string): CharacterId {
  let h = 7;
  for (const ch of name) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  return CHARACTER_IDS[h % CHARACTER_IDS.length];
}

// 3x2 eyes and 4-wide mouths. 'E'/'M' dark, 'W' white, 'P' pink, '.' keeps what's under it.
const EYES = {
  open: ['WEE', 'EEE'],
  blink: ['...', 'EEE'],
  up: ['EEW', 'EEE'],
  happy: ['.E.', 'E.E'],
  dead: ['E.E', '.E.'],
} as const;
const MOUTHS = {
  closed: ['.MM.'],
  smile: ['M..M', '.MM.'],
  open: ['MMMM', '.PP.'],
  flat: ['MMMM'],
  hmm: ['..MM'],
} as const;

const FIXED: Record<string, string> = {
  K: '#16141F',
  E: '#16141F',
  M: '#16141F',
  W: '#FFFFFF',
  P: '#FF8FB1',
  A: '#FFD447',
  G: '#8A8FA3',
  C: '#FFF1D6',
  R: '#FF5A5A',
  Z: '#B9C2FF',
};

/** Pixels of one frame: color -> list of [x, y] in the 20x20 canvas. */
export type Frame = Map<string, [number, number][]>;

export interface FrameSpec {
  eyes: keyof typeof EYES;
  eyeShift: number;
  mouth: keyof typeof MOUTHS;
  dx: number;
  dy: number;
  effect: 'none' | 'dots1' | 'dots2' | 'dots3' | 'spark' | 'spark2' | 'sparkle' | 'sparkle2' | 'alert' | 'z' | 'z2';
}

/** How many frames each mood's loop has (played at FRAME_MS each). */
export const FRAME_MS = 140;

/**
 * The frame to show for a mood at tick t. `seed` staggers blinks between bots.
 * Idle: blinks every ~3 s and bobs slowly. Thinking: looks up and around, "..." appears.
 * Working: quick bob, eyes scan, spark. Talking: mouth flaps. Done: jump + sparkles.
 * Error: shake + "!". Sleeping: eyes shut, "z".
 */
export function frameSpec(mood: Mood, t: number, seed = 0): FrameSpec {
  const base: FrameSpec = { eyes: 'open', eyeShift: 0, mouth: 'closed', dx: 0, dy: 0, effect: 'none' };
  switch (mood) {
    case 'idle': {
      const cycle = (t + seed * 7) % 22;
      return { ...base, eyes: cycle === 0 ? 'blink' : 'open', dy: Math.floor(t / 4) % 2 };
    }
    case 'thinking': {
      const look = [0, 0, -1, -1, 0, 0, 1, 1][t % 8];
      const dots = (['dots1', 'dots2', 'dots3', 'none'] as const)[Math.floor(t / 3) % 4];
      return { ...base, eyes: 'up', eyeShift: look, mouth: 'hmm', effect: dots };
    }
    case 'working': {
      const scan = [-1, 0, 1, 0][t % 4];
      return { ...base, eyeShift: scan, dy: t % 2, effect: t % 4 < 2 ? 'spark' : 'spark2' };
    }
    case 'talking':
      return { ...base, mouth: t % 2 ? 'open' : 'closed', dy: Math.floor(t / 2) % 2, eyes: (t + seed) % 18 === 0 ? 'blink' : 'open' };
    case 'done': {
      const jump = [0, -2, -3, -2, 0, 0, 0, 0][t % 8];
      return { ...base, eyes: 'happy', mouth: 'smile', dy: jump, effect: t % 4 < 2 ? 'sparkle' : 'sparkle2' };
    }
    case 'error':
      return { ...base, eyes: 'dead', mouth: 'flat', dx: [0, -1, 1, -1, 1, 0, 0, 0][t % 8], effect: t % 4 < 3 ? 'alert' : 'none' };
    case 'sleeping':
      return { ...base, eyes: 'blink', mouth: 'flat', dy: Math.floor(t / 6) % 2, effect: Math.floor(t / 5) % 2 ? 'z' : 'z2' };
  }
}

/** Builds the pixels for one frame of a character in a body color. */
export function renderFrame(id: CharacterId, color: string, spec: FrameSpec): Frame {
  const ch = CHARACTERS[id];
  const grid = ch.rows.map((r) => r.split(''));
  const stamp = (mask: readonly string[], x0: number, y0: number) =>
    mask.forEach((row, dy) =>
      row.split('').forEach((c, dx) => {
        if (c !== '.' && grid[y0 + dy]?.[x0 + dx] !== undefined) grid[y0 + dy][x0 + dx] = c;
      }),
    );

  // Shade the body first (from the bare outline), then draw the face on top.
  const shade = ch.rows.map((r, y) =>
    r.split('').map((c, x) => {
      if (c !== 'B') return c;
      const above = ch.rows[y - 1]?.[x] ?? '.';
      const below = ch.rows[y + 1]?.[x] ?? '.';
      if (above === 'K' || above === '.') return 'L';
      if (below === 'K' || below === '.') return 'D';
      return 'B';
    }),
  );
  shade.forEach((row, y) => row.forEach((c, x) => (grid[y][x] = c)));
  for (const [ex, ey] of ch.eyes) stamp(EYES[spec.eyes], ex + spec.eyeShift, ey);
  if (ch.mouth) stamp(MOUTHS[spec.mouth], ch.mouth[0], ch.mouth[1]);

  const colors: Record<string, string> = { ...FIXED, B: color, L: shift(color, 0.28), D: shift(color, -0.25) };
  const frame: Frame = new Map();
  const put = (c: string, x: number, y: number) => {
    if (x < 0 || y < 0 || x >= CANVAS || y >= CANVAS) return;
    const hex = colors[c];
    if (!hex) return;
    if (!frame.has(hex)) frame.set(hex, []);
    frame.get(hex)!.push([x, y]);
  };
  grid.forEach((row, y) => row.forEach((c, x) => put(c, x + OX + spec.dx, y + OY + spec.dy)));
  for (const [c, x, y] of effectPixels(spec.effect)) put(c, x, y);
  return frame;
}

function effectPixels(effect: FrameSpec['effect']): [string, number, number][] {
  const dots = (n: number) => [...Array(n)].map((_, i) => ['W', 14 + i * 2, 1] as [string, number, number]);
  switch (effect) {
    case 'none':
      return [];
    case 'dots1':
      return dots(1);
    case 'dots2':
      return dots(2);
    case 'dots3':
      return dots(3);
    case 'spark':
      return [['A', 17, 1], ['A', 16, 2], ['A', 17, 2], ['A', 18, 2], ['A', 17, 3]];
    case 'spark2':
      return [['A', 16, 1], ['A', 18, 1], ['A', 17, 2], ['A', 16, 3], ['A', 18, 3]];
    case 'sparkle':
      return [['A', 1, 2], ['A', 0, 3], ['A', 2, 3], ['A', 1, 4], ['W', 18, 1], ['A', 17, 6]];
    case 'sparkle2':
      return [['W', 1, 3], ['A', 18, 0], ['A', 17, 1], ['A', 19, 1], ['A', 18, 2], ['W', 0, 7]];
    case 'alert':
      return [['R', 18, 0], ['R', 18, 1], ['R', 18, 2], ['R', 18, 4]];
    case 'z':
      return [['Z', 15, 0], ['Z', 16, 0], ['Z', 17, 0], ['Z', 16, 1], ['Z', 15, 2], ['Z', 16, 2], ['Z', 17, 2]];
    case 'z2':
      return [['Z', 16, 1], ['Z', 17, 1], ['Z', 18, 1], ['Z', 17, 2], ['Z', 16, 3], ['Z', 17, 3], ['Z', 18, 3]];
  }
}

/** One SVG path per color (unit squares), for crisp pixel rendering. */
export function framePaths(frame: Frame): { color: string; d: string }[] {
  return [...frame].map(([color, px]) => ({ color, d: px.map(([x, y]) => `M${x} ${y}h1.04v1.04h-1.04z`).join('') }));
}

/** Lighten (amount > 0) or darken (amount < 0) a #rrggbb color. */
export function shift(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
    Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount)),
  );
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** What a bot's sprite should do, from its chat state. */
export function moodFromChat(state: {
  pending: { text: string; tools: { status: string }[]; thinking: boolean } | null;
  error: string | null;
}): Mood {
  const p = state.pending;
  if (!p) return state.error ? 'error' : 'idle';
  if (p.tools.some((t) => t.status === 'running')) return 'working';
  if (p.text && !p.thinking) return 'talking';
  return 'thinking';
}
