import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useColumnStyle } from '@/components/Column';
import { isDesktop } from '@/components/desktop';
import { Group, GroupFootnote, GroupHeader, LEADING_INSET } from '@/components/Grouped';
import { Sheet } from '@/components/Sheet';
import { BotUsageRow, ProviderCard, Segmented } from '@/components/UsageParts';
import { useBotsUsage, useUsageSnapshot } from '@/components/useUsage';
import { colors } from '@/lib/theme';
import type { Days } from '@/lib/usage';

// Usage (card 25): the AI subscriptions (Hermes's account limits) and what each bot used. Everything comes
// from `hermes serve` (lib/usage.ts); nothing is stored here. Pull to refresh; refreshes itself every 60 s while open.
export default function UsageScreen() {
  const column = useColumnStyle();
  const [days, setDays] = useState<Days>(7);
  const { snapshot, error, refresh } = useUsageSnapshot();
  const bots = useBotsUsage(days);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => setNow(Date.now()), [snapshot]);

  const pull = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refresh(true), bots.refresh().catch(() => undefined)]);
    } finally {
      setRefreshing(false);
    }
  }, [refresh, bots]);

  const failed = Object.entries(bots.errors);
  return (
    <View style={styles.screen}>
      <Sheet title="Usage" />
      <ScrollView
        contentContainerStyle={[styles.body, column]}
        refreshControl={isDesktop ? undefined : <RefreshControl refreshing={refreshing} onRefresh={() => void pull()} tintColor={colors.dim} />}
      >
        {isDesktop ? (
          <Pressable onPress={() => void pull()} accessibilityRole="button" accessibilityLabel="Refresh usage" style={styles.refresh}>
            <Text style={styles.refreshText}>{refreshing ? 'Refreshing…' : 'Refresh'}</Text>
          </Pressable>
        ) : null}

        <GroupHeader>Subscriptions</GroupHeader>
        {error && !snapshot ? (
          <Text style={styles.error}>{error}</Text>
        ) : !snapshot ? (
          <ActivityIndicator color={colors.dim} style={styles.spinner} />
        ) : (
          <View style={styles.cards}>
            {snapshot.providers.map((p) => (
              <ProviderCard key={p.slug} p={p} now={now} />
            ))}
            {!snapshot.providers.length ? <Text style={styles.empty}>No AI providers are signed in on Hermes.</Text> : null}
          </View>
        )}
        {error && snapshot ? <Text style={styles.error}>Couldn't refresh: {error}</Text> : null}
        <GroupFootnote>Limits come from Hermes and can be a few minutes behind.</GroupFootnote>

        <GroupHeader>Bots</GroupHeader>
        <View style={styles.segmentWrap}>
          <Segmented value={days} onChange={setDays} />
        </View>
        {bots.usage === null ? (
          <ActivityIndicator color={colors.dim} style={styles.spinner} />
        ) : bots.usage.length ? (
          <Group inset={LEADING_INSET}>
            {bots.usage.map((u) => (
              <BotUsageRow key={u.bot} u={u} onPress={() => router.push({ pathname: '/usage/[bot]', params: { bot: u.bot, days: String(days) } })} />
            ))}
          </Group>
        ) : (
          <Text style={styles.empty}>No bots on this Hermes yet.</Text>
        )}
        {failed.map(([bot, message]) => (
          <Text key={bot} style={styles.error}>
            {bot}: {message}
          </Text>
        ))}
        <GroupFootnote>Costs are Hermes's estimates (what the tokens would cost), not a bill.</GroupFootnote>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { paddingHorizontal: 16, paddingBottom: 32 },
  cards: { gap: 12 },
  segmentWrap: { marginBottom: 12 },
  spinner: { marginVertical: 24 },
  empty: { color: colors.dim, fontSize: 15, lineHeight: 22, paddingVertical: 12 },
  error: { color: colors.bad, fontSize: 14, lineHeight: 20, marginTop: 8 },
  refresh: { alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  refreshText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
});
