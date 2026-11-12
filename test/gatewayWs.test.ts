import { describe, expect, it } from 'vitest';
import { GatewaySocket, describeFrame, gatewayWsUrl, parseServerRequest, type WsLike } from '@/lib/gatewayWs';

class FakeWs implements WsLike {
  static last: FakeWs;
  sent: Record<string, unknown>[] = [];
  onopen: WsLike['onopen'] = null;
  onmessage: WsLike['onmessage'] = null;
  onclose: WsLike['onclose'] = null;
  onerror: WsLike['onerror'] = null;
  constructor(readonly url: string) {
    FakeWs.last = this;
    queueMicrotask(() => this.push({ jsonrpc: '2.0', method: 'event', params: { type: 'gateway.ready', payload: {} } }));
  }
  push(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  send(data: string) {
    const f = JSON.parse(data) as Record<string, unknown>;
    this.sent.push(f);
    if (f.method === 'client.capabilities') queueMicrotask(() => this.push({ jsonrpc: '2.0', id: f.id, result: { server_requests: ['sudo'] } }));
  }
  close() {}
}

describe('gateway socket (spike)', () => {
  it('builds the ws url with the bearer token', () => {
    expect(gatewayWsUrl('https://b-lab.ts.net:8443/', 'a b')).toBe('wss://b-lab.ts.net:8443/api/ws?token=a%20b');
    expect(gatewayWsUrl('http://127.0.0.1:9119', 't')).toBe('ws://127.0.0.1:9119/api/ws?token=t');
  });

  it('parses sudo, secret and approval requests and ignores everything else', () => {
    expect(parseServerRequest({ id: 'srq-1', method: 'sudo', params: { session_id: 's', command: 'sudo true' } })).toEqual({ kind: 'sudo', id: 'srq-1', sessionId: 's', command: 'sudo true' });
    expect(parseServerRequest({ id: 'srq-2', method: 'secret', params: { session_id: 's', env_var: 'K', prompt: 'p', metadata: { x: 1 } } })).toEqual({ kind: 'secret', id: 'srq-2', sessionId: 's', envVar: 'K', prompt: 'p' });
    expect(parseServerRequest({ id: 'srq-3', method: 'approval', params: { session_id: 's', request_id: 'r', command: 'rm x', description: 'd', choices: ['once', 'deny', 7] } })).toMatchObject({ kind: 'approval', requestId: 'r', choices: ['once', 'deny'] });
    expect(parseServerRequest({ id: 'srq-4', method: 'tour', params: {} })).toEqual({ kind: 'other', id: 'srq-4', method: 'tour' });
    expect(parseServerRequest({ id: 7, method: 'sudo' })).toBeNull(); // an answer to our own call, not a request
    expect(parseServerRequest({ method: 'event', params: {} })).toBeNull();
    expect(parseServerRequest(null)).toBeNull();
  });

  it('never lets a typed value into a log line', () => {
    const line = describeFrame(JSON.stringify({ jsonrpc: '2.0', id: 'srq-1', result: { value: 'hunter2 "quoted" \\ back' } }));
    expect(line).not.toContain('hunter2');
    expect(line).toContain('"value":"<hidden>"');
  });

  it('says it answers server requests, then answers a sudo request once with what the handler returns', async () => {
    const asked: string[] = [];
    const sock = new GatewaySocket('ws://x/api/ws?token=t', FakeWs, {
      onRequest: async (r) => {
        asked.push(r.kind);
        return { value: 'typed-secret' };
      },
    });
    await sock.open();
    const ws = FakeWs.last;
    expect(ws.sent[0]).toMatchObject({ method: 'client.capabilities', params: { server_requests: true } });
    ws.push({ jsonrpc: '2.0', id: 'srq-9', method: 'sudo', params: { session_id: 's', command: 'sudo true' } });
    await new Promise((r) => setTimeout(r, 5));
    expect(asked).toEqual(['sudo']);
    expect(ws.sent.at(-1)).toEqual({ jsonrpc: '2.0', id: 'srq-9', result: { value: 'typed-secret' } });
    expect(ws.sent.filter((f) => f.id === 'srq-9')).toHaveLength(1);
  });

  it('answers empty (skip) or deny when there is no handler or the handler throws', async () => {
    const sock = new GatewaySocket('ws://x', FakeWs, {
      onRequest: async () => {
        throw new Error('boom typed-secret');
      },
    });
    await sock.open();
    const ws = FakeWs.last;
    ws.push({ id: 'srq-1', method: 'sudo', params: { session_id: 's' } });
    ws.push({ id: 'srq-2', method: 'approval', params: { session_id: 's', request_id: 'r', command: 'x' } });
    await new Promise((r) => setTimeout(r, 5));
    expect(ws.sent.find((f) => f.id === 'srq-1')).toEqual({ jsonrpc: '2.0', id: 'srq-1', result: { value: '' } });
    expect(ws.sent.find((f) => f.id === 'srq-2')).toEqual({ jsonrpc: '2.0', id: 'srq-2', result: { choice: 'deny' } });
  });

  it('routes events and replies, and a request frame never reaches onEvent', async () => {
    const events: string[] = [];
    const sock = new GatewaySocket('ws://x', FakeWs, { onEvent: (e) => events.push(e.type) });
    await sock.open();
    const ws = FakeWs.last;
    const call = sock.call<{ session_id: string }>('session.create', { profile: 'p' });
    const id = ws.sent.at(-1)!.id;
    ws.push({ jsonrpc: '2.0', method: 'event', params: { type: 'message.delta', session_id: 's', payload: { text: 'hi' } } });
    ws.push({ id: 'srq-1', method: 'sudo', params: { session_id: 's' } });
    ws.push({ jsonrpc: '2.0', id, result: { session_id: 's' } });
    expect(await call).toEqual({ session_id: 's' });
    expect(events).toEqual(['message.delta']);
    const bad = sock.call('prompt.submit', {});
    ws.push({ jsonrpc: '2.0', id: ws.sent.at(-1)!.id, error: { code: 4001, message: 'nope' } });
    await expect(bad).rejects.toMatchObject({ message: 'nope', code: 4001 });
  });
});
