import { Link, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetch } from 'expo/fetch';
import { BotSprite } from '@/components/BotSprite';
import { loadManager } from '@/components/manager';
import { useBotMood } from '@/components/useBotMood';
import { getConnection, listBots, removeBot, type SavedBot } from '@/lib/bots';
import { HermesClient, type FetchLike } from '@/lib/hermes';
import { colors } from '@/lib/theme';

type Status = 'checking' | 'ok' | string;

/** The saved bots. onSelect opens a chat (pushes a screen on phones, fills the right pane on an open Duo). */
export function BotList({ onSelect, selected }: { onSelect: (bot: string) => void; selected?: string | null }) {
  const [bots, setBots] = useState<SavedBot[] | null>(null);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const { bottom } = useSafeAreaInsets();

  const load = useCallback(() => {
    let live = true;
    listBots().then(async (list) => {
      if (!live) return;
      setBots(list);
      setStatus(Object.fromEntries(list.map((b) => [b.bot, 'checking'])));
      for (const b of list) {
        const conn = await getConnection(b.bot);
        if (!conn) continue;
        new HermesClient(conn, fetch as unknown as FetchLike)
          .check()
          .then(() => live && setStatus((s) => ({ ...s, [b.bot]: 'ok' })))
          .catch((e: Error) => live && setStatus((s) => ({ ...s, [b.bot]: e.message })));
      }
    });
    return () => {
      live = false;
    };
  }, []);
  useFocusEffect(load);

  const removeFromApp = (bot: string) =>
    Alert.alert(`Remove ${bot} from the app?`, 'The bot stays on Hermes. You can add it back from New bot.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeBot(bot).then(load) },
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

  const showActions = (bot: string) =>
    Alert.alert(bot, undefined, [
      { text: 'Change character…', onPress: () => router.push({ pathname: '/character/[bot]', params: { bot } }) },
      { text: 'Remove from app', onPress: () => removeFromApp(bot) },
      ...(bot === 'default' ? [] : [{ text: 'Delete bot…', style: 'destructive' as const, onPress: () => deleteFromHermes(bot) }]),
      { text: 'Cancel', style: 'cancel' },
    ]);

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
              style={({ pressed }) => [styles.row, item.bot === selected && styles.rowSelected, pressed && { opacity: 0.6 }]}
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
            </Pressable>
          );
        }}
      />
      <Link href="/new" asChild>
        <Pressable style={StyleSheet.flatten([styles.add, { marginBottom: Math.max(bottom, 16) }])} accessibilityRole="button">
          <Text style={styles.addText}>New bot</Text>
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
  add: { margin: 16, padding: 15, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center' },
  addText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
