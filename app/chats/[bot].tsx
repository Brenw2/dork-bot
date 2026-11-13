import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Menu } from '@/components/alert';
import { useBotName } from '@/components/useBotName';
import { useColumnStyle } from '@/components/Column';
import { currentChat, openChat, startNewChat, useCurrentChat } from '@/components/currentChat';
import { deleteChat, onChatsChanged, renameChat } from '@/components/ChatView';
import { isDesktop } from '@/components/desktop';
import { Group } from '@/components/Grouped';
import { Icon } from '@/components/AppIcons';
import { fetch } from '@/components/net';
import { Sheet } from '@/components/Sheet';
import { useBotLook } from '@/components/useBotLook';
import { useWork } from '@/components/workWatch';
import { rowTime } from '@/lib/botList';
import { getConnection } from '@/lib/bots';
import { chatName, cleanPreview, type ChatSummary } from '@/lib/chats';
import { HermesClient, type FetchLike } from '@/lib/hermes';
import { colors } from '@/lib/theme';

// A bot's chats, newest first, the same on every device (they're Hermes sessions). Tap one to open
// it, the compose button for a fresh one, press and hold (⋯ on hover on desktop) to rename or delete.
// docs/design/REVIEW.md, fix 8.
export default function Chats() {
  const { bot } = useLocalSearchParams<{ bot: string }>();
  const botName = useBotName(bot);
  const column = useColumnStyle();
  const open = useCurrentChat(bot);
  const { color } = useBotLook(bot);
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [hovered, setHovered] = useState<string | null>(null);

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
  const fresh = useCallback(() => {
    startNewChat(bot);
    router.back();
  }, [bot]);
  const action = useMemo(() => ({ label: 'New chat', icon: 'compose' as const, onPress: fresh }), [fresh]);
  const actions = (c: ChatSummary, anchor?: { x: number; y: number }) =>
    Menu.show(
      chatName(bot, c),
      [
        { text: 'Rename…', icon: 'pencil', onPress: () => void renameChat(bot, c.id) },
        { text: 'Delete…', icon: 'trash', style: 'destructive' as const, onPress: () => void deleteChat(bot, c.id) },
        { text: 'Cancel', style: 'cancel' as const },
      ],
      anchor,
    );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !chats) return chats ?? [];
    return chats.filter((c) => `${chatName(bot, c)} ${cleanPreview(c.preview)}`.toLowerCase().includes(q));
  }, [chats, query, bot]);
  const openId = open ?? currentChat(bot);

  return (
    <View style={styles.screen}>
      <Sheet title="Chats" bot={bot} action={action} />
      <ScrollView
        contentContainerStyle={[styles.body, column]}
        keyboardShouldPersistTaps="handled"
        refreshControl={isDesktop ? undefined : <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} tintColor={colors.dim} />}
      >
        <View style={styles.search}>
          <Icon name="search" size={16} color={colors.faint} />
          <TextInput
            style={[styles.searchInput, isDesktop && ({ outlineStyle: 'none' } as object)]}
            value={query}
            onChangeText={setQuery}
            placeholder="Search chats"
            placeholderTextColor={colors.faint}
            accessibilityLabel="Search chats"
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
        <WorkRowLink bot={bot} botName={botName} color={color} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {chats === null && !error ? <ActivityIndicator style={{ marginTop: 30 }} /> : null}
        {chats && chats.length === 0 ? <Text style={styles.empty}>No chats with {botName} yet. Say something and it shows up here.</Text> : null}
        {chats && chats.length > 0 && shown.length === 0 ? <Text style={styles.empty}>No chats match "{query.trim()}".</Text> : null}
        {shown.length ? (
          <Group>
            {shown.map((item) => {
              const isOpen = item.id === openId;
              const name = chatName(bot, item);
              const preview = cleanPreview(item.preview);
              const time = rowTime(item.lastActive);
              return (
                <Pressable
                  key={item.id}
                  style={({ pressed }) => [styles.row, hovered === item.id && { backgroundColor: colors.hover }, pressed && { backgroundColor: colors.raised }]}
                  onPress={() => pick(item.id)}
                  onLongPress={() => actions(item)}
                  onHoverIn={() => setHovered(item.id)}
                  onHoverOut={() => setHovered((h) => (h === item.id ? null : h))}
                  accessibilityRole="button"
                  accessibilityLabel={`${name}${isOpen ? ', open now' : ''}, ${time}`}
                  accessibilityHint="Opens this chat. Press and hold to rename or delete."
                >
                  <View style={styles.text}>
                    <View style={styles.line1}>
                      <Text style={styles.name} numberOfLines={1} maxFontSizeMultiplier={1.4}>{name}</Text>
                      {isDesktop && hovered === item.id ? (
                        <Pressable onPress={(e) => actions(item, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })} hitSlop={8} accessibilityRole="button" accessibilityLabel={`More for ${name}`}>
                          <Text style={styles.more}>⋯</Text>
                        </Pressable>
                      ) : (
                        <Text style={styles.when} maxFontSizeMultiplier={1.4}>{time}</Text>
                      )}
                    </View>
                    {preview && preview !== name ? <Text style={styles.preview} numberOfLines={1} maxFontSizeMultiplier={1.4}>{preview}</Text> : null}
                  </View>
                  <View style={styles.gutter}>{isOpen ? <Icon name="check" size={22} color={color} stroke={2.2} /> : null}</View>
                </Pressable>
              );
            })}
          </Group>
        ) : null}
        {shown.length ? <Text style={styles.footnote}>Press and hold a chat to rename or delete it.</Text> : null}
      </ScrollView>
    </View>
  );
}

/** "Work" row at the top of Chats: what the bot does outside the app, with how many are running now. */
function WorkRowLink({ bot, botName, color }: { bot: string; botName: string; color: string }) {
  const { items } = useWork(bot);
  const running = items?.filter((i) => i.status === 'working').length ?? 0;
  const note = items === null ? '' : running ? `${running} working now` : items.length ? `${items.length} recent` : `Nothing from outside the app yet`;
  return (
    <View style={styles.workGroup}>
      <Pressable
        style={({ pressed }) => [styles.work, pressed && { backgroundColor: colors.raised }]}
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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, gap: 16, paddingBottom: 32 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 36, borderRadius: 10, paddingHorizontal: 10, backgroundColor: colors.card },
  searchInput: { flex: 1, color: colors.text, fontSize: 17, padding: 0 },
  workGroup: { backgroundColor: colors.card, borderRadius: 12, overflow: 'hidden' },
  work: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, minHeight: 56 },
  workName: { color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '600' },
  workNote: { color: colors.dim, fontSize: 13, lineHeight: 18 },
  workChevron: { color: colors.disclosure, fontSize: 20 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 62, paddingLeft: 16, paddingVertical: 8 },
  text: { flex: 1, gap: 1 },
  line1: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '600' },
  when: { color: colors.dim, fontSize: 15, lineHeight: 20 },
  preview: { color: colors.dim, fontSize: 15, lineHeight: 20 },
  gutter: { width: 50, alignItems: 'center', justifyContent: 'center' },
  more: { color: colors.dim, fontSize: 18, paddingHorizontal: 4 },
  footnote: { color: colors.dim, fontSize: 13, lineHeight: 18, paddingHorizontal: 16, marginTop: -8 },
  empty: { color: colors.dim, fontSize: 15, textAlign: 'center', marginTop: 14, lineHeight: 22 },
  error: { color: colors.bad, fontSize: 14, paddingHorizontal: 4 },
});
