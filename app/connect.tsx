import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { fetch } from 'expo/fetch';
import { Column } from '@/components/Column';
import { saveManagerAuth } from '@/lib/bots';
import type { FetchLike } from '@/lib/hermes';
import { HermesManager } from '@/lib/manager';
import { managerFromParams } from '@/lib/pairing';
import { button, colors } from '@/lib/theme';

// Opened by a dorkbot://connect?admin=…&chat=…&rt=… code from scripts/pair-hermes.sh.
export default function Connect() {
  const params = useLocalSearchParams();
  const link = managerFromParams(params);
  const [state, setState] = useState<'checking' | 'ok' | string>('checking');

  useEffect(() => {
    if (!link) return setState('This code is missing something. Run scripts/pair-hermes.sh again.');
    let auth = { adminUrl: link.adminUrl, chatUrl: link.chatUrl, refreshToken: link.refreshToken };
    const manager = new HermesManager(auth, fetch as unknown as FetchLike, (rt) => {
      auth = { ...auth, refreshToken: rt };
    });
    manager
      .listProfiles()
      .then(() => saveManagerAuth(auth))
      .then(() => setState('ok'))
      .catch((e: Error) => setState(e.message));
    // Only on first open: the link doesn't change.
  }, []);

  return (
    <View style={styles.page}>
      <Column style={styles.screen}>
        {state === 'checking' ? (
          <>
            <ActivityIndicator color={colors.text} />
            <Text style={styles.text}>Signing in to Hermes…</Text>
          </>
        ) : state === 'ok' ? (
          <>
            <Text style={styles.title}>Connected to Hermes</Text>
            <Text style={styles.text}>You can create bots from the app now.</Text>
            <Pressable style={styles.button} onPress={() => router.replace('/new')} accessibilityRole="button">
              <Text style={styles.buttonText}>Create a bot</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.title}>Couldn't connect</Text>
            <Text style={styles.error}>{state}</Text>
            <Pressable style={styles.button} onPress={() => router.dismissTo('/')} accessibilityRole="button">
              <Text style={styles.buttonText}>Close</Text>
            </Pressable>
          </>
        )}
      </Column>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 },
  title: { color: colors.text, fontSize: 20, fontWeight: '600' },
  text: { color: colors.dim, fontSize: 15, textAlign: 'center' },
  error: { color: colors.bad, fontSize: 15, textAlign: 'center' },
  button: { ...button.primary, marginTop: 10, paddingHorizontal: 28 },
  buttonText: button.text,
});
