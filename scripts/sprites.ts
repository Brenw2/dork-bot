// Renders the pixel characters and the app icon from lib/sprites.ts. Needs rsvg-convert (librsvg).
//   node scripts/sprites.ts sheet [out.png]   every look of every character x every mood
//   node scripts/sprites.ts icon [out.png]    the app icon, 1024x1024 (assets/icon.png)
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { BOT_COLORS, CHARACTER_IDS, MOODS, framePaths, frameSpec, lookName, looksOf, renderFrame, type CharacterId, type FrameSpec } from '../lib/sprites.ts';

function spriteGroup(id: CharacterId, color: string, spec: FrameSpec, x: number, y: number, scale: number, variant = 0): string {
  const paths = framePaths(renderFrame(id, color, spec, variant));
  return `<g transform="translate(${x} ${y}) scale(${scale})">${paths.map((p) => `<path d="${p.d}" fill="${p.color}"/>`).join('')}</g>`;
}

function toPng(svg: string, out: string, width?: number) {
  mkdirSync(dirname(out), { recursive: true });
  const tmp = `${out}.svg`;
  writeFileSync(tmp, svg);
  execFileSync('rsvg-convert', [...(width ? ['-w', String(width)] : []), '-o', out, tmp]);
  rmSync(tmp);
}

function sheet(out: string) {
  const cell = 100;
  const scale = 4;
  const left = 150;
  const top = 40;
  const rows = CHARACTER_IDS.flatMap((id) => looksOf(id).map((_, v) => [id, v] as const));
  const w = left + MOODS.length * cell;
  const h = top + rows.length * cell;
  let body = '';
  MOODS.forEach((m, i) => (body += `<text x="${left + i * cell + cell / 2}" y="26" fill="#9298A0" font-family="monospace" font-size="15" text-anchor="middle">${m}</text>`));
  rows.forEach(([id, v], r) => {
    body += `<text x="10" y="${top + r * cell + cell / 2 + 5}" fill="#ECEDEF" font-family="monospace" font-size="15">${id} · ${lookName(id, v)}</text>`;
    MOODS.forEach((m, c) => {
      const t = m === 'done' ? 2 : 1;
      body += spriteGroup(id, BOT_COLORS[r % BOT_COLORS.length], frameSpec(m, t), left + c * cell + 10, top + r * cell + 5, scale, v);
    });
  });
  toPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#0F1012"/>${body}</svg>`, out);
}

// The app icon (option A1): the square purple robot on a pixel grid. Full-bleed; iOS rounds the corners.
function icon(out: string) {
  const S = 1024;
  let grid = '';
  for (let i = 64; i < S; i += 64) grid += `<path d="M${i} 0V${S}M0 ${i}H${S}" stroke="#352C63" stroke-width="2"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" shape-rendering="crispEdges"><rect width="${S}" height="${S}" fill="#2B2350"/>${grid}${spriteGroup('robot', '#8B7CF6', frameSpec('idle', 1), 112, 70, 40)}</svg>`;
  toPng(svg, out, S);
}

const [cmd, out] = process.argv.slice(2);
if (cmd === 'sheet') sheet(out ?? 'artifacts/sprites/sheet.png');
else if (cmd === 'icon') icon(out ?? 'assets/icon.png');
else {
  console.error('usage: node scripts/sprites.ts sheet|icon [out]');
  process.exit(1);
}
