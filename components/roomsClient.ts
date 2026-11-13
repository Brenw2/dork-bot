// What the room screens share: the one /api/ws link, the unsent-message record, the "seen" marker, and the
// hook that turns the gateway's rooms into rows for the bot list. Thin: the logic is in lib/rooms.ts.
import { randomUUID } from 'expo-crypto';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { loadManager } from '@/components/manager';
import { listBots } from '@/lib/bots';
import type { WsCtor } from '@/lib/gatewayWs';
import { nameOf } from '@/lib/names';
import { RoomLink } from '@/lib/roomLink';
import { orderRows, summarizeRoom, type PendingSend, type RoomMember, type RoomRow, type SendStore } from '@/lib/rooms';
import * as SecureStore from '@/lib/secureStore';

/** The shared socket. It opens when first used and again after the phone slept. */
export const roomLink = new RoomLink(async () => {
  const m = await loadManager();
  return m ? m.wsAuth() : null;
}, globalThis.WebSocket as unknown as WsCtor);

export const newId = (): string => randomUUID();

const sendKey = (room: string) => `dork-room-send.${room}`;
const seenKey = (room: string) => `dork-room-seen.${room}`;

/** One unsent message per room, kept until the gateway ACKs it. */
export const sendStore: SendStore = {
  async get(room) {
    try {
      const raw = await SecureStore.getItemAsync(sendKey(room));
      const p = raw ? (JSON.parse(raw) as PendingSend) : null;
      return p && typeof p.eventId === 'string' && typeof p.text === 'string' ? p : null;
    } catch {
      return null;
    }
  },
  async set(room, p) {
    if (p) await SecureStore.setItemAsync(sendKey(room), JSON.stringify(p));
    else await SecureStore.deleteItemAsync(sendKey(room));
  },
};

/** The last room seq this phone has seen (for the Needs you badge). */
export async function getSeen(room: string): Promise<number> {
  const n = Number(await SecureStore.getItemAsync(seenKey(room)));
  return Number.isFinite(n) ? n : 0;
}
export async function setSeen(room: string, seq: number): Promise<void> {
  await SecureStore.setItemAsync(seenKey(room), String(seq));
}

/** Profile -> the name to show (Rename…), for rows and messages. */
export async function memberLabels(): Promise<(m: RoomMember | null, id: string) => string> {
  const names = new Map((await listBots()).map((b) => [b.bot, b.displayName]));
  return (m, id) => {
    const profile = m?.profile ?? id;
    return nameOf(profile, names.get(profile));
  };
}

const LIST_MS = 8000;
const TAIL = 30;

/**
 * Rooms for the bot list: on focus, then every 8 s while the app is in the front. Not paired, no driver or any
 * error means no rooms (the bot list must keep working without them).
 */
export function useRoomRows(): { rows: RoomRow[]; supported: boolean } {
  const [rows, setRows] = useState<RoomRow[]>([]);
  const [supported, setSupported] = useState(false);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const client = roomLink.client;
      const ok = await client.supported();
      setSupported(ok);
      if (!ok) return setRows([]);
      const [rooms, label] = await Promise.all([client.list(), memberLabels()]);
      const out: RoomRow[] = [];
      for (const room of rooms) {
        const { room: fresh, state } = await client.roomState(room.id);
        const latest = Math.max(state.latestSeq, fresh?.latestSeq ?? 0);
        const page = await client.log(room.id, Math.max(0, latest - TAIL), TAIL);
        out.push(summarizeRoom(fresh ?? room, page.events, state, await getSeen(room.id), label));
      }
      setRows(orderRows(out));
    } catch {
      // No Hermes, not paired or the gateway has no rooms: show none.
    } finally {
      busy.current = false;
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      const t = setInterval(() => AppState.currentState === 'active' && void refresh(), LIST_MS);
      return () => clearInterval(t);
    }, [refresh]),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void refresh());
    return () => sub.remove();
  }, [refresh]);
  return { rows, supported };
}
