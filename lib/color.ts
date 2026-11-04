// Color maths for bot-colored buttons and bubbles. Plain TypeScript (no React Native), unit-tested.
function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  return Number.isNaN(n) ? [139, 124, 246] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** Text color that reads on a bot-colored button: near-black on light colors, white on dark ones. */
export function onColor(hex: string): string {
  const lin = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  // Whichever of white or the app's background contrasts more.
  return (1.05) / (lum + 0.05) >= (lum + 0.05) / 0.0057 ? '#FFFFFF' : '#0F1012';
}

/** `hex` blended into `base` (the app's background by default): t = 0 is base, 1 is hex. */
export function mix(hex: string, t: number, base = '#0F1012'): string {
  const a = rgb(base);
  const b = rgb(hex);
  return toHex(a.map((v, i) => v + (b[i] - v) * t));
}
