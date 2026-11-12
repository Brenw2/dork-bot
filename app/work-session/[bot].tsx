import { Stack, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, StyleSheet, Text, View } from 'react-native';
import { Activity, Mine, Reply } from '@/components/ChatView';
import { useColumnStyle } from '@/components/Column';
import { fetch } from '@/components/net';
import { useBotLook } from '@/components/useBotLook';
import { useBotName } from '@/components/useBotName';
import { getConnection } from '@/lib/bots';
import { chatRows, type ChatRow } from '@/lib/chatState';
import { HermesClient, toChatMessages, type FetchLike } from '@/lib/hermes';
import { whenLabel } from '@/lib/routines';
import { colors } from '@/lib/theme';
import { SESSION_POLL_MS, statusLabel, WorkSessionView, type WorkItem } from '@/lib/work';

// One piece of outside work, read-only, in the same look as a chat: the task it was given, the tool
// steps collapsed into one line, and the bot's replies. While it runs this checks Hermes every few
// seconds; it stops when the session has ended, when the screen is covered, and in the background.
export default function WorkSessionScreen() {
  const { bot, id } = useLocalSearchParams<{ bot: string; id: string }>();
  const botName = useBotName(bot);
  const column = useColumnStyle();
  const { color } = useBotLook(bot);
  const focused = useIsFocused();
  const [item, setItem] = useState<WorkItem | null>(null);
  const [raw, setRaw] = useState<unknown[]>([]);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const view = useRef<WorkSessionView | null>(null);
  const ended = item !== null && item.status !== 'working';

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setForeground(s === 'active'));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!focused || !foreground || ended) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        if (!view.current) {
          const conn = await getConnection(bot);
          if (!conn) return setError(`No saved key for ${bot}.`);
          const client = new HermesClient(conn, fetch as unknown as FetchLike);
          view.current = new WorkSessionView(bot, { row: () => client.sessionRow(id), messages: () => client.rawMessages(id), now: () => Date.now() });
        }
        const got = await view.current.load();
        if (stop) return;
        if (!got) return setMissing(true);
        setItem(got.item);
        if (got.changed) setRaw(got.raw);
        setError(null);
        if (got.item.status !== 'working') return; // over: nothing more to watch
      } catch (e) {
        if (!stop) setError((e as Error).message); // keep what is shown, try again
      }
      if (!stop) timer = setTimeout(() => void tick(), SESSION_POLL_MS);
    };
    void tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [bot, id, focused, foreground, ended]);

  const rows = useMemo(() => chatRows({ messages: toChatMessages(raw as Parameters<typeof toChatMessages>[0]), pending: null }), [raw]);
  const working = item?.status === 'working';

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: `${botName}'s work` }} />
      {item ? (
        <View style={[styles.head, column]}>
          <Text style={styles.title} numberOfLines={3}>
            {item.title}
          </Text>
          <Text style={[styles.status, { color: working ? color : item.status === 'failed' ? colors.bad : colors.dim }]}>{statusLabel(item.status)}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {[item.startedBy, whenLabel(new Date(item.startedAt * 1000).toISOString())].filter(Boolean).join(' · ')} · read-only
          </Text>
        </View>
      ) : null}
      {missing ? <Text style={styles.empty}>That work isn't on {botName} any more.</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!item && !missing && !error ? <ActivityIndicator style={{ marginTop: 30 }} /> : null}
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        contentContainerStyle={[styles.body, column]}
        renderItem={({ item: r }) => <WorkRowView row={r} bot={bot} />}
        ListFooterComponent={working ? <Text style={styles.working}>{botName} is working…</Text> : undefined}
      />
    </View>
  );
}

function WorkRowView({ row, bot }: { row: ChatRow; bot: string }) {
  if (row.kind === 'activity') return <Activity tools={row.tools} live={false} />;
  if (row.kind !== 'message') return null;
  return row.message.role === 'user' ? <Mine message={row.message} bot={bot} /> : <Reply text={row.message.content} bot={bot} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  head: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, gap: 2 },
  title: { color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '600' },
  status: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  meta: { color: colors.dim, fontSize: 12, lineHeight: 16 },
  body: { padding: 16, gap: 10 },
  working: { color: colors.dim, fontSize: 15, paddingVertical: 8 },
  empty: { color: colors.dim, fontSize: 15, textAlign: 'center', marginTop: 30, paddingHorizontal: 16 },
  error: { color: colors.bad, fontSize: 14, paddingHorizontal: 16, paddingTop: 10 },
});
