// Saved bots. The list (names, addresses) and each bot's key are kept in the
// iOS Keychain through expo-secure-store; keys never leave the device.
import * as SecureStore from './secureStore';
import type { BotConnection } from './hermes';
import type { ManagerAuth } from './manager';
import type { Look } from './sprites';

export interface SavedBot {
  bot: string;
  url: string;
  addedAt: number;
  /** Picked character, look and color; unset means the defaults from the name. */
  look?: Look;
}

// Screens showing a bot's character re-read the list when it changes.
const changeListeners = new Set<() => void>();
export function onBotsChanged(fn: () => void): () => void {
  changeListeners.add(fn);
  return () => void changeListeners.delete(fn);
}
const changed = () => changeListeners.forEach((fn) => fn());

const INDEX = 'dork-bots';
const keyName = (bot: string) => `dork-bot-key.${bot}`;

export async function listBots(): Promise<SavedBot[]> {
  const raw = await SecureStore.getItemAsync(INDEX);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as SavedBot[];
  } catch {
    return [];
  }
}

export async function getConnection(bot: string): Promise<BotConnection | null> {
  const saved = (await listBots()).find((b) => b.bot === bot);
  const key = await SecureStore.getItemAsync(keyName(bot));
  return saved && key ? { url: saved.url, bot, key } : null;
}

export async function saveBot(conn: BotConnection, look?: Look): Promise<void> {
  await SecureStore.setItemAsync(keyName(conn.bot), conn.key);
  const all = await listBots();
  const old = all.find((b) => b.bot === conn.bot);
  const bots = all.filter((b) => b.bot !== conn.bot);
  bots.push({ bot: conn.bot, url: conn.url, addedAt: Date.now(), look: look ?? old?.look });
  bots.sort((a, b) => a.bot.localeCompare(b.bot));
  await SecureStore.setItemAsync(INDEX, JSON.stringify(bots));
  changed();
}

export async function setLook(bot: string, look: Look): Promise<void> {
  const bots = (await listBots()).map((b) => (b.bot === bot ? { ...b, look } : b));
  await SecureStore.setItemAsync(INDEX, JSON.stringify(bots));
  changed();
}

export async function removeBot(bot: string): Promise<void> {
  await SecureStore.deleteItemAsync(keyName(bot));
  const bots = (await listBots()).filter((b) => b.bot !== bot);
  await SecureStore.setItemAsync(INDEX, JSON.stringify(bots));
  changed();
}

// The Hermes sign-in (from scripts/pair-hermes.sh) that lets the app create bots.
const MANAGER = 'dork-hermes-manager';

export async function getManagerAuth(): Promise<ManagerAuth | null> {
  const raw = await SecureStore.getItemAsync(MANAGER);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ManagerAuth;
  } catch {
    return null;
  }
}

export async function saveManagerAuth(auth: ManagerAuth): Promise<void> {
  await SecureStore.setItemAsync(MANAGER, JSON.stringify(auth));
}

export async function forgetManagerAuth(): Promise<void> {
  await SecureStore.deleteItemAsync(MANAGER);
}
