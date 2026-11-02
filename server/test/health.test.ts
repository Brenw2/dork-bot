import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { checkHealth } from '../src/health.js';

const cfg = loadConfig({ DORK_WEB_DIST: '/nonexistent' });

function fakeFetch(routes: Record<string, () => Response>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const hit = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    if (!hit) throw new Error('ECONNREFUSED');
    return hit[1]();
  }) as typeof fetch;
}

const tags = (names: string[]) => () => Response.json({ models: names.map((name) => ({ name })) });

describe('checkHealth', () => {
  it('is ok when Ollama has the Dork model and Hermes answers', async () => {
    const h = await checkHealth(cfg, fakeFetch({
      [cfg.ollamaUrl]: tags(['gemma4:31b']),
      [cfg.hermesApiUrl]: () => new Response('unauthorized', { status: 401 }),
    }));
    expect(h.ok).toBe(true);
    expect(h.ollama.modelInstalled).toBe(true);
    expect(h.hermes.detail).toContain('401');
  });

  it('flags a missing model', async () => {
    const h = await checkHealth(cfg, fakeFetch({
      [cfg.ollamaUrl]: tags(['llama3:8b']),
      [cfg.hermesApiUrl]: () => new Response('{}'),
    }));
    expect(h.ok).toBe(false);
    expect(h.ollama.detail).toContain('not installed');
  });

  it('reports both services unreachable', async () => {
    const h = await checkHealth(cfg, fakeFetch({}));
    expect(h.ok).toBe(false);
    expect(h.ollama.detail).toContain('unreachable');
    expect(h.hermes.detail).toContain('unreachable');
  });
});

describe('GET /api/health', () => {
  it('returns the health JSON', async () => {
    const app = createApp(cfg, fakeFetch({ [cfg.ollamaUrl]: tags(['gemma4:31b']) }));
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ollama: { ok: boolean }; hermes: { ok: boolean } };
    expect(body.ollama.ok).toBe(true);
    expect(body.hermes.ok).toBe(false);
  });
});
