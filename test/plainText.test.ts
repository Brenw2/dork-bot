import { describe, expect, it } from 'vitest';
import { plainSegments, plainText } from '@/lib/plainText';

describe('plainText (Select Text sheet and Copy)', () => {
  it('drops markdown syntax but keeps the words', () => {
    expect(plainText('## Fix\n\nThe race is in `waitForBot`: it polls **before** the key is set, see [the docs](https://x.test/a).')).toBe(
      'Fix\n\nThe race is in waitForBot: it polls before the key is set, see the docs.',
    );
  });

  it('joins prose blocks into one run, so selection can cross paragraphs', () => {
    const segs = plainSegments('One.\n\nTwo.\n\nThree.');
    expect(segs).toEqual([{ kind: 'text', text: 'One.\n\nTwo.\n\nThree.' }]);
  });

  it('keeps code blocks as their own monospace run with exact characters', () => {
    const segs = plainSegments('Run this:\n\n```ts\nconst a = b >= 1 && c < 2;\n  indented();\n```\n\nThen reload.');
    expect(segs).toEqual([
      { kind: 'text', text: 'Run this:' },
      { kind: 'code', text: 'const a = b >= 1 && c < 2;\n  indented();' },
      { kind: 'text', text: 'Then reload.' },
    ]);
  });

  it('keeps list markers, numbers and checkboxes', () => {
    expect(plainText('1. Set the key.\n2. Poll.\n\n- apples\n- pears')).toBe('1. Set the key.\n2. Poll.\n\n• apples\n• pears');
    expect(plainText('- [x] done\n- [ ] todo')).toBe('[x] done\n[ ] todo');
  });

  it('turns a table into tab-separated rows', () => {
    expect(plainText('| a | b |\n|---|---|\n| 1 | 2 |')).toBe('a\tb\n1\t2');
  });

  it('decodes entities and keeps a bare link address', () => {
    expect(plainText('Tom &amp; Jerry <https://x.test/path>')).toBe('Tom & Jerry https://x.test/path');
  });

  it('is empty for empty text', () => {
    expect(plainSegments('  \n')).toEqual([]);
    expect(plainText('')).toBe('');
  });
});
