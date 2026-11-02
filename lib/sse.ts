// Incremental parser for Server-Sent Events, as sent by the Hermes API server.
// Feed it text chunks in any split; it returns every complete event.

export interface SseEvent {
  event: string;
  data: string;
}

export class SseParser {
  private buf = '';

  push(chunk: string): SseEvent[] {
    this.buf += chunk.replace(/\r\n?/g, '\n');
    const out: SseEvent[] = [];
    let i: number;
    while ((i = this.buf.indexOf('\n\n')) >= 0) {
      const frame = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      const ev = parseFrame(frame);
      if (ev) out.push(ev);
    }
    return out;
  }
}

function parseFrame(frame: string): SseEvent | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of frame.split('\n')) {
    if (line === '' || line.startsWith(':')) continue; // comment / keepalive
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  return data.length ? { event, data: data.join('\n') } : null;
}
