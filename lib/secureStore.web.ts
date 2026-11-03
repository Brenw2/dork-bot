// Web stand-in for expo-secure-store (which does nothing on web). Only the
// layout tests run the web build, and they seed this from Playwright, so
// localStorage is fine here. Never ship real keys through the web build.
const PREFIX = 'dorkbot.';

export async function getItemAsync(key: string): Promise<string | null> {
  return globalThis.localStorage?.getItem(PREFIX + key) ?? null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  globalThis.localStorage?.setItem(PREFIX + key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  globalThis.localStorage?.removeItem(PREFIX + key);
}
