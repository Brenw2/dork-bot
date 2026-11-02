import { useEffect, useState } from 'react';
import { fetchHealth, type Health, type ServiceStatus } from './health';

function Status({ label, s }: { label: string; s: ServiceStatus }) {
  return (
    <li className={s.ok ? 'ok' : 'bad'}>
      <span className="dot" aria-hidden />
      <strong>{label}</strong> {s.detail}
    </li>
  );
}

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHealth().then(setHealth, (e: Error) => setError(e.message));
  }, []);

  return (
    <main>
      <h1>Dork Bot</h1>
      <p className="tag">AI teammates, running locally on Dork.</p>
      {error && <p className="bad">{error}</p>}
      {health && (
        <ul className="status">
          <Status label={`Dork (${health.ollama.model})`} s={health.ollama} />
          <Status label="Hermes" s={health.hermes} />
        </ul>
      )}
    </main>
  );
}
