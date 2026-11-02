// Saved bots. The list (names, addresses) and each bot's key are kept in the
// iOS Keychain through expo-secure-store; keys never leave the device.
import * as SecureStore from 'expo-secure-store';
import type { BotConnection } from './hermes';

export interface SavedBot {
  bot: string;
  url: string;
  addedAt: number;
}

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

export async function saveBot(conn: BotConnection): Promise<void> {
  await SecureStore.setItemAsync(keyName(conn.bot), conn.key);
  const bots = (await listBots()).filter((b) => b.bot !== conn.bot);
  bots.push({ bot: conn.bot, url: conn.url, addedAt: Date.now() });
  bots.sort((a, b) => a.bot.localeCompare(b.bot));
  await SecureStore.setItemAsync(INDEX, JSON.stringify(bots));
}

export async function removeBot(bot: string): Promise<void> {
  await SecureStore.deleteItemAsync(keyName(bot));
  const bots = (await listBots()).filter((b) => b.bot !== bot);
  await SecureStore.setItemAsync(INDEX, JSON.stringify(bots));
}
