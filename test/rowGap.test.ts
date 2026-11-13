import { describe, expect, it } from 'vitest';
import { rowGap, type ChatRow } from '@/lib/chatState';
import type { ChatMessage } from '@/lib/hermes';

const msg = (role: 'user' | 'assistant', id = 1, extra: Partial<ChatMessage> = {}): ChatRow => ({
  kind: 'message',
  id: String(id),
  message: { id, role, content: 'x', ...extra } as unknown as ChatMessage,
});
const chip: ChatRow = { kind: 'activity', id: 't', tools: [], live: false };
const pending: ChatRow = { kind: 'pending', id: 'pending', text: 'hi' };

describe('rowGap (transcript rhythm)', () => {
  it('has no space above the first row', () => expect(rowGap(undefined, msg('user'))).toBe(0));
  it('4 inside one sender\'s run', () => {
    expect(rowGap(msg('user', 1), msg('user', 2))).toBe(4);
    expect(rowGap(msg('assistant', 1), msg('assistant', 2))).toBe(4);
  });
  it('16 from your bubble to the bot', () => {
    expect(rowGap(msg('user'), chip)).toBe(16);
    expect(rowGap(msg('user'), msg('assistant', 2))).toBe(16);
    expect(rowGap(msg('user'), pending)).toBe(16);
  });
  it('20 from a bot reply to your next bubble', () => {
    expect(rowGap(msg('assistant'), msg('user', 2))).toBe(20);
    expect(rowGap(pending, msg('user', 2))).toBe(20);
  });
  it('10 from a chip to its reply', () => {
    expect(rowGap(chip, msg('assistant', 2))).toBe(10);
    expect(rowGap(chip, pending)).toBe(10);
  });
  it('a routine card has 16 above and below, from bubbles and replies alike', () => {
    const note = msg('user', 3, { routine: { name: 'r', at: '2026-01-01T00:00:00Z', text: 'x' } as never });
    expect(rowGap(msg('user'), note)).toBe(16);
    expect(rowGap(msg('assistant'), note)).toBe(16);
    expect(rowGap(note, msg('user', 4))).toBe(16);
    expect(rowGap(note, msg('assistant', 4))).toBe(16);
    expect(rowGap(note, note)).toBe(16);
    expect(rowGap(undefined, note)).toBe(0);
  });
});
