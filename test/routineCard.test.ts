import { describe, expect, it } from 'vitest';
import { focusPosition, focusStep, ROUTINE_FOCUS, routineHasBody, routineHint, routineLabel, routinePreview, routineTints } from '@/lib/routineCard';
import { parsePushData, routeFor } from '@/lib/push';
import { noteIndex } from '@/lib/routineNotes';

describe('routine card colours (Fix 11, bot colour #4CC38A)', () => {
  it('uses the locked tints', () => {
    const t = routineTints('#4CC38A');
    expect(t.fill.toLowerCase()).toBe('#141e1c');
    expect(t.border.toLowerCase()).toBe('#1c372c');
    expect(t.disc.toLowerCase()).toBe('#1a3028');
    expect(t.highlightFill.toLowerCase()).toBe('#1c372c');
    expect(t.highlightBorder.toLowerCase()).toBe('#347b5a');
  });
});

describe('routine card text', () => {
  it('previews the first text with Markdown stripped, on one line', () => {
    expect(routinePreview('**Saturday hike:** dry until 2 PM.\n\n- Pack a rain jacket\n- Bring water')).toBe('Saturday hike: dry until 2 PM. Pack a rain jacket Bring water');
  });
  it('labels and hints for VoiceOver', () => {
    expect(routineLabel('Friday packing reminder', 'Fri 8:00 PM')).toBe('Routine Friday packing reminder, Fri 8:00 PM');
    expect(routineHint(false)).toBe('Double tap to expand');
    expect(routineHint(true)).toBe('Double tap to collapse');
  });
  it('no output text: no body, no chevron', () => {
    expect(routineHasBody('')).toBe(false);
    expect(routineHasBody('  \n')).toBe(false);
    expect(routineHasBody('Three stories.')).toBe(true);
  });
});

describe('landing on a routine card from a notification', () => {
  const AT = '2026-11-13T20:00:00-05:00';
  const chat = 'dork-bot-assistant--abc';

  it('the push carries the chat and the stamp, and opens that chat at that entry', () => {
    const data = parsePushData({ kind: 'routine', bot: 'assistant', job: 'j1', chat, at: AT });
    expect(data).toEqual({ kind: 'routine', bot: 'assistant', job: 'j1', chat, at: AT });
    expect(routeFor(data!, false)).toEqual({ pathname: '/chat/[bot]', params: { bot: 'assistant', chat, at: AT } });
    expect(routeFor(data!, true)).toEqual({ pathname: '/', params: { bot: 'assistant', chat, at: AT } });
  });
  it('a push for an unmarked run (no chat) opens Routine results; a stray `at` without a chat is dropped', () => {
    const data = parsePushData({ kind: 'routine', bot: 'assistant', job: 'j1', at: AT });
    expect(data).toEqual({ kind: 'routine', bot: 'assistant', job: 'j1' });
    expect(routeFor(data!, false)).toEqual({ pathname: '/routine-results/[bot]', params: { bot: 'assistant' } });
  });
  it('a bad stamp or another bot\'s chat is ignored', () => {
    expect(parsePushData({ kind: 'routine', bot: 'assistant', chat, at: 'has space' })).toEqual({ kind: 'routine', bot: 'assistant', chat });
    expect(parsePushData({ kind: 'routine', bot: 'assistant', chat: 'dork-bot-chief--abc', at: AT })).toEqual({ kind: 'routine', bot: 'assistant' });
  });
  it('a routine push with a chat but no stamp opens the chat without a target', () => {
    const route = routeFor(parsePushData({ kind: 'routine', bot: 'assistant', chat })!, false);
    expect(route).toEqual({ pathname: '/chat/[bot]', params: { bot: 'assistant', chat } });
  });

  it('finds the entry by its stamp; reloads a bounded number of times; then falls back to Routine results', () => {
    const rows = [{ kind: 'message', message: {} }, { kind: 'message', message: { routine: { at: AT } } }];
    expect(noteIndex(rows, AT)).toBe(1);
    expect(focusStep(true, 0)).toBe('go');
    expect(focusStep(false, 0)).toBe('reload');
    expect(focusStep(false, ROUTINE_FOCUS.retries - 1)).toBe('reload');
    expect(focusStep(false, ROUTINE_FOCUS.retries)).toBe('fallback');
    expect(focusStep(true, ROUTINE_FOCUS.retries)).toBe('go');
  });

  it('scrolls the card top 16 below the header, or centres a card taller than the list', () => {
    expect(focusPosition(300, 700, false)).toEqual({ viewPosition: 0, viewOffset: 16 });
    expect(focusPosition(300, 700, true)).toEqual({ viewPosition: 1, viewOffset: -16 }); // inverted list: its end is the top of the screen
    expect(focusPosition(900, 700, true)).toEqual({ viewPosition: 0.5, viewOffset: 0 });
    expect(focusPosition(900, 700, false)).toEqual({ viewPosition: 0.5, viewOffset: 0 });
  });
});
