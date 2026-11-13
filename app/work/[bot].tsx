import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useState } from 'react';
import { useColumnStyle } from '@/components/Column';
import { isDesktop } from '@/components/desktop';
import { useBotLook } from '@/components/useBotLook';
import { Sheet } from '@/components/Sheet';
import { useBotName } from '@/components/useBotName';
import { useWork } from '@/components/workWatch';
import { whenLabel } from '@/lib/routines';
import { colors } from '@/lib/theme';
import { statusLabel, type WorkItem } from '@/lib/work';

// A bot's Work: what it does that the app didn't start (terminal runs, other bots, other apps),
// newest first, live while this screen is up. Tap one to read it. Routines have Routine results.
export default function WorkScreen() {
  const { bot } = useLocalSearchParams<{ bot: string }>();
  const botName = useBotName(bot);
  const column = useColumnStyle();
  const { color } = useBotLook(bot);
  const { items, error, reload } = useWork(bot);
  const [refreshing, setRefreshing] = useState(false);

  return (
    <View style={styles.screen}>
      <Sheet title="Work" bot={bot} />
      <View style={[styles.fill, column]}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {items === null && !error ? <ActivityIndicator style={{ marginTop: 30 }} /> : null}
        <FlatList
          data={items ?? []}
          keyExtractor={(w) => w.id}
          contentContainerStyle={styles.list}
          refreshControl={
            isDesktop ? undefined : <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void reload().finally(() => setRefreshing(false)); }} tintColor={colors.dim} />
          }
          ListEmptyComponent={items ? <Text style={styles.empty}>Nothing yet. When {botName} works on something that wasn't started in the app, it shows up here.</Text> : undefined}
          renderItem={({ item }) => <WorkRow item={item} bot={bot} color={color} />}
        />
      </View>
    </View>
  );
}

function WorkRow({ item, bot, color }: { item: WorkItem; bot: string; color: string }) {
  const when = whenLabel(new Date(item.startedAt * 1000).toISOString());
  const meta = [item.startedBy, when].filter(Boolean).join(' · ');
  const tone = item.status === 'working' ? color : item.status === 'failed' ? colors.bad : colors.dim;
  const label = statusLabel(item.status);
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: '#22252A' }]}
      onPress={() => router.push({ pathname: '/work-session/[bot]', params: { bot, id: item.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${label}${item.startedBy ? `, started by ${item.startedBy}` : ''}, ${when}`}
      accessibilityHint="Opens this work to read"
    >
      <View style={styles.line}>
        <Text style={styles.name} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={[styles.status, { color: tone }]}>{label}</Text>
      </View>
      {item.outcome ? (
        <Text style={styles.outcome} numberOfLines={2}>
          {item.outcome}
        </Text>
      ) : null}
      <Text style={styles.meta} numberOfLines={1}>
        {meta}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  list: { padding: 16, gap: 8 },
  row: { padding: 14, gap: 4, minHeight: 76, borderRadius: 12, backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  line: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  name: { flex: 1, color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '600' },
  status: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  outcome: { color: colors.dim, fontSize: 15, lineHeight: 20 },
  meta: { color: colors.dim, fontSize: 13, lineHeight: 18 },
  empty: { color: colors.dim, fontSize: 15, textAlign: 'center', marginTop: 30, lineHeight: 22, paddingHorizontal: 16 },
  error: { color: colors.bad, fontSize: 14, paddingHorizontal: 16, paddingTop: 10 },
});
