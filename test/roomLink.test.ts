import { describe, expect, it } from 'vitest';
import { GatewayError, GatewaySocket, gatewayWsUrl, parseServerRequest, describeFrame, type WsLike } from '@/lib/gatewayWs';
import { RoomLink } from '@/lib/roomLink';

/** A fake /api/ws server end: answers `gateway.ready`, client.capabilities and whatever `handle` says. */
class FakeWs implements WsLike {
  static all: FakeWs[] = [];
  static handle: (method: string, params: any) => unknown = () => ({});
  onopen: WsLike['onopen'] = null;
  onmessage: WsLike['onmessage'] = null;
  onclose: WsLike['onclose'] = null;
  onerror: WsLike['onerror'] = null;
  sent: any[] = [];
  constructor(readonly url: string) {
    FakeWs.all.push(this);
    queueMicrotask(() => {
      this.onopen?.({});
      this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'gateway.ready' } }) });
    });
  }
  send(data: string) {
    const f = JSON.parse(data);
    this.sent.push(f);
    queueMicrotask(() => {
      const r = FakeWs.handle(f.method, f.params);
      this.onmessage?.({ data: JSON.stringify(r instanceof GatewayError ? { id: f.id, error: { code: r.code, message: r.message } } : { id: f.id, result: r }) });
    });
  }
  close() {
    this.onclose?.({ code: 1000 });
  }
  drop() {
    this.onclose?.({ code: 1006 });
  }
}

describe('gateway socket', () => {
  it('builds the ws url with the token', () => {
    expect(gatewayWsUrl('https://b-lab.ts.net:8443/', 'a b')).toBe('wss://b-lab.ts.net:8443/api/ws?token=a%20b');
  });

  it('never logs a typed secret', () => {
    expect(describeFrame('{"result":{"value":"hunter2"}}')).toBe('{"result":{"value":"<hidden>"}}');
    expect(parseServerRequest({ id: 'srq-1', method: 'approval', params: { command: 'ls', choices: ['once'] } })).toMatchObject({ kind: 'approval', command: 'ls' });
  });
});

describe('room link', () => {
  const auth = async () => ({ adminUrl: 'http://hermes.test:9119', token: 't0k' });

  it('opens once, shares the socket and calls groups methods', async () => {
    FakeWs.all = [];
    FakeWs.handle = (m) => (m === 'groups.capabilities' ? { driver: true } : {});
    const link = new RoomLink(auth, FakeWs);
    expect(await link.client.supported()).toBe(true);
    await link.client.supported();
    expect(FakeWs.all).toHaveLength(1);
    expect(FakeWs.all[0].url).toBe('ws://hermes.test:9119/api/ws?token=t0k');
    link.close();
  });

  it('reopens after the socket drops and the call goes through on the new one', async () => {
    FakeWs.all = [];
    FakeWs.handle = () => ({ events: [], cursor: 0, latest_seq: 0 });
    const link = new RoomLink(auth, FakeWs);
    await link.client.log('r', 0);
    FakeWs.all[0].drop(); // phone slept
    await link.client.log('r', 0);
    expect(FakeWs.all).toHaveLength(2);
    link.close();
  });

  it('a server error is not retried', async () => {
    FakeWs.all = [];
    FakeWs.handle = (m) => (m === 'groups.state' ? new GatewayError('hosted room not found', 4114) : {});
    const link = new RoomLink(auth, FakeWs);
    await expect(link.client.state('gone')).rejects.toThrow('hosted room not found');
    expect(FakeWs.all[0].sent.filter((f) => f.method === 'groups.state')).toHaveLength(1);
    link.close();
  });

  it('says so when the phone is not paired', async () => {
    const link = new RoomLink(async () => null, FakeWs);
    await expect(link.client.list()).rejects.toThrow('Connect to Hermes');
  });
});

describe('GatewaySocket', () => {
  it('rejects pending calls when the socket closes', async () => {
    FakeWs.all = [];
    FakeWs.handle = () => new Promise(() => {}) as unknown;
    const s = new GatewaySocket('ws://x', FakeWs);
    await s.open();
    const p = s.call('groups.list');
    FakeWs.all[0].drop();
    await expect(p).rejects.toThrow('socket closed');
  });
});
