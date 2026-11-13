// Friendly names for Hermes tools (design fix 4). Label only: the step list still shows the raw name.

const TABLE: { match: (n: string) => boolean; live: string; done: string }[] = [
  { match: (n) => n === 'terminal', live: 'Running a command…', done: 'Terminal' },
  { match: (n) => n === 'web_search', live: 'Searching the web…', done: 'Web search' },
  { match: (n) => n === 'web_extract' || n.startsWith('browser_'), live: 'Reading a page…', done: 'Reading a page' },
  { match: (n) => n === 'read_file' || n === 'search_files', live: 'Reading files…', done: 'Files' },
  { match: (n) => n === 'write_file' || n === 'patch', live: 'Editing files…', done: 'Files' },
  { match: (n) => n === 'memory' || n === 'session_search', live: 'Checking memory…', done: 'Memory' },
  { match: (n) => n === 'skill_view' || n === 'skills_list', live: 'Checking a skill…', done: 'Skills' },
  { match: (n) => n === 'cronjob', live: 'Setting up a routine…', done: 'Routines' },
];

/** `mcp__trello__trelloSearch` → { server: "Trello", words: "search" } (a leading word that repeats the server is dropped). */
export function parseMcp(name: string): { server: string; words: string } | null {
  const parts = name.split('__');
  if (parts.length < 3 || parts[0] !== 'mcp' || !parts[1]) return null;
  const server = parts[1].replace(/[-_]+/g, ' ').trim();
  const tool = parts.slice(2).join(' ');
  const words = tool
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (words[0] === server.toLowerCase().replace(/\s+/g, '')) words.shift();
  return { server: server.charAt(0).toUpperCase() + server.slice(1), words: words.join(' ') };
}

/** The step that is running now: "Searching the web…", "Trello: search…". Unknown tools keep their raw name. */
export function liveToolName(name: string): string {
  const row = TABLE.find((t) => t.match(name));
  if (row) return row.live;
  const mcp = parseMcp(name);
  if (mcp) return mcp.words ? `${mcp.server}: ${mcp.words}…` : `${mcp.server}…`;
  return name;
}

/** A finished step in the summary chip: "Web search", "Trello". */
export function doneToolName(name: string): string {
  const row = TABLE.find((t) => t.match(name));
  if (row) return row.done;
  return parseMcp(name)?.server ?? name;
}
