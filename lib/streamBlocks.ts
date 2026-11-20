// A reply that is still being written: split it into the blocks that are finished (safe to format as markdown)
// and the last, open one (shown plain until it finishes, so half-written markdown never flickers or reflows
// the words already on screen). Rules (Design, streaming spec):
//   - a block is complete at a blank line outside a code fence, or at the closing fence;
//   - inside an open fence blank lines complete nothing: the open code is returned as `fence`;
//   - lists, tables and quotes stay one block until the blank line; single newlines don't complete them.
export type StreamSplit = { done: string; open: string; fence: { lang: string; code: string } | null };

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/;

export function splitStreaming(text: string): StreamSplit {
  const lines = text.split('\n');
  let pos = 0; // start offset of the current line
  let doneEnd = 0; // offset just after the last completed block
  let fence: { marker: string; start: number; lang: string } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hasNewline = i < lines.length - 1; // the last line has no newline yet: still being typed
    const next = pos + line.length + 1;
    if (fence) {
      const m = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if (m && m[1][0] === fence.marker[0] && m[1].length >= fence.marker.length && hasNewline) {
        fence = null;
        doneEnd = next; // the closing fence completes the block
      }
      // A closing fence with no newline after it yet is still open: the line may not be finished.
    } else {
      const f = line.match(FENCE);
      if (f) {
        fence = { marker: f[1], start: pos, lang: f[2] };
      } else if (line.trim() === '' && hasNewline) {
        doneEnd = next;
      }
    }
    pos = next;
  }
  if (fence) {
    const body = text.slice(fence.start).split('\n').slice(1).join('\n');
    return { done: text.slice(0, fence.start), open: '', fence: { lang: fence.lang, code: body } };
  }
  return { done: text.slice(0, doneEnd), open: text.slice(doneEnd), fence: null };
}
