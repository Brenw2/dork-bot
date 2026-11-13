import { describe, expect, it } from 'vitest';
import { activityLine, APPROVAL_TIMEOUT_S, chatReducer, chatRows, countdown, initialChat, stillWorking, type ChatState } from '@/lib/chatState';
import { doneToolName, liveToolName, parseMcp } from '@/lib/toolNames';
import type { ApprovalRequest } from '@/lib/hermes';

// Design fixes 4 and 5 (docs/design/REVIEW.md): working states and inline approvals.

describe('friendly tool names (fix 4)', () => {
  const table: [string, string, string][] = [
    ['terminal', 'Running a command…', 'Terminal'],
    ['web_search', 'Searching the web…', 'Web search'],
    ['web_extract', 'Reading a page…', 'Reading a page'],
    ['browser_navigate', 'Reading a page…', 'Reading a page'],
    ['read_file', 'Reading files…', 'Files'],
    ['search_files', 'Reading files…', 'Files'],
    ['write_file', 'Editing files…', 'Files'],
    ['patch', 'Editing files…', 'Files'],
    ['memory', 'Checking memory…', 'Memory'],
    ['session_search', 'Checking memory…', 'Memory'],
    ['skill_view', 'Checking a skill…', 'Skills'],
    ['skills_list', 'Checking a skill…', 'Skills'],
    ['cronjob', 'Setting up a routine…', 'Routines'],
  ];
  it.each(table)('%s', (name, live, done) => {
    expect(liveToolName(name)).toBe(live);
    expect(doneToolName(name)).toBe(done);
  });
  it('MCP tools read "<Server>: <words>…"', () => {
    expect(liveToolName('mcp__trello__trelloSearch')).toBe('Trello: search…');
    expect(liveToolName('mcp__trello__trelloReadCard')).toBe('Trello: read card…');
    expect(liveToolName('mcp__linear__list_issues')).toBe('Linear: list issues…');
    expect(liveToolName('mcp__trello__trello')).toBe('Trello…');
    expect(doneToolName('mcp__trello__trelloSearch')).toBe('Trello');
    expect(parseMcp('mcp__my-server__do_it')).toEqual({ server: 'My server', words: 'do it' });
  });
  it('anything else keeps its raw name', () => {
    expect(liveToolName('image_generate')).toBe('image_generate');
    expect(doneToolName('image_generate')).toBe('image_generate');
    expect(liveToolName('mcp_broken')).toBe('mcp_broken');
  });
  it('the chip text', () => {
    const t = (name: string, status: 'running' | 'done' | 'failed' = 'done') => ({ name, preview: null, status });
    expect(activityLine([t('mcp__trello__trelloSearch', 'running')], true)).toBe('Trello: search…');
    expect(activityLine([t('terminal'), t('web_search'), t('mcp__trello__trelloReadCard', 'running')], true)).toBe('Trello: read card… · 3 steps');
    expect(activityLine([t('mcp__trello__a_b'), t('web_search'), t('mcp__trello__c'), t('web_search')], false)).toBe('Used Trello, Web search · 4 steps');
  });
});

describe('still working (fix 4)', () => {
  it('shows nothing before 10 s', () => {
    expect(stillWorking(0)).toBeNull();
    expect(stillWorking(9_999)).toBeNull();
  });
  it('seconds, then minutes', () => {
    expect(stillWorking(10_000)).toBe('Still working · 10 s');
    expect(stillWorking(48_400)).toBe('Still working · 48 s');
    expect(stillWorking(120_000)).toBe('Still working · 2 min');
    expect(stillWorking(150_000)).toBe('Still working · 2 min');
  });
});

describe('typing bubble (fix 4)', () => {
  it('is in the transcript the moment you send', () => {
    const s = chatReducer(initialChat, { type: 'send', text: 'hi' });
    expect(chatRows(s).at(-1)).toMatchObject({ kind: 'pending', text: '' });
  });
});

describe('inline approvals (fix 5)', () => {
  const request: ApprovalRequest = { command: 'rm -rf ~/notes/old-drafts', description: 'recursive delete', choices: ['once', 'session', 'always', 'deny'], requestId: 'r1' };
  const waiting = (): ChatState => chatReducer(chatReducer(initialChat, { type: 'send', text: 'clean up' }), { type: 'approval', request });

  it('is the last row, and the typing bubble steps aside', () => {
    const rows = chatRows(waiting());
    expect(rows.at(-1)).toMatchObject({ kind: 'approval', request });
    expect(rows.some((r) => r.kind === 'pending')).toBe(false);
  });
  it('keeps the reply text that came before it', () => {
    let s = waiting();
    s = chatReducer(s, { type: 'event', event: { type: 'delta', text: "I'll delete the folder." } });
    expect(chatRows(s).map((r) => r.kind)).toEqual(['message', 'pending', 'approval']);
  });
  it('collapses to a chip when answered, and the typing bubble comes back', () => {
    const s = chatReducer(waiting(), { type: 'answered', choice: 'once' });
    expect(s.approval).toBeNull();
    expect(chatRows(s).map((r) => r.kind)).toEqual(['message', 'decision', 'pending']);
    expect(chatRows(s)[1]).toMatchObject({ decision: { choice: 'once', command: 'rm -rf ~/notes/old-drafts' } });
  });
  it('a Deny chip is kept too', () => {
    const s = chatReducer(waiting(), { type: 'answered', choice: 'deny' });
    expect(s.decisions).toEqual([{ choice: 'deny', command: 'rm -rf ~/notes/old-drafts' }]);
  });
  it('the chips go with the finished reply, and a new send starts clean', () => {
    let s = chatReducer(waiting(), { type: 'answered', choice: 'once' });
    s = chatReducer(s, { type: 'ended' });
    expect(s.decisions).toEqual([]);
    expect(chatRows(s).some((r) => r.kind === 'decision')).toBe(false);
  });
  it('a queued message sits after everything and counts as yours for spacing', () => {
    const rows = chatRows(waiting(), ['also bring water']);
    expect(rows.map((r) => r.kind)).toEqual(['message', 'approval', 'queued']);
  });
  it('counts down from the 300 s timeout', () => {
    expect(APPROVAL_TIMEOUT_S).toBe(300);
    expect(countdown(300)).toBe('5:00');
    expect(countdown(272)).toBe('4:32');
    expect(countdown(9.2)).toBe('0:10');
    expect(countdown(-3)).toBe('0:00');
  });
});
