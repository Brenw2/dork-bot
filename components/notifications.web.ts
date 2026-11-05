// The web build (desktop app, layout tests): no push notifications. Same exports as notifications.ts.
import type { TurnOnResult } from './notifications';

export const notificationsSupported = false;

export async function getPushToken(): Promise<string | null> {
  return null;
}

export async function turnOnNotifications(): Promise<TurnOnResult> {
  return { ok: false, reason: 'Notifications go to the iPhone app.' };
}

export async function turnOffNotifications(): Promise<Record<string, string>> {
  return {};
}

export function useOnScreen(_bot: string): void {}

export function NotificationRoutes(): null {
  return null;
}
