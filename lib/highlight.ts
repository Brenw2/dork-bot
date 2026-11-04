// Syntax highlighting for code blocks in bot replies. highlight.js (core + the languages bots
// actually write) does the parsing; its HTML output is turned into plain tokens here, so the app
// draws them as colored Text on the phone and the desktop alike (no DOM, no WebView).
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import lua from 'highlight.js/lib/languages/lua';
import makefile from 'highlight.js/lib/languages/makefile';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const LANGUAGES = {
  bash, c, cpp, csharp, css, diff, dockerfile, go, ini, java, javascript, json, kotlin, lua,
  makefile, markdown, php, python, ruby, rust, shell, sql, swift, typescript, xml, yaml,
};
for (const [name, lang] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, lang);
// Fence names bots use that highlight.js knows by another name.
const ALIASES: Record<string, string> = {
  sh: 'bash', zsh: 'bash', console: 'shell', ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  mjs: 'javascript', cjs: 'javascript', py: 'python', rb: 'ruby', rs: 'rust', yml: 'yaml', html: 'xml', svg: 'xml',
  toml: 'ini', 'c++': 'cpp', 'c#': 'csharp', cs: 'csharp', kt: 'kotlin', golang: 'go', md: 'markdown', docker: 'dockerfile',
};

export interface CodeToken {
  text: string;
  /** highlight.js scope of the innermost span (e.g. "keyword", "string", "title.function"), or null for plain text. */
  scope: string | null;
}

/** The language's display name for a fence tag, or null if unknown ("" → null). */
export function languageFor(tag: string | undefined): string | null {
  const t = (tag ?? '').trim().toLowerCase().split(/\s+/)[0];
  if (!t) return null;
  const name = ALIASES[t] ?? t;
  return hljs.getLanguage(name) ? name : null;
}

/**
 * Code split into lines of tokens. Unknown or missing languages are left plain rather than guessed:
 * auto-detection colors prose and logs in confusing ways.
 */
export function highlight(code: string, tag?: string): CodeToken[][] {
  const lang = languageFor(tag);
  if (!lang || code.length > 50_000) return code.split('\n').map((line) => [{ text: line, scope: null }]);
  let html: string;
  try {
    html = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return code.split('\n').map((line) => [{ text: line, scope: null }]);
  }
  return splitLines(parseHtml(html));
}

const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#x27;': "'", '&#39;': "'" };
const unescape = (s: string) => s.replace(/&(?:lt|gt|amp|quot|#x27|#39);/g, (m) => ENTITIES[m] ?? m);

/** highlight.js output is only `<span class="hljs-…">`, `</span>` and escaped text. */
export function parseHtml(html: string): CodeToken[] {
  const out: CodeToken[] = [];
  const stack: (string | null)[] = [];
  const re = /<span class="([^"]*)">|<\/span>|([^<]+)/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[1] !== undefined) {
      const scope = m[1].split(/\s+/).find((c) => c.startsWith('hljs-'))?.slice(5).replace(/_+$/, '') ?? null;
      stack.push(scope);
    } else if (m[2] !== undefined) {
      const scope = [...stack].reverse().find((s) => s) ?? null;
      const text = unescape(m[2]);
      const last = out[out.length - 1];
      if (last && last.scope === scope) last.text += text;
      else out.push({ text, scope });
    } else stack.pop();
  }
  return out;
}

function splitLines(tokens: CodeToken[]): CodeToken[][] {
  const lines: CodeToken[][] = [[]];
  for (const t of tokens) {
    const parts = t.text.split('\n');
    parts.forEach((p, i) => {
      if (i > 0) lines.push([]);
      if (p) lines[lines.length - 1].push({ text: p, scope: t.scope });
    });
  }
  return lines;
}

/** Colors for scopes: a dark theme tuned to the app's background (#0F1012 / code #15171B). */
export const CODE_COLORS: Record<string, string> = {
  keyword: '#C792EA',
  built_in: '#82AAFF',
  type: '#FFCB6B',
  literal: '#F78C6C',
  number: '#F78C6C',
  string: '#C3E88D',
  regexp: '#89DDFF',
  subst: '#EEFFFF',
  symbol: '#F78C6C',
  class: '#FFCB6B',
  function: '#82AAFF',
  title: '#82AAFF',
  'title.class': '#FFCB6B',
  'title.function': '#82AAFF',
  params: '#E7E9EC',
  comment: '#6B7280',
  doctag: '#C792EA',
  meta: '#89DDFF',
  'meta keyword': '#89DDFF',
  'meta string': '#C3E88D',
  section: '#82AAFF',
  tag: '#F07178',
  name: '#F07178',
  attr: '#FFCB6B',
  attribute: '#FFCB6B',
  variable: '#F07178',
  'variable.language': '#FF5370',
  property: '#80CBC4',
  operator: '#89DDFF',
  punctuation: '#A6ACCD',
  bullet: '#89DDFF',
  code: '#C3E88D',
  emphasis: '#E7E9EC',
  strong: '#E7E9EC',
  formula: '#C792EA',
  link: '#82AAFF',
  quote: '#6B7280',
  addition: '#4CC38A',
  deletion: '#F06A6A',
  selector: '#C792EA',
  'selector-tag': '#C792EA',
  'selector-class': '#FFCB6B',
  'selector-id': '#F78C6C',
  'template-variable': '#F07178',
  'template-tag': '#C792EA',
};

export function colorFor(scope: string | null): string | undefined {
  if (!scope) return undefined;
  return CODE_COLORS[scope] ?? CODE_COLORS[scope.split('.')[0]];
}
