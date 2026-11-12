import { describe, expect, it } from 'vitest';
import { turnPending } from '@/lib/busy';
import { cleanPreview } from '@/lib/chats';
import { awaitingReply, chatRows } from '@/lib/chatState';
import { toChatMessages } from '@/lib/hermes';
import { cleanMeta, type BotMeta } from '@/lib/manager';
import { cleanPush, notifyOn, notifyPatch, parsePushData, routeFor, setNotify, type PushDeps } from '@/lib/push';
import { isNoteStamp, noteIndex, notePreview, parseRoutineNote } from '@/lib/routineNotes';

const AT = '2026-11-12T15:04:05-05:00';
const NOTE = `[Routine · Morning news · ${AT}]\nThree stories today.\n\n- one\n- two`;
const PHONE = 'ExponentPushToken[phone-1]';

/** Hermes's PUT /api/config merges dicts and replaces lists; this is that, for dork_bot.push. */
function hermes(initial: Record<string, BotMeta> = {}) {
  const meta: Record<string, BotMeta> = structuredClone(initial);
  const puts: { bot: string; patch: BotMeta }[] = [];
  const deps: PushDeps = {
    getPush: async (b) => cleanMeta(structuredClone(meta[b] ?? {})).push,
    setPush: async (b, push) => {
      puts.push({ bot: b, patch: { push } });
      const cur = meta[b] ?? {};
      meta[b] = { ...cur, push: { ...cur.push, ...push } };
    },
  };
  return { meta, puts, deps };
}

describe('the Notify me switch is stored in dork_bot.push.routines', () => {
  it('is off for every routine until marked, including bots that have no push block yet', () => {
    expect(notifyOn(undefined, 'j1')).toBe(false);
    expect(notifyOn({ tokens: [PHONE] }, 'j1')).toBe(false);
    expect(notifyOn({ routines: ['j2'] }, 'j1')).toBe(false);
    expect(notifyOn({ routines: ['j1'] }, 'j1')).toBe(true);
  });

  it('cleanPush keeps well-formed job ids once; junk is dropped', () => {
    expect(cleanPush({ routines: ['a', 'a', 'b', 3, null, '', 'x'.repeat(201)] })).toEqual({ routines: ['a', 'b'] });
    expect(cleanPush({ routines: 'a' })).toEqual({});
    expect(cleanMeta({ push: { tokens: [PHONE], muted: false, routines: ['a'] } }).push).toEqual({ tokens: [PHONE], muted: false, routines: ['a'] });
  });

  it('the patch adds or removes one id and says nothing to do when it already is so', () => {
    expect(notifyPatch(undefined, 'j1', true)).toEqual({ routines: ['j1'] });
    expect(notifyPatch({ routines: ['j2'] }, 'j1', true)).toEqual({ routines: ['j2', 'j1'] });
    expect(notifyPatch({ routines: ['j1', 'j2'] }, 'j1', false)).toEqual({ routines: ['j2'] });
    expect(notifyPatch({ routines: ['j1'] }, 'j1', true)).toBeNull();
    expect(notifyPatch(undefined, 'j1', false)).toBeNull();
  });

  it('marking leaves the phones, the mute switch and other bots alone, and Hermes keeps it for the second device', async () => {
    const h = hermes({ chief: { push: { tokens: [PHONE], muted: true } }, assistant: { push: { tokens: [PHONE] } } });
    expect(await setNotify(h.deps, 'chief', 'j1', true)).toEqual(['j1']);
    expect(h.meta.chief.push).toEqual({ tokens: [PHONE], muted: true, routines: ['j1'] });
    expect(h.meta.assistant.push).toEqual({ tokens: [PHONE] });
    // the other device (or this one after a restart) reads it back from Hermes
    expect(notifyOn(await h.deps.getPush('chief'), 'j1')).toBe(true);
    expect(notifyOn(await h.deps.getPush('chief'), 'j2')).toBe(false);
    expect(await setNotify(h.deps, 'chief', 'j1', false)).toEqual([]);
    expect(notifyOn(await h.deps.getPush('chief'), 'j1')).toBe(false);
  });

  it("setting what's already set writes nothing; a mark made on another device meanwhile is kept", async () => {
    const h = hermes({ chief: { push: { routines: ['j1'] } } });
    await setNotify(h.deps, 'chief', 'j1', true);
    expect(h.puts).toEqual([]);
    h.meta.chief.push = { routines: ['j1', 'j9'] }; // the iPad marked j9 after this screen loaded
    expect(await setNotify(h.deps, 'chief', 'j2', true)).toEqual(['j1', 'j9', 'j2']);
  });

  it('a failed save is an error the screen can show, not a silent change', async () => {
    const deps: PushDeps = { getPush: async () => undefined, setPush: async () => Promise.reject(new Error("Couldn't save chief's settings: HTTP 500")) };
    await expect(setNotify(deps, 'chief', 'j1', true)).rejects.toThrow(/save chief/);
  });
});

describe('the routine message in the chat', () => {
  it('is recognised by its marker line and split into name, time and output', () => {
    expect(parseRoutineNote(NOTE)).toEqual({ name: 'Morning news', at: AT, text: 'Three stories today.\n\n- one\n- two' });
    expect(parseRoutineNote(`[Routine · Digest · today · ${AT}]\nok`)).toEqual({ name: 'Digest · today', at: AT, text: 'ok' });
    expect(parseRoutineNote(`[Routine · Empty · ${AT}]`)).toEqual({ name: 'Empty', at: AT, text: '' });
  });

  it('is not confused with ordinary messages', () => {
    for (const text of ['hello', '[Routine] hi', 'see [Routine · x · y]\nabove', '[Routine · x]\nno time', `[routine · x · ${AT}]\nlower`, '', undefined, 5]) {
      expect(parseRoutineNote(text)).toBeNull();
    }
  });

  it('loads as a message from the bot with the routine on it, not as a user bubble', () => {
    const raw = [
      { id: 1, role: 'user', content: 'hi', timestamp: 100 },
      { id: 2, role: 'assistant', content: 'hello', timestamp: 101 },
      { id: 3, role: 'user', content: NOTE, timestamp: 200 },
    ];
    const [, , note] = toChatMessages(raw);
    expect(note).toMatchObject({ id: '3', role: 'assistant', content: 'Three stories today.\n\n- one\n- two', at: 200, routine: { name: 'Morning news', at: AT } });
    expect(toChatMessages(raw).filter((m) => m.role === 'user')).toHaveLength(1);
  });

  it('the bot is not shown as still working on it, and Brennan was not waiting for a reply', () => {
    const raw = [
      { id: 1, role: 'user', content: 'hi', timestamp: 100 },
      { id: 2, role: 'assistant', content: 'hello', timestamp: 101 },
      { id: 3, role: 'user', content: NOTE, timestamp: 200 },
    ];
    expect(turnPending(raw, 210)).toBe(false); // a raw user row, but it is the routine's
    expect(awaitingReply(toChatMessages(raw), 210)).toBeNull();
    // a real message waiting for its reply behind a routine note still counts
    const waiting = [...raw, { id: 4, role: 'user', content: 'and?', timestamp: 205 }];
    expect(turnPending(waiting, 210)).toBe(true);
    expect(turnPending([{ id: 1, role: 'user', content: 'hi', timestamp: 100 }, { id: 2, role: 'user', content: NOTE, timestamp: 101 }], 110)).toBe(true);
  });

  it('shows in the chat list as a routine, not as raw marker text', () => {
    expect(cleanPreview(`[Routine · Morning news · ${AT}]\nThree stories`)).toBe('Routine · Morning news');
    expect(cleanPreview('[Routine · Morning news · 2026-11-12T15:04:05-0')).toBe('Routine · Morning news');
    expect(notePreview('hello')).toBeNull();
  });

  it('is found by its time stamp so a tapped push can scroll to it', () => {
    const rows = chatRows({ messages: toChatMessages([{ id: 1, role: 'user', content: 'hi' }, { id: 2, role: 'user', content: NOTE }]), pending: null });
    expect(noteIndex(rows, AT)).toBe(1);
    expect(noteIndex(rows, 'other')).toBe(-1);
  });
});

describe('what the push opens', () => {
  const chat = 'dork-bot-chief--abc';
  it('a marked routine opens the chat it was added to, at the message', () => {
    const data = parsePushData({ bot: 'chief', kind: 'routine', job: 'j1', chat, at: AT });
    expect(data).toEqual({ kind: 'routine', bot: 'chief', job: 'j1', chat, at: AT });
    expect(routeFor(data!, false)).toEqual({ pathname: '/chat/[bot]', params: { bot: 'chief', chat, at: AT } });
    expect(routeFor(data!, true)).toEqual({ pathname: '/', params: { bot: 'chief', chat, at: AT } });
  });

  it('with no chat to open (or one that is not the bot\'s) it still opens Routine results', () => {
    for (const raw of [{ bot: 'chief', kind: 'routine', job: 'j1' }, { bot: 'chief', kind: 'routine', chat: 'dork-bot-assistant', at: AT }]) {
      expect(routeFor(parsePushData(raw)!, false)).toEqual({ pathname: '/routine-results/[bot]', params: { bot: 'chief' } });
    }
  });

  it('a stamp that could not come from the plugin is dropped', () => {
    expect(parsePushData({ bot: 'chief', kind: 'routine', chat, at: 'a b' })).toEqual({ kind: 'routine', bot: 'chief', chat });
    expect(isNoteStamp(AT)).toBe(true);
    expect(isNoteStamp('x]y')).toBe(false);
    expect(isNoteStamp('')).toBe(false);
  });
});
