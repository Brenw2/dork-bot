import { Link, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Alert, Menu } from '@/components/alert';
import { isDesktop } from '@/components/desktop';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetch } from '@/components/net';
import { BotSprite } from '@/components/BotSprite';
import { useBusyWatch } from '@/components/busyWatch';
import { loadManager } from '@/components/manager';
import { notificationsSupported } from '@/components/notifications';
import { pushMeta, syncNow } from '@/components/sync';
import { useBotMood } from '@/components/useBotMood';
import { renameBot } from '@/components/useBotName';
import { nameOf } from '@/lib/names';
import { getConnection, listBots, onBotsChanged, removeBot, type SavedBot } from '@/lib/bots';
import { HermesClient, type FetchLike } from '@/lib/hermes';
import { botColor, button, colors } from '@/lib/theme';
import { RoomListRow } from '@/components/RoomRow';
import { useRoomRows } from '@/components/roomsClient';

type Status = 'checking' | 'ok' | string;

/**
 * The saved bots. onSelect opens a chat (pushes a screen on phones, fills the chat pane in two panes).
 * compact: the slim sidebar next to a chat, with smaller rows.
 */
export function BotList({ onSelect, selected, compact = false, onSelectRoom, selectedRoom }: { onSelect: (bot: string) => void; selected?: string | null; compact?: boolean; onSelectRoom?: (room: string) => void; selectedRoom?: string | null }) {
  const [bots, setBots] = useState<SavedBot[] | null>(null);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const { bottom } = useSafeAreaInsets();
  useBusyWatch();
  // Group rooms on Hermes (card 8): a row each, above the bots. None when Hermes has no rooms or isn't reachable.
  const { rows: rooms, supported: roomsSupported } = useRoomRows();

  const load = useCallback(() => {
    let live = true;
    const show = () => listBots().then(async (list) => {
      if (!live) return;
      setBots(list);
      setStatus((s) => Object.fromEntries(list.map((b) => [b.bot, s[b.bot] ?? 'checking'])));
      for (const b of list) {
        const conn = await getConnection(b.bot);
        if (!conn) continue;
        new HermesClient(conn, fetch as unknown as FetchLike)
          .check()
          .then(() => live && setStatus((s) => ({ ...s, [b.bot]: 'ok' })))
          .catch((e: Error) => live && setStatus((s) => ({ ...s, [b.bot]: e.message })));
      }
    });
    // Show what's on this device right away, then again if Hermes says the list changed
    // (a bot made, deleted or hidden on another device).
    // (a bot made, deleted or hidden on another device). Sync saves through lib/bots, which fires onBotsChanged.
    const off = onBotsChanged(() => void show());
    show().then(() => syncNow());
    return () => {
      live = false;
      off();
    };
  }, []);
  useFocusEffect(load);

  const hide = (bot: string) =>
    Alert.alert(`Hide ${nameOf(bot, bots?.find((b) => b.bot === bot)?.displayName)}?`, 'It goes from Dork Bot on your phone and desktop, but stays on Hermes. Add it back from New bot.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Hide', style: 'destructive', onPress: () => removeBot(bot).then(() => pushMeta(bot, { hidden: true })).then(load) },
    ]);

  // Deleting a Hermes profile wipes its memory, chats and routines, so make him type the name.
  const deleteFromHermes = (bot: string) =>
    Alert.prompt(
      `Delete ${bot}?`,
      `This deletes the bot on Hermes for good: its memory, chats and routines. Type ${bot} to confirm.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async (typed?: string) => {
            if (typed?.trim().toLowerCase() !== bot) return Alert.alert('Not deleted', "The name didn't match.");
            try {
              const manager = await loadManager();
              if (!manager) return Alert.alert('Connect to Hermes first', 'Run scripts/pair-hermes.sh on b-lab and scan the code.');
              await manager.deleteBot(bot);
              await removeBot(bot);
              load();
            } catch (e) {
              Alert.alert(`Couldn't delete ${bot}`, (e as Error).message);
            }
          },
        },
      ],
      'plain-text',
    );

  const showActions = (bot: string, anchor?: { x: number; y: number }) => {
    const shown = nameOf(bot, bots?.find((b) => b.bot === bot)?.displayName);
    Menu.show(shown, [
      { text: 'Rename…', onPress: () => renameBot(bot, shown) },
      { text: 'Change look…', onPress: () => router.push({ pathname: '/look/[bot]', params: { bot } }) },
      { text: 'Chats…', onPress: () => router.push({ pathname: '/chats/[bot]', params: { bot } }) },
      { text: 'Work…', onPress: () => router.push({ pathname: '/work/[bot]', params: { bot } }) },
      { text: 'Routines…', onPress: () => router.push({ pathname: '/routines/[bot]', params: { bot } }) },
      { text: 'Routine results…', onPress: () => router.push({ pathname: '/routine-results/[bot]', params: { bot } }) },
      { text: 'Connectors…', onPress: () => router.push({ pathname: '/connectors/[bot]', params: { bot } }) },
      ...(notificationsSupported ? [{ text: 'Notifications…', onPress: () => router.push('/notifications') }] : []),
      { text: 'Hide', onPress: () => hide(bot) },
      ...(bot === 'default' ? [] : [{ text: 'Delete bot…', style: 'destructive' as const, onPress: () => deleteFromHermes(bot) }]),
      { text: 'Cancel', style: 'cancel' },
    ], anchor);
  };
  if (bots === null) return <View style={styles.screen} />;

  return (
    <View style={styles.screen}>
      <FlatList
        data={bots}
        keyExtractor={(b) => b.bot}
        ListHeaderComponent={
          rooms.length ? (
            <View style={styles.rooms}>
              {rooms.map((r) => (
                <RoomListRow
                  key={r.id}
                  row={r}
                  label={(id) => nameOf(id, bots?.find((b) => b.bot === id)?.displayName)}
                  selected={r.id === selectedRoom}
                  compact={compact}
                  onPress={() => (onSelectRoom ? onSelectRoom(r.id) : router.push({ pathname: '/room/[id]', params: { id: r.id } }))}
                />
              ))}
            </View>
          ) : undefined
        }
        contentContainerStyle={bots.length ? (compact ? styles.listCompact : styles.list) : styles.empty}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>No bots yet</Text>
            <Text style={styles.emptyText}>Tap New bot to make one, or to add a bot that's already on Hermes.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const s = status[item.bot];
          return (
            <Pressable
              style={({ pressed }) => [styles.row, compact && styles.rowCompact, item.bot === selected && [styles.rowSelected, { borderColor: (item.look?.color ?? botColor(item.bot)) }], pressed && { opacity: 0.6 }]}
              onPress={() => onSelect(item.bot)}
              onLongPress={() => showActions(item.bot)}
              accessibilityRole="button"
              accessibilityLabel={`${nameOf(item.bot, item.displayName)}, ${s === 'ok' ? 'connected' : s === 'checking' || !s ? 'checking' : s}`}
              accessibilityHint="Opens the chat. Long-press for more."
            >
              <BotSprite bot={item.bot} size={compact ? 34 : 48} mood={s && s !== 'ok' && s !== 'checking' ? 'sleeping' : undefined} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, compact && styles.nameCompact]} numberOfLines={1}>{nameOf(item.bot, item.displayName)}</Text>
                <StatusLine bot={item.bot} status={s} />
              </View>
              <View style={[styles.dot, { backgroundColor: s === 'ok' ? colors.ok : s === 'checking' ? colors.dim : colors.bad }]} />
              {/* No long-press with a mouse: the same menu behind a button. */}
              {isDesktop ? (
                <Pressable onPress={(e) => showActions(item.bot, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })} hitSlop={8} accessibilityRole="button" accessibilityLabel={`More for ${nameOf(item.bot, item.displayName)}`}>
                  <Text style={styles.more}>⋯</Text>
                </Pressable>
              ) : null}
            </Pressable>
          );
        }}
      />
      <Link href="/new" asChild>
        <Pressable style={StyleSheet.flatten([styles.add, compact && styles.addCompact, { marginBottom: Math.max(bottom, compact ? 12 : 16) }])} accessibilityRole="button" accessibilityLabel="New bot">
          <Text style={styles.addText}>+ New bot</Text>
        </Pressable>
      </Link>
      {roomsSupported && (bots?.length ?? 0) >= 2 ? (
        <Pressable onPress={() => router.push('/room-new')} style={styles.newGroup} accessibilityRole="button" accessibilityLabel="New group chat" hitSlop={8}>
          <Text style={styles.newGroupText}>New group chat</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const DOING: Record<string, string> = { thinking: 'Thinking…', working: 'Working…', talking: 'Replying…', done: 'Done', error: 'Hit an error' };

/** "Connected", or what the bot is doing right now while it works. */
function StatusLine({ bot, status }: { bot: string; status: Status | undefined }) {
  const mood = useBotMood(bot);
  const text = status === 'ok' ? (DOING[mood] ?? 'Connected') : status === 'checking' || !status ? 'Checking…' : status;
  return (
    <Text style={[styles.sub, status === 'ok' && DOING[mood] ? { color: colors.text } : null]} numberOfLines={1}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  list: { padding: 16, gap: 10 },
  empty: { flexGrow: 1, justifyContent: 'center', padding: 32 },
  emptyBox: { alignItems: 'center', gap: 10 },
  emptyTitle: { color: colors.text, fontSize: 20, fontWeight: '600' },
  emptyText: { color: colors.dim, fontSize: 15, textAlign: 'center', lineHeight: 22 },
  code: { color: colors.text, fontFamily: 'Menlo' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  listCompact: { padding: 10, gap: 6 },
  rowCompact: { gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12 },
  rowSelected: { borderColor: colors.accent, borderWidth: 1.5 },
  name: { color: colors.text, fontSize: 17, fontWeight: '600' },
  nameCompact: { fontSize: 15 },
  sub: { color: colors.dim, fontSize: 13, marginTop: 2 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  more: { color: colors.dim, fontSize: 20, paddingHorizontal: 4 },
  add: { ...button.primary, alignSelf: 'center', minWidth: 180, margin: 16 },
  addCompact: { height: 40, minWidth: 0, alignSelf: 'stretch', marginHorizontal: 10, marginTop: 8 },
  addText: button.text,
  rooms: { marginBottom: 6 },
  newGroup: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', marginBottom: 8 },
  newGroupText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
});
