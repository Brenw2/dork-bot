import type { Config } from './config.js';

export interface ServiceStatus {
  ok: boolean;
  detail: string;
}

export interface Health {
  ok: boolean;
  ollama: ServiceStatus & { model: string; modelInstalled: boolean };
  hermes: ServiceStatus;
}

type Fetch = typeof fetch;

const TIMEOUT_MS = 2000;

async function probe(fetchImpl: Fetch, url: string): Promise<Response | Error> {
  try {
    return await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

export async function checkOllama(cfg: Config, fetchImpl: Fetch = fetch): Promise<Health['ollama']> {
  const res = await probe(fetchImpl, `${cfg.ollamaUrl}/api/tags`);
  if (res instanceof Error) {
    return { ok: false, detail: `unreachable: ${res.message}`, model: cfg.dorkModel, modelInstalled: false };
  }
  if (!res.ok) {
    return { ok: false, detail: `HTTP ${res.status}`, model: cfg.dorkModel, modelInstalled: false };
  }
  const body = (await res.json()) as { models?: { name?: string }[] };
  const names = (body.models ?? []).map((m) => m.name);
  const modelInstalled = names.includes(cfg.dorkModel);
  return {
    ok: modelInstalled,
    detail: modelInstalled ? 'ready' : `model ${cfg.dorkModel} not installed (have: ${names.join(', ') || 'none'})`,
    model: cfg.dorkModel,
    modelInstalled,
  };
}

export async function checkHermes(cfg: Config, fetchImpl: Fetch = fetch): Promise<ServiceStatus> {
  // Any HTTP answer (even 401 without a key) proves the API server is up.
  const res = await probe(fetchImpl, `${cfg.hermesApiUrl}/v1/models`);
  if (res instanceof Error) {
    return { ok: false, detail: `API server unreachable at ${cfg.hermesApiUrl}: ${res.message}` };
  }
  return { ok: true, detail: `API server answered HTTP ${res.status}` };
}

export async function checkHealth(cfg: Config, fetchImpl: Fetch = fetch): Promise<Health> {
  const [ollama, hermes] = await Promise.all([checkOllama(cfg, fetchImpl), checkHermes(cfg, fetchImpl)]);
  return { ok: ollama.ok && hermes.ok, ollama, hermes };
}
