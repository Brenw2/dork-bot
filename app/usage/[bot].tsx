import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/AppIcons';
import { BotAvatar } from '@/components/BotSprite';
import { useColumnStyle } from '@/components/Column';
import { isDesktop } from '@/components/desktop';
import { DailyChart, EmptyChart, ModelRow, Segmented, Tile } from '@/components/UsageParts';
import { useBotLook } from '@/components/useBotLook';
import { useBotName } from '@/components/useBotName';
import { useBotUsage, useDays, useUsageSnapshot } from '@/components/useUsage';
import { formatCost, formatCount, formatTokens, hasActivity } from '@/lib/usage';
import { makeStyles, useTheme } from '@/components/theme';

// One bot's usage (Fix 12): the same 7/30/90 control, six tiles, tokens per day with day selection, and by-model rows.
export default function BotUsageScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { bot } = useLocalSearchParams<{ bot: string }>();
  const column = useColumnStyle();
  const insets = useSafeAreaInsets();
  const name = useBotName(bot);
  const { color } = useBotLook(bot);
  const [days, setDays] = useDays();
  const { usage, error, refresh } = useBotUsage(bot, days);
  const { snapshot } = useUsageSnapshot();
  const [pulling, setPulling] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const pull = useCallback(async () => {
    setPulling(true);
    try {
      await refresh();
    } finally {
      setPulling(false);
    }
  }, [refresh]);
  const providers = snapshot?.providers ?? [];
  const active = usage ? hasActivity(usage) : false;

  return (
    <View style={[styles.screen, !isDesktop && { paddingTop: insets.top }]}>
      {!isDesktop ? (
        <View style={styles.nav}>
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/usage'))} accessibilityRole="button" accessibilityLabel="Back to Usage" style={styles.back}>
            <Icon name="back" size={31} color={color} stroke={2.6} />
            <Text style={[styles.backText, { color }]} maxFontSizeMultiplier={1.4}>
              Usage
            </Text>
          </Pressable>
          <View style={styles.who} accessible accessibilityLabel={`${name}, last ${days} days`}>
            <BotAvatar bot={bot} size={32} />
            <View>
              <Text style={styles.name} numberOfLines={1} maxFontSizeMultiplier={1.4}>
                {name}
              </Text>
              <Text style={styles.sub} maxFontSizeMultiplier={1.4}>
                Last {days} days
              </Text>
            </View>
          </View>
          <View style={styles.back} />
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={[styles.body, column]}
        refreshControl={isDesktop ? undefined : <RefreshControl refreshing={pulling} onRefresh={() => void pull()} tintColor={colors.dim} />}
      >
        <Segmented value={days} onChange={setDays} color={color} />
        {error && !usage ? <Text style={styles.error}>{error}</Text> : null}
        {usage ? (
          <>
            <View style={styles.tiles}>
              <Tile label="Input" value={formatTokens(usage.input)} />
              <Tile label="Output" value={formatTokens(usage.output)} />
              <Tile label="Cache" value={formatTokens(usage.cacheRead)} />
              <Tile label="API calls" value={formatCount(usage.apiCalls)} />
              <Tile label="Tool calls" value={formatCount(usage.toolCalls)} />
              <Tile label="Est. cost" value={formatCost(usage.cost)} />
            </View>
            <Text style={styles.header} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
              Tokens per day
            </Text>
            {active ? <DailyChart u={usage} color={color} now={now} /> : <EmptyChart days={days} />}
            {active && usage.models.length ? (
              <>
                <Text style={styles.header} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
                  By model
                </Text>
                <View style={styles.list}>
                  {usage.models.map((m, i) => (
                    <View key={m.model}>
                      {i > 0 ? <View style={styles.sep} /> : null}
                      <ModelRow m={m} u={usage} providers={providers} color={color} />
                    </View>
                  ))}
                </View>
              </>
            ) : null}
            <Text style={styles.footnote}>Tokens are input plus output. Cache is counted on its own. Costs are Hermes estimates.</Text>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 52, paddingHorizontal: 12 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44, minWidth: 80 },
  backText: { fontSize: 17 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { color: colors.text, fontSize: 16, lineHeight: 20, fontWeight: '600' },
  sub: { color: colors.dim, fontSize: 12, lineHeight: 16 },
  body: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },
  error: { color: colors.bad, fontSize: 14, lineHeight: 20, marginTop: 12 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  header: { color: colors.dim, fontSize: 13, lineHeight: 18, letterSpacing: 0.3, textTransform: 'uppercase', marginLeft: 16, marginTop: 18, marginBottom: 7 },
  list: { backgroundColor: colors.card, borderRadius: 12, overflow: 'hidden' },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 16 },
  footnote: { color: colors.dim, fontSize: 13, lineHeight: 18, marginHorizontal: 16, marginTop: 12 },
}));
