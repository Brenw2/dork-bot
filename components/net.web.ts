// The app's fetch on the web build. In the desktop app the request is made by the desktop main
// process (Hermes refuses browser CORS requests) and the body streams back over IPC, so chat
// replies still arrive word by word. In a plain browser (the layout tests): the browser's fetch.
import { desktop } from './desktop';

type Init = { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal };

interface Pending {
  controller: ReadableStreamDefaultController<Uint8Array>;
}

const streams = new Map<string, Pending>();
let listening = false;
let seq = 0;

function listen() {
  if (listening || !desktop) return;
  listening = true;
  desktop.onFetchEvent((id, kind, data) => {
    const s = streams.get(id);
    if (!s) return;
    if (kind === 'chunk' && data instanceof Uint8Array) s.controller.enqueue(data);
    else if (kind === 'end') {
      streams.delete(id);
      s.controller.close();
    } else if (kind === 'error') {
      streams.delete(id);
      s.controller.error(data === 'aborted' ? new DOMException('Aborted', 'AbortError') : new Error(String(data)));
    }
  });
}

async function desktopFetch(url: string, init: Init = {}) {
  const bridge = desktop!;
  listen();
  const id = `f${++seq}-${Date.now()}`;
  if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start: (c) => void (controller = c),
    cancel: () => {
      streams.delete(id);
      bridge.fetchAbort(id);
    },
  });
  // Register before starting: chunks can arrive before the start call returns.
  streams.set(id, { controller });
  const onAbort = () => bridge.fetchAbort(id);
  init.signal?.addEventListener('abort', onAbort, { once: true });
  let head: { status: number; ok: boolean };
  try {
    head = await bridge.fetchStart(id, url, { method: init.method, headers: init.headers, body: init.body });
  } catch (e) {
    streams.delete(id);
    throw init.signal?.aborted ? new DOMException('Aborted', 'AbortError') : new TypeError((e as Error).message.replace(/^Error invoking remote method 'net:fetch': (Error: )?/, ''));
  }
  const text = async () => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let out = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
    }
    return out + decoder.decode();
  };
  return { ok: head.ok, status: head.status, body, text, json: async () => JSON.parse(await text()) as unknown };
}

export const fetch: (url: string, init?: Init) => Promise<unknown> = desktop
  ? desktopFetch
  : (url, init) => globalThis.fetch(url, init);
