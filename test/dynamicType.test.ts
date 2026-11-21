import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { maxScale, maxScaleFor, MIN_HIT, scaled } from '@/lib/type';

// Dynamic Type guard (card 33). Text follows the system text size (iOS Settings > Display > Text Size). Only
// lib/type.ts decides a cap, so a component can't quietly turn scaling off or pick its own number.
const root = fileURLToPath(new URL('..', import.meta.url));
const HELPER = 'lib/type.ts';

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(join(root, dir))) {
    if (f === 'node_modules' || f.startsWith('.')) continue;
    const rel = `${dir}/${f}`;
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(f)) out.push(rel);
  }
  return out;
}

/** The source without comments, so a doc line that names a prop is not a violation. */
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/** Scaling switched off: `allowFontScaling={false}`, `allowFontScaling: false`, or a spread that does it. */
export const scalingOff = (src: string): string[] => [...strip(src).matchAll(/allowFontScaling\s*(?:=\s*\{\s*false\s*\}|:\s*false)/g)].map((m) => m[0]);

/** A cap that is a number written in place (`maxFontSizeMultiplier={1.4}`, `maxFontSizeMultiplier: 1.2`, a const of one). */
export const rawCaps = (src: string): string[] =>
  [...strip(src).matchAll(/maxFontSizeMultiplier\s*(?:=\s*\{|:)\s*([^,}\s)]+)/g)].map((m) => m[0]).filter((m) => /(?:\{|:)\s*\d/.test(m) || /(?:\{|:)\s*[A-Z_]{3,}\s*$/.test(m));

const files = [...walk('app'), ...walk('components'), ...walk('lib')].filter((f) => f !== HELPER);

describe('guard scanner', () => {
  it('catches a deliberate violation', () => {
    expect(scalingOff('<Text allowFontScaling={false}>x</Text>')).toHaveLength(1);
    expect(scalingOff('const p = { allowFontScaling: false };')).toHaveLength(1);
    expect(rawCaps('<Text maxFontSizeMultiplier={1.4}>x</Text>')).toHaveLength(1);
    expect(rawCaps('<Text maxFontSizeMultiplier={ 1.2 }>x</Text>')).toHaveLength(1);
    expect(rawCaps('const p = { maxFontSizeMultiplier: 1.3 };')).toHaveLength(1);
    expect(rawCaps('<Text maxFontSizeMultiplier={CHROME_SCALE}>x</Text>')).toHaveLength(1);
  });
  it('lets the helper tokens and comments through', () => {
    expect(scalingOff('<Text allowFontScaling>x</Text>')).toEqual([]);
    expect(scalingOff('// allowFontScaling={false} would stop it\n<Text>x</Text>')).toEqual([]);
    expect(rawCaps('<Text maxFontSizeMultiplier={maxScale.chrome}>x</Text>')).toEqual([]);
    expect(rawCaps('<Text maxFontSizeMultiplier={maxScale.mono}>x</Text>')).toEqual([]);
    expect(rawCaps('/* maxFontSizeMultiplier={1.4} */ <Text>x</Text>')).toEqual([]);
  });
});

describe('G13 Dynamic Type: no text turns scaling off or caps itself', () => {
  it('scans the app, its components and lib', () => {
    expect(files.length).toBeGreaterThan(50);
  });
  it('no allowFontScaling={false} anywhere', () => {
    expect(files.filter((f) => scalingOff(readFileSync(join(root, f), 'utf8')).length)).toEqual([]);
  });
  it('no raw maxFontSizeMultiplier number outside lib/type.ts', () => {
    expect(files.filter((f) => rawCaps(readFileSync(join(root, f), 'utf8')).length)).toEqual([]);
  });
  it('every cap that is set comes from maxScale', () => {
    const bad: string[] = [];
    for (const f of files) for (const m of strip(readFileSync(join(root, f), 'utf8')).matchAll(/maxFontSizeMultiplier\s*=\s*\{([^}]*)\}/g)) if (!/^\s*maxScale\.(chrome|mono|body)\s*$/.test(m[1])) bad.push(`${f}: ${m[1]}`);
    expect(bad).toEqual([]);
  });
});

describe('lib/type', () => {
  it('reading text has no cap; chrome and mono are 1.3 (THEMES.md)', () => {
    expect(maxScale.body).toBeUndefined();
    expect(maxScale.chrome).toBe(1.3);
    expect(maxScale.mono).toBe(1.3);
    expect(maxScaleFor('chrome')).toBe(1.3);
    expect(maxScaleFor('body')).toBeUndefined();
  });
  it('scaled() follows the font scale up to the cap and never shrinks', () => {
    expect(scaled(16, 1)).toBe(16);
    expect(scaled(16, 0.8)).toBe(16);
    expect(scaled(16, 2)).toBe(32);
    expect(scaled(16, 2, maxScale.chrome)).toBeCloseTo(20.8);
  });
  it('keeps the 44 pt hit area', () => {
    expect(MIN_HIT).toBe(44);
  });
});
