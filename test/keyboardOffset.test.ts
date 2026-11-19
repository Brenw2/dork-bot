import { describe, expect, it } from 'vitest';
import { keyboardOffset } from '../lib/keyboardOffset';

describe('keyboardOffset', () => {
  it('iOS group screen: offset by the native header (where the view starts)', () => expect(keyboardOffset('ios', false, 103)).toBe(103));
  it('rounds to whole points', () => expect(keyboardOffset('ios', false, 102.6)).toBe(103));
  it('no offset before the view is measured', () => expect(keyboardOffset('ios', false, 0)).toBe(0));
  it('ignores bad measurements', () => {
    expect(keyboardOffset('ios', false, NaN)).toBe(0);
    expect(keyboardOffset('ios', false, -5)).toBe(0);
  });
  it('desktop pane has no native header', () => expect(keyboardOffset('ios', true, 103)).toBe(0));
  it('other platforms are unchanged', () => {
    expect(keyboardOffset('android', false, 103)).toBe(0);
    expect(keyboardOffset('web', false, 103)).toBe(0);
  });
});
