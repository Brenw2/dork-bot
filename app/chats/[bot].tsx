import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Menu } from '@/components/alert';
import { useBotName } from '@/components/useBotName';
import { useColumnStyle } from '@/components/Column';
import { currentChat, openChat, startNewChat, useCurrentChat } from '@/components/currentChat';
import { deleteChat, onChatsChanged, renameChat } from '@/components/ChatView';
import { isDesktop } from '@/components/desktop';
import { fetch } from '@/components/net';
import { useBotLook } from '@/components/useBotLook';
import { useWork } from '@/components/workWatch';
import { getConnection } from '@/lib/bots';
import { agoLabel, chatName, cleanPreview, type ChatSummary } from '@/lib/chats';
import { HermesClient, type FetchLike } from '@/lib/hermes';
import { button, colors, mix, onColor } from '@/lib/theme';

// A bot's chats, newest first, the same on every device (they're Hermes sessions). Tap one to open
// it, New chat for a fresh one, long-press (⋯ on desktop) to rename or delete.
export default function Chats() {
  const { bot } = useLocalSearchParams<{ bot: string }>();
  const botName = useBotName(bot);
  const column = useColumnStyle();
  const open = useCurrentChat(bot);
  const { color } = useBotLook(bot);
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const conn = await getConnection(bot);
    if (!conn) return setError(`No saved key for ${bot}.`);
    try {
      setChats(await new HermesClient(conn, fetch as unknown as FetchLike).listChats());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [bot]);

  useEffect(() => {
    void load();
    return onChatsChanged(() => void load());
  }, [load]);

  const pick = (id: string) => {
    openChat(bot, id);
    router.back();
  };
  const fresh = () => {
    startNewChat(bot);
    router.back();
  };
  const actions = (c: ChatSummary, anchor?: { x: number; y: number }) =>
    Menu.show(
      chatName(bot, c),
      [
        { text: 'Rename…', onPress: () => void renameChat(bot, c.id) },
        { text: 'Delete…', style: 'destructive' as const, onPress: () => void deleteChat(bot, c.id) },
        { text: 'Cancel', style: 'cancel' as const },
      ],
      anchor,
    );

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: `${botName}'s chats` }} />
      <View style={[styles.fill, column]}>
        <Pressable
          style={({ pressed }) => [styles.new, { backgroundColor: color }, pressed && { opacity: 0.7 }]}
          onPress={fresh}
          accessibilityRole="button"
          accessibilityLabel="New chat"
        >
          <Text style={[styles.newText, { color: onColor(color) }]}>+ New chat</Text>
        </Pressable>
        <WorkRowLink bot={bot} botName={botName} color={color} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {chats === null && !error ? <ActivityIndicator style={{ marginTop: 30 }} /> : null}
        <FlatList
          data={chats ?? []}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          refreshControl={isDesktop ? undefined : <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} tintColor={colors.dim} />}
          ListEmptyComponent={chats ? <Text style={styles.empty}>No chats with {botName} yet. Say something and it shows up here.</Text> : undefined}
          renderItem={({ item }) => {
            const isOpen = item.id === (open ?? currentChat(bot));
            const name = chatName(bot, item);
            const preview = cleanPreview(item.preview);
            return (
              <Pressable
                style={({ pressed }) => [styles.row, isOpen && { borderColor: mix(color, 0.8), borderWidth: 1.5 }, pressed && { opacity: 0.6 }]}
                onPress={() => pick(item.id)}
                onLongPress={() => actions(item)}
                accessibilityRole="button"
                accessibilityLabel={`${name}${isOpen ? ', open now' : ''}, ${agoLabel(item.lastActive)}`}
                accessibilityHint="Opens this chat. Long-press to rename or delete."
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {name}
                  </Text>
                  {preview && preview !== name ? (
                    <Text style={styles.preview} numberOfLines={1}>
                      {preview}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.when}>{agoLabel(item.lastActive)}</Text>
                {isDesktop ? (
                  <Pressable onPress={(e) => actions(item, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })} hitSlop={8} accessibilityRole="button" accessibilityLabel={`More for ${name}`}>
                    <Text style={styles.more}>⋯</Text>
                  </Pressable>
                ) : null}
              </Pressable>
            );
          }}
        />
      </View>
    </View>
  );
}

/** "Work" row at the top of Chats: what the bot does outside the app, with how many are running now. */
function WorkRowLink({ bot, botName, color }: { bot: string; botName: string; color: string }) {
  const { items } = useWork(bot);
  const running = items?.filter((i) => i.status === 'working').length ?? 0;
  const note = items === null ? '' : running ? `${running} working now` : items.length ? `${items.length} recent` : `Nothing from outside the app yet`;
  return (
    <Pressable
      style={({ pressed }) => [styles.work, pressed && { backgroundColor: '#22252A' }]}
      onPress={() => router.push({ pathname: '/work/[bot]', params: { bot } })}
      accessibilityRole="button"
      accessibilityLabel={`${botName}'s work${note ? `, ${note}` : ''}`}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.workName}>Work</Text>
        {note ? <Text style={[styles.workNote, running ? { color } : null]}>{note}</Text> : null}
      </View>
      <Text style={styles.workChevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  work: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginTop: 12, paddingHorizontal: 14, minHeight: 56, borderRadius: 12, backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  workName: { color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '600' },
  workNote: { color: colors.dim, fontSize: 13, lineHeight: 18 },
  workChevron: { color: colors.disclosure, fontSize: 20 },
  fill: { flex: 1 },
  new: { ...button.primary, marginHorizontal: 16, marginTop: 16, height: 46, borderRadius: 23 },
  newText: { ...button.text },
  list: { padding: 16, gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  name: { color: colors.text, fontSize: 16, fontWeight: '600' },
  preview: { color: colors.dim, fontSize: 13 },
  when: { color: colors.dim, fontSize: 13 },
  more: { color: colors.dim, fontSize: 20, paddingHorizontal: 4 },
  empty: { color: colors.dim, fontSize: 15, textAlign: 'center', marginTop: 30, lineHeight: 22 },
  error: { color: colors.bad, fontSize: 14, paddingHorizontal: 16, paddingTop: 10 },
});
