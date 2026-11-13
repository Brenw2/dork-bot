// The bot list, like Messages (docs/design/REVIEW.md, fix 1): full-bleed rows with an avatar, the newest
// message, when it was, and what the bot is doing or what's wrong. Recent activity first; a bot that
// needs your OK goes to the top. Phone and folded Duo: a large title. Desktop and the open Duo in
// landscape (`compact`): the sidebar, with its own header.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Alert, Menu } from '@/components/alert';
import { BotAvatar } from '@/components/BotSprite';
import { openBotSheet } from '@/components/ChatHeader';
import { useBusyWatch } from '@/components/busyWatch';
import { isDesktop } from '@/components/desktop';
import { Icon } from '@/components/AppIcons';
import { liveRuns } from '@/components/liveRuns';
import { fetch } from '@/components/net';
import { syncNow } from '@/components/sync';
import { useBotMood } from '@/components/useBotMood';
import { getConnection, listBots, onBotsChanged, type SavedBot } from '@/lib/bots';
import { connectError, doingLine, errorLine, latestPreview, rowTime, sortRows, type BotPreview, type ConnectState } from '@/lib/botList';
import { HermesClient, type FetchLike } from '@/lib/hermes';
import { nameOf } from '@/lib/names';
import { colors, mix } from '@/lib/theme';

const REFRESH_MS = 15_000;
// The last thing seen for each bot survives leaving and coming back to the list, so rows don't flash empty.
const previewCache = new Map<string, BotPreview>();

/** Re-renders when any bot starts or stops waiting for an OK. */
function useApprovalTick(): number {
  const [n, setN] = useState(0);
  useEffect(() => liveRuns.onApprovals(() => setN((v) => v + 1)), []);
  return n;
}


/**
 * The saved bots. onSelect opens a chat (pushes a screen on phones, fills the chat pane in two panes).
 * compact: the sidebar next to a chat (desktop and the open Duo in landscape).
 */
export function BotList({ onSelect, selected, compact = false }: { onSelect: (bot: string) => void; selected?: string | null; compact?: boolean }) {
  const [bots, setBots] = useState<SavedBot[] | null>(null);
  const [status, setStatus] = useState<Record<string, ConnectState>>({});
  const [previews, setPreviews] = useState<Record<string, BotPreview>>(() => Object.fromEntries(previewCache));
  useBusyWatch();
  const approvals = useApprovalTick();
  const insets = useSafeAreaInsets();

  const load = useCallback(() => {
    let live = true;
    const check = async (list: SavedBot[]) => {
      await Promise.all(
        list.map(async (b) => {
          const conn = await getConnection(b.bot);
          if (!conn) return;
          const client = new HermesClient(conn, fetch as unknown as FetchLike);
          try {
            await client.check();
            if (live) setStatus((s) => ({ ...s, [b.bot]: 'ok' }));
          } catch (e) {
            if (live) setStatus((s) => ({ ...s, [b.bot]: connectError((e as { status?: number }).status, (e as Error).message) }));
            return; // keep the last preview
          }
          try {
            const p = await latestPreview(client);
            previewCache.set(b.bot, p);
            if (live) setPreviews((cur) => ({ ...cur, [b.bot]: p }));
          } catch {
            // keep the last preview
          }
        }),
      );
    };
    const show = () =>
      listBots().then(async (list) => {
        if (!live) return;
        setBots(list);
        setStatus((s) => Object.fromEntries(list.map((b) => [b.bot, s[b.bot] ?? 'checking'])));
        await check(list);
      });
    // Show what's on this device right away, then again if Hermes says the list changed
    // (a bot made, deleted or hidden on another device). Sync saves through lib/bots, which fires onBotsChanged.
    const off = onBotsChanged(() => void show());
    show().then(() => syncNow());
    const id = setInterval(() => void listBots().then((list) => (live ? check(list) : undefined)), REFRESH_MS);
    return () => {
      live = false;
      off();
      clearInterval(id);
    };
  }, []);
  useFocusEffect(load);

  // `approvals` is a dependency so the order follows a bot starting or stopping needing an OK.
  const rows = useMemo(
    () => sortRows((bots ?? []).map((saved) => ({ bot: saved.bot, saved, needsYou: !!liveRuns.needsYou(saved.bot), at: previews[saved.bot]?.at ?? null }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bots, previews, approvals],
  );

  const appMenu = (anchor?: { x: number; y: number }) =>
    Menu.show(
      'Dork Bot',
      [
        { text: 'Notifications…', onPress: () => router.push('/notifications') },
        { text: 'Add with a code…', onPress: () => router.push('/add') },
        { text: 'Show hidden bots', onPress: () => router.push('/new') },
        { text: 'Cancel', style: 'cancel' },
      ],
      anchor,
    );

  const header = <ListHeader compact={compact} top={insets.top} onMenu={appMenu} />;
  if (bots === null) return <View style={styles.screen}>{header}</View>;

  const open = (b: SavedBot) => {
    const s = status[b.bot];
    if (typeof s === 'object' && s.error === 'key') return router.push('/add');
    if (typeof s === 'object' && s.error === 'other') return Alert.alert("Can't connect", s.detail);
    onSelect(b.bot);
  };

  return (
    <View style={styles.screen}>
      {header}
      <FlatList
        data={rows}
        keyExtractor={(r) => r.bot}
        contentContainerStyle={rows.length ? (compact ? styles.listCompact : styles.list) : styles.empty}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <View style={styles.emptyDisc}>
              <Icon name="compose" size={26} color={colors.accent} />
            </View>
            <Text style={styles.emptyTitle}>No bots yet</Text>
            <Text style={styles.emptyText}>Tap New bot to make one, or to add a bot that's already on Hermes.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <BotRow saved={item.saved} compact={compact} selected={item.bot === selected} state={status[item.bot]} preview={previews[item.bot]} onOpen={() => open(item.saved)} />
        )}
      />
    </View>
  );
}

function ListHeader({ compact, top, onMenu }: { compact: boolean; top: number; onMenu: (anchor?: { x: number; y: number }) => void }) {
  const hit = isDesktop ? 32 : 44;
  const icon = isDesktop ? 19 : 24;
  const buttonStyle = ({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
    styles.headerButton,
    { width: hit, height: hit },
    (hovered || pressed) && isDesktop && { backgroundColor: colors.raised },
    pressed && !isDesktop && { opacity: 0.6 },
  ];
  const buttons = (
    <View style={styles.headerButtons}>
      <Pressable onPress={(e) => onMenu({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })} accessibilityRole="button" accessibilityLabel="More" style={buttonStyle}>
        <Icon name="ellipsis" size={icon} color={colors.accent} />
      </Pressable>
      <Pressable onPress={() => router.push('/new')} accessibilityRole="button" accessibilityLabel="New bot" style={buttonStyle}>
        <Icon name="compose" size={icon} color={colors.accent} />
      </Pressable>
    </View>
  );
  if (compact) {
    return (
      <View style={[styles.sidebarHeader, { paddingTop: top, height: 56 + top }]}>
        <Text style={styles.sidebarTitle} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
          Dork Bot
        </Text>
        {buttons}
      </View>
    );
  }
  return (
    <View style={{ paddingTop: top }}>
      <View style={styles.largeButtons}>{buttons}</View>
      <Text style={styles.largeTitle} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
        Dork Bot
      </Text>
    </View>
  );
}

function BotRow({ saved, compact, selected, state, preview, onOpen }: { saved: SavedBot; compact: boolean; selected: boolean; state: ConnectState | undefined; preview: BotPreview | undefined; onOpen: () => void }) {
  const bot = saved.bot;
  const name = nameOf(bot, saved.displayName);
  const mood = useBotMood(bot);
  useApprovalTick();
  const needs = liveRuns.needsYou(bot);
  const broken = typeof state === 'object' ? state : null;
  const doing = !broken && !needs ? doingLine(mood) : null;
  const time = rowTime(preview?.at);

  let line: string;
  let lineStyle: object | null = null;
  if (broken) {
    line = errorLine(broken);
    lineStyle = { color: colors.bad };
  } else if (needs) line = `Wants to run a command: ${needs.command || needs.description}`;
  else if (doing) {
    line = doing;
    lineStyle = { color: colors.text };
  } else line = preview ? (preview.text ?? 'No messages yet') : '';

  const big = !isDesktop; // phone, and the Duo's sidebar on iOS: larger text and 44 pt targets
  const [hovered, setHovered] = useState(false);
  const label = `${name}, ${needs ? 'needs you, ' : ''}${line}${time ? `, ${time}` : ''}`;

  const badge = needs ? (
    <View style={styles.badge}>
      <Text style={styles.badgeText} maxFontSizeMultiplier={1.4}>
        Needs you
      </Text>
    </View>
  ) : null;

  if (compact) {
    return (
      <Pressable
        onPress={onOpen}
        onLongPress={() => openBotSheet(bot)}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Opens the chat. Long-press for the bot's settings."
        style={({ pressed }) => [styles.sideRow, hovered && !selected && { backgroundColor: colors.hover }, (selected || pressed) && { backgroundColor: colors.raised }]}
      >
        <BotAvatar bot={bot} size={40} mood={broken ? 'sleeping' : undefined} />
        <View style={styles.sideText}>
          <View style={styles.line1}>
            <Text style={[styles.sideName, { fontSize: big ? 16 : 15, lineHeight: 20 }]} numberOfLines={1} maxFontSizeMultiplier={1.4}>
              {name}
            </Text>
            {isDesktop && hovered ? (
              <Pressable onPress={() => openBotSheet(bot)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`More for ${name}`} style={styles.rowMore}>
                <Text style={styles.rowMoreText}>⋯</Text>
              </Pressable>
            ) : (
              <Text style={styles.sideTime} maxFontSizeMultiplier={1.4}>
                {time}
              </Text>
            )}
          </View>
          <View style={styles.line2}>
            <Text style={[styles.sidePreview, { fontSize: big ? 14 : 13, lineHeight: 18 }, lineStyle]} numberOfLines={1} maxFontSizeMultiplier={1.4}>
              {line}
            </Text>
            {badge}
          </View>
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onOpen}
      onLongPress={() => openBotSheet(bot)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens the chat. Long-press for the bot's settings."
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.raised }]}
    >
      <View style={styles.rowAvatar}>
        <BotAvatar bot={bot} size={52} mood={broken ? 'sleeping' : undefined} />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowInner}>
          <View style={styles.line1}>
            <Text style={styles.name} numberOfLines={1} maxFontSizeMultiplier={1.4}>
              {name}
            </Text>
            <Text style={styles.time} maxFontSizeMultiplier={1.4}>
              {time}
            </Text>
            <Text style={styles.chevron}>›</Text>
          </View>
          <View style={styles.line2}>
            <Text style={[styles.preview, lineStyle]} numberOfLines={2} maxFontSizeMultiplier={1.4}>
              {line}
            </Text>
            {badge}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  list: { paddingBottom: 24 },
  listCompact: { paddingHorizontal: 8, paddingBottom: 12, gap: 2 },
  empty: { flexGrow: 1, justifyContent: 'center', padding: 32 },
  emptyBox: { alignItems: 'center', gap: 10 },
  emptyDisc: { width: 52, height: 52, borderRadius: 26, backgroundColor: mix(colors.accent, 0.18), alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  emptyTitle: { color: colors.text, fontSize: 20, fontWeight: '600' },
  emptyText: { color: colors.dim, fontSize: 15, textAlign: 'center', lineHeight: 22 },
  // Header
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: isDesktop ? 4 : 0 },
  headerButton: { alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  largeButtons: { flexDirection: 'row', justifyContent: 'flex-end', height: 44, paddingRight: 8 },
  largeTitle: { color: colors.text, fontSize: 34, lineHeight: 41, fontWeight: '700', paddingHorizontal: 16, paddingBottom: 8 },
  sidebarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 18, paddingRight: isDesktop ? 12 : 4 },
  sidebarTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  // Phone rows: full-bleed, 76 tall at least, hairline from x 80
  row: { flexDirection: 'row', minHeight: 76 },
  rowAvatar: { width: 80, paddingLeft: 16, paddingTop: 12 },
  rowBody: { flex: 1, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowInner: { paddingTop: 10, paddingBottom: 10, paddingRight: 16, gap: 1 },
  line1: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  line2: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '600' },
  time: { color: colors.dim, fontSize: 15, lineHeight: 20 },
  chevron: { color: colors.chevron, fontSize: 15, lineHeight: 20 },
  preview: { flex: 1, color: colors.dim, fontSize: 15, lineHeight: 20 },
  badge: { height: 20, borderRadius: 10, paddingHorizontal: 8, backgroundColor: colors.bad, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#1A0B0B', fontSize: 12, fontWeight: '700' },
  // Sidebar rows: 64 tall, inset 8, radius 10, avatar 40
  sideRow: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 64, paddingHorizontal: 12, borderRadius: 10 },
  sideText: { flex: 1, gap: 1 },
  sideName: { flex: 1, color: colors.text, fontWeight: '600' },
  sideTime: { color: colors.dim, fontSize: 12, lineHeight: 16 },
  sidePreview: { flex: 1, color: colors.dim },
  rowMore: { width: 24, height: 20, alignItems: 'center', justifyContent: 'center' },
  rowMoreText: { color: colors.dim, fontSize: 16, lineHeight: 16, fontWeight: '700' },
});
