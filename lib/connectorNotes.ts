// What a bot needs to hear after its connectors change.
//
// Two things get in the way of a bot using a connector it was just given (checked live on
// Hermes 0.22.5, see docs/HERMES.md → Connectors):
// 1. The gateway loads a new connector on its next housekeeping tick (every 60 s). A bot created
//    moments before can wait up to two ticks, so allow WARMUP_MS before telling it the tools are there.
// 2. The model goes along with its own earlier replies. If it said "I don't have a deepwiki tool"
//    once, it keeps saying so after the tool is loaded and never searches for it.
//
// So the chat passes a one-turn system note (Hermes's ephemeral `system_message`) naming the new
// connectors, until the bot has used one of the connector's tools or the note goes stale. While a
// connector is still loading, the chat shows how long that should take.

export const WARMUP_MS = 2 * 60_000;
export const NOTE_TTL_MS = 30 * 60_000;

type Change = { name: string; kind: 'added' | 'removed'; at: number };
type Listener = () => void;

/** Hermes names MCP tools `mcp__<server>__<tool>`; hyphens and dots in the server name become `_`. */
export function connectorOfTool(toolName: string): string | null {
  const m = /^mcp__(.+?)__/.exec(toolName);
  return m ? m[1] : null;
}

const toolPrefix = (name: string) => `mcp__${name.replace(/[-.]/g, '_')}__`;

export class ConnectorNotes {
  private changes = new Map<string, Change[]>();
  private listeners = new Set<Listener>();

  constructor(private readonly now: () => number = Date.now) {}

  added(bot: string, name: string): void {
    this.record(bot, { name, kind: 'added', at: this.now() });
  }

  removed(bot: string, name: string): void {
    this.record(bot, { name, kind: 'removed', at: this.now() });
  }

  /** Connectors added to this bot that the gateway may still be loading, with seconds left. */
  warming(bot: string): { name: string; secondsLeft: number }[] {
    const t = this.now();
    return this.live(bot)
      .filter((c) => c.kind === 'added' && t - c.at < WARMUP_MS)
      .map((c) => ({ name: c.name, secondsLeft: Math.ceil((c.at + WARMUP_MS - t) / 1000) }));
  }

  /** The system note for this bot's next turn, or undefined when there's nothing to say. */
  instructions(bot: string): string | undefined {
    const changes = this.live(bot);
    if (!changes.length) return undefined;
    const lines: string[] = [];
    const added = changes.filter((c) => c.kind === 'added');
    const removed = changes.filter((c) => c.kind === 'removed');
    if (added.length) {
      const list = added.map((c) => `${c.name} (tools named ${toolPrefix(c.name)}*)`).join(', ');
      lines.push(
        `Connectors were just added to you: ${list}. They are real tools you have now. ` +
          `Load them with tool_search if you don't see them, and use them when the request calls for it. ` +
          `If an earlier reply in this chat said you don't have them, that is out of date.`,
      );
    }
    if (removed.length) {
      lines.push(`These connectors were removed and their tools are gone: ${removed.map((c) => c.name).join(', ')}.`);
    }
    return lines.join('\n');
  }

  /** Call for every tool the bot runs: using a connector's tool means the bot knows it has it. */
  toolUsed(bot: string, toolName: string): void {
    const server = connectorOfTool(toolName);
    if (!server) return;
    const list = this.changes.get(bot);
    if (!list) return;
    const next = list.filter((c) => !(c.kind === 'added' && toolPrefix(c.name) === `mcp__${server}__`));
    if (next.length !== list.length) this.set(bot, next);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private live(bot: string): Change[] {
    const t = this.now();
    return (this.changes.get(bot) ?? []).filter((c) => t - c.at < NOTE_TTL_MS);
  }

  private record(bot: string, change: Change) {
    // The latest change to a connector wins (added then removed = removed).
    this.set(bot, [...(this.changes.get(bot) ?? []).filter((c) => c.name !== change.name), change]);
  }

  private set(bot: string, list: Change[]) {
    if (list.length) this.changes.set(bot, list);
    else this.changes.delete(bot);
    for (const fn of this.listeners) fn();
  }
}

export const connectorNotes = new ConnectorNotes();
