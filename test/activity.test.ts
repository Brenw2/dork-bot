import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityStore } from '@/lib/activity';

// In a browser (the desktop app), setTimeout/clearTimeout throw "Illegal invocation" unless
// called on window. Calling them as a method of the store blanked the whole desktop app.
describe('ActivityStore default timers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('calls setTimeout/clearTimeout unbound, like a browser requires', () => {
    const realSet = globalThis.setTimeout;
    const realClear = globalThis.clearTimeout;
    function strictSet(this: unknown, fn: () => void, ms?: number) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      return realSet(fn, ms);
    }
    function strictClear(this: unknown, t?: ReturnType<typeof setTimeout>) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      return realClear(t);
    }
    vi.stubGlobal('setTimeout', strictSet);
    vi.stubGlobal('clearTimeout', strictClear);
    const store = new ActivityStore();
    // A reply finishes (done → a timer), then a new one starts before it fires (clears the timer).
    store.set('assistant', 'talking');
    expect(() => store.set('assistant', 'idle')).not.toThrow();
    expect(store.get('assistant')).toBe('done');
    expect(() => store.set('assistant', 'thinking')).not.toThrow();
    expect(store.get('assistant')).toBe('thinking');
  });
});
