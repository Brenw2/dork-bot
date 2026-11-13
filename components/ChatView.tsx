import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { fetch } from '@/components/net';
import { Menu } from '@/components/alert';
import { chatName } from '@/lib/chats';
import { noteIndex, type RoutineNote } from '@/lib/routineNotes';
import { whenLabel } from '@/lib/routines';
import { BotSprite } from '@/components/BotSprite';
import { Markdown, BODY_SIZE } from '@/components/Markdown';
import { isDesktop } from '@/components/desktop';
import { PICK_SOURCES, pickImages, useImageDrop, type PickSource } from '@/components/pickImages';
import { useHermesImage } from '@/components/useHermesImage';
import { attachmentProblem, MAX_IMAGES, messageBody, type Attachment } from '@/lib/attachments';
import { activity } from '@/lib/activity';
import { connectorNotes } from '@/lib/connectorNotes';
import { getConnection } from '@/lib/bots';
import { activityLine, awaitingReply, chatReducer, chatRows, initialChat, rowGap, type ChatRow } from '@/lib/chatState';
import { HermesClient, type ApprovalChoice, type ApprovalRequest, type ChatMessage, type FetchLike } from '@/lib/hermes';
import { currentChat, openChat, startNewChat, latestChat, useCurrentChat } from '@/components/currentChat';
import { notificationsSupported, useOnScreen } from '@/components/notifications';
import { WorkingOn } from '@/components/WorkingOn';
import { Alert } from '@/components/alert';
import { moodFromChat } from '@/lib/sprites';
import { useBotLook } from '@/components/useBotLook';
import { renameBot, useBotName } from '@/components/useBotName';
import { useChatModel } from '@/components/useChatModel';
import { liveRuns, liveRunsReady } from '@/components/liveRuns';
import { keepWorking } from '@/components/busyWatch';
import { leaveAction } from '@/lib/busy';
import { providerName } from '@/lib/models';
import { ArrowUpIcon, PlusIcon, StopIcon } from '@/components/ChatIcons';
import { Activity, ApprovalCard, DecisionChip, TypingRow, useDesk } from '@/components/ChatStatus';
import { colors, mix, mono, onColor } from '@/lib/theme';

export { Activity };

const WEB = Platform.OS === 'web';
const INPUT_PANE_SHARE = 0.4; // desktop: the message box grows to this share of the chat pane's height

interface ChatViewProps {
  bot: string;
  maxWidth?: number;
  inPane?: boolean;
  /** In a pane next to the bot list: the button that hides or shows that list. */
  list?: { hidden: boolean; toggle: () => void };
  /** A routine note to scroll to once the chat has it (a tapped "Notify me" notification): its time stamp. */
  focusAt?: string;
}

/**
 * The bot's open chat (its most recent one unless another was picked). Used full screen
 * (app/chat/[bot].tsx) and as the chat pane next to the bot list.
 */
export function ChatView(props: ChatViewProps) {
  const chat = useCurrentChat(props.bot);
  useOnScreen(props.bot);
  if (!chat) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator style={{ marginTop: 40 }} />
      </View>
    );
  }
  return <ChatThread key={chat} {...props} chat={chat} />;
}

function ChatThread({ bot, chat, maxWidth, inPane = false, list, focusAt }: ChatViewProps & { chat: string }) {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [client, setClient] = useState<HermesClient | null>(null);
  const [state, dispatch] = useReducer(chatReducer, initialChat);
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const [attached, setAttached] = useState<Attachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const addImages = useCallback((more: Attachment[]) => {
    if (!more.length) return;
    setAttached((cur) => {
      const next = [...cur, ...more].slice(0, MAX_IMAGES);
      setAttachError(attachmentProblem(next));
      return next;
    });
  }, []);
  const abortRef = useRef<AbortController | null>(null);
  const startedAt = useRef(0);
  const sessionId = chat;
  // Bumped to retry the first load (b-lab was unreachable): every 5 s, and when the app comes back.
  const [attempt, setAttempt] = useState(0);

  // Connect and load the chat's history (a new chat has none; Hermes creates it on the first
  // message). If a reply was still running when this chat was last open (or the app was closed),
  // show that it's still working.
  useEffect(() => {
    let live = true;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let sub: { remove: () => void } | null = null;
    (async () => {
      const conn = await getConnection(bot);
      if (!conn) return dispatch({ type: 'failed', message: `No saved key for ${bot}.` });
      const c = new HermesClient(conn, fetch as unknown as FetchLike);
      try {
        const [messages] = await Promise.all([c.messages(sessionId), liveRunsReady]);
        if (live) {
          setClient(c);
          dispatch({ type: 'loaded', messages });
          const run = liveRuns.get(sessionId);
          const sentElsewhere = awaitingReply(messages, Date.now() / 1000);
          if (run && !liveRuns.isStreaming(sessionId)) {
            startedAt.current = run.startedAt;
            dispatch({ type: 'resumed', runId: run.runId });
            if (run.approval) dispatch({ type: 'approval', request: run.approval });
          } else if (sentElsewhere !== null && !liveRuns.isStreaming(sessionId)) {
            startedAt.current = sentElsewhere * 1000;
            dispatch({ type: 'remote' });
          }
        }
      } catch (e) {
        if (!live) return;
        dispatch({ type: 'failed', message: (e as Error).message });
        retry = setTimeout(() => setAttempt((n) => n + 1), 5000);
        sub = AppState.addEventListener('change', (s) => s === 'active' && setAttempt((n) => n + 1));
      }
    })();
    return () => {
      live = false;
      if (retry) clearTimeout(retry);
      sub?.remove();
      // Hanging up doesn't stop the reply on Hermes: hand it to the background checks.
      liveRuns.detach(sessionId);
      abortRef.current?.abort();
    };
  }, [bot, sessionId, attempt]);

  // A reply this screen isn't streaming finished: load it from the history.
  const resumed = !!state.pending?.resumed;
  useEffect(() => {
    if (!client) return;
    const reload = () =>
      client
        .messages(sessionId)
        .then((messages) => dispatch({ type: 'loaded', messages }))
        .catch(() => undefined);
    const off = liveRuns.subscribe((c, run) => {
      if (c !== sessionId) return;
      if (run) return dispatch({ type: 'approval', request: run.approval ?? null });
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

  // The same chat is open on the other devices: pick up what they send (and their replies), and
  // show the bot working on a message sent from elsewhere. A cheap count check every few seconds,
  // the full history only when it changed.
  const pendingRef = useRef(state.pending);
  pendingRef.current = state.pending;
  const msgCount = useRef<number | null>(null);
  useEffect(() => {
    if (!client) return;
    let live = true;
    let busy = false;
    const check = async () => {
      // This screen is streaming a reply itself; the history catches up when it's done.
      if (busy || (pendingRef.current && !pendingRef.current.resumed)) return;
      busy = true;
      try {
        const count = await client.messageCount(sessionId);
        if (!live || count === msgCount.current) return;
        const first = msgCount.current === null;
        msgCount.current = count;
        if (first) return; // the initial load already has this history
        const messages = await client.messages(sessionId);
        if (!live || (pendingRef.current && !pendingRef.current.resumed)) return;
        dispatch({ type: 'loaded', messages });
        const sentAt = awaitingReply(messages, Date.now() / 1000);
        if (pendingRef.current?.remote && sentAt === null) dispatch({ type: 'settled' });
        else if (!pendingRef.current && sentAt !== null) {
          startedAt.current = sentAt * 1000;
          dispatch({ type: 'remote' });
        }
      } catch {
        // offline for a moment; try again on the next tick
      } finally {
        busy = false;
      }
    };
    void check();
    const id = setInterval(check, 4000);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void check());
    return () => {
      live = false;
      clearInterval(id);
      sub.remove();
    };
  }, [client, sessionId]);

  // Tell the rest of the app what this bot is doing, so its character animates everywhere.
  const mood = moodFromChat(state);
  const firstMood = useRef(true);
  useEffect(() => {
    // Opening a chat while the bot is busy elsewhere (a terminal run, a routine, a reply left running):
    // an idle chat must not turn that "working" into "done".
    const first = firstMood.current;
    firstMood.current = false;
    if (first && mood === 'idle' && activity.get(bot) === 'working') return;
    activity.set(bot, mood);
  }, [bot, mood]);
  // Leaving the chat: idle, unless the reply is still running. A run Hermes is tracking stays "working"
  // until the background checks see it end; a reply with no run yet is handed to the busy watch. Either
  // way "done" only shows once the reply really finished.
  useEffect(
    () => () => {
      const action = leaveAction({ runTracked: liveRuns.botBusy(bot), replying: !!pendingRef.current });
      if (action === 'hold') activity.set(bot, 'working');
      else if (action === 'adopt') keepWorking(bot);
      else activity.set(bot, 'idle');
    },
    [bot],
  );

  // The typing row counts "Still working" from startedAt (after 10 s); no timer here.
  const running = state.pending !== null;
  const remote = !!state.pending?.remote;

  // Typed while a reply was running: goes out, in order, once that reply is done.
  const [queued, setQueued] = useState<{ text: string; images: Attachment[] }[]>([]);

  const submit = async (text: string, images: Attachment[]) => {
    if (!client) return;
    const tooBig = attachmentProblem(images);
    if (tooBig) return setAttachError(tooBig);
    setAttachError(null);
    pinned.current = true;
    startedAt.current = Date.now();
    dispatch({ type: 'send', text, images: images.map((im) => im.dataUrl) });
    const abort = new AbortController();
    abortRef.current = abort;
    let runId: string | null = null;
    try {
      await client.ensureSession(sessionId);
      await client.chat(
        sessionId,
        messageBody(text, images),
        (event) => {
          if (event.type === 'tool' && event.phase === 'started') connectorNotes.toolUsed(bot, event.name);
          if (event.type === 'started' && event.runId) {
            runId = event.runId;
            liveRuns.start(bot, sessionId, runId);
          }
          if (event.type === 'finished') liveRuns.finish(sessionId);
          dispatch({ type: 'event', event });
        },
        abort.signal,
        { instructions: connectorNotes.instructions(bot) },
      );
      // The stream can end without run.completed (the phone dropped the connection): if Hermes
      // still has the run, keep showing that the bot is working.
      if (runId && liveRuns.get(sessionId)) {
        liveRuns.detach(sessionId);
        dispatch({ type: 'resumed', runId });
      } else dispatch({ type: 'ended' });
    } catch (e) {
      if (abort.signal.aborted) dispatch({ type: 'ended' });
      else if (runId && liveRuns.get(sessionId)) {
        // Network dropped or the app was backgrounded mid-reply; the reply carries on on Hermes.
        liveRuns.detach(sessionId);
        dispatch({ type: 'resumed', runId });
      } else dispatch({ type: 'failed', message: (e as Error).message });
    } finally {
      startedAt.current = liveRuns.get(sessionId)?.startedAt ?? 0;
    }
  };

  const send = () => {
    const text = draft.trim();
    const images = attached;
    if ((!text && !images.length) || !client) return;
    const tooBig = attachmentProblem(images);
    if (tooBig) return setAttachError(tooBig);
    setDraft('');
    setAttached([]);
    setAttachError(null);
    if (running && !remote) return setQueued((q) => [...q, { text, images }]);
    void submit(text, images);
  };
  // The reply is done: send what was queued behind it.
  useEffect(() => {
    if (running || !client || !queued.length) return;
    const [next, ...rest] = queued;
    setQueued(rest);
    void submit(next.text, next.images);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, client, queued]);

  const [answering, setAnswering] = useState(false);
  const answer = async (choice: ApprovalChoice) => {
    const request = state.approval;
    const runId = state.runId ?? liveRuns.get(sessionId)?.runId;
    if (!client || !request || !runId) return;
    setAnswering(true);
    try {
      await client.approve(runId, choice, request.requestId);
      dispatch({ type: 'answered', choice });
    } catch (e) {
      dispatch({ type: 'approval', request: null });
      Alert.alert("Couldn't answer", (e as Error).message);
    } finally {
      setAnswering(false);
    }
  };

  const stop = () => {
    if (client && state.runId) client.stop(state.runId).catch(() => undefined);
  };

  // Phone: an inverted list (newest at the bottom, opens there however long the history is).
  // Web (the desktop app): react-native-web scrolls an inverted list in script, so the wheel jumps,
  // trackpad momentum is lost and the scrollbar runs backwards. There it's a normal list, pinned
  // to the bottom while you're at the bottom (new messages, the streaming reply).
  const queuedText = useMemo(() => queued.map((q) => q.text), [queued]);
  const rows = useMemo(() => (WEB ? chatRows(state, queuedText) : chatRows(state, queuedText).reverse()), [state, queuedText]);
  const listRef = useRef<FlatList<ChatRow>>(null);
  const pinned = useRef(true);
  const onScroll = (e: { nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } } }) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    pinned.current = contentSize.height - layoutMeasurement.height - contentOffset.y < 80;
  };
  // scrollToEnd does nothing here until the list has measured itself, so scroll to the height we're given.
  const contentHeight = useRef(0);
  const followBottom = (h = contentHeight.current) => {
    contentHeight.current = h;
    if (pinned.current) listRef.current?.scrollToOffset({ offset: h, animated: false });
  };
  // An approval card arrives at the end of the transcript: bring it into view (it can be taller than the space on a small screen).
  const approvalId = state.approval?.requestId ?? state.approval?.command ?? null;
  useEffect(() => {
    if (!approvalId) return;
    pinned.current = true;
    followBottom();
    const t = setTimeout(() => followBottom(), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approvalId]);
  // A tapped "Notify me" notification: scroll to the routine's message once the chat has it (it can land a few seconds after the push).
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (!focusAt || scrolledTo.current === focusAt) return;
    const index = noteIndex(rows, focusAt);
    if (index < 0) return;
    scrolledTo.current = focusAt;
    pinned.current = false;
    const t = setTimeout(() => listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true }), 60);
    return () => clearTimeout(t);
  }, [focusAt, rows]);
  // Desktop (web): the message box starts at one line and grows with its text up to 40% of the chat pane, then scrolls.
  // The field is 44 tall on the desktop, 36 on the phone (design fix 3); the textarea has no border or padding of its
  // own beyond the text's, so its height is the field's height.
  const desk = useDesk();
  const fieldMin = desk ? 44 : 36;
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const [paneHeight, setPaneHeight] = useState(0);
  const [inputHeight, setInputHeight] = useState<number | undefined>(undefined);
  const inputCap = paneHeight ? Math.round(paneHeight * INPUT_PANE_SHARE) : undefined;
  useLayoutEffect(() => {
    if (!WEB) return;
    const el = inputRef.current as unknown as HTMLTextAreaElement | null;
    if (!el || !el.style) return;
    const was = el.style.height; // React's own value; put it back so an unchanged height stays applied
    el.style.height = '0px'; // measure the content on its own, so the box can shrink too
    const border = el.offsetHeight - el.clientHeight; // scrollHeight leaves the border out
    const h = el.scrollHeight < fieldMin + 10 ? fieldMin : el.scrollHeight + border;
    el.style.height = was;
    const next = Math.max(fieldMin, inputCap ? Math.min(h, inputCap) : h);
    // No scrollbar until the text reaches the cap (a box under it never needs one).
    el.style.overflowY = inputCap && h >= inputCap ? 'auto' : 'hidden';
    setInputHeight(next);
  }, [draft, inputCap, fieldMin]);
  const column = maxWidth ? { maxWidth, width: '100%' as const, alignSelf: 'center' as const } : null;
  const canSend = (!!draft.trim() || attached.length > 0) && !!client;
  // Send/Stop: a 30 circle 3 in from the field's corner (desktop 32, 6 in); the field's own line is a hairline.
  const roundSize = desk
    ? { width: 32, height: 32, borderRadius: 16, right: 6 - StyleSheet.hairlineWidth, bottom: 6 - StyleSheet.hairlineWidth }
    : { width: 30, height: 30, borderRadius: 15, right: 3 - StyleSheet.hairlineWidth, bottom: 3 - StyleSheet.hairlineWidth };
  const disconnected = !client && !!state.error && !state.error.startsWith('No saved key');
  const { color } = useBotLook(bot);
  const name = useBotName(bot);
  const onBot = onColor(color);
  useImageDrop(addImages, !!client);
  const attach = (source: PickSource) => void pickImages(source, attached.length).then(addImages).catch((e: Error) => setAttachError(e.message));
  const openAttach = (anchor?: { x: number; y: number }) =>
    PICK_SOURCES.length === 1
      ? attach(PICK_SOURCES[0].source)
      : Menu.show('Add a picture', [...PICK_SOURCES.map((p) => ({ text: p.label, onPress: () => attach(p.source) })), { text: 'Cancel', style: 'cancel' as const }], anchor);
  const warming = useConnectorWarmup(bot);

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}
      onLayout={WEB ? (e) => setPaneHeight(e.nativeEvent.layout.height) : undefined}
    >
      {inPane ? (
        <View style={styles.paneHeader}>
          {list ? (
            <Pressable
              onPress={list.toggle}
              accessibilityRole="button"
              accessibilityLabel={list.hidden ? 'Show the bot list' : 'Hide the bot list'}
              hitSlop={8}
              style={({ pressed }) => [styles.listToggle, pressed && { opacity: 0.6 }]}
            >
              <Text style={[styles.headerButton, { color }]}>{list.hidden ? '› Bots' : '‹ Hide'}</Text>
            </Pressable>
          ) : null}
          <BotSprite bot={bot} size={30} />
          <View>
            <Text style={[styles.paneTitle, { color }]}>{name}</Text>
            <WorkingOn bot={bot} />
          </View>
          <View style={{ flex: 1 }} />
          <ChatActions bot={bot} />
        </View>
      ) : null}
      <ModelBar bot={bot} style={column} color={color} />
      <FlatList
        ref={listRef}
        inverted={!WEB}
        {...(WEB
          ? {
              onScroll,
              scrollEventThrottle: 50,
              onContentSizeChange: (_w: number, h: number) => followBottom(h),
              onLayout: () => followBottom(),
              // Chats are short enough to draw whole; virtualizing from the top made the list jump
              // while it filled in on the way to the bottom.
              initialNumToRender: 10_000,
              windowSize: 10_000,
            }
          : null)}
        data={rows}
        extraData={answering}
        keyExtractor={(r) => r.id}
        onScrollToIndexFailed={(info) => {
          // Rows not measured yet: go near, then try the exact one again.
          listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
          setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0.5, animated: true }), 120);
        }}
        style={styles.list}
        contentContainerStyle={[styles.listBody, column]}
        keyboardDismissMode="interactive"
        ListEmptyComponent={
          <View style={WEB ? styles.emptyWeb : styles.flip}>
            {client ? (
              <Text style={styles.hint}>Say something to {name}.</Text>
            ) : state.error ? null : (
              <ActivityIndicator style={{ marginTop: 40 }} />
            )}
          </View>
        }
        renderItem={({ item, index }) => (
          <Row
            // Space above each row follows who spoke before it (rowGap). `rows` is oldest-first on the web
            // and newest-first on the phone's inverted list, so "before" is the neighbour on the other side.
            gap={rowGap(rows[WEB ? index - 1 : index + 1], item)}
            row={item}
            bot={bot}
            since={startedAt.current}
            approval={{ busy: answering, onAnswer: answer }}
          />
        )}
      />
      {state.error ? <Text style={styles.error}>{state.error}</Text> : null}
      {warming.length ? (
        <Text style={[styles.warming, column]} accessibilityLiveRegion="polite">
          {warming.map((w) => w.name).join(', ')} still connecting to {bot}, about {Math.max(...warming.map((w) => w.secondsLeft))} s
        </Text>
      ) : null}
      {attached.length ? (
        <ScrollView horizontal style={[styles.attachRow, column]} contentContainerStyle={styles.attachRowBody} keyboardShouldPersistTaps="handled">
          {attached.map((im, i) => (
            <View key={i} style={styles.thumbWrap}>
              <Image source={{ uri: im.dataUrl }} style={styles.thumb} accessibilityLabel={`Picture ${i + 1}`} />
              <Pressable
                style={styles.thumbRemove}
                onPress={() =>
                  setAttached((cur) => {
                    const next = cur.filter((_, j) => j !== i);
                    setAttachError(attachmentProblem(next));
                    return next;
                  })
                }
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`Remove picture ${i + 1}`}
              >
                <Text style={styles.thumbRemoveText}>✕</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
      {attachError ? <Text style={[styles.error, column]}>{attachError}</Text> : null}
      <View style={[{ paddingTop: 8, paddingHorizontal: 12, paddingBottom: Math.max(insets.bottom, 8) }, column]}>
        <View style={styles.composer}>
          <Pressable
            style={({ pressed }) => [styles.attach, { width: fieldMin, height: fieldMin, borderRadius: fieldMin / 2 }, pressed && { opacity: 0.6 }]}
            onPress={(e) => openAttach({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
            disabled={!client || attached.length >= MAX_IMAGES}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel="Add a picture"
          >
            <PlusIcon size={18} color={colors.dim} />
          </Pressable>
          <View testID="composer-field" style={[styles.field, { minHeight: fieldMin, borderRadius: fieldMin / 2 }, disconnected && { opacity: 0.5 }]}>
            <TextInput
              ref={inputRef}
              style={[
                styles.input,
                desk ? { fontSize: 16, lineHeight: 24, paddingVertical: 10, paddingRight: 44 } : { fontSize: 17, lineHeight: 22, paddingVertical: 7, paddingRight: 36, maxHeight: 6 * 22 + 14 },
                WEB && inputHeight !== undefined && { height: inputHeight, maxHeight: inputCap ?? 140 },
                WEB && ({ outlineStyle: 'none' } as object),
              ]}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              value={draft}
              onChangeText={setDraft}
              placeholder={disconnected ? "Can't reach b-lab" : `Message ${name}`}
              placeholderTextColor={colors.faint}
              accessibilityLabel={`Message ${name}`}
              multiline
              // Desktop: Enter sends, Shift+Enter is a new line.
              {...(Platform.OS === 'web'
                ? {
                    onKeyPress: (e: { nativeEvent: { key: string; shiftKey?: boolean }; preventDefault: () => void }) => {
                      if (e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
                        e.preventDefault();
                        void send();
                      }
                    },
                  }
                : null)}
              // The web build (layout tests, previews) draws a multiline box two rows tall; iOS starts at one.
              {...(Platform.OS === 'web' ? { numberOfLines: 1 } : null)}
              editable={!!client}
            />
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.fieldLine, { borderRadius: fieldMin / 2 }]} />
            {canSend ? (
              <Pressable
                testID="composer-send"
                style={[styles.roundButton, roundSize, { backgroundColor: color }]}
                onPress={send}
                accessibilityRole="button"
                accessibilityLabel="Send"
              >
                <ArrowUpIcon size={16} color={onBot} />
              </Pressable>
            ) : running && !remote ? (
              <Pressable
                testID="composer-stop"
                style={[styles.roundButton, roundSize, { backgroundColor: colors.text }]}
                onPress={stop}
                disabled={!state.runId}
                accessibilityRole="button"
                accessibilityLabel="Stop"
              >
                <StopIcon color={colors.bg} />
              </Pressable>
            ) : null}
          </View>
        </View>
        {desk && focused ? (
          <Text style={styles.hintLine} accessibilityElementsHidden importantForAccessibility="no">
            Enter to send · Shift+Enter for a new line
          </Text>
        ) : null}
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

/**
 * The chat header's buttons: Chats (the bot's chats, and New chat) and ⋯ (new chat, rename or
 * delete this chat, routines, connectors). In the chat header and the open-Duo pane header.
 */
export function ChatActions({ bot }: { bot: string }) {
  const { color } = useBotLook(bot);
  const name = useBotName(bot);
  const more = (anchor?: { x: number; y: number }) =>
    Menu.show(
      name,
      [
        { text: 'Rename bot…', onPress: () => renameBot(bot, name) },
        { text: 'New chat', onPress: () => void startNewChat(bot) },
        { text: 'Rename this chat…', onPress: () => void renameOpenChat(bot) },
        { text: 'Delete this chat…', style: 'destructive' as const, onPress: () => void deleteOpenChat(bot) },
        { text: 'Work…', onPress: () => router.push({ pathname: '/work/[bot]', params: { bot } }) },
        { text: 'Routines…', onPress: () => router.push({ pathname: '/routines/[bot]', params: { bot } }) },
        { text: 'Routine results…', onPress: () => router.push({ pathname: '/routine-results/[bot]', params: { bot } }) },
        { text: 'Connectors…', onPress: () => router.push({ pathname: '/connectors/[bot]', params: { bot } }) },
        ...(notificationsSupported ? [{ text: 'Notifications…', onPress: () => router.push('/notifications') }] : []),
        { text: 'Cancel', style: 'cancel' as const },
      ],
      anchor,
    );
  return (
    <View style={styles.actions}>
      <Pressable
        onPress={() => router.push({ pathname: '/chats/[bot]', params: { bot } })}
        accessibilityRole="button"
        accessibilityLabel={`${name}'s chats`}
        hitSlop={8}
      >
        <Text style={[styles.headerButton, { color }]}>Chats</Text>
      </Pressable>
      <Pressable
        onPress={(e) => more({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
        accessibilityRole="button"
        accessibilityLabel={`More for this chat with ${name}`}
        hitSlop={8}
      >
        <Text style={[styles.headerButton, styles.moreButton, { color }]}>⋯</Text>
      </Pressable>
    </View>
  );
}

async function chatClient(bot: string): Promise<HermesClient | null> {
  const conn = await getConnection(bot);
  return conn ? new HermesClient(conn, fetch as unknown as FetchLike) : null;
}

/** Renames the open chat (an empty name hands naming back to Hermes). */
export async function renameChat(bot: string, chat: string): Promise<void> {
  const client = await chatClient(bot);
  if (!client) return;
  const current = (await client.listChats().catch(() => [])).find((c) => c.id === chat);
  if (!current) return Alert.alert('Nothing to rename yet', 'Send a message first; the chat starts then.');
  Alert.prompt(
    'Rename chat',
    `Now: ${chatName(bot, current)}`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Rename',
        onPress: (title?: string) => {
          client.renameChat(chat, title ?? '').then(notifyChatsChanged, (e: Error) => Alert.alert("Couldn't rename it", e.message));
        },
      },
    ],
    'plain-text',
  );
}

/** Deletes a chat on Hermes (after a confirm) and opens the bot's next most recent one. */
export async function deleteChat(bot: string, chat: string): Promise<void> {
  const client = await chatClient(bot);
  if (!client) return;
  Alert.alert('Delete this chat?', 'Its messages are deleted on Hermes, on every device. The bot keeps its memory.', [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Delete',
      style: 'destructive',
      onPress: async () => {
        try {
          await client.deleteChat(chat);
          notifyChatsChanged();
          if (currentChat(bot) === chat) {
            const next = (await client.listChats().catch(() => [])).find((c) => c.id !== chat);
            if (next) openChat(bot, next.id);
            else startNewChat(bot);
          }
        } catch (e) {
          Alert.alert("Couldn't delete it", (e as Error).message);
        }
      },
    },
  ]);
}

const renameOpenChat = async (bot: string) => renameChat(bot, currentChat(bot) ?? (await latestChat(bot)));
const deleteOpenChat = async (bot: string) => deleteChat(bot, currentChat(bot) ?? (await latestChat(bot)));

const chatsListeners = new Set<() => void>();
/** The chat list re-reads when a chat is renamed or deleted from a menu. */
export function onChatsChanged(fn: () => void): () => void {
  chatsListeners.add(fn);
  return () => void chatsListeners.delete(fn);
}
function notifyChatsChanged() {
  chatsListeners.forEach((fn) => fn());
}

/** The chat's model ("claude-opus-5-5 · Anthropic"); tap to switch. Turns red when the model can't work. */
function ModelBar({ bot, style, color }: { bot: string; style: ViewStyle | null; color: string }) {
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
      <Text style={[styles.modelChange, { color }]}>Change</Text>
    </Pressable>
  );
}

function Row({ row, bot, since, gap, approval }: { row: ChatRow; bot: string; since: number; gap: number; approval: { busy: boolean; onAnswer: (c: ApprovalChoice) => void } }) {
  return (
    <View style={{ marginTop: gap }}>
      <RowBody row={row} bot={bot} since={since} approval={approval} />
    </View>
  );
}

function RowBody({ row, bot, since, approval }: { row: ChatRow; bot: string; since: number; approval: { busy: boolean; onAnswer: (c: ApprovalChoice) => void } }) {
  switch (row.kind) {
    case 'message':
      if (row.message.routine) return <RoutineNoteView note={row.message.routine} bot={bot} />;
      return row.message.role === 'user' ? <Mine message={row.message} bot={bot} /> : <Reply text={row.message.content} bot={bot} />;
    case 'activity':
      return <Activity tools={row.tools} live={row.live} />;
    case 'pending':
      return row.text ? <Reply text={row.text} bot={bot} /> : <TypingRow bot={bot} since={since} />;
    case 'approval':
      return <ApprovalCard request={row.request} bot={bot} busy={approval.busy} onAnswer={approval.onAnswer} />;
    case 'decision':
      return <DecisionChip decision={row.decision} bot={bot} />;
    case 'queued':
      return (
        <View style={{ opacity: 0.6 }}>
          <Mine message={{ id: row.id, role: 'user', content: row.text } as ChatMessage} bot={bot} />
        </View>
      );
  }
}

/** A "Notify me" routine's result in the chat: from the bot, headed with the routine's name and when it ran. */
function RoutineNoteView({ note, bot }: { note: RoutineNote; bot: string }) {
  const { color } = useBotLook(bot);
  // 1:1 chats show no bot name above the card (the left bar and header say who/what); a group room (G3) would add it.
  return (
    <View style={[styles.reply, styles.routineNote, { borderLeftColor: color }]} accessibilityLabel={`Routine ${note.name}, ${whenLabel(note.at)}`}>
      <Text style={styles.routineHead}>
        Routine · {note.name} · {whenLabel(note.at)}
      </Text>
      {note.text ? <Markdown text={note.text} accent={color} /> : null}
    </View>
  );
}

/** A bot reply: formatted text across the chat's width. 1:1 chats show no name over it (a group room would). */
export function Reply({ text, bot }: { text: string; bot: string }) {
  const { color } = useBotLook(bot);
  return (
    <View style={styles.reply}>
      <Markdown text={text} accent={color} />
    </View>
  );
}

/** What you sent: a bubble tinted with the bot's color, with any pictures above the text. */
export function Mine({ message, bot }: { message: ChatMessage; bot: string }) {
  const { color } = useBotLook(bot);
  const local = message.localImages ?? [];
  const remote = local.length ? [] : (message.images ?? []);
  return (
    <View style={[styles.mine, { maxWidth: isDesktop ? '70%' : '78%' }]}>
      {local.length || remote.length ? (
        <View style={styles.pictures}>
          {local.map((uri, i) => (
            <Picture key={`l${i}`} uri={uri} count={local.length} />
          ))}
          {remote.map((path) => (
            <HermesPicture key={path} bot={bot} path={path} count={remote.length} />
          ))}
        </View>
      ) : null}
      {message.content ? (
        <View style={[styles.bubble, { backgroundColor: mix(color, 0.3) }]}>
          <Text style={styles.text} selectable>
            {message.content}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function HermesPicture({ bot, path, count }: { bot: string; path: string; count: number }) {
  const { uri, failed } = useHermesImage(bot, path);
  if (uri) return <Picture uri={uri} count={count} />;
  return (
    <View style={[styles.picture, pictureSize(count), styles.picturePlaceholder]}>
      {failed ? <Text style={styles.pictureNote}>Picture</Text> : <ActivityIndicator color={colors.dim} />}
    </View>
  );
}

/** Several pictures: square tiles. One: its own shape, within 300 × 300. */
const pictureSize = (count: number, aspect?: number) => {
  if (count > 1) return { width: 124, height: 124 };
  if (!aspect) return { width: 260, height: 200 };
  return aspect >= 1 ? { width: 300, height: Math.round(300 / aspect) } : { width: Math.round(300 * aspect), height: 300 };
};

/** A sent picture; tap for full size. */
function Picture({ uri, count }: { uri: string; count: number }) {
  const [open, setOpen] = useState(false);
  const [aspect, setAspect] = useState<number | undefined>();
  useEffect(() => {
    if (count > 1) return;
    Image.getSize(uri, (w, h) => h > 0 && setAspect(w / h), () => undefined);
  }, [uri, count]);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="imagebutton" accessibilityLabel="Picture. Open full size">
        <Image source={{ uri }} style={[styles.picture, pictureSize(count, aspect)]} resizeMode="cover" />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.viewer} onPress={() => setOpen(false)} accessibilityLabel="Close picture">
          <Image source={{ uri }} style={styles.viewerImage} resizeMode="contain" />
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  headerButton: { color: colors.accent, fontSize: 16 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingRight: 8 },
  moreButton: { fontSize: 20, fontWeight: '700', paddingHorizontal: 2 },
  listToggle: { marginRight: 4 },
  paneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
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
  // No list gap: each row carries its own space above it (rowGap).
  listBody: { flexGrow: 1, padding: 14 },
  // An inverted list draws its empty state upside down unless it's flipped back.
  flip: { flex: 1, transform: [{ scaleY: -1 }], justifyContent: 'flex-end' },
  emptyWeb: { flex: 1, justifyContent: 'flex-end' },
  hint: { color: colors.dim, fontSize: 14, textAlign: 'center', marginTop: 8 },
  bubble: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, alignSelf: 'flex-end' },
  mine: { alignSelf: 'flex-end', gap: 4, alignItems: 'flex-end' },
  reply: { alignSelf: 'stretch', paddingRight: 4 },
  routineNote: { borderLeftWidth: 3, paddingLeft: 10 },
  routineHead: { color: colors.dim, fontSize: 12, marginBottom: 10 },
  pictures: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' },
  picture: { borderRadius: 14, backgroundColor: colors.card },
  picturePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  pictureNote: { color: colors.dim, fontSize: 13 },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  viewerImage: { width: '100%', height: '100%' },
  attachRow: { flexGrow: 0, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  attachRowBody: { gap: 8, paddingHorizontal: 12, paddingTop: 10 },
  thumbWrap: { width: 64, height: 64 },
  thumb: { width: 64, height: 64, borderRadius: 10, backgroundColor: colors.card },
  thumbRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbRemoveText: { color: colors.text, fontSize: 11, fontWeight: '700' },
  attach: { backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  text: { color: colors.text, fontSize: BODY_SIZE, lineHeight: 22 },
  error: { color: colors.bad, fontSize: 14, paddingHorizontal: 16, paddingBottom: 6 },
  warming: { color: colors.dim, fontSize: 13, paddingHorizontal: 16, paddingBottom: 6 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end', // the plus stays level with the bottom line as the field grows
    gap: 8,
  },
  // The field holds its Send/Stop circle (design fix 3), so they never change its width.
  field: { flex: 1, backgroundColor: colors.card, justifyContent: 'center' },
  fieldLine: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  input: { color: colors.text, paddingLeft: 14 },
  roundButton: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  hintLine: { color: colors.faint, fontSize: 12, lineHeight: 16, marginTop: 6, marginLeft: 52 },
});
