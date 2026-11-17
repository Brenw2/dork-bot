import { useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useColumnStyle } from '@/components/Column';
import { isDesktop } from '@/components/desktop';
import { Group, GroupFootnote, GroupHeader } from '@/components/Grouped';
import { Sheet } from '@/components/Sheet';
import { DailyChart, Segmented, Stat } from '@/components/UsageParts';
import { useBotUsage } from '@/components/useUsage';
import { colors } from '@/lib/theme';
import { formatCost, formatTokens, type Days } from '@/lib/usage';

// One bot's usage: totals, the daily chart and the by-model breakdown (card 25).
export default function BotUsageScreen() {
  const { bot, days: daysParam } = useLocalSearchParams<{ bot: string; days?: string }>();
  const column = useColumnStyle();
  const [days, setDays] = useState<Days>(daysParam === '30' ? 30 : daysParam === '90' ? 90 : 7);
  const { usage, error, refresh } = useBotUsage(bot, days);
  const [refreshing, setRefreshing] = useState(false);
  const pull = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  return (
    <View style={styles.screen}>
      <Sheet title="Usage" bot={bot} />
      <ScrollView
        contentContainerStyle={[styles.body, column]}
        refreshControl={isDesktop ? undefined : <RefreshControl refreshing={refreshing} onRefresh={() => void pull()} tintColor={colors.dim} />}
      >
        <Segmented value={days} onChange={setDays} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!usage && !error ? <ActivityIndicator color={colors.dim} style={styles.spinner} /> : null}
        {usage ? (
          <>
            <View style={styles.stats}>
              <Stat label="Tokens in" value={formatTokens(usage.input)} />
              <Stat label="Tokens out" value={formatTokens(usage.output)} />
              <Stat label="API calls" value={String(usage.apiCalls)} />
              <Stat label="Est. cost" value={formatCost(usage.cost)} />
            </View>
            <GroupHeader>Daily tokens</GroupHeader>
            <View style={styles.card}>
              <DailyChart u={usage} />
            </View>
            <GroupHeader>By model</GroupHeader>
            {usage.models.length ? (
              <Group>
                {usage.models.map((m) => (
                  <View key={m.model} style={styles.modelRow} accessible accessibilityLabel={`${m.model}, ${formatTokens(m.input)} in, ${formatTokens(m.output)} out, ${m.apiCalls} calls, ${formatCost(m.cost)}`}>
                    <View style={styles.modelTop}>
                      <Text style={styles.model} numberOfLines={1} maxFontSizeMultiplier={1.4}>
                        {m.model}
                      </Text>
                      <Text style={styles.cost} maxFontSizeMultiplier={1.4}>
                        {formatCost(m.cost)}
                      </Text>
                    </View>
                    <Text style={styles.line} numberOfLines={1} maxFontSizeMultiplier={1.4}>
                      {formatTokens(m.input)} in · {formatTokens(m.output)} out · {m.apiCalls} calls
                    </Text>
                  </View>
                ))}
              </Group>
            ) : (
              <Text style={styles.line}>No model activity in the last {days} days.</Text>
            )}
            <GroupFootnote>Costs are Hermes's estimates (what the tokens would cost), not a bill.</GroupFootnote>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },
  spinner: { marginVertical: 24 },
  error: { color: colors.bad, fontSize: 14, lineHeight: 20, marginTop: 12 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14, backgroundColor: colors.card, borderRadius: 12, padding: 16, marginTop: 14 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 16 },
  modelRow: { paddingHorizontal: 16, paddingVertical: 10, gap: 2 },
  modelTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  model: { flexShrink: 1, color: colors.text, fontSize: 16, lineHeight: 22 },
  cost: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '600' },
  line: { color: colors.dim, fontSize: 13, lineHeight: 18 },
});
