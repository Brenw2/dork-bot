import { describe, expect, it } from 'vitest';
import { splitStreaming } from '../lib/streamBlocks';

describe('splitStreaming', () => {
  it('plain text with no blank line is all open', () => {
    expect(splitStreaming('Hello wor')).toEqual({ done: '', open: 'Hello wor', fence: null });
  });
  it('a blank line completes the block before it', () => {
    expect(splitStreaming('One.\n\nTwo is being wri')).toEqual({ done: 'One.\n\n', open: 'Two is being wri', fence: null });
  });
  it('a blank line still being typed does not complete yet', () => {
    expect(splitStreaming('One.\n')).toEqual({ done: '', open: 'One.\n', fence: null });
  });
  it('single newlines keep a list as one open block', () => {
    const s = splitStreaming('Intro.\n\n- a\n- b\n- c');
    expect(s.done).toBe('Intro.\n\n');
    expect(s.open).toBe('- a\n- b\n- c');
  });
  it('a table stays open until the blank line', () => {
    expect(splitStreaming('| a | b |\n|---|---|\n| 1 | 2 |').done).toBe('');
  });
  it('an open fence is returned as code, with the text before it done', () => {
    const s = splitStreaming('Here:\n\n```ts\nconst a = 1;\n\nconst b = 2;');
    expect(s.done).toBe('Here:\n\n');
    expect(s.open).toBe('');
    expect(s.fence).toEqual({ lang: 'ts', code: 'const a = 1;\n\nconst b = 2;' });
  });
  it('blank lines inside a fence complete nothing', () => {
    expect(splitStreaming('```\na\n\nb\n\n').fence?.code).toBe('a\n\nb\n\n');
  });
  it('the closing fence completes the block', () => {
    const s = splitStreaming('```js\nx\n```\nAfter');
    expect(s).toEqual({ done: '```js\nx\n```\n', open: 'After', fence: null });
  });
  it('a closing fence still being typed leaves the fence open', () => {
    expect(splitStreaming('```js\nx\n```').fence).not.toBeNull();
  });
  it('a longer fence is only closed by an equal or longer one', () => {
    expect(splitStreaming('````\n```\nx\n').fence?.code).toBe('```\nx\n');
  });
  it('~~~ fences work', () => {
    expect(splitStreaming('~~~\nx\n~~~\n').done).toBe('~~~\nx\n~~~\n');
  });
  it('done + open (+ the fence) always rebuild the text', () => {
    for (const t of ['a', 'a\n\nb', 'a\n\n```\nq\n\nr', '```\nq\n```\n\nz\n', '- x\n- y\n\n> q\n> r']) {
      const s = splitStreaming(t);
      expect(s.done + s.open + (s.fence ? t.slice(s.done.length) : '')).toBe(t);
    }
  });
});
