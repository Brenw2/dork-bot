import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

const cfg = loadConfig();
const app = createApp(cfg);

serve({ fetch: app.fetch, hostname: cfg.host, port: cfg.port }, (info) => {
  console.log(`Dork Bot server on http://${info.address}:${info.port}`);
});
