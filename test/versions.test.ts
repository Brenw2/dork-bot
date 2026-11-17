import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

describe('release versions', () => {
  it('app.json, package.json and desktop/package.json agree', () => {
    const versions = {
      'app.json': read('app.json').expo.version,
      'package.json': read('package.json').version,
      'desktop/package.json': read('desktop/package.json').version,
    };
    expect(new Set(Object.values(versions)).size, JSON.stringify(versions)).toBe(1);
  });
});
