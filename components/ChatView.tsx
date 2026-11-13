import { router } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetch } from '@/components/net';
import { Menu } from '@/components/alert';
import { chatName } from '@/lib/chats';
import { noteIndex } from '@/lib/routineNotes';
import { focusPosition, focusStep, ROUTINE_FOCUS, ROUTINE_MOTION } from '@/lib/routineCard';
import { whenLabel } from '@/lib/routines';
import { RoutineCard } from '@/components/RoutineCard';
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
import { HermesClient, HermesError, type ApprovalChoice, type ApprovalRequest, type ChatMessage, type FetchLike } from '@/lib/hermes';
import { currentChat, openChat, startNewChat, latestChat, useCurrentChat } from '@/components/currentChat';
import { useOnScreen } from '@/components/notifications';
import { ChatHeader, ModelBanner } from '@/components/ChatHeader';
import { FailureBanner, FailureCard, useRetryCountdown } from '@/components/ChatErrors';
import { describeFailure } from '@/lib/errors';
import { Alert } from '@/components/alert';
import { moodFromChat } from '@/lib/sprites';
import { useBotLook } from '@/components/useBotLook';
import { useBotName } from '@/components/useBotName';
import { useChatModel } from '@/components/useChatModel';
import { liveRuns, liveRunsReady } from '@/components/liveRuns';
import { keepWorking } from '@/components/busyWatch';
import { leaveAction } from '@/lib/busy';
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
        dispatch({ type: 'failed', message: (e as Error).message, status: (e as HermesError).status });
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

  const submit = async (text: string, images: Attachment[], retry = false) => {
    if (!client) return;
    const tooBig = attachmentProblem(images);
    if (tooBig) return setAttachError(tooBig);
    setAttachError(null);
    pinned.current = true;
    startedAt.current = Date.now();
    dispatch({ type: 'send', text, retry, images: images.map((im) => im.dataUrl) });
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
      } else dispatch({ type: 'failed', message: (e as Error).message, status: (e as HermesError).status, notSent: !runId && (e as HermesError).status === undefined });
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
  // The bot list's "Needs you" follows the approval this chat is showing.
  useEffect(() => liveRuns.setApproval(sessionId, state.approval), [sessionId, state.approval]);

  // Try again: resend your last message to the same chat (it replaces the failed one in the transcript).
  const tryAgain = () => {
    const last = [...state.messages].reverse().find((m) => m.role === 'user' && !m.routine);
    if (!last || !client || (running && !remote)) return;
    void submit(last.content, (last.localImages ?? []).map((dataUrl) => ({ dataUrl })), true);
  };

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
  // Routine cards: collapsed by default; open ones are remembered while this chat is open (in memory, per
  // card), so scrolling away and back keeps them. Leaving the chat resets them (Fix 11).
  const [openCards, setOpenCards] = useState<ReadonlySet<string>>(() => new Set());
  const [flashes, setFlashes] = useState<Record<string, number>>({});
  const cardHeights = useRef<Record<string, number>>({});
  const listHeight = useRef(0);
  const routineCtx = useMemo<RoutineCtx>(
    () => ({
      isOpen: (at) => openCards.has(at),
      toggle: (at) =>
        setOpenCards((cur) => {
          const next = new Set(cur);
          if (!next.delete(at)) next.add(at);
          return next;
        }),
      flash: (at) => flashes[at] ?? 0,
      measured: (at, h) => {
        cardHeights.current[at] = h;
      },
    }),
    [openCards, flashes],
  );
  // A tapped "Notify me" notification: find the routine's card (it can land a few seconds after the push, so
  // reload the history a few times), open it, scroll to it and flash it once. Not found: Routine results.
  const scrolledTo = useRef<string | null>(null);
  const reloads = useRef(0);
  const [reloadTick, setReloadTick] = useState(0);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  useEffect(() => {
    reloads.current = 0;
  }, [focusAt]);
  useEffect(() => {
    if (!focusAt || !client || scrolledTo.current === focusAt) return;
    const index = noteIndex(rows, focusAt);
    const step = focusStep(index >= 0, reloads.current);
    if (step === 'reload') {
      const t = setTimeout(() => {
        reloads.current += 1;
        client
          .messages(sessionId)
          .then((messages) => dispatch({ type: 'loaded', messages }))
          .catch(() => undefined)
          .finally(() => setReloadTick((n) => n + 1));
      }, ROUTINE_FOCUS.everyMs);
      return () => clearTimeout(t);
    }
    scrolledTo.current = focusAt;
    if (step === 'fallback') {
      router.push({ pathname: '/routine-results/[bot]', params: { bot } });
      return;
    }
    pinned.current = false;
    setOpenCards((cur) => new Set(cur).add(focusAt));
    setFlashes((cur) => ({ ...cur, [focusAt]: (cur[focusAt] ?? 0) + 1 }));
    // Scroll once it has opened (its height is then known): 16 below the header, or centred if it's taller than the list.
    // (Not cleared when `rows` changes: this effect has already done its part.)
    setTimeout(() => {
      const at = noteIndex(rowsRef.current, focusAt);
      if (at < 0) return;
      const pos = focusPosition(cardHeights.current[focusAt] ?? 0, listHeight.current, !WEB);
      listRef.current?.scrollToIndex({ index: at, animated: true, ...pos });
    }, ROUTINE_MOTION.expand + 80);
  }, [focusAt, rows, client, sessionId, reloadTick, bot]);
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
  const disconnected = !client && !!state.failure && state.failure.status === undefined && !state.failure.raw.startsWith('No saved key');
  const { color } = useBotLook(bot);
  const name = useBotName(bot);
  const model = useChatModel(bot);
  const onBot = onColor(color);
  useImageDrop(addImages, !!client);
  const attach = (source: PickSource) => void pickImages(source, attached.length).then(addImages).catch((e: Error) => setAttachError(e.message));
  const openAttach = (anchor?: { x: number; y: number }) =>
    PICK_SOURCES.length === 1
      ? attach(PICK_SOURCES[0].source)
      : Menu.show('Add a picture', [...PICK_SOURCES.map((p) => ({ text: p.label, onPress: () => attach(p.source) })), { text: 'Cancel', style: 'cancel' as const }], anchor);
  const warming = useConnectorWarmup(bot);
  const retryIn = useRetryCountdown(!client && !!state.failure, attempt);

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
      onLayout={WEB ? (e) => setPaneHeight(e.nativeEvent.layout.height) : undefined}
    >
      <ChatHeader bot={bot} pane={inPane} list={list} model={model} />
      {model.problem ? <ModelBanner bot={bot} problem={model.problem} /> : null}
      {state.failure && describeFailure(state.failure, name).place === 'banner' ? (
        <FailureBanner failure={state.failure} name={name} secondsToRetry={retryIn} onRetry={() => setAttempt((n) => n + 1)} onPair={() => router.push('/add')} />
      ) : null}
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
        extraData={[answering, routineCtx]}
        onLayout={(e) => {
          listHeight.current = e.nativeEvent.layout.height;
        }}
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
            approval={{ busy: answering, onAnswer: answer, onAgain: tryAgain, onNewChat: () => void startNewChat(bot), name }}
            routine={routineCtx}
          />
        )}
      />
      {/* connection and key problems are a banner under the nav (above); a failed turn is a card in the transcript */}
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

export { deleteChat, onChatsChanged, renameChat } from '@/components/chatActions';

/** The chat's routine cards: which are open, which flash, and where they were measured. */
type RoutineCtx = { isOpen: (at: string) => boolean; toggle: (at: string) => void; flash: (at: string) => number; measured: (at: string, h: number) => void };

type RowCtx = { busy: boolean; onAnswer: (c: ApprovalChoice) => void; onAgain: () => void; onNewChat: () => void; name: string };

function Row({ row, bot, since, gap, approval, routine }: { row: ChatRow; bot: string; since: number; gap: number; approval: RowCtx; routine: RoutineCtx }) {
  return (
    <View style={{ marginTop: gap }}>
      <RowBody row={row} bot={bot} since={since} approval={approval} routine={routine} />
    </View>
  );
}

function RowBody({ row, bot, since, approval, routine }: { row: ChatRow; bot: string; since: number; approval: RowCtx; routine: RoutineCtx }) {
  switch (row.kind) {
    case 'message':
      if (row.message.routine) return <RoutineNoteView note={row.message.routine} bot={bot} ctx={routine} />;
      return row.message.role === 'user' ? <Mine message={row.message} bot={bot} /> : <Reply text={row.message.content} bot={bot} />;
    case 'activity':
      return <Activity tools={row.tools} live={row.live} />;
    case 'pending':
      return row.text ? <Reply text={row.text} bot={bot} /> : <TypingRow bot={bot} since={since} />;
    case 'approval':
      return <ApprovalCard request={row.request} bot={bot} busy={approval.busy} onAnswer={approval.onAnswer} />;
    case 'failure':
      return <FailureCard failure={row.failure} bot={bot} name={approval.name} onAgain={approval.onAgain} onNewChat={approval.onNewChat} onRetryUnsent={approval.onAgain} />;
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

/** A "Notify me" routine's result in the chat: a collapsible card (components/RoutineCard.tsx). */
function RoutineNoteView({ note, bot, ctx }: { note: NonNullable<ChatMessage['routine']>; bot: string; ctx: RoutineCtx }) {
  const { color } = useBotLook(bot);
  return (
    <RoutineCard
      name={note.name}
      when={whenLabel(note.at)}
      text={note.text}
      color={color}
      expanded={ctx.isOpen(note.at)}
      onToggle={() => ctx.toggle(note.at)}
      highlight={ctx.flash(note.at)}
      onLayoutHeight={(h) => ctx.measured(note.at, h)}
    />
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
