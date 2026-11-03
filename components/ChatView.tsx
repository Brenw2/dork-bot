import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { fetch } from 'expo/fetch';
import { BotSprite } from '@/components/BotSprite';
import { activity } from '@/lib/activity';
import { getConnection } from '@/lib/bots';
import { activityLine, chatReducer, chatRows, initialChat, type ChatRow, type ToolCall } from '@/lib/chatState';
import { chatSessionId, HermesClient, type ChatMessage, type FetchLike } from '@/lib/hermes';
import { moodFromChat } from '@/lib/sprites';
import { useBotLook } from '@/components/useBotLook';
import { colors, mono } from '@/lib/theme';

/** One bot's ongoing chat. Used full screen (app/chat/[bot].tsx) and as the right pane on an open Duo. */
export function ChatView({ bot, maxWidth, inPane = false }: { bot: string; maxWidth?: number; inPane?: boolean }) {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [client, setClient] = useState<HermesClient | null>(null);
  const [state, dispatch] = useReducer(chatReducer, initialChat);
  const [draft, setDraft] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const sessionId = chatSessionId(bot);

  // Connect, make sure the bot's one chat exists, and load its history.
  useEffect(() => {
    let live = true;
    (async () => {
      const conn = await getConnection(bot);
      if (!conn) return dispatch({ type: 'failed', message: `No saved key for ${bot}.` });
      const c = new HermesClient(conn, fetch as unknown as FetchLike);
      try {
        await c.ensureSession(sessionId, `Dork Bot: ${bot}`);
        const messages = await c.messages(sessionId);
        if (live) {
          setClient(c);
          dispatch({ type: 'loaded', messages });
        }
      } catch (e) {
        if (live) dispatch({ type: 'failed', message: (e as Error).message });
      }
    })();
    return () => {
      live = false;
      abortRef.current?.abort();
    };
  }, [bot, sessionId]);

  // Tell the rest of the app what this bot is doing, so its character animates everywhere.
  const mood = moodFromChat(state);
  useEffect(() => {
    activity.set(bot, mood);
  }, [bot, mood]);
  useEffect(() => () => activity.set(bot, 'idle'), [bot]);

  // Local models can take a while before the first word; show a timer.
  const running = state.pending !== null;
  useEffect(() => {
    if (!running) return;
    const t0 = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [running]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !client || running) return;
    setDraft('');
    dispatch({ type: 'send', text });
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      await client.chat(sessionId, text, (event) => dispatch({ type: 'event', event }), abort.signal);
      dispatch({ type: 'ended' });
    } catch (e) {
      if (!abort.signal.aborted) dispatch({ type: 'failed', message: (e as Error).message });
      else dispatch({ type: 'ended' });
    }
  };

  const stop = () => {
    if (client && state.runId) client.stop(state.runId).catch(() => undefined);
  };

  // Inverted list: newest at the bottom, and the chat opens there however long the history is.
  const rows = useMemo(() => chatRows(state).reverse(), [state]);
  const column = maxWidth ? { maxWidth, width: '100%' as const, alignSelf: 'center' as const } : null;
  const canSend = !!draft.trim() && !!client;
  const { color } = useBotLook(bot);

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      {inPane ? (
        <View style={styles.paneHeader}>
          <BotSprite bot={bot} size={30} />
          <Text style={[styles.paneTitle, { color }]}>{bot}</Text>
          <View style={{ flex: 1 }} />
          <ConnectorsButton bot={bot} />
        </View>
      ) : null}
      <FlatList
        inverted
        data={rows}
        keyExtractor={(r) => r.id}
        style={styles.list}
        contentContainerStyle={[styles.listBody, column]}
        keyboardDismissMode="interactive"
        ListEmptyComponent={
          <View style={styles.flip}>
            {client ? (
              <Text style={styles.hint}>Say something to {bot}.</Text>
            ) : state.error ? null : (
              <ActivityIndicator style={{ marginTop: 40 }} />
            )}
          </View>
        }
        renderItem={({ item }) => <Row row={item} bot={bot} thinking={`${bot} is thinking… ${elapsed}s`} />}
      />
      {state.error ? <Text style={styles.error}>{state.error}</Text> : null}
      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }, column]}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder={`Message ${bot}`}
          placeholderTextColor={colors.dim}
          accessibilityLabel={`Message ${bot}`}
          multiline
          editable={!!client}
        />
        {running ? (
          <Pressable
            style={[styles.send, { backgroundColor: colors.bad }]}
            onPress={stop}
            disabled={!state.runId}
            accessibilityRole="button"
            accessibilityLabel="Stop"
          >
            <Text style={styles.sendText}>Stop</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[styles.send, !canSend && { opacity: 0.4 }]}
            onPress={send}
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !canSend }}
          >
            <Text style={styles.sendText}>Send</Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

/** Opens the bot's connectors (Notion, Linear, ...). In the chat header and the open-Duo pane header. */
export function ConnectorsButton({ bot }: { bot: string }) {
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/connectors/[bot]', params: { bot } })}
      accessibilityRole="button"
      accessibilityLabel={`${bot}'s connectors`}
      hitSlop={8}
    >
      <Text style={styles.headerButton}>Connectors</Text>
    </Pressable>
  );
}

function Row({ row, bot, thinking }: { row: ChatRow; bot: string; thinking: string }) {
  switch (row.kind) {
    case 'message':
      return <Bubble role={row.message.role} text={row.message.content} bot={bot} />;
    case 'activity':
      return <Activity tools={row.tools} live={row.live} />;
    case 'pending':
      return row.text ? (
        <Bubble role="assistant" text={row.text} bot={bot} />
      ) : (
        <View style={styles.thinkingRow}>
          <BotSprite bot={bot} size={28} />
          <Text style={styles.thinkingText}>{thinking}</Text>
        </View>
      );
  }
}

function Bubble({ role, text, bot }: { role: ChatMessage['role']; text: string; bot: string }) {
  const mine = role === 'user';
  const { color } = useBotLook(bot);
  return (
    <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
      {!mine ? <Text style={[styles.who, { color }]}>{bot}</Text> : null}
      <Text style={styles.text} selectable>
        {text}
      </Text>
    </View>
  );
}

// A run of tool calls is one line that updates in place ("… terminal · 3 steps"). Tap it for the steps,
// tap a step for what it ran.
function Activity({ tools, live }: { tools: ToolCall[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  const [openStep, setOpenStep] = useState<number | null>(null);
  return (
    <View style={styles.activity}>
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }} hitSlop={6}>
        <Text style={styles.toolText} numberOfLines={1}>
          {activityLine(tools, live)} {open ? '▾' : '▸'}
        </Text>
      </Pressable>
      {open
        ? tools.map((t, i) => (
            <Pressable key={i} onPress={() => setOpenStep(openStep === i ? null : i)} disabled={!t.preview} accessibilityRole="button">
              <Text style={styles.step} numberOfLines={1}>
                {t.status === 'running' ? '…' : t.status === 'failed' ? '✕' : '✓'} {t.name}
              </Text>
              {openStep === i && t.preview ? (
                <Text style={[styles.step, styles.preview]} numberOfLines={12}>
                  {t.preview}
                </Text>
              ) : null}
            </Pressable>
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  headerButton: { color: colors.accent, fontSize: 16 },
  paneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  thinkingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' },
  thinkingText: { color: colors.dim, fontSize: 14 },
  paneTitle: { fontSize: 17, fontWeight: '600' },
  list: { flex: 1 },
  listBody: { flexGrow: 1, padding: 14, gap: 10 },
  // An inverted list draws its empty state upside down unless it's flipped back.
  flip: { flex: 1, transform: [{ scaleY: -1 }], justifyContent: 'flex-end' },
  hint: { color: colors.dim, fontSize: 14, textAlign: 'center', marginTop: 8 },
  bubble: { maxWidth: '86%', padding: 12, borderRadius: 16 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.user },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.card },
  who: { fontSize: 12, fontWeight: '600', marginBottom: 3 },
  text: { color: colors.text, fontSize: 16, lineHeight: 22 },
  activity: {
    alignSelf: 'flex-start',
    maxWidth: '86%',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: 4,
  },
  toolText: { color: colors.dim, fontSize: 13 },
  step: { color: colors.dim, fontSize: 12, paddingLeft: 8 },
  preview: { fontFamily: mono, paddingLeft: 20 },
  error: { color: colors.bad, fontSize: 14, paddingHorizontal: 16, paddingBottom: 6 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    maxHeight: 140,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    borderRadius: 20,
    backgroundColor: colors.card,
  },
  send: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 20, backgroundColor: colors.accent },
  sendText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
