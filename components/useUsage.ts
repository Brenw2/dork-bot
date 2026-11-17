// Shared usage state for the Usage screen, the bot detail and the header gauge. Auto-refresh every 60 s
// while something is showing it and the app is in the foreground, never in the background (card 25, decision 4).
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { loadManager } from '@/components/manager';
import { listBots } from '@/lib/bots';
import { sameHost } from '@/lib/sync';
import { UsageClient, type BotUsage, type Days, type UsageSnapshot } from '@/lib/usage';

export const AUTO_REFRESH_MS = 60_000;

let lastSnapshot: UsageSnapshot | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** The last subscription snapshot (survives leaving the screen, so the gauge and the screen don't flash empty). */
export function cachedSnapshot(): UsageSnapshot | null {
  return lastSnapshot;
}

let inflight: Promise<UsageSnapshot> | null = null;

/** One fetch at a time, and the list's gauge and the screen share it: a poll within 10 s of the last one reuses it. */
export async function refreshSnapshot(refresh = false): Promise<UsageSnapshot> {
  if (inflight) return inflight;
  if (!refresh && lastSnapshot && Date.now() - lastSnapshot.fetchedAt < 10_000) return lastSnapshot;
  inflight = (async () => {
    const manager = await loadManager();
    if (!manager) throw new Error('Connect to Hermes first.');
    lastSnapshot = await new UsageClient(manager).providers(refresh);
    emit();
    return lastSnapshot;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Calls `fn` now and every 60 s while `active` and the app is in the foreground. */
function useWhileOpen(fn: () => void, active: boolean, immediate = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    let id: ReturnType<typeof setInterval> | null = null;
    const start = (first = false) => {
      if (id) return;
      if (immediate || !first) ref.current();
      id = setInterval(() => ref.current(), AUTO_REFRESH_MS);
    };
    const stop = () => {
      if (id) clearInterval(id);
      id = null;
    };
    if (AppState.currentState === 'active') start(true);
    const sub = AppState.addEventListener('change', (s) => (s === 'active' ? start() : stop()));
    return () => {
      stop();
      sub.remove();
    };
  }, [active]);
}

export function useUsageSnapshot(): { snapshot: UsageSnapshot | null; error: string | null; refresh: (hard?: boolean) => Promise<void> } {
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(lastSnapshot);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const on = () => setSnapshot(lastSnapshot);
    listeners.add(on);
    return () => void listeners.delete(on);
  }, []);
  const refresh = useCallback(async (hard = false) => {
    try {
      await refreshSnapshot(hard);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useWhileOpen(() => void refresh(false), true);
  return { snapshot, error, refresh };
}

/** Just the gauge's data: the shared snapshot, kept fresh while the list is showing. Errors leave the gauge grey. */
export function useGaugeSnapshot(): UsageSnapshot | null {
  const { snapshot } = useUsageSnapshot();
  return snapshot;
}

export interface BotsUsageState {
  usage: BotUsage[] | null;
  errors: Record<string, string>;
  refresh: () => Promise<void>;
}

/** Every bot on this Hermes, for 7, 30 or 90 days. */
export function useBotsUsage(days: Days): BotsUsageState {
  const [state, setState] = useState<{ usage: BotUsage[] | null; errors: Record<string, string> }>({ usage: null, errors: {} });
  const refresh = useCallback(async () => {
    const manager = await loadManager();
    if (!manager) return setState({ usage: [], errors: {} });
    const names = (await listBots()).filter((b) => sameHost(b.url, manager.chatUrl)).map((b) => b.bot);
    const r = await new UsageClient(manager).bots(names, days);
    setState(r);
  }, [days]);
  useEffect(() => {
    setState((s) => ({ ...s, usage: null }));
  }, [days]);
  useWhileOpen(() => void refresh().catch(() => undefined), true, false);
  // Re-run right away when the period changes (useWhileOpen only restarts with `active`).
  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);
  return { ...state, refresh };
}

export function useBotUsage(bot: string, days: Days): { usage: BotUsage | null; error: string | null; refresh: () => Promise<void> } {
  const [usage, setUsage] = useState<BotUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const manager = await loadManager();
      if (!manager) throw new Error('Connect to Hermes first.');
      setUsage(await new UsageClient(manager).bot(bot, days));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [bot, days]);
  useWhileOpen(() => void refresh(), true, false);
  useEffect(() => {
    setUsage(null);
    void refresh();
  }, [refresh]);
  return { usage, error, refresh };
}
