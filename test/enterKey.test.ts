import { describe, expect, it } from 'vitest';
import { isSendEnter } from '../lib/enterKey';

const key = (k: string, extra: object = {}) => ({ nativeEvent: { key: k, ...extra } });

describe('isSendEnter', () => {
  it('plain Enter sends', () => expect(isSendEnter(key('Enter'))).toBe(true));
  it('Shift+Enter is a new line', () => expect(isSendEnter(key('Enter', { shiftKey: true }))).toBe(false));
  it('Enter while an IME is composing does not send', () => expect(isSendEnter(key('Enter', { isComposing: true }))).toBe(false));
  it('other keys do not send', () => expect(isSendEnter(key('a'))).toBe(false));
});
