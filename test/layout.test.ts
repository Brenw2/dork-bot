import { describe, expect, it } from 'vitest';
import { foldNavFor, layoutClassFor, orientationActionFor } from '@/lib/layoutClass';

// Window sizes from Sports Week's Duo design: folded / Split View / open portrait / open landscape.
describe('iPhone Duo layout classes', () => {
  it('classifies real window sizes', () => {
    expect(layoutClassFor({ width: 402, height: 874 })).toBe('compact'); // regular iPhone
    expect(layoutClassFor({ width: 874, height: 402 })).toBe('compact'); // regular iPhone, landscape
    expect(layoutClassFor({ width: 469, height: 951 })).toBe('compact'); // Split View on the open Duo
    expect(layoutClassFor({ width: 669, height: 951 })).toBe('expanded-narrow'); // open Duo, portrait
    expect(layoutClassFor({ width: 951, height: 669, insetLeft: 84 })).toBe('expanded-wide'); // open, landscape, 867 usable
  });

  it('only lets an open Duo rotate', () => {
    expect(orientationActionFor('compact', 'ios')).toBe('lock-portrait');
    expect(orientationActionFor('expanded-narrow', 'ios')).toBe('unlock');
    expect(orientationActionFor('expanded-wide', 'android')).toBe('lock-portrait');
  });

  it('keeps the open chat across fold and unfold', () => {
    expect(foldNavFor('compact', 'expanded-wide', { pushedChat: 'assistant', selected: null })).toEqual({ type: 'show-in-pane', bot: 'assistant' });
    expect(foldNavFor('expanded-wide', 'compact', { pushedChat: null, selected: 'assistant' })).toEqual({ type: 'push-chat', bot: 'assistant' });
    expect(foldNavFor('expanded-wide', 'expanded-narrow', { pushedChat: null, selected: 'assistant' })).toEqual({ type: 'push-chat', bot: 'assistant' });
    expect(foldNavFor('compact', 'expanded-narrow', { pushedChat: 'assistant', selected: null })).toBeNull();
    expect(foldNavFor('expanded-wide', 'compact', { pushedChat: null, selected: null })).toBeNull();
  });
});
