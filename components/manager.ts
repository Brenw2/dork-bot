// Wires the HermesManager to the phone: expo/fetch, the Keychain-stored sign-in
// (refresh tokens are saved as they rotate) and random bot keys from expo-crypto.
import { getRandomBytes } from 'expo-crypto';
import { fetch } from '@/components/net';
import { getManagerAuth, saveManagerAuth } from '@/lib/bots';
import type { FetchLike } from '@/lib/hermes';
import { HermesManager } from '@/lib/manager';

export async function loadManager(): Promise<HermesManager | null> {
  const auth = await getManagerAuth();
  if (!auth) return null;
  return new HermesManager(auth, fetch as unknown as FetchLike, (refreshToken) => saveManagerAuth({ ...auth, refreshToken }));
}

/** A new API_SERVER_KEY: 32 random bytes as hex. */
export function randomKey(): string {
  return Array.from(getRandomBytes(32), (b) => b.toString(16).padStart(2, '0')).join('');
}
