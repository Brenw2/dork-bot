import { describe, expect, it } from 'vitest';
import { connectorOfTool, ConnectorNotes, NOTE_TTL_MS, WARMUP_MS } from '@/lib/connectorNotes';

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

describe('connectorNotes', () => {
  it('says nothing for a bot whose connectors did not change', () => {
    const n = new ConnectorNotes();
    expect(n.instructions('ada')).toBeUndefined();
    expect(n.warming('ada')).toEqual([]);
  });

  it('tells the bot about a new connector, with its tool prefix, until it uses one of its tools', () => {
    const c = clock();
    const n = new ConnectorNotes(c.now);
    n.added('ada', 'deepwiki');
    const note = n.instructions('ada')!;
    expect(note).toContain('deepwiki (tools named mcp__deepwiki__*)');
    expect(note).toContain('tool_search');
    expect(note).toContain('out of date');
    expect(n.instructions('bob')).toBeUndefined(); // per bot

    n.toolUsed('ada', 'tool_search');
    expect(n.instructions('ada')).toBeDefined();
    n.toolUsed('ada', 'mcp__deepwiki__ask_wiki_question');
    expect(n.instructions('ada')).toBeUndefined();
  });

  it('maps hyphenated connector names the way Hermes names their tools', () => {
    const n = new ConnectorNotes();
    n.added('ada', 'aws-knowledge');
    expect(n.instructions('ada')).toContain('mcp__aws_knowledge__*');
    n.toolUsed('ada', 'mcp__aws_knowledge__search');
    expect(n.instructions('ada')).toBeUndefined();
    expect(connectorOfTool('mcp__aws_knowledge__search')).toBe('aws_knowledge');
    expect(connectorOfTool('terminal')).toBeNull();
  });

  it('counts down the warm-up, then stops warming but keeps the note', () => {
    const c = clock();
    const n = new ConnectorNotes(c.now);
    n.added('ada', 'deepwiki');
    expect(n.warming('ada')).toEqual([{ name: 'deepwiki', secondsLeft: WARMUP_MS / 1000 }]);
    c.advance(WARMUP_MS - 30_000);
    expect(n.warming('ada')).toEqual([{ name: 'deepwiki', secondsLeft: 30 }]);
    c.advance(30_000);
    expect(n.warming('ada')).toEqual([]);
    expect(n.instructions('ada')).toBeDefined();
  });

  it('drops a stale note', () => {
    const c = clock();
    const n = new ConnectorNotes(c.now);
    n.added('ada', 'deepwiki');
    c.advance(NOTE_TTL_MS);
    expect(n.instructions('ada')).toBeUndefined();
  });

  it('the latest change wins: added then removed tells the bot it is gone', () => {
    const n = new ConnectorNotes();
    n.added('ada', 'deepwiki');
    n.removed('ada', 'deepwiki');
    const note = n.instructions('ada')!;
    expect(note).not.toContain('just added');
    expect(note).toContain('removed and their tools are gone: deepwiki');
    expect(n.warming('ada')).toEqual([]);
  });

  it('notifies subscribers on changes', () => {
    const n = new ConnectorNotes();
    let calls = 0;
    const off = n.subscribe(() => calls++);
    n.added('ada', 'deepwiki');
    n.toolUsed('ada', 'mcp__deepwiki__x');
    n.toolUsed('ada', 'mcp__deepwiki__x'); // nothing left to clear
    off();
    n.added('ada', 'linear');
    expect(calls).toBe(2);
  });
});
