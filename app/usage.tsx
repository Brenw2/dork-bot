import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, type NativeScrollEvent, type NativeSyntheticEvent, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/AppIcons';
import { useColumnStyle } from '@/components/Column';
import { isDesktop } from '@/components/desktop';
import { BotUsageRow, FailBanner, ProviderCard, Segmented, SkeletonBotRows, SkeletonCard, TotalsCard, Unreachable, UpdatedLine } from '@/components/UsageParts';
import { useBotsUsage, useDays, useUsageSnapshot } from '@/components/useUsage';
import { clockLabel, dueResets, hasActivity, localTokens, sortBots, updatedLine } from '@/lib/usage';
import { makeStyles, useTheme } from '@/components/theme';

const Header = ({ children }: { children: string }) => {
const styles = useStyles();
return (
  <Text style={styles.header} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
    {children}
  </Text>
);
};

// Usage (card 25, docs/design/REVIEW.md Fix 12): the AI subscriptions (Hermes's account limits), then what each bot
// used. Everything comes from `hermes serve` (lib/usage.ts); nothing is stored. Refreshes once on open, on pull (↻ on
// desktop), on returning to the app after 5 minutes, and once for each window that shows "Reset due". No timer.
export default function UsageScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const column = useColumnStyle();
  const insets = useSafeAreaInsets();
  const [days, setDays] = useDays();
  const { snapshot, loading, error, refresh } = useUsageSnapshot();
  const bots = useBotsUsage(days);
  const [pulling, setPulling] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000); // the countdowns and the Updated line, no refetch
    return () => clearInterval(id);
  }, []);
  useEffect(() => setNow(Date.now()), [snapshot]);
  // "Reset due": refetch once for each window whose reset has passed (the clock tick above only re-renders).
  const refetched = useRef(new Set<string>());
  const lastDue = useRef(0);
  useEffect(() => {
    if (!snapshot) return;
    const fresh = dueResets(snapshot.providers, now).filter((k) => !refetched.current.has(k));
    if (!fresh.length || now - lastDue.current < 30_000) return; // never more than one due-refetch per 30 s
    lastDue.current = now;
    fresh.forEach((k) => refetched.current.add(k));
    void refresh(true);
  }, [snapshot, now, refresh]);
  // The nav row stays put; the large title collapses into it once scrolled (Fix 12, 25-usage-scrolled--iphone).
  const [scrolled, setScrolled] = useState(false);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setScrolled(e.nativeEvent.contentOffset.y > 40);

  const all = useCallback(async () => {
    await Promise.all([refresh(true), bots.refresh().catch(() => undefined)]);
  }, [refresh, bots]);
  const pull = useCallback(async () => {
    setPulling(true);
    try {
      await all();
    } finally {
      setPulling(false);
    }
  }, [all]);

  const unreachable = !snapshot && !!error && (bots.unreachable || bots.usage === null);
  const sorted = bots.usage ? sortBots(bots.usage) : null;
  const quiet = sorted !== null && sorted.length > 0 && !sorted.some(hasActivity);
  const since = snapshot ? clockLabel(snapshot.fetchedAt, now) : '';
  const providers = snapshot?.providers ?? [];

  return (
    <View style={[styles.screen, !isDesktop && { paddingTop: insets.top }]}>
      {!isDesktop ? (
        <View style={[styles.nav, scrolled && styles.navScrolled]}>
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} accessibilityRole="button" accessibilityLabel="Back to Bots" style={styles.back}>
            <Icon name="back" size={31} color={colors.accent} stroke={2.6} />
            <Text style={styles.backText} maxFontSizeMultiplier={1.4}>
              Bots
            </Text>
          </Pressable>
          {scrolled ? (
            <Text style={styles.navTitle} accessibilityRole="header" maxFontSizeMultiplier={1.4} pointerEvents="none">
              Usage
            </Text>
          ) : null}
        </View>
      ) : null}
      <ScrollView
        onScroll={onScroll}
        scrollEventThrottle={32}
        contentContainerStyle={[styles.body, column]}
        refreshControl={isDesktop ? undefined : <RefreshControl refreshing={pulling} onRefresh={() => void pull()} tintColor={colors.dim} />}
      >
        {isDesktop ? (
          <View style={styles.desktopBar}>
            <UpdatedLine text={snapshot ? updatedLine(snapshot.fetchedAt, now) : null} loading={loading} failed={!!error} onRetry={() => void all()} />
            <Pressable onPress={() => void pull()} accessibilityRole="button" accessibilityLabel="Refresh usage" style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.refresh, hovered && { backgroundColor: colors.raised }]}>
              <Text style={styles.refreshText}>↻</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={[styles.title, scrolled && { opacity: 0 }]} accessibilityRole={scrolled ? undefined : 'header'} maxFontSizeMultiplier={1.4}>
              Usage
            </Text>
            <View style={styles.updatedWrap}>
              <UpdatedLine text={snapshot ? updatedLine(snapshot.fetchedAt, now) : null} loading={loading} failed={!!error} onRetry={() => void all()} />
            </View>
          </>
        )}

        {unreachable ? (
          <Unreachable onRetry={() => void all()} />
        ) : (
          <>
            {error && snapshot ? <FailBanner since={since} onRetry={() => void all()} /> : null}

            <Header>Subscriptions</Header>
            <View style={styles.cards}>
              {!snapshot ? (
                <SkeletonCard />
              ) : providers.length ? (
                providers.map((p) => <ProviderCard key={p.slug} p={p} now={now} days={days} localTokens={bots.usage ? localTokens(p, bots.usage) : null} />)
              ) : (
                <View style={styles.plain}>
                  <Text style={styles.plainText}>No subscriptions found in Hermes</Text>
                </View>
              )}
            </View>

            <Header>Bots</Header>
            <Segmented value={days} onChange={setDays} />
            {sorted === null ? (
              <View style={styles.gap}>
                <SkeletonBotRows />
              </View>
            ) : (
              <View style={styles.gap}>
                {sorted.length ? <TotalsCard bots={sorted} /> : null}
                {quiet ? (
                  <View style={styles.plain}>
                    <Text style={styles.plainText}>No bot activity in the last {days} days</Text>
                  </View>
                ) : null}
                {sorted.length ? (
                  <View style={styles.list}>
                    {sorted.map((u, i) => (
                      <View key={u.bot}>
                        {i > 0 ? <View style={styles.sep} /> : null}
                        <BotUsageRow
                          u={u}
                          hidden={!!bots.hidden[u.bot]}
                          providers={providers}
                          onPress={() => router.push({ pathname: '/usage/[bot]', params: { bot: u.bot } })}
                        />
                      </View>
                    ))}
                  </View>
                ) : (
                  <View style={styles.plain}>
                    <Text style={styles.plainText}>No bots on this Hermes yet.</Text>
                  </View>
                )}
                {Object.entries(bots.errors).map(([bot, message]) => (
                  <Text key={bot} style={styles.error}>
                    Couldn't read {bot}'s usage: {message}
                  </Text>
                ))}
              </View>
            )}
            <Text style={styles.footnote}>Tokens are input plus output. Cache is counted on its own. Costs are Hermes estimates.</Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { paddingHorizontal: 16, paddingBottom: 40 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'transparent' },
  navScrolled: { borderBottomColor: colors.border },
  navTitle: { color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '600' },
  back: { position: 'absolute', top: 0, left: 8, flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44 },
  backText: { color: colors.accent, fontSize: 17 },
  title: { color: colors.text, fontSize: 34, lineHeight: 41, fontWeight: '700' },
  updatedWrap: { marginTop: 4, marginBottom: 4 },
  desktopBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  refresh: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  refreshText: { color: colors.accent, fontSize: 18 },
  header: { color: colors.dim, fontSize: 13, lineHeight: 18, letterSpacing: 0.3, textTransform: 'uppercase', marginLeft: 16, marginTop: 18, marginBottom: 7 },
  cards: { gap: 12 },
  gap: { gap: 12, marginTop: 12 },
  list: { backgroundColor: colors.card, borderRadius: 12, overflow: 'hidden' },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 68 },
  plain: { backgroundColor: colors.card, borderRadius: 12, padding: 16 },
  plainText: { color: colors.dim, fontSize: 15, lineHeight: 20 },
  error: { color: colors.bad, fontSize: 13, lineHeight: 18 },
  footnote: { color: colors.dim, fontSize: 13, lineHeight: 18, marginHorizontal: 16, marginTop: 12 },
}));
