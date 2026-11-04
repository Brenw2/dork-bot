import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { fetch } from 'expo/fetch';
import { BotSprite } from '@/components/BotSprite';
import { activity } from '@/lib/activity';
import { connectorNotes } from '@/lib/connectorNotes';
import { getConnection } from '@/lib/bots';
import { activityLine, chatReducer, chatRows, initialChat, type ChatRow, type ToolCall } from '@/lib/chatState';
import { chatSessionId, HermesClient, type ChatMessage, type FetchLike } from '@/lib/hermes';
import { moodFromChat } from '@/lib/sprites';
import { useBotLook } from '@/components/useBotLook';
import { useChatModel } from '@/components/useChatModel';
import { liveRuns, liveRunsReady } from '@/components/liveRuns';
import { elapsedLabel } from '@/lib/liveRuns';
import { providerName } from '@/lib/models';
import { button, colors, mono } from '@/lib/theme';

/** One bot's ongoing chat. Used full screen (app/chat/[bot].tsx) and as the right pane on an open Duo. */
export function ChatView({ bot, maxWidth, inPane = false }: { bot: string; maxWidth?: number; inPane?: boolean }) {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [client, setClient] = useState<HermesClient | null>(null);
  const [state, dispatch] = useReducer(chatReducer, initialChat);
  const [draft, setDraft] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const startedAt = useRef(0);
  const sessionId = chatSessionId(bot);

  // Connect, make sure the bot's one chat exists, and load its history. If a reply was still
  // running when this chat was last open (or the app was closed), show that it's still working.
  useEffect(() => {
    let live = true;
    (async () => {
      const conn = await getConnection(bot);
      if (!conn) return dispatch({ type: 'failed', message: `No saved key for ${bot}.` });
      const c = new HermesClient(conn, fetch as unknown as FetchLike);
      try {
        await c.ensureSession(sessionId, `Dork Bot: ${bot}`);
        const [messages] = await Promise.all([c.messages(sessionId), liveRunsReady]);
        if (live) {
          setClient(c);
          dispatch({ type: 'loaded', messages });
          const run = liveRuns.get(bot);
          if (run && !liveRuns.isStreaming(bot)) {
            startedAt.current = run.startedAt;
            dispatch({ type: 'resumed', runId: run.runId });
          }
        }
      } catch (e) {
        if (live) dispatch({ type: 'failed', message: (e as Error).message });
      }
    })();
    return () => {
      live = false;
      // Hanging up doesn't stop the reply on Hermes: hand it to the background checks.
      liveRuns.detach(bot);
      abortRef.current?.abort();
    };
  }, [bot, sessionId]);

  // A reply this screen isn't streaming finished: load it from the history.
  const resumed = !!state.pending?.resumed;
  useEffect(() => {
    if (!client) return;
    const reload = () =>
      client
        .messages(sessionId)
        .then((messages) => dispatch({ type: 'loaded', messages }))
        .catch(() => undefined);
    const off = liveRuns.subscribe((b) => {
      if (b !== bot) return;
      reload().then(() => dispatch({ type: 'settled' }));
    });
    // While waiting, refresh now and then so steps Hermes has saved show up.
    const id = resumed ? setInterval(reload, 5000) : null;
    if (resumed) void liveRuns.poll();
    return () => {
      off();
      if (id) clearInterval(id);
    };
  }, [bot, client, sessionId, resumed]);

  // Tell the rest of the app what this bot is doing, so its character animates everywhere.
  const mood = moodFromChat(state);
  useEffect(() => {
    activity.set(bot, mood);
  }, [bot, mood]);
  // Leaving the chat: idle, unless the reply is still running (the background checks keep it "working").
  useEffect(() => () => void (liveRuns.get(bot) ? activity.set(bot, 'working') : activity.set(bot, 'idle')), [bot]);

  // Local models can take a while before the first word; show a timer.
  const running = state.pending !== null;
  useEffect(() => {
    if (!running) return;
    const t0 = startedAt.current || Date.now();
    setElapsed(Math.round((Date.now() - t0) / 1000));
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [running]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !client || running) return;
    setDraft('');
    startedAt.current = Date.now();
    dispatch({ type: 'send', text });
    const abort = new AbortController();
    abortRef.current = abort;
    let runId: string | null = null;
    try {
      await client.chat(
        sessionId,
        text,
        (event) => {
          if (event.type === 'tool' && event.phase === 'started') connectorNotes.toolUsed(bot, event.name);
          if (event.type === 'started' && event.runId) {
            runId = event.runId;
            liveRuns.start(bot, runId);
          }
          if (event.type === 'finished') liveRuns.finish(bot);
          dispatch({ type: 'event', event });
        },
        abort.signal,
        { instructions: connectorNotes.instructions(bot) },
      );
      // The stream can end without run.completed (the phone dropped the connection): if Hermes
      // still has the run, keep showing that the bot is working.
      if (runId && liveRuns.get(bot)) {
        liveRuns.detach(bot);
        dispatch({ type: 'resumed', runId });
      } else dispatch({ type: 'ended' });
    } catch (e) {
      if (abort.signal.aborted) dispatch({ type: 'ended' });
      else if (runId && liveRuns.get(bot)) {
        // Network dropped or the app was backgrounded mid-reply; the reply carries on on Hermes.
        liveRuns.detach(bot);
        dispatch({ type: 'resumed', runId });
      } else dispatch({ type: 'failed', message: (e as Error).message });
    } finally {
      startedAt.current = liveRuns.get(bot)?.startedAt ?? 0;
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
  const warming = useConnectorWarmup(bot);

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
      <ModelBar bot={bot} style={column} />
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
        renderItem={({ item }) => (
          <Row
            row={item}
            bot={bot}
            thinking={`${bot} ${resumed ? 'is still working' : 'is thinking'}… ${elapsedLabel(elapsed * 1000)}`}
          />
        )}
      />
      {state.error ? <Text style={styles.error}>{state.error}</Text> : null}
      {warming.length ? (
        <Text style={[styles.warming, column]} accessibilityLiveRegion="polite">
          {warming.map((w) => w.name).join(', ')} still connecting to {bot}, about {Math.max(...warming.map((w) => w.secondsLeft))} s
        </Text>
      ) : null}
      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }, column]}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder={`Message ${bot}`}
          placeholderTextColor={colors.dim}
          accessibilityLabel={`Message ${bot}`}
          multiline
          // The web build (layout tests, previews) draws a multiline box two rows tall; iOS starts at one.
          {...(Platform.OS === 'web' ? { numberOfLines: 1 } : null)}
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
            style={[styles.send, !canSend && button.disabled]}
            onPress={send}
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !canSend }}
          >
            <Text style={[styles.sendText, !canSend && button.disabledText]}>Send</Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

/** Connectors the gateway may still be loading for this bot, re-rendered each second until done. */
function useConnectorWarmup(bot: string) {
  const [, tick] = useState(0);
  const warming = connectorNotes.warming(bot);
  useEffect(() => connectorNotes.subscribe(() => tick((n) => n + 1)), []);
  const active = warming.length > 0;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
  return warming;
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

/** The chat's model ("claude-opus-5-5 · Anthropic"); tap to switch. Turns red when the model can't work. */
function ModelBar({ bot, style }: { bot: string; style: ViewStyle | null }) {
  const { choice, problem, catalog, error } = useChatModel(bot);
  const label = choice
    ? `${choice.model}${choice.provider ? ` · ${providerName(catalog, choice.provider)}` : ''}`
    : error
      ? "Couldn't load the model list"
      : 'Loading model…';
  return (
    <Pressable
      style={({ pressed }) => [styles.modelBar, style, pressed && { opacity: 0.6 }]}
      onPress={() => router.push({ pathname: '/model/[bot]', params: { bot } })}
      accessibilityRole="button"
      accessibilityLabel={`Model: ${label}. Change model`}
      hitSlop={4}
    >
      <Text style={[styles.modelText, problem ? { color: colors.bad } : null]} numberOfLines={problem ? 3 : 1}>
        {problem ?? label}
      </Text>
      <Text style={styles.modelChange}>Change</Text>
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
  modelBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  modelText: { flex: 1, color: colors.dim, fontSize: 13 },
  modelChange: { color: colors.accent, fontSize: 13, fontWeight: '600' },
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
  warming: { color: colors.dim, fontSize: 13, paddingHorizontal: 16, paddingBottom: 6 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end', // Send stays level with the bottom line as the message box grows
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    color: colors.text,
    fontSize: 16,
    lineHeight: 20,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderRadius: 22,
    backgroundColor: colors.card,
  },
  send: { ...button.primary, height: 44, borderRadius: 22, paddingHorizontal: 18 },
  sendText: { ...button.text, fontSize: 15 },
});
