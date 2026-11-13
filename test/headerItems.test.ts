import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rn = vi.hoisted(() => ({ Platform: { OS: 'ios' } }));
vi.mock('react-native', () => rn);

import { headerSides } from '@/lib/headerItems';

const L = { type: 'L' } as never;
const R = { type: 'R' } as never;

describe('headerSides', () => {
  beforeEach(() => { rn.Platform.OS = 'ios'; });

  it('iOS: custom items that hide the shared (glass) background', () => {
    const o = headerSides({ left: L, right: R }) as any;
    expect(o.headerLeft).toBeUndefined();
    expect(o.headerRight).toBeUndefined();
    expect(o.unstable_headerLeftItems()).toEqual([{ type: 'custom', element: L, hidesSharedBackground: true }]);
    expect(o.unstable_headerRightItems()).toEqual([{ type: 'custom', element: R, hidesSharedBackground: true }]);
  });

  it('iOS: an empty side returns no item at all', () => {
    expect(Object.keys(headerSides({ right: R }))).toEqual(['unstable_headerRightItems']);
    expect(Object.keys(headerSides({ left: L, right: null }))).toEqual(['unstable_headerLeftItems']);
    expect(headerSides({})).toEqual({});
  });

  it('non-iOS: plain headerLeft/headerRight', () => {
    for (const os of ['android', 'web']) {
      rn.Platform.OS = os;
      const o = headerSides({ left: L, right: R }) as any;
      expect(o.headerLeft()).toBe(L);
      expect(o.headerRight()).toBe(R);
      expect(o.unstable_headerLeftItems).toBeUndefined();
      expect(Object.keys(headerSides({ left: L }))).toEqual(['headerLeft']);
      expect(headerSides({})).toEqual({});
    }
  });
});

// Regression guard: plain headerLeft/headerRight get the iOS 26 glass capsule. Screens must use headerSides.
const root = fileURLToPath(new URL('..', import.meta.url));
const ALLOW = new Set([join('lib', 'headerItems.ts')]);
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|jsx?)$/.test(n) ? [p] : [];
  });
}

describe('no direct header buttons', () => {
  it('app/ and components/ never set headerLeft/headerRight directly', () => {
    const bad: string[] = [];
    for (const dir of ['app', 'components']) {
      for (const f of walk(join(root, dir))) {
        const rel = f.slice(root.length);
        if (ALLOW.has(rel)) continue;
        readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
          if (/\bheader(Left|Right)\b\s*[:=(]/.test(line) || /\bheader(Left|Right)\b\s*,/.test(line)) bad.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
      }
    }
    expect(bad, 'use headerSides() from lib/headerItems.ts').toEqual([]);
  });
});
