// Pictures in the chat history are files on Hermes; load each once (through hermes serve) and keep
// it for the rest of the session. Pictures this device just sent are already data URLs.
import { useEffect, useState } from 'react';
import { loadManager } from '@/components/manager';

const cache = new Map<string, Promise<string>>();

export function useHermesImage(bot: string, path: string | undefined): { uri: string | null; failed: boolean } {
  const [state, setState] = useState<{ uri: string | null; failed: boolean }>({ uri: null, failed: false });
  useEffect(() => {
    if (!path) return;
    let live = true;
    const key = `${bot}\n${path}`;
    let p = cache.get(key);
    if (!p) {
      p = loadManager().then((m) => {
        if (!m) throw new Error('Not signed in to Hermes');
        return m.image(bot, path);
      });
      // A failure isn't kept: next time the chat shows, it tries again.
      p.catch(() => cache.delete(key));
      cache.set(key, p);
    }
    p.then(
      (uri) => live && setState({ uri, failed: false }),
      () => live && setState({ uri: null, failed: true }),
    );
    return () => {
      live = false;
    };
  }, [bot, path]);
  return state;
}
