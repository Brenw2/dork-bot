import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { BotList } from '@/components/BotList';
import { openChat } from '@/components/currentChat';
import { ChatView } from '@/components/ChatView';
import { RoomChat } from '@/components/RoomChat';
import { isDesktop } from '@/components/desktop';
import { useLayoutClass } from '@/components/useLayoutClass';
import { setListHidden, useListHidden } from '@/components/useListHidden';
import { CHAT_MAX_WIDTH, foldNavFor, SIDEBAR_WIDTH } from '@/lib/layoutClass';
import { colors } from '@/lib/theme';

// Phones, the folded Duo and the open Duo in portrait: the bot list, and a tap pushes the chat.
// Open Duo in landscape and a wide desktop window: a slim bot list on the left, the chat in the
// rest. The chat's header has a button that hides the list, so the chat gets the whole width.
const DESKTOP_TWO_PANE = 720;
const DESKTOP_CHAT_MAX = 820;

export default function Home() {
  const { width } = useWindowDimensions();
  const cls = useLayoutClass();
  const params = useLocalSearchParams<{ bot?: string; chat?: string; at?: string; room?: string }>();
  // A group room open in the right pane (a room push on two panes, or a tap on a room row).
  const [selectedRoom, setSelectedRoom] = useState<string | null>(params.room ?? null);
  useEffect(() => {
    if (params.room) {
      setSelectedRoom(params.room);
      setSelected(null);
    }
  }, [params.room]);
  useEffect(() => {
    if (params.bot && params.chat) openChat(params.bot, params.chat);
  }, [params.bot, params.chat]);
  const [selected, setSelected] = useState<string | null>(params.bot ?? null);
  const listHidden = useListHidden();
  const prevCls = useRef(cls);

  const desktopWide = isDesktop && width >= DESKTOP_TWO_PANE;
  const prevDesktopWide = useRef(desktopWide);

  useEffect(() => {
    if (params.bot) setSelected(params.bot);
  }, [params.bot]);

  // Folding while two panes are open: carry the open chat into a full-screen chat.
  // (Desktop: the same when the window gets too narrow for two panes.)
  useEffect(() => {
    if (isDesktop) {
      const was = prevDesktopWide.current;
      prevDesktopWide.current = desktopWide;
      if (was && !desktopWide && selected) router.push({ pathname: '/chat/[bot]', params: { bot: selected } });
      return;
    }
    const action = foldNavFor(prevCls.current, cls, { pushedChat: null, selected });
    prevCls.current = cls;
    if (action?.type === 'push-chat') router.push({ pathname: '/chat/[bot]', params: { bot: action.bot } });
  }, [cls, selected, desktopWide]);

  const twoPane = isDesktop ? desktopWide : cls === 'expanded-wide';
  if (!twoPane) {
    return <BotList onSelect={(bot) => router.push({ pathname: '/chat/[bot]', params: { bot } })} />;
  }

  // With no chat open there's nothing to give the room to, so the list always shows.
  const open = selected ?? selectedRoom;
  const showList = !listHidden || !open;
  return (
    <View style={styles.row}>
      {showList ? (
        <View style={styles.sidebar}>
          <BotList
            onSelect={(bot) => {
              setSelectedRoom(null);
              setSelected(bot);
            }}
            selected={selected}
            compact
            onSelectRoom={(room) => {
              setSelected(null);
              setSelectedRoom(room);
            }}
            selectedRoom={selectedRoom}
          />
        </View>
      ) : null}
      <View style={styles.detail}>
        {selectedRoom && !selected ? (
          <RoomChat key={selectedRoom} id={selectedRoom} inPane maxWidth={isDesktop ? DESKTOP_CHAT_MAX : CHAT_MAX_WIDTH} />
        ) : selected ? (
          <ChatView
            key={selected}
            bot={selected}
            inPane
            focusAt={params.bot === selected ? params.at : undefined}
            maxWidth={isDesktop ? DESKTOP_CHAT_MAX : CHAT_MAX_WIDTH}
            list={{ hidden: !showList, toggle: () => setListHidden(showList) }}
          />
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Pick a bot to chat with.</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  sidebar: { width: SIDEBAR_WIDTH, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border },
  detail: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.dim, fontSize: 15 },
});
