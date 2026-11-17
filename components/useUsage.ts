// Shared usage state for the Usage screen, the bot detail and the header gauge (Fix 12). Numbers are kept in memory
// only, so opening the screen shows the last ones at once and refreshes behind them. Refresh once at open, and when
// the app returns to the foreground if the data is over 5 minutes old. There is no timer (Chief's ruling, 2026-11-18).
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { loadManager } from '@/components/manager';
import { listBots } from '@/lib/bots';
import { sameHost } from '@/lib/sync';
import { UsageClient, usageBotNames, type BotUsage, type Days, type UsageSnapshot } from '@/lib/usage';

/** Data older than this is refreshed when the list opens or the app comes back to the foreground (Fix 12). */
export const STALE_MS = 5 * 60_000;

// ---- 7/30/90, remembered while the app runs and shared by the screen, the detail and the rows ----
let days: Days = 30;
const dayListeners = new Set<() => void>();
export function setDays(d: Days): void {
  days = d;
  dayListeners.forEach((l) => l());
}
export function useDays(): [Days, (d: Days) => void] {
  const d = useSyncExternalStore(
    (fn) => {
      dayListeners.add(fn);
      return () => void dayListeners.delete(fn);
    },
    () => days,
  );
  return [d, setDays];
}

// ---- subscriptions ----
let lastSnapshot: UsageSnapshot | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let inflight: Promise<UsageSnapshot> | null = null;

export function cachedSnapshot(): UsageSnapshot | null {
  return lastSnapshot;
}

/** One fetch at a time, shared by the list's gauge and the screen; a poll within 10 s of the last one reuses it. */
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

/** Calls `fn` when the app returns to the foreground and the data (`lastAt`) is over 5 minutes old. No timer. */
function useOnForeground(fn: () => void, lastAt: () => number | null) {
  const ref = useRef(fn);
  ref.current = fn;
  const at = useRef(lastAt);
  at.current = lastAt;
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      const last = at.current();
      if (s === 'active' && (last === null || Date.now() - last > STALE_MS)) ref.current();
    });
    return () => sub.remove();
  }, []);
}

export interface SnapshotState {
  snapshot: UsageSnapshot | null;
  loading: boolean;
  /** The last refresh failed; `snapshot` (if any) is what was there before. */
  error: string | null;
  refresh: (hard?: boolean) => Promise<void>;
}

/** The Usage screen's subscriptions: cached numbers at once, then a refresh, then nothing until you pull or come back after 5 minutes. */
export function useUsageSnapshot(): SnapshotState {
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(lastSnapshot);
  const [loading, setLoading] = useState(!lastSnapshot);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const on = () => setSnapshot(lastSnapshot);
    listeners.add(on);
    return () => void listeners.delete(on);
  }, []);
  const refresh = useCallback(async (hard = false) => {
    setLoading(true);
    try {
      await refreshSnapshot(hard);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void refresh(false), [refresh]); // once at open
  useOnForeground(() => void refresh(false), () => lastSnapshot?.fetchedAt ?? null);
  return { snapshot, loading, error, refresh };
}

/** The header gauge's data: the shared snapshot, asked for once on opening the list when missing or over 5 minutes old. */
export function useGaugeSnapshot(): UsageSnapshot | null {
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(lastSnapshot);
  useEffect(() => {
    const on = () => setSnapshot(lastSnapshot);
    listeners.add(on);
    if (!lastSnapshot || Date.now() - lastSnapshot.fetchedAt > STALE_MS) void refreshSnapshot(false).catch(() => undefined);
    return () => void listeners.delete(on);
  }, []);
  return snapshot;
}

// ---- bots ----
export interface BotsUsageState {
  usage: BotUsage[] | null;
  hidden: Record<string, boolean>;
  errors: Record<string, string>;
  /** Hermes couldn't be reached at all and nothing is cached. */
  unreachable: boolean;
  refresh: () => Promise<void>;
}

const botsCache = new Map<Days, { usage: BotUsage[]; hidden: Record<string, boolean>; errors: Record<string, string>; at: number }>();

/** Every bot on this Hermes (hidden ones too) for 7, 30 or 90 days. */
export function useBotsUsage(period: Days): BotsUsageState {
  const [state, setState] = useState(() => botsCache.get(period) ?? null);
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(async () => {
    const manager = await loadManager();
    if (!manager) {
      setFailed(true);
      return;
    }
    try {
      const profiles = await manager.listProfiles();
      const saved = (await listBots()).filter((b) => sameHost(b.url, manager.chatUrl)).map((b) => b.bot);
      const { names, hidden } = usageBotNames(profiles, saved);
      const r = await new UsageClient(manager).bots(names, period);
      const next = { usage: r.usage, hidden, errors: r.errors, at: Date.now() };
      botsCache.set(period, next);
      setState(next);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [period]);
  useEffect(() => {
    setState(botsCache.get(period) ?? null);
    void refresh();
  }, [period, refresh]);
  useOnForeground(() => void refresh(), () => botsCache.get(period)?.at ?? null);
  return { usage: state?.usage ?? null, hidden: state?.hidden ?? {}, errors: state?.errors ?? {}, unreachable: failed && !state, refresh };
}

export function useBotUsage(bot: string, period: Days): { usage: BotUsage | null; error: string | null; refresh: () => Promise<void> } {
  const [usage, setUsage] = useState<BotUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastAt = useRef<number | null>(null);
  const refresh = useCallback(async () => {
    try {
      const manager = await loadManager();
      if (!manager) throw new Error('Connect to Hermes first.');
      setUsage(await new UsageClient(manager).bot(bot, period));
      lastAt.current = Date.now();
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [bot, period]);
  useEffect(() => {
    setUsage((u) => (u && u.days === period && u.bot === bot ? u : null));
    void refresh();
  }, [refresh, bot, period]);
  useOnForeground(() => void refresh(), () => lastAt.current);
  return { usage, error, refresh };
}
