import { describe, expect, it } from 'vitest';
import { chatReducer, chatRows, initialChat } from '@/lib/chatState';
import { describeFailure, hermesSaid, isBanner } from '@/lib/errors';

// Design fix 6 (docs/design/REVIEW.md): errors in plain words, with an action.
describe('hermesSaid', () => {
  it('quotes Hermes, not the transport', () => {
    expect(hermesSaid('Chat failed: HTTP 500 {"error":"model runner crashed"}')).toBe('model runner crashed');
    expect(hermesSaid('Chat failed: HTTP 502 {"error":{"message":"upstream timed out","type":"x"}}')).toBe('upstream timed out');
    expect(hermesSaid('Chat failed: HTTP 500 {"detail":"boom"}')).toBe('boom');
  });
  it('quotes a plain line, never markup, and nothing when there is nothing', () => {
    expect(hermesSaid('Chat failed: HTTP 500 Internal Server Error')).toBe('Internal Server Error');
    expect(hermesSaid('Chat failed: HTTP 503 <html><body>bad gateway</body></html>')).toBeNull();
    expect(hermesSaid('Chat failed: HTTP 500 ')).toBeNull();
    expect(hermesSaid('Chat failed: HTTP 500 {"x":1}')).toBeNull();
  });
});

describe('describeFailure: the copy table', () => {
  const raw5 = 'Chat failed: HTTP 500 {"error":"model runner crashed"}';
  it('network / timeout → banner with a countdown and Retry now', () => {
    expect(describeFailure({ raw: "Can't reach b-lab. (Failed to fetch)" }, 'scout', 4)).toEqual({ place: 'banner', text: "Can't reach b-lab. Trying again in 4 s.", action: 'retry' });
  });
  it('401 / 403 → banner, Pair again', () => {
    for (const status of [401, 403]) expect(describeFailure({ raw: 'x', status }, 'scout')).toEqual({ place: 'banner', text: "scout's key was rejected.", action: 'pair' });
  });
  it('404 on the chat → card, New chat', () => {
    expect(describeFailure({ raw: 'x', status: 404 }, 'scout')).toEqual({ place: 'card', title: "This chat isn't on Hermes anymore.", detail: null, actions: ['new-chat'] });
  });
  it('429 → card, Try again', () => {
    expect(describeFailure({ raw: 'x', status: 429 }, 'scout')).toEqual({ place: 'card', title: 'Hermes is busy.', detail: null, actions: ['again'] });
  });
  it('5xx → card quoting Hermes with the code, Try again and Details', () => {
    expect(describeFailure({ raw: raw5, status: 500 }, 'scout')).toEqual({
      place: 'card',
      title: 'scout hit an error',
      detail: 'Hermes said: model runner crashed (HTTP 500)',
      actions: ['again', 'details'],
    });
  });
  it('a stream error event → card quoting Hermes, no HTTP code, not a connection banner', () => {
    expect(describeFailure({ raw: 'context window exceeded', fromHermes: true }, 'scout')).toMatchObject({ place: 'card', detail: 'Hermes said: context window exceeded' });
  });
  it('run.failed → "<name>\'s reply stopped."', () => {
    expect(describeFailure({ raw: 'The bot hit an error on that one.', stopped: true }, 'scout')).toMatchObject({ place: 'card', title: "scout's reply stopped.", actions: ['again', 'details'] });
  });
  it('not sent → one line under your bubble', () => {
    expect(describeFailure({ raw: 'x', notSent: true }, 'scout')).toEqual({ place: 'unsent', text: 'Not sent. Tap to retry.' });
  });
  it('no raw "HTTP nnn {json}" outside Details: every card text is plain', () => {
    const views = [{ raw: raw5, status: 500 }, { raw: 'x', status: 429 }, { raw: 'x', status: 404 }, { raw: 'x', stopped: true }].map((f) => describeFailure(f, 'scout'));
    for (const v of views) if (v.place === 'card') expect(`${v.title} ${v.detail ?? ''}`).not.toMatch(/HTTP \d{3} \{|"error"/);
  });
  it('every failure has an action', () => {
    for (const f of [{ raw: 'x' }, { raw: 'x', status: 401 }, { raw: 'x', status: 500 }, { raw: 'x', status: 404 }, { raw: 'x', status: 429 }, { raw: 'x', stopped: true }, { raw: 'x', notSent: true }]) {
      const v = describeFailure(f, 'scout');
      expect(v.place === 'card' ? v.actions.length : v.place === 'banner' ? 1 : 1).toBeGreaterThan(0);
    }
  });
});

describe('failures in the chat state', () => {
  const sent = chatReducer(initialChat, { type: 'send', text: 'hi' });
  it('a 500 becomes a card row under your message', () => {
    const s = chatReducer(sent, { type: 'failed', message: 'Chat failed: HTTP 500 {"error":"x"}', status: 500 });
    expect(chatRows(s).map((r) => r.kind)).toEqual(['message', 'failure']);
  });
  it('a connection problem is a banner (no row) and clears when the history loads', () => {
    const s = chatReducer(initialChat, { type: 'failed', message: "Can't reach b-lab." });
    expect(isBanner(s.failure!)).toBe(true);
    expect(chatRows(s)).toEqual([]);
    expect(chatReducer(s, { type: 'loaded', messages: [] }).failure).toBeNull();
  });
  it('a card stays through a history reload, and clears on the next send', () => {
    const failed = chatReducer(sent, { type: 'failed', message: 'x', status: 500 });
    expect(chatReducer(failed, { type: 'loaded', messages: failed.messages }).failure).not.toBeNull();
    expect(chatReducer(failed, { type: 'send', text: 'again' }).failure).toBeNull();
  });
  it('Try again replaces the failed message instead of repeating it', () => {
    const failed = chatReducer(sent, { type: 'failed', message: 'x', status: 500 });
    const again = chatReducer(failed, { type: 'send', text: 'hi', retry: true });
    expect(again.messages.filter((m) => m.role === 'user')).toHaveLength(1);
  });
  it('not sent: a line under your bubble, on your side of the spacing', () => {
    const s = chatReducer(sent, { type: 'failed', message: "Can't reach b-lab.", notSent: true });
    expect(chatRows(s).at(-1)).toMatchObject({ kind: 'failure' });
  });
  it('a run that failed on Hermes is a "reply stopped" card', () => {
    let s = chatReducer(sent, { type: 'event', event: { type: 'finished', status: 'failed' } });
    expect(s.failure).toMatchObject({ stopped: true });
    s = chatReducer(sent, { type: 'event', event: { type: 'error', message: 'boom' } });
    expect(s.failure).toMatchObject({ fromHermes: true, raw: 'boom' });
  });
});
