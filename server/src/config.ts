import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Config {
  /** Address the Dork Bot server listens on. Localhost only by default. */
  host: string;
  port: number;
  /** Ollama (Dork) base URL, without /v1. */
  ollamaUrl: string;
  /** Model every Dork Bot bot is pinned to. */
  dorkModel: string;
  /** Hermes API server base URL (gateway api_server platform). */
  hermesApiUrl: string;
  /** Where Dork Bot keeps its own app state. */
  dataDir: string;
  /** Built web app to serve, if present. */
  webDist: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    host: env.DORK_HOST ?? '127.0.0.1',
    port: Number(env.DORK_PORT ?? 7420),
    ollamaUrl: (env.DORK_OLLAMA_URL ?? 'http://127.0.0.1:11434').replace(/\/+$/, ''),
    dorkModel: env.DORK_MODEL ?? 'gemma4:31b',
    hermesApiUrl: (env.DORK_HERMES_API_URL ?? 'http://127.0.0.1:8642').replace(/\/+$/, ''),
    dataDir: env.DORK_DATA_DIR ?? join(homedir(), '.dork-bot'),
    webDist: env.DORK_WEB_DIST ?? new URL('../../web/dist', import.meta.url).pathname,
  };
}
