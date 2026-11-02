import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { fetch } from 'expo/fetch';
import { getConnection, listBots, removeBot, type SavedBot } from '@/lib/bots';
import { HermesClient, type FetchLike } from '@/lib/hermes';
import { botColor, colors } from '@/lib/theme';

type Status = 'checking' | 'ok' | string;

/** The saved bots. onSelect opens a chat (pushes a screen on phones, fills the right pane on an open Duo). */
export function BotList({ onSelect, selected }: { onSelect: (bot: string) => void; selected?: string | null }) {
  const [bots, setBots] = useState<SavedBot[] | null>(null);
  const [status, setStatus] = useState<Record<string, Status>>({});

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

  const confirmRemove = (bot: string) =>
    Alert.alert(`Remove ${bot}?`, 'This removes it from the app only. The bot stays in Hermes.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeBot(bot).then(load) },
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
            <Text style={styles.emptyText}>
              On your computer run{'\n'}
              <Text style={styles.code}>scripts/pair-bot.sh assistant</Text>
              {'\n'}and scan the QR code with the iPhone camera.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const s = status[item.bot];
          return (
            <Pressable
              style={({ pressed }) => [styles.row, item.bot === selected && styles.rowSelected, pressed && { opacity: 0.6 }]}
              onPress={() => onSelect(item.bot)}
              onLongPress={() => confirmRemove(item.bot)}
            >
              <View style={[styles.avatar, { backgroundColor: botColor(item.bot) }]}>
                <Text style={styles.avatarText}>{item.bot[0]?.toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.bot}</Text>
                <Text style={styles.sub} numberOfLines={1}>
                  {s === 'ok' ? 'Connected' : s === 'checking' || !s ? 'Checking…' : s}
                </Text>
              </View>
              <View style={[styles.dot, { backgroundColor: s === 'ok' ? colors.ok : s === 'checking' ? colors.dim : colors.bad }]} />
            </Pressable>
          );
        }}
      />
      <Link href="/add" asChild>
        <Pressable style={styles.add}>
          <Text style={styles.addText}>Add a bot</Text>
        </Pressable>
      </Link>
    </View>
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
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#111', fontSize: 18, fontWeight: '700' },
  name: { color: colors.text, fontSize: 17, fontWeight: '600' },
  sub: { color: colors.dim, fontSize: 13, marginTop: 2 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  add: { margin: 16, marginBottom: 34, padding: 15, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center' },
  addText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
