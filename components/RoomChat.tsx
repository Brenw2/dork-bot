import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApprovalButtons } from '@/components/ApprovalButtons';
import { Icon } from '@/components/AppIcons';
import { Alert, Menu } from '@/components/alert';
import { Button } from '@/components/Buttons';
import { approvalOrder, useDesk } from '@/components/ChatStatus';
import { HeaderButton, PageHeader } from '@/components/ChatHeader';
import { Badge, Tag } from '@/components/Chips';
import { JumpPill } from '@/components/JumpPill';
import { EmptyState, ErrorBanner } from '@/components/States';
import { distanceFromEnd, jumpVisible } from '@/lib/jumpPill';
import { Composer } from '@/components/Composer';
import { isDesktop } from '@/components/desktop';
import { Markdown } from '@/components/Markdown';
import { MessageMenu, WEB_SELECT } from '@/components/MessageMenu';
import { useOnScreenRoom } from '@/components/notifications';
import { MemberDisc, MemberStack } from '@/components/RoomAvatar';
import { ScreenFrame } from '@/components/ScreenFrame';
import { getSeen, memberLabels, newId, roomLink, sendStore, setSeen } from '@/components/roomsClient';
import { lookFor } from '@/components/useBotLook';
import { loadManager } from '@/components/manager';
import { listBots } from '@/lib/bots';
import { nameOf } from '@/lib/names';
import {
  buildTranscript,
  heldMembers,
  insertMention,
  joinNames,
  mentionQuery,
  RoomPoller,
  sendMessage,
  suggestions,
  tokenizeMentions,
  type Item,
  type PendingAction,
  type Room,
  type RoomEvent,
  type RoomMember,
  type RoomState,
} from '@/lib/rooms';
import type { ApprovalChoice } from '@/lib/hermes';
import { mono, onColor } from '@/lib/theme';
import { makeStyles, useTheme } from '@/components/theme';

// ---------- who is who ----------

export interface MemberInfo {
  name: (m: RoomMember | null, id?: string) => string;
  color: (profile: string) => string;
  job: (profile: string) => string | undefined;
}

/** Display name (Rename…), color (look) and job (the profile's description) for each member. */
export function useMemberInfo(): MemberInfo {
  const [names, setNames] = useState<Record<string, string | undefined>>({});
  const [colorsBy, setColors] = useState<Record<string, string>>({});
  const [jobs, setJobs] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    listBots().then((list) => {
      if (!live) return;
      setNames(Object.fromEntries(list.map((b) => [b.bot, b.displayName])));
      setColors(Object.fromEntries(list.map((b) => [b.bot, lookFor(b.bot, b.look).color])));
    });
    loadManager()
      .then((m) => m?.listProfiles())
      .then((ps) => live && ps && setJobs(Object.fromEntries(ps.map((p) => [p.name, p.description]))))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return useMemo(
    () => ({
      name: (m, id = '') => nameOf(m?.profile ?? id, names[m?.profile ?? id]),
      color: (p) => colorsBy[p] ?? lookFor(p).color,
      job: (p) => jobs[p] || undefined,
    }),
    [names, colorsBy, jobs],
  );
}

// ---------- the header (phone: the screen's header; desktop: drawn in the pane) ----------

const roomInfoListeners = new Set<() => void>();
const changed = () => roomInfoListeners.forEach((f) => f());

/** The room's name and members, for headers. Reloads after a rename. */
export function useRoomInfo(id: string): Room | null {
  const [room, setRoom] = useState<Room | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      roomLink.client
        .roomState(id)
        .then((r) => live && r.room && setRoom(r.room))
        .catch(() => undefined);
    void load();
    roomInfoListeners.add(load);
    return () => {
      live = false;
      roomInfoListeners.delete(load);
    };
  }, [id]);
  return room;
}

function showMembers(room: Room, info: ReturnType<typeof useMemberInfo>) {
  Alert.alert(`${room.members.length} members`, room.members.map((m) => info.name(m)).join('\n') + '\n\nMembers are set when the group is made. Hermes has no way to change them later.');
}

// Tapping the title opens Members (there is no dedicated button).
export function RoomTitle({ room }: { room: Room | null }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const info = useMemberInfo();
  if (!room) return <View style={{ height: 32 }} />;
  return (
    <Pressable
      onPress={() => showMembers(room, info)}
      accessibilityRole="button"
      accessibilityLabel="Members"
      hitSlop={{ top: 6, bottom: 6 }}
      style={({ pressed }) => [styles.titleBlock, pressed && { backgroundColor: colors.raised }, isDesktop && ({ cursor: 'pointer' } as object)]}
    >
      <MemberStack profiles={room.members.map((m) => m.profile)} size={32} />
      <View style={{ flexShrink: 1 }}>
        <Text style={{ color: colors.text, fontSize: isDesktop ? 16 : 16, lineHeight: 20, fontWeight: '600' }} numberOfLines={1} maxFontSizeMultiplier={1.4}>
          {room.name}
        </Text>
        <Text style={{ color: colors.dim, fontSize: 12, lineHeight: 16 }} numberOfLines={1} maxFontSizeMultiplier={1.4}>
          {room.members.map((m) => info.name(m)).join(', ')}
        </Text>
      </View>
    </Pressable>
  );
}

export function RoomActions({ room }: { room: Room | null }) {
  const { colors } = useTheme();
  const info = useMemberInfo();
  if (!room) return null;
  const members = () => showMembers(room, info);
  const rename = () =>
    Alert.prompt(
      'Rename group',
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rename',
          onPress: async (typed?: string) => {
            try {
              await roomLink.client.rename(room.id, typed ?? '');
              changed();
            } catch (e) {
              Alert.alert("Couldn't rename", (e as Error).message);
            }
          },
        },
      ],
      'plain-text',
      room.name,
    );
  const disband = () =>
    Alert.alert(`Disband ${room.name}?`, 'The group and its messages are deleted on Hermes, for every device and Hermes Desktop. The bots stay.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disband',
        style: 'destructive',
        onPress: async () => {
          try {
            await roomLink.client.disband(room.id);
            router.canGoBack() ? router.back() : router.replace('/');
          } catch (e) {
            Alert.alert("Couldn't disband", (e as Error).message);
          }
        },
      },
    ]);
  const more = (anchor?: { x: number; y: number }) =>
    Menu.show(
      room.name,
      [
        { text: 'Rename…', icon: 'pencil', onPress: rename },
        { text: 'Members', icon: 'info', sepBefore: true, onPress: members },
        { text: 'Disband…', icon: 'trash', sepBefore: true, style: 'destructive', onPress: disband },
        { text: 'Cancel', style: 'cancel' },
      ],
      anchor,
    );
  // The same ⋯ circle button as the 1:1 chat header (ChatHeader), on the phone and on desktop. No gear.
  return <HeaderButton icon="ellipsis" color={colors.accent} label={`More for ${room.name}`} onPress={(e) => more({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })} />;
}

// The room's one-row header is the shared PageHeader (components/ChatHeader.tsx), drawn by the screen, not the native
// stack (app/_layout.tsx: room/[id] is headerShown: false). Accent instead of a bot color: a room has no bot context.
export function RoomHeader({ room, pane, list }: { room: Room | null; pane: boolean; list?: { hidden: boolean; toggle: () => void } }) {
  const { colors } = useTheme();
  return (
    <PageHeader pane={pane} list={list} tint={colors.accent} title={<RoomTitle room={room} />}>
      <RoomActions room={room} />
    </PageHeader>
  );
}

// ---------- the room ----------

const MD = /```|^\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\|)/m;

function clockTime(at?: number): string {
  return at ? new Date(at * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
}

function stamp(at: number): { day: string; time: string } {
  const d = new Date(at * 1000);
  const n = new Date();
  const days = Math.round((Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) - Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 86_400_000);
  const day = days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 7 ? d.toLocaleDateString('en-US', { weekday: 'long' }) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return { day, time: clockTime(at) };
}

export function RoomChat({ id, maxWidth, inPane = false, list }: { id: string; maxWidth?: number; inPane?: boolean; list?: { hidden: boolean; toggle: () => void } }) {
  const { colors } = useTheme();
  const styles = useStyles();
  useOnScreenRoom(id);
  const [paneHeight, setPaneHeight] = useState(0);
  const room = useRoomInfo(id);
  const info = useMemberInfo();
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const [state, setState] = useState<RoomState | null>(null);
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [pick, setPick] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const scroll = useRef<{ scrollToEnd: (o?: { animated?: boolean }) => void } | null>(null);
  const poller = useRef<RoomPoller | null>(null);
  const since = useRef(0);
  const bySeq = useRef(new Map<number, RoomEvent>());
  const seenAtOpen = useRef<number | null>(null);
  const workStart = useRef<number | null>(null);
  const [, tickClock] = useState(0);

  const addEvents = useCallback((list: RoomEvent[]) => {
    for (const e of list) bySeq.current.set(e.seq, e);
    const all = [...bySeq.current.values()].sort((a, b) => a.seq - b.seq);
    setEvents(all);
    const top = all.length ? all[all.length - 1].seq : 0;
    if (top) void setSeen(id, top);
  }, [id]);

  // Open: remember what was seen before, resend an unsent message (same event_id), then poll while in the front.
  useEffect(() => {
    let live = true;
    getSeen(id).then((s) => live && (seenAtOpen.current = s));
    sendStore.get(id).then((p) => p && sendMessage(roomLink.client, sendStore, id, p.text, newId).catch(() => undefined));
    const p = new RoomPoller({
      client: roomLink.client,
      roomId: id,
      since: since.current,
      onEvents: addEvents,
      onState: (s) => {
        setState(s);
        setError((e) => (e === "Can't reach Hermes. Trying again…" ? null : e));
      },
      onError: (e) => {
        if (/not found/i.test((e as Error).message)) setGone(true);
        else setError("Can't reach Hermes. Trying again…");
      },
    });
    poller.current = p;
    if (AppState.currentState === 'active') p.start();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') p.start();
      else {
        p.stop(); // nothing polls in the background; the round keeps running on b-lab
        roomLink.close();
      }
    });
    return () => {
      live = false;
      sub.remove();
      p.stop();
    };
  }, [id, addEvents]);

  const working = Object.entries(state?.activity ?? {});
  const busy = state?.working === true || working.length > 0;
  useEffect(() => {
    workStart.current = busy ? (workStart.current ?? Date.now()) : null;
    if (!busy) return;
    const t = setInterval(() => tickClock((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const members = room?.members ?? [];
  const items = useMemo(() => buildTranscript(events, members, (m, mid) => info.name(m, mid)), [events, members, info]);
  const lastUserSeq = useMemo(() => Math.max(0, ...events.filter((e) => e.kind === 'message.user').map((e) => e.seq)), [events]);
  const held = useMemo(() => (busy ? [] : heldMembers(events)), [events, busy]);
  const approvals = (state?.pending ?? []).filter((p) => p.kind === 'approval');

  // Follow the end while the reader is at the end; scrolled up, keep their place and offer "Jump to latest" (K13).
  const pinned = useRef(true);
  const viewport = useRef(0);
  const distance = useRef(0);
  const [unseen, setUnseen] = useState(false);
  const [farUp, setFarUp] = useState(false);
  const onScroll = (e: { nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } } }) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    viewport.current = layoutMeasurement.height;
    distance.current = distanceFromEnd({ inverted: false, offset: contentOffset.y, content: contentSize.height, viewport: layoutMeasurement.height });
    pinned.current = distance.current < 80;
    if (pinned.current) setUnseen(false);
    setFarUp(distance.current > layoutMeasurement.height);
  };
  const jumpToLatest = () => {
    pinned.current = true;
    setUnseen(false);
    setFarUp(false);
    scroll.current?.scrollToEnd({ animated: true });
  };
  const newest = items.length ? items[items.length - 1] : null;
  useEffect(() => {
    if (newest?.type === 'user') pinned.current = true; // your own message always shows
    if (!pinned.current) {
      if (items.length || approvals.length) setUnseen(true);
      return;
    }
    const t = setTimeout(() => scroll.current?.scrollToEnd({ animated: false }), 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, approvals.length]);

  // @-mention autocomplete
  const q = mentionQuery(text, caret);
  const sugg = useMemo(() => (q ? suggestions(members, q.query, (m) => info.name(m), (m) => info.job(m.profile)) : []), [q?.query, q?.start, members, info]);
  useEffect(() => setPick(0), [q?.query]);
  const choose = (handle: string) => {
    const next = insertMention(text, caret, handle);
    setText(next.text);
    setCaret(next.caret);
  };

  const send = async (raw = text) => {
    const body = raw.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      await sendMessage(roomLink.client, sendStore, id, body, newId);
      if (raw === text) setText('');
      void poller.current?.tick();
    } catch {
      setError("Couldn't send. Tap Send to try again.");
    } finally {
      setSending(false);
    }
  };

  const stop = async () => {
    try {
      await roomLink.client.stop(id, newId());
      void poller.current?.tick();
    } catch (e) {
      setError(`Couldn't stop: ${(e as Error).message}`);
    }
  };

  const answer = async (a: PendingAction, choice: string) => {
    try {
      await roomLink.client.approve(id, a, choice);
      void poller.current?.tick();
    } catch (e) {
      setError(`Couldn't answer: ${(e as Error).message}`);
    }
  };

  // The @-mention picker takes the arrows, Enter and Tab first; with no picker open the composer's own
  // Enter-to-send (desktop) runs, the same as the one-to-one chat.
  const onKey = (e: { nativeEvent: { key: string; shiftKey?: boolean; isComposing?: boolean }; preventDefault?: () => void }) => {
    if (!sugg.length) return false;
    const k = e.nativeEvent.key;
    if (k === 'ArrowDown') setPick((p) => Math.min(p + 1, sugg.length - 1));
    else if (k === 'ArrowUp') setPick((p) => Math.max(p - 1, 0));
    else if (k === 'Enter' || k === 'Tab') {
      e.preventDefault?.();
      choose(sugg[pick].handle);
    }
    return true;
  };

  const column = maxWidth ? { width: '100%' as const, maxWidth, alignSelf: 'center' as const } : null;
  const placeholder = held.length ? '@mention a bot, or @all to resume' : `Message ${room?.name ?? 'the group'}`;
  const canSend = text.trim().length > 0 && !sending;

  if (gone) {
    return (
      <View style={[styles.screen, styles.center]}>
        <Text style={styles.goneTitle}>This group is gone</Text>
        <Text style={styles.goneText}>It was disbanded on Hermes.</Text>
        <Button label="Back to bots" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={{ marginTop: 8 }} />
      </View>
    );
  }

  return (
    <ScreenFrame
      onLayout={(e) => Platform.OS === 'web' && setPaneHeight(e.nativeEvent.layout.height)}
      header={<RoomHeader room={room} pane={inPane} list={list} />}
      composer={
        <Composer
          value={text}
          onChangeText={(t) => {
            // Typing at the end moves the caret with it (the selection event can lag a frame behind).
            if (caret >= text.length) setCaret(t.length);
            setText(t);
          }}
          above={sugg.length ? (
            <View style={[styles.popover, isDesktop && { width: 360, right: undefined }]} accessibilityRole="menu">
              {sugg.map((s, i) => (
                <View key={s.handle}>
                  {s.kind === 'all' && i > 0 ? <View style={styles.popLine} /> : null}
                  <Pressable onPress={() => choose(s.handle)} accessibilityRole="menuitem" style={[styles.popRow, isDesktop && { height: 40 }, i === pick && { backgroundColor: colors.menuHover }]}>
                    {s.kind === 'all' ? (
                      <View style={[styles.allDisc, isDesktop && { width: 26, height: 26 }]}>
                        <Text style={{ color: colors.accent, fontSize: 13 }}>👥</Text>
                      </View>
                    ) : (
                      <MemberDisc bot={members.find((m) => m.handle === s.handle)?.profile ?? s.handle} size={isDesktop ? 26 : 28} />
                    )}
                    <Text style={styles.popName}>{s.label}</Text>
                    <Text style={styles.popHandle}>@{s.handle}</Text>
                    <Text style={styles.popJob} numberOfLines={1}>{s.kind === 'all' ? `All ${members.length} members` : (s.job ?? '')}</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
          onSend={() => void send()}
          canSend={canSend}
          placeholder={placeholder}
          label={`Message ${room?.name ?? 'the group'}`}
          color={colors.accent}
          stop={busy ? { onPress: () => void stop(), label: 'Stop the room' } : undefined}
          paneHeight={paneHeight}
          column={column}
          onKey={onKey}
          onSelectionChange={setCaret}
        />
      }
    >
      <View style={{ flex: 1 }}>
      <ScrollView
        ref={scroll as never}
        style={{ flex: 1 }}
        contentContainerStyle={[styles.transcript, column]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        onScroll={onScroll}
        scrollEventThrottle={32}
      >
        {items.map((it, i) => (
          <Row key={it.seq} roomId={id} it={it} prev={items[i - 1]} info={info} members={members} unanswered={it.type === 'member' && it.needsYou && it.seq > lastUserSeq} />
        ))}
        {approvals.map((a, i) => (
          <ApprovalCard key={`${a.taskId}${i}`} a={a} member={members.find((m) => m.memberId === a.memberId) ?? null} room={room?.name ?? 'the group'} info={info} onAnswer={(c) => answer(a, c)} />
        ))}
        {!items.length && !busy ? <EmptyState body="No messages yet. Say something, or @mention a bot to ask just that one." /> : null}
      </ScrollView>
      <JumpPill visible={jumpVisible({ distanceFromEnd: farUp ? distance.current : 0, viewport: viewport.current, unseen })} onPress={jumpToLatest} />
      </View>

      {busy || held.length ? (
        <View style={[styles.strip, column]}>
          {busy ? (
            <>
              <View style={styles.stripLeft}>
                {working.map(([mid, status], i) => {
                  const m = members.find((x) => x.memberId === mid) ?? null;
                  const waiting = approvals.some((a) => a.memberId === mid);
                  return (
                    <View key={mid} style={styles.stripItem}>
                      {i > 0 ? <Text style={styles.stripDot}>·</Text> : null}
                      <MemberDisc bot={m?.profile ?? mid} size={20} mood={waiting ? 'idle' : 'thinking'} />
                      <Text style={styles.stripName} numberOfLines={1}>{info.name(m, mid)}</Text>
                      <Text style={styles.stripState}>{waiting ? 'is waiting for your OK' : status === 'queued' ? 'is up next' : 'is working'}</Text>
                    </View>
                  );
                })}
                {!working.length ? <Text style={styles.stripState}>Working…</Text> : null}
              </View>
              {workStart.current && Date.now() - workStart.current >= 10_000 ? <Text style={styles.stripState}>{Math.floor((Date.now() - workStart.current) / 1000)} s</Text> : null}
            </>
          ) : (
            <>
              <View style={styles.stripLeft}>
                {held.map((mid) => {
                  const m = members.find((x) => x.memberId === mid || x.profile === mid) ?? null;
                  return (
                    <Tag key={mid} label="Held" accessibilityLabel={`${info.name(m, mid)} is held`} leading={<MemberDisc bot={m?.profile ?? mid} size={18} mood="sleeping" />} />
                  );
                })}
              </View>
              <Pressable onPress={() => void send('@all resume')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Resume all">
                <Text style={styles.resume}>Resume all</Text>
              </Pressable>
            </>
          )}
        </View>
      ) : null}

      {error ? <ErrorBanner text={error} /> : null}
    </ScreenFrame>
  );
}

// ---------- rows ----------

function Row({ roomId, it, prev, info, members, unanswered }: { roomId: string; it: Item; prev?: Item; info: MemberInfo; members: RoomMember[]; unanswered: boolean }) {
  const styles = useStyles();
  const sep = prev && 'at' in prev && 'at' in it && prev.at && it.at && it.at - prev.at > 1800 ? stamp(it.at) : !prev && 'at' in it && it.at ? stamp(it.at) : null;
  return (
    <>
      {sep ? (
        <Text style={styles.sep}>
          <Text style={{ fontWeight: '600' }}>{sep.day}</Text> {sep.time}
        </Text>
      ) : null}
      {it.type === 'system' ? (
        <Text style={styles.system}>{it.text}</Text>
      ) : it.type === 'user' ? (
        <MessageMenu text={it.text} raw style={styles.bubble}>
          <Text style={styles.bubbleText} selectable={WEB_SELECT}>
            <Mentions text={it.text} members={members} info={info} />
          </Text>
        </MessageMenu>
      ) : (
        <MemberMessage roomId={roomId} it={it} info={info} members={members} unanswered={unanswered} />
      )}
    </>
  );
}

function MemberMessage({ roomId, it, info, members, unanswered }: { roomId: string; it: Extract<Item, { type: 'member' }>; info: MemberInfo; members: RoomMember[]; unanswered: boolean }) {
  const styles = useStyles();
  const profile = it.member?.profile ?? it.actorId;
  const color = info.color(profile);
  return (
    <View style={[styles.msg, { marginTop: it.grouped ? 4 : 14 }]}>
      {unanswered ? <View style={styles.needsBar} /> : null}
      <View style={styles.gutter}>{it.grouped ? null : <MemberDisc bot={profile} size={28} />}</View>
      <View style={{ flex: 1 }}>
        {it.grouped ? null : (
          <View style={styles.nameLine}>
            <Text style={[styles.speaker, { color }]}>{info.name(it.member, it.actorId)}</Text>
            <Text style={styles.time}>{clockTime(it.at)}</Text>
            {unanswered ? <Badge label="Needs you" /> : null}
          </View>
        )}
        <MessageMenu text={it.text} raw={!MD.test(it.text)}>
          {MD.test(it.text) ? (
            <Markdown text={it.text} accent={color} />
          ) : (
            <Text style={styles.body} selectable={WEB_SELECT}>
              <Mentions text={it.text} members={members} info={info} />
            </Text>
          )}
        </MessageMenu>
      </View>
    </View>
  );
}

/** Text with each known @mention in its bot's color (semibold). @all/@everyone and @user in accent. Unknown @words stay plain. */
function Mentions({ text, members, info }: { text: string; members: RoomMember[]; info: MemberInfo }) {
  const { colors } = useTheme();
  return (
    <>
      {tokenizeMentions(text, members).map((s, i) =>
        s.kind === 'plain' ? (
          s.text
        ) : (
          <Text key={i} style={{ fontWeight: '600', color: s.kind === 'member' ? info.color(members.find((m) => m.handle === s.handle)?.profile ?? s.handle) : colors.accent }}>
            {s.kind === 'you' ? '@you' : s.text}
          </Text>
        ),
      )}
    </>
  );
}

const CHOICE: Record<string, string> = { once: 'Allow once', session: 'Allow in this chat', always: 'Always allow', deny: 'Deny' };

function ApprovalCard({ a, member, room, info, onAnswer }: { a: PendingAction; member: RoomMember | null; room: string; info: MemberInfo; onAnswer: (c: string) => void }) {
  const { colors, mix } = useTheme();
  const styles = useStyles();
  const profile = member?.profile ?? a.memberId;
  const color = info.color(profile);
  const choices = a.choices.length ? a.choices : ['once', 'deny'];
  const [done, setDone] = useState(false);
  const desk = useDesk();
  return (
    <View style={[styles.approval, { borderColor: mix(color, 0.55) }]} accessibilityLiveRegion="polite">
      <View style={styles.apHead}>
        <MemberDisc bot={profile} size={28} />
        <View style={{ flex: 1 }}>
          <Text style={styles.apTitle}>{a.command ? 'Run this command?' : 'Needs your OK'}</Text>
          <Text style={styles.apSub}>{info.name(member, a.memberId)} needs your OK in {room}</Text>
        </View>
      </View>
      {a.command ? (
        <ScrollView horizontal style={styles.apCode} contentContainerStyle={{ padding: 10 }}>
          <Text style={styles.apCommand} selectable>{a.command}</Text>
        </ScrollView>
      ) : null}
      {a.description ? <Text style={styles.apWhy}>Hermes flagged it: {a.description}</Text> : null}
      <ApprovalButtons choices={approvalOrder(choices as ApprovalChoice[], desk)} labels={CHOICE} color={color} desk={desk} disabled={done} dim={done} onAnswer={(c) => { setDone(true); onAnswer(c); }} />
      <Text style={styles.apNote}>Answers right away. No answer counts as Deny.</Text>
    </View>
  );
}

const BODY = isDesktop ? 16 : 17;

const useStyles = makeStyles(({ colors, mix }) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  goneTitle: { color: colors.text, fontSize: 20, fontWeight: '600' },
  goneText: { color: colors.dim, fontSize: 15 },
  titleBlock: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, paddingVertical: 4, paddingHorizontal: 6, maxWidth: '100%' },
  transcript: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 },
  sep: { alignSelf: 'center', color: colors.dim, fontSize: 12, lineHeight: 16, fontWeight: '500', marginTop: 14 },
  system: { alignSelf: 'center', color: colors.dim, fontSize: 13, lineHeight: 18, textAlign: 'center', marginTop: 14, paddingHorizontal: 16 },
  bubble: { alignSelf: 'flex-end', maxWidth: '82%', marginTop: 14, backgroundColor: mix(colors.accent, 0.3), borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  bubbleText: { color: colors.text, fontSize: BODY, lineHeight: isDesktop ? 24 : 22 },
  msg: { flexDirection: 'row', gap: 8 },
  gutter: { width: 28 },
  needsBar: { position: 'absolute', left: -10, top: 0, bottom: 0, width: 3, borderRadius: 2, backgroundColor: colors.bad },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 18 },
  speaker: { fontSize: 14, lineHeight: 18, fontWeight: '600' },
  time: { color: colors.dim, fontSize: 12, lineHeight: 16 },
  body: { color: colors.text, fontSize: BODY, lineHeight: 24 },
  approval: { marginTop: 12, marginLeft: 36, padding: 12, gap: 10, borderRadius: 16, borderWidth: 1.5, backgroundColor: colors.card },
  apHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  apTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  apSub: { color: colors.dim, fontSize: 13, lineHeight: 18 },
  apCode: { flexGrow: 0, borderRadius: 8, backgroundColor: colors.code },
  apCommand: { color: colors.text, fontFamily: mono, fontSize: 13, lineHeight: 20 },
  apWhy: { color: colors.dim, fontSize: 13, lineHeight: 18 },
  apNote: { color: colors.dim, fontSize: 13, lineHeight: 18 },
  strip: { flexDirection: 'row', alignItems: 'center', minHeight: 36, paddingHorizontal: 16, gap: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  stripLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  stripItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stripName: { color: colors.text, fontSize: 13, fontWeight: '500' },
  stripState: { color: colors.dim, fontSize: 13, lineHeight: 18 },
  stripDot: { color: colors.dim, fontSize: 13, marginHorizontal: 2 },
  resume: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  popover: { position: 'absolute', left: 12, right: 12, bottom: '100%', marginBottom: 4, backgroundColor: colors.raised, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.menuBorder, overflow: 'hidden' },
  popRow: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12 },
  popLine: { height: StyleSheet.hairlineWidth, backgroundColor: colors.menuBorder, marginHorizontal: 12 },
  popName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  popHandle: { color: colors.dim, fontSize: 13 },
  popJob: { flex: 1, textAlign: 'right', color: colors.faint, fontSize: 12 },
  allDisc: { width: 28, height: 28, borderRadius: 14, backgroundColor: mix(colors.accent, 0.25), alignItems: 'center', justifyContent: 'center' },
}));
