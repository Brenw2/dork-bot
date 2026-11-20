import { describe, expect, it } from 'vitest';
import { distanceFromEnd, jumpVisible } from '../lib/jumpPill';

describe('jumpVisible', () => {
  it('needs new text and more than one screen from the end', () => {
    expect(jumpVisible({ distanceFromEnd: 900, viewport: 800, unseen: true })).toBe(true);
    expect(jumpVisible({ distanceFromEnd: 900, viewport: 800, unseen: false })).toBe(false);
    expect(jumpVisible({ distanceFromEnd: 700, viewport: 800, unseen: true })).toBe(false);
  });
  it('is hidden before the list is measured', () => expect(jumpVisible({ distanceFromEnd: 10, viewport: 0, unseen: true })).toBe(false));
});

describe('distanceFromEnd', () => {
  it('inverted (phone): the offset is the distance', () => expect(distanceFromEnd({ inverted: true, offset: 250, content: 3000, viewport: 800 })).toBe(250));
  it('normal (web): content - viewport - offset', () => expect(distanceFromEnd({ inverted: false, offset: 1000, content: 3000, viewport: 800 })).toBe(1200));
  it('never negative (overscroll)', () => expect(distanceFromEnd({ inverted: false, offset: 2300, content: 3000, viewport: 800 })).toBe(0));
});
