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
  const options: Record<string, string> = {
    // A: one big robot on purple with a pixel grid, the classic.
    'a-robot': `<rect width="${S}" height="${S}" fill="#2B2350"/>${pixelGrid(64, '#352C63')}${spriteGroup('robot', '#8B7CF6', idle, 112, 70, 40)}`,
    // B: the crew, three characters side by side on a dark night sky.
    'b-crew': `<rect width="${S}" height="${S}" fill="#14122A"/><rect y="760" width="${S}" height="264" fill="#1F1B3D"/>${[
      [180, 120], [620, 140], [90, 540], [880, 470], [430, 70], [760, 620],
    ].map(([x, y]) => `<rect x="${x}" y="${y}" width="16" height="16" fill="#FFD447"/>`).join('')}${spriteGroup('slime', '#4CC38A', idle, -8, 400, 20)}${spriteGroup('robot', '#8B7CF6', happy, 262, 220, 25)}${spriteGroup('cat', '#F2A65A', idle, 632, 400, 20)}`,
    // C: a happy robot face on a warm sunset with sparkles, more playful.
    'c-happy': `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF8F6B"/><stop offset="1" stop-color="#8B4FD8"/></linearGradient></defs><rect width="${S}" height="${S}" fill="url(#g)"/>${spriteGroup('robot', '#5AB0F2', happy, 112, 100, 40)}`,
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
