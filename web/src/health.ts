export interface ServiceStatus {
  ok: boolean;
  detail: string;
}

export interface Health {
  ok: boolean;
  ollama: ServiceStatus & { model: string; modelInstalled: boolean };
  hermes: ServiceStatus;
}

export async function fetchHealth(): Promise<Health> {
  const res = await fetch('/api/health');
  if (!res.ok) throw new Error(`Dork Bot server: HTTP ${res.status}`);
  return (await res.json()) as Health;
}
