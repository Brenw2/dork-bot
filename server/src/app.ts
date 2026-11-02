import { existsSync } from 'node:fs';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Config } from './config.js';
import { checkHealth } from './health.js';

export function createApp(cfg: Config, fetchImpl: typeof fetch = fetch): Hono {
  const app = new Hono();

  app.get('/api/health', async (c) => c.json(await checkHealth(cfg, fetchImpl)));

  if (existsSync(cfg.webDist)) {
    app.use('/*', serveStatic({ root: cfg.webDist }));
    app.get('*', serveStatic({ root: cfg.webDist, path: 'index.html' }));
  }

  return app;
}
