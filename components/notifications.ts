// Push notifications on the phone (expo-notifications), wired to lib/push.ts:
// - Turning them on is always Brennan's tap (the Notifications screen), never on launch: it asks
//   iOS, gets this phone's Expo push token, and adds it to every bot's dork_bot.push block on
//   Hermes. Sync (components/sync.ts) adds it to bots made later.
// - A tap opens that bot's chat (or Routines); a reply for the chat on screen shows no banner.
// The web build (desktop app, layout tests) gets notifications.web.ts, where all of this is off.
import Constants from 'expo-constants';
import { router, useIsFocused } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { currentChat } from '@/components/currentChat';
import { loadManager } from '@/components/manager';
import { syncNow } from '@/components/sync';
import { useLayoutClass } from '@/components/useLayoutClass';
import { getPushToken, listBots, savePushToken } from '@/lib/bots';
import type { HermesManager } from '@/lib/manager';
import { parsePushData, routeFor, setTokenOnBots, showWhileOpen, type OnScreen } from '@/lib/push';
import { sameHost } from '@/lib/sync';

export const notificationsSupported = true;
export { getPushToken };

export type TurnOnResult = { ok: true; errors: Record<string, string> } | { ok: false; reason: string };

/** Adds (on) or takes out (off) this phone's token on every bot on this Hermes. */
async function setTokenEverywhere(manager: HermesManager, token: string, on: boolean): Promise<Record<string, string>> {
  const bots = (await listBots()).filter((b) => sameHost(b.url, manager.chatUrl)).map((b) => b.bot);
  const { errors } = await setTokenOnBots(
    { getPush: async (bot) => (await manager.getMeta(bot)).push, setPush: (bot, push) => manager.setMeta(bot, { push }) },
    bots,
    token,
    on,
  );
  return errors;
}

/** Asks iOS (its prompt shows once; after a No it's Settings → Dork Bot), then registers this phone. */
export async function turnOnNotifications(): Promise<TurnOnResult> {
  const manager = await loadManager();
  if (!manager) return { ok: false, reason: 'Connect to Hermes first: run scripts/pair-hermes.sh on b-lab and scan the code.' };
  const asked = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
  if (!asked.granted) return { ok: false, reason: 'Notifications are off for Dork Bot. Turn them on in Settings → Dork Bot → Notifications.' };
  const projectId = (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId;
  let token: string;
  try {
    token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch (e) {
    // A build without the Push capability gets no device token from iOS.
    return { ok: false, reason: `iOS gave no push token: ${(e as Error).message}` };
  }
  await savePushToken(token);
  const errors = await setTokenEverywhere(manager, token, true);
  void syncNow(true);
  return { ok: true, errors };
}

/** Takes this phone's token off every bot. Other phones keep theirs. */
export async function turnOffNotifications(): Promise<Record<string, string>> {
  const token = await getPushToken();
  await savePushToken(null);
  const manager = await loadManager();
  return token && manager ? setTokenEverywhere(manager, token, false) : {};
}

// The chat on screen, for the banner decision. ChatView reports its bot while its screen is focused.
let onScreenBot: string | null = null;

export function useOnScreen(bot: string): void {
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) return;
    onScreenBot = bot;
    return () => {
      if (onScreenBot === bot) onScreenBot = null;
    };
  }, [bot, focused]);
}

function onScreen(): OnScreen | null {
  return onScreenBot ? { bot: onScreenBot, chat: currentChat(onScreenBot) } : null;
}

Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    const show = showWhileOpen(parsePushData(n.request.content.data), onScreen());
    return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
  },
});

/** Opens what a tapped notification is about. Mounted once in the root layout. */
export function NotificationRoutes(): null {
  const twoPane = useLayoutClass() === 'expanded-wide';
  const handled = useRef(new Set<string>());
  useEffect(() => {
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const id = response.notification.request.identifier;
      if (handled.current.has(id)) return;
      handled.current.add(id);
      const data = parsePushData(response.notification.request.content.data);
      if (!data) return;
      const route = routeFor(data, twoPane);
      if (route.pathname === '/') router.navigate(route);
      else router.push(route);
    };
    // A tap that launched the app, then taps while it runs.
    open(Notifications.getLastNotificationResponse());
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [twoPane]);
  return null;
}
