// A reply's markdown as plain text, for the "Select Text" sheet (phone) and for Copy: no asterisks, backticks
// or link syntax; lists keep their markers, tables become tab-separated rows, code keeps its exact characters.
// Pure (no React), so it is unit-tested in test/plainText.test.ts.
import { marked, type Token, type Tokens } from 'marked';

/** One run of the plain text: prose (system font) or a code block (monospace). */
export interface PlainSegment {
  kind: 'text' | 'code';
  text: string;
}

/** marked leaves HTML entities in inline text (&amp;, &#39;…); show the characters. */
export function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39|#x27);/g, (_, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'" })[e] ?? _);
}

function inlineText(tokens: Token[] | undefined): string {
  if (!tokens) return '';
  return tokens
    .map((t) => {
      switch (t.type) {
        case 'strong':
        case 'em':
        case 'del':
          return inlineText((t as Tokens.Strong).tokens);
        case 'codespan':
          return decodeEntities((t as Tokens.Codespan).text);
        case 'link': {
          const l = t as Tokens.Link;
          const label = inlineText(l.tokens);
          // A bare address is its own text; a link with words keeps the words (the address is not shown in the chat).
          return label || l.href;
        }
        case 'image': {
          const im = t as Tokens.Image;
          return im.text || im.href;
        }
        case 'br':
          return '\n';
        case 'text': {
          const tt = t as Tokens.Text;
          return tt.tokens ? inlineText(tt.tokens) : decodeEntities(tt.text);
        }
        case 'escape':
          return decodeEntities((t as Tokens.Escape).text);
        default:
          return 'text' in t && typeof t.text === 'string' ? decodeEntities(t.text) : '';
      }
    })
    .join('');
}

function blockSegments(tokens: Token[], out: PlainSegment[], indent = ''): void {
  const push = (text: string) => {
    const t = text.replace(/\s+$/, '');
    if (!t) return;
    const last = out[out.length - 1];
    // Neighbouring prose joins into one run, separated by a blank line, so selection runs across paragraphs.
    if (last?.kind === 'text') last.text += `\n\n${indent}${t}`;
    else out.push({ kind: 'text', text: `${indent}${t}` });
  };
  for (const t of tokens) {
    switch (t.type) {
      case 'space':
        break;
      case 'paragraph':
      case 'heading':
        push(inlineText((t as Tokens.Paragraph).tokens));
        break;
      case 'text': {
        const tt = t as Tokens.Text;
        push(tt.tokens ? inlineText(tt.tokens) : decodeEntities(tt.text));
        break;
      }
      case 'code':
        out.push({ kind: 'code', text: (t as Tokens.Code).text.replace(/\n$/, '') });
        break;
      case 'blockquote':
        blockSegments((t as Tokens.Blockquote).tokens, out, indent);
        break;
      case 'list': {
        const l = t as Tokens.List;
        const start = typeof l.start === 'number' ? l.start : 1;
        l.items.forEach((item, j) => {
          const marker = item.task ? (item.checked ? '[x]' : '[ ]') : l.ordered ? `${start + j}.` : '•';
          const inner: PlainSegment[] = [];
          blockSegments(item.tokens, inner);
          inner.forEach((seg, k) => {
            if (seg.kind === 'code') return void out.push(seg);
            // The marker goes on the item's first line; continuation lines hang under it.
            const text = k === 0 ? `${marker} ${seg.text}` : seg.text;
            const last = out[out.length - 1];
            if (last?.kind === 'text') last.text += `${k === 0 && j > 0 ? '\n' : '\n\n'}${text}`;
            else out.push({ kind: 'text', text });
          });
        });
        break;
      }
      case 'table': {
        const tb = t as Tokens.Table;
        const rows = [tb.header, ...tb.rows].map((r) => r.map((c) => inlineText(c.tokens)).join('\t'));
        push(rows.join('\n'));
        break;
      }
      case 'hr':
        break;
      case 'html':
        push((t as Tokens.HTML).text.trim());
        break;
      default:
        if ('text' in t && typeof t.text === 'string') push(t.text);
    }
  }
}

/** The text of a message as runs of prose and code, in order. Unparseable markdown comes back as one prose run. */
export function plainSegments(text: string): PlainSegment[] {
  let tokens: Token[];
  try {
    tokens = marked.lexer(text, { gfm: true, breaks: false });
  } catch {
    return text.trim() ? [{ kind: 'text', text }] : [];
  }
  const out: PlainSegment[] = [];
  blockSegments(tokens, out);
  return out;
}

/** The whole message as one plain string (Copy All). Blocks are separated by a blank line. */
export function plainText(text: string): string {
  return plainSegments(text)
    .map((s) => s.text)
    .join('\n\n');
}
