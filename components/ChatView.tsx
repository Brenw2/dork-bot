import { useEffect, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetch } from 'expo/fetch';
import { getConnection } from '@/lib/bots';
import { chatReducer, initialChat, type ToolCall } from '@/lib/chatState';
import { chatSessionId, HermesClient, type ChatMessage, type FetchLike } from '@/lib/hermes';
import { botColor, colors, mono } from '@/lib/theme';

/** One bot's ongoing chat. Used full screen (app/chat/[bot].tsx) and as the right pane on an open Duo. */
export function ChatView({ bot, maxWidth, inPane = false }: { bot: string; maxWidth?: number; inPane?: boolean }) {
  const insets = useSafeAreaInsets();
  const [client, setClient] = useState<HermesClient | null>(null);
  const [state, dispatch] = useReducer(chatReducer, initialChat);
  const [draft, setDraft] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const listRef = useRef<FlatList<ChatMessage>>(null);
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

  const rows: ChatMessage[] = state.pending
    ? [...state.messages, { id: 'pending', role: 'assistant', content: state.pending.text }]
    : state.messages;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top + 44}
    >
      {inPane ? (
        <View style={styles.paneHeader}>
          <Text style={[styles.paneTitle, { color: botColor(bot) }]}>{bot}</Text>
        </View>
      ) : null}
      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={(m) => m.id}
        contentContainerStyle={[styles.list, maxWidth ? { maxWidth, width: '100%', alignSelf: 'center' } : null]}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={
          client ? <Text style={styles.hint}>Say something to {bot}.</Text> : state.error ? undefined : <ActivityIndicator style={{ marginTop: 40 }} />
        }
        renderItem={({ item }) =>
          item.id === 'pending' && state.pending ? (
            <View style={{ gap: 6 }}>
              {state.pending.tools.map((t, i) => (
                <ToolRow key={i} tool={t} />
              ))}
              {state.pending.text ? (
                <Bubble role="assistant" text={state.pending.text} bot={bot} />
              ) : (
                <Text style={styles.hint}>
                  {bot} is thinking… {elapsed}s
                </Text>
              )}
            </View>
          ) : item.role === 'tool' ? (
            <ToolRow tool={{ name: item.toolName ?? 'tool', preview: item.content || null, status: 'done' }} />
          ) : (
            <Bubble role={item.role} text={item.content} bot={bot} />
          )
        }
      />
      {state.error ? <Text style={styles.error}>{state.error}</Text> : null}
      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }, maxWidth ? { maxWidth, width: '100%', alignSelf: 'center' } : null]}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder={`Message ${bot}`}
          placeholderTextColor={colors.dim}
          multiline
          editable={!!client}
        />
        {running ? (
          <Pressable style={[styles.send, { backgroundColor: colors.bad }]} onPress={stop} disabled={!state.runId}>
            <Text style={styles.sendText}>Stop</Text>
          </Pressable>
        ) : (
          <Pressable style={[styles.send, (!draft.trim() || !client) && { opacity: 0.4 }]} onPress={send}>
            <Text style={styles.sendText}>Send</Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ role, text, bot }: { role: ChatMessage['role']; text: string; bot: string }) {
  const mine = role === 'user';
  return (
    <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
      {!mine ? <Text style={[styles.who, { color: botColor(bot) }]}>{bot}</Text> : null}
      <Text style={styles.text} selectable>
        {text}
      </Text>
    </View>
  );
}

// Tool calls show inline and collapsed: tap to see what it ran.
function ToolRow({ tool }: { tool: ToolCall }) {
  const [open, setOpen] = useState(false);
  const icon = tool.status === 'running' ? '…' : tool.status === 'failed' ? '✕' : '✓';
  return (
    <Pressable onPress={() => setOpen(!open)} style={styles.tool}>
      <Text style={styles.toolText}>
        {icon} {tool.name}
      </Text>
      {open && tool.preview ? <Text style={[styles.toolText, { fontFamily: mono }]}>{tool.preview}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  paneHeader: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  paneTitle: { fontSize: 17, fontWeight: '600' },
  list: { padding: 14, gap: 10 },
  hint: { color: colors.dim, fontSize: 14, textAlign: 'center', marginTop: 8 },
  bubble: { maxWidth: '86%', padding: 12, borderRadius: 16 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.user },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.card },
  who: { fontSize: 12, fontWeight: '600', marginBottom: 3 },
  text: { color: colors.text, fontSize: 16, lineHeight: 22 },
  tool: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: 4,
  },
  toolText: { color: colors.dim, fontSize: 13 },
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
