// Live test against a real Hermes + Dork. Skipped unless DORK_LIVE=1.
//   DORK_LIVE=1 npm test                                   # http://127.0.0.1:8642
//   DORK_LIVE=1 DORK_HERMES_URL=https://b-lab.tail7e27a7.ts.net npm test
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chatReducer, initialChat } from '@/lib/chatState';
import { HermesClient, type FetchLike } from '@/lib/hermes';

const live = process.env.DORK_LIVE === '1';
const bot = process.env.DORK_BOT ?? 'assistant';
const url = process.env.DORK_HERMES_URL ?? 'http://127.0.0.1:8642';

describe.skipIf(!live)(`live: ${bot} at ${url}`, () => {
  const env = readFileSync(join(homedir(), '.hermes', 'profiles', bot, '.env'), 'utf8');
  const key = env.match(/^API_SERVER_KEY=["']?([^"'\n]+)/m)?.[1] ?? '';
  const client = new HermesClient({ url, bot, key }, fetch as unknown as FetchLike);
  const sessionId = `dork-bot-live-${Date.now()}`;

  it('rejects a wrong key', async () => {
    const bad = new HermesClient({ url, bot, key: 'x'.repeat(32) }, fetch as unknown as FetchLike);
    await expect(bad.check()).rejects.toThrow(/rejected/);
  });

  it('streams a real reply from Dork and it lands in the history', async () => {
    await client.check();
    await client.ensureSession(sessionId, 'Dork Bot live test');
    await client.ensureSession(sessionId, 'Dork Bot live test'); // second call: 409 is fine

    let state = chatReducer(initialChat, { type: 'send', text: 'Reply with exactly: pong' });
    const t0 = Date.now();
    let firstToken = 0;
    await client.chat(sessionId, 'Reply with exactly: pong', (event) => {
      if (event.type === 'delta' && !firstToken) firstToken = Date.now() - t0;
      state = chatReducer(state, { type: 'event', event });
    });
    const reply = state.messages.at(-1);
    console.log(`reply=${JSON.stringify(reply?.content)} first_token=${firstToken}ms total=${Date.now() - t0}ms`);
    expect(state.error).toBeNull();
    expect(reply?.role).toBe('assistant');
    expect(reply?.content.toLowerCase()).toContain('pong');

    const history = await client.messages(sessionId);
    expect(history.map((m) => m.role)).toEqual(['user', 'assistant']);
  }, 300_000);
});
