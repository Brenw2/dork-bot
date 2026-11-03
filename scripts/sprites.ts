// Renders sprite sheets and app icon options as SVG/PNG from lib/sprites.ts.
//   node scripts/sprites.ts sheet <out.png>     every character x mood (first frames)
//   node scripts/sprites.ts icons <dir>         icon options, 1024x1024 PNG
// Needs rsvg-convert (librsvg).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CANVAS, CHARACTER_IDS, MOODS, framePaths, frameSpec, renderFrame, type CharacterId, type FrameSpec } from '../lib/sprites.ts';

const PALETTE = ['#8B7CF6', '#4CC38A', '#F2A65A', '#5AB0F2', '#F06A9A', '#C8D35A'];

function spriteGroup(id: CharacterId, color: string, spec: FrameSpec, x: number, y: number, scale: number): string {
  const paths = framePaths(renderFrame(id, color, spec));
  return `<g transform="translate(${x} ${y}) scale(${scale})">${paths.map((p) => `<path d="${p.d}" fill="${p.color}"/>`).join('')}</g>`;
}

function toPng(svg: string, out: string, width?: number) {
  mkdirSync(dirname(out), { recursive: true });
  const tmp = `${out}.svg`;
  writeFileSync(tmp, svg);
  execFileSync('rsvg-convert', [...(width ? ['-w', String(width)] : []), '-o', out, tmp]);
}

function sheet(out: string) {
  const cell = 120;
  const scale = 5;
  const left = 90;
  const top = 40;
  const w = left + MOODS.length * cell;
  const h = top + CHARACTER_IDS.length * cell;
  let body = '';
  MOODS.forEach((m, i) => (body += `<text x="${left + i * cell + cell / 2}" y="26" fill="#9298A0" font-family="monospace" font-size="16" text-anchor="middle">${m}</text>`));
  CHARACTER_IDS.forEach((id, r) => {
    body += `<text x="10" y="${top + r * cell + cell / 2 + 5}" fill="#ECEDEF" font-family="monospace" font-size="16">${id}</text>`;
    MOODS.forEach((m, c) => {
      const t = m === 'done' ? 2 : 1;
      body += spriteGroup(id, PALETTE[r % PALETTE.length], frameSpec(m, t), left + c * cell + 10, top + r * cell + 10, scale);
    });
  });
  toPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#0F1012"/>${body}</svg>`, out);
}

// App icon options. iOS masks the corners itself, so these are full-bleed squares.
function icons(dir: string) {
  mkdirSync(dir, { recursive: true });
  const S = 1024;
  const idle = frameSpec('idle', 1);
  const happy = frameSpec('done', 0);
  const pixelGrid = (step: number, color: string) => {
    let g = '';
    for (let i = step; i < S; i += step) g += `<path d="M${i} 0V${S}M0 ${i}H${S}" stroke="${color}" stroke-width="2"/>`;
    return g;
  };
  // Extra pixels on top of a sprite, in its 20x20 canvas coordinates.
  type Px = [string, number, number];
  const withExtras = (id: CharacterId, color: string, spec: FrameSpec, x: number, y: number, scale: number, extras: Px[]) => {
    const frame = renderFrame(id, color, spec);
    for (const [c, px, py] of extras) {
      for (const list of frame.values()) {
        const i = list.findIndex(([a, b]) => a === px && b === py);
        if (i >= 0) list.splice(i, 1);
      }
      if (!frame.has(c)) frame.set(c, []);
      frame.get(c)!.push([px, py]);
    }
    const paths = framePaths(frame);
    return `<g transform="translate(${x} ${y}) scale(${scale})">${paths.map((p) => `<path d="${p.d}" fill="${p.color}"/>`).join('')}</g>`;
  };
  const K = '#16141F';
  const box = (x0: number, y0: number, x1: number, y1: number, c: string): Px[] => {
    const out: Px[] = [];
    for (let x = x0; x <= x1; x++) out.push([c, x, y0], [c, x, y1]);
    for (let y = y0 + 1; y < y1; y++) out.push([c, x0, y], [c, x1, y]);
    return out;
  };
  // Nerd glasses around the robot's eyes (eyes sit at canvas x 6-8 and 11-13, y 8-9): dark frames,
  // light lenses, small pupils inside. Round = frame corners left off.
  const LENS = '#DCEBFF';
  const lensPair = (pupils: 'dot' | 'happy' | 'side', round: boolean): Px[] => {
    const out: Px[] = [];
    for (const x0 of [5, 10]) {
      const frame = box(x0, 7, x0 + 4, 10, K).filter(([, x, y]) => !round || !((x === x0 || x === x0 + 4) && (y === 7 || y === 10)));
      out.push(...frame);
      for (let x = x0 + 1; x <= x0 + 3; x++) for (let y = 8; y <= 9; y++) out.push([LENS, x, y]);
      if (pupils === 'dot') out.push([K, x0 + 2, 8], [K, x0 + 2, 9]);
      if (pupils === 'side') out.push([K, x0 + 3, 8], [K, x0 + 3, 9], [K, x0 + 2, 9]);
      if (pupils === 'happy') out.push([K, x0 + 2, 8], [K, x0 + 1, 9], [K, x0 + 3, 9]);
    }
    return out;
  };
  const glow: Px[] = [['#FFF3A8', 8, 3], ['#FFF3A8', 11, 3], ['#FFF3A8', 9, 2], ['#FFF3A8', 10, 2]];
  const scanlines = (color: string) => {
    let g = '';
    for (let y = 0; y < S; y += 16) g += `<rect y="${y}" width="${S}" height="6" fill="${color}"/>`;
    return g;
  };
  const vignette = `<defs><radialGradient id="v" cx="0.5" cy="0.5" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></radialGradient></defs><rect width="${S}" height="${S}" fill="url(#v)"/>`;
  const purple = '#8B7CF6';
  // Scale 40 = the robot fills 800 of 1024; 46 is a tighter crop (the sprite's top 3 rows are empty canvas).
  const big = (spec: FrameSpec, extras: Px[] = []) => withExtras('robot', purple, spec, 52, 6, 46, extras);
  const options: Record<string, string> = {
    'a1-classic': `<rect width="${S}" height="${S}" fill="#2B2350"/>${pixelGrid(64, '#352C63')}${spriteGroup('robot', purple, idle, 112, 70, 40)}`,
    'a2-big': `<rect width="${S}" height="${S}" fill="#2B2350"/>${pixelGrid(64, '#352C63')}${big(idle)}`,
    'a3-side-eye-glasses': `<rect width="${S}" height="${S}" fill="#2B2350"/>${pixelGrid(64, '#352C63')}${withExtras('robot', purple, idle, 112, 70, 40, lensPair('side', true))}`,
    'a4-happy-glasses': `<rect width="${S}" height="${S}" fill="#2B2350"/>${pixelGrid(64, '#352C63')}${withExtras('robot', purple, happy, 112, 70, 40, lensPair('happy', true))}`,
    'a5-happy-glasses-big': `<rect width="${S}" height="${S}" fill="#2B2350"/>${pixelGrid(64, '#352C63')}${big(happy, lensPair('happy', true))}`,
    'a6-night-glow': `<rect width="${S}" height="${S}" fill="#110E24"/>${pixelGrid(64, '#1C1838')}${withExtras('robot', purple, idle, 112, 70, 40, [...lensPair('side', true), ...glow])}`,
    'a7-crt': `<rect width="${S}" height="${S}" fill="#2B2350"/>${spriteGroup('robot', purple, idle, 112, 70, 40)}${scanlines('#00000022')}${vignette}`,
    'a8-teal': `<rect width="${S}" height="${S}" fill="#0F4C4A"/>${pixelGrid(64, '#145956')}${spriteGroup('robot', purple, idle, 112, 70, 40)}`,
  };
  for (const [name, inner] of Object.entries(options)) {
    toPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" shape-rendering="crispEdges">${inner}</svg>`, join(dir, `${name}.png`), S);
  }
}

const [cmd, out] = process.argv.slice(2);
if (cmd === 'sheet') sheet(out ?? 'artifacts/sprites/sheet.png');
else if (cmd === 'icons') icons(out ?? 'artifacts/icons');
else {
  console.error('usage: node scripts/sprites.ts sheet|icons [out]');
  process.exit(1);
}
void CANVAS;
