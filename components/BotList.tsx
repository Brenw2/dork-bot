import { Link, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Alert, Menu } from '@/components/alert';
import { isDesktop } from '@/components/desktop';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetch } from '@/components/net';
import { BotSprite } from '@/components/BotSprite';
import { loadManager } from '@/components/manager';
import { pushMeta, syncNow } from '@/components/sync';
import { useBotMood } from '@/components/useBotMood';
import { getConnection, listBots, onBotsChanged, removeBot, type SavedBot } from '@/lib/bots';
import { HermesClient, type FetchLike } from '@/lib/hermes';
import { botColor, button, colors } from '@/lib/theme';

type Status = 'checking' | 'ok' | string;

/** The saved bots. onSelect opens a chat (pushes a screen on phones, fills the right pane on an open Duo). */
export function BotList({ onSelect, selected }: { onSelect: (bot: string) => void; selected?: string | null }) {
  const [bots, setBots] = useState<SavedBot[] | null>(null);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const { bottom } = useSafeAreaInsets();

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
    Alert.alert(`Hide ${bot}?`, 'It goes from Dork Bot on your phone and desktop, but stays on Hermes. Add it back from New bot.', [
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

  const showActions = (bot: string, anchor?: { x: number; y: number }) =>
    Menu.show(bot, [
      { text: 'Change look…', onPress: () => router.push({ pathname: '/look/[bot]', params: { bot } }) },
      { text: 'Connectors…', onPress: () => router.push({ pathname: '/connectors/[bot]', params: { bot } }) },
      { text: 'Hide', onPress: () => hide(bot) },
      ...(bot === 'default' ? [] : [{ text: 'Delete bot…', style: 'destructive' as const, onPress: () => deleteFromHermes(bot) }]),
      { text: 'Cancel', style: 'cancel' },
    ], anchor);

  if (bots === null) return <View style={styles.screen} />;

  return (
    <View style={styles.screen}>
      <FlatList
        data={bots}
        keyExtractor={(b) => b.bot}
        contentContainerStyle={bots.length ? styles.list : styles.empty}
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
              style={({ pressed }) => [styles.row, item.bot === selected && [styles.rowSelected, { borderColor: (item.look?.color ?? botColor(item.bot)) }], pressed && { opacity: 0.6 }]}
              onPress={() => onSelect(item.bot)}
              onLongPress={() => showActions(item.bot)}
              accessibilityRole="button"
              accessibilityLabel={`${item.bot}, ${s === 'ok' ? 'connected' : s === 'checking' || !s ? 'checking' : s}`}
              accessibilityHint="Opens the chat. Long-press for more."
            >
              <BotSprite bot={item.bot} size={48} mood={s && s !== 'ok' && s !== 'checking' ? 'sleeping' : undefined} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.bot}</Text>
                <StatusLine bot={item.bot} status={s} />
              </View>
              <View style={[styles.dot, { backgroundColor: s === 'ok' ? colors.ok : s === 'checking' ? colors.dim : colors.bad }]} />
              {/* No long-press with a mouse: the same menu behind a button. */}
              {isDesktop ? (
                <Pressable onPress={(e) => showActions(item.bot, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })} hitSlop={8} accessibilityRole="button" accessibilityLabel={`More for ${item.bot}`}>
                  <Text style={styles.more}>⋯</Text>
                </Pressable>
              ) : null}
            </Pressable>
          );
        }}
      />
      <Link href="/new" asChild>
        <Pressable style={StyleSheet.flatten([styles.add, { marginBottom: Math.max(bottom, 16) }])} accessibilityRole="button" accessibilityLabel="New bot">
          <Text style={styles.addText}>+ New bot</Text>
        </Pressable>
      </Link>
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
  rowSelected: { borderColor: colors.accent, borderWidth: 1.5 },
  name: { color: colors.text, fontSize: 17, fontWeight: '600' },
  sub: { color: colors.dim, fontSize: 13, marginTop: 2 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  more: { color: colors.dim, fontSize: 20, paddingHorizontal: 4 },
  add: { ...button.primary, alignSelf: 'center', minWidth: 180, margin: 16 },
  addText: button.text,
});
