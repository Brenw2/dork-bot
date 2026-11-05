import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, RefreshControl, ScrollView, type ScrollViewInstance, StyleSheet, Text, View } from 'react-native';
import { useColumnStyle } from '@/components/Column';
import { isDesktop } from '@/components/desktop';
import { Markdown } from '@/components/Markdown';
import { useBotName } from '@/components/useBotName';
import { fetch } from '@/components/net';
import { useBotLook } from '@/components/useBotLook';
import { getConnection } from '@/lib/bots';
import { HermesClient, type FetchLike } from '@/lib/hermes';
import { RoutineResults, type RoutineResult } from '@/lib/routineResults';
import { whenLabel } from '@/lib/routines';
import { colors, mix } from '@/lib/theme';

// A bot's Routine results: every routine run's full output, newest at the bottom, each labeled with
// the routine's name and when it ran. Separate from the bot's normal chats; read-only.
export default function RoutineResultsScreen() {
  const { bot } = useLocalSearchParams<{ bot: string }>();
  const botName = useBotName(bot);
  const column = useColumnStyle();
  const { color } = useBotLook(bot);
  const [api, setApi] = useState<RoutineResults | null>(null);
  const [results, setResults] = useState<RoutineResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const scroller = useRef<ScrollViewInstance>(null);

  const load = useCallback(async (r: RoutineResults) => {
    try {
      setResults(await r.load());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void getConnection(bot).then((conn) => {
      if (!conn) return setError(`No saved key for ${bot}.`);
      const r = new RoutineResults(new HermesClient(conn, fetch as unknown as FetchLike));
      setApi(r);
      void load(r);
    });
  }, [bot, load]);

  // A result that landed while the app was in the background shows when it comes back.
  useEffect(() => {
    if (!api) return;
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void load(api));
    return () => sub.remove();
  }, [api, load]);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: `${botName}'s routine results` }} />
      <ScrollView
        ref={scroller}
        contentContainerStyle={[styles.body, column]}
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
        refreshControl={
          isDesktop || !api ? undefined : (
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(api).finally(() => setRefreshing(false)); }} tintColor={colors.dim} />
          )
        }
      >
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {results === null && !error ? <ActivityIndicator style={{ marginTop: 30 }} /> : null}
        {results?.length === 0 ? <Text style={styles.empty}>No routine results yet. When a routine of {botName} finishes with something to say, it shows up here.</Text> : null}
        {results?.map((r) => (
          <View key={r.sessionId} style={[styles.entry, { borderColor: mix(color, 0.5) }]}>
            <View style={styles.head}>
              <Text style={[styles.name, { color }]} numberOfLines={1}>{r.name}</Text>
              <Text style={styles.when}>{whenLabel(new Date(r.at * 1000).toISOString())}</Text>
            </View>
            <Markdown text={r.text} accent={color} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, gap: 12 },
  entry: { padding: 14, gap: 8, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1 },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  name: { flex: 1, fontSize: 15, fontWeight: '600' },
  when: { color: colors.dim, fontSize: 13 },
  empty: { color: colors.dim, fontSize: 15, textAlign: 'center', marginTop: 30, lineHeight: 22 },
  error: { color: colors.bad, fontSize: 14 },
});
