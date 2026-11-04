// Web stand-in for expo-secure-store (which does nothing on web).
// - The desktop app: its main process keeps each value encrypted with the system keyring
//   (Electron safeStorage) in a file only this user can read.
// - A plain browser (the layout tests seed this from Playwright): localStorage. Never ship real
//   keys through a plain browser.
import { desktop } from '@/components/desktop';

const PREFIX = 'dorkbot.';

export async function getItemAsync(key: string): Promise<string | null> {
  if (desktop) return desktop.storeGet(key);
  return globalThis.localStorage?.getItem(PREFIX + key) ?? null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  if (desktop) return desktop.storeSet(key, value);
  globalThis.localStorage?.setItem(PREFIX + key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  if (desktop) return desktop.storeDelete(key);
  globalThis.localStorage?.removeItem(PREFIX + key);
}
