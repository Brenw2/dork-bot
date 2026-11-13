import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useBusyWatch } from '@/components/busyWatch';
import { ChatView } from '@/components/ChatView';
import { openChat } from '@/components/currentChat';
import { useLayoutClass } from '@/components/useLayoutClass';
import { CHAT_MAX_WIDTH, foldNavFor } from '@/lib/layoutClass';

// The header (back, bot, model, Chats, ⋯) is the chat's own one-row header: components/ChatHeader.tsx.
export default function ChatScreen() {
  const { bot, chat, at } = useLocalSearchParams<{ bot: string; chat?: string; at?: string }>();
  // A link to one chat (a notification): open that one.
  useEffect(() => {
    if (chat) openChat(bot, chat);
  }, [bot, chat]);
  const cls = useLayoutClass();
  useBusyWatch();
  const prevCls = useRef(cls);

  // Unfolding to two panes: go back to the list with this chat open in the right pane.
  useEffect(() => {
    const action = foldNavFor(prevCls.current, cls, { pushedChat: bot, selected: null });
    prevCls.current = cls;
    if (action?.type === 'show-in-pane') router.dismissTo({ pathname: '/', params: { bot: action.bot } });
  }, [cls, bot]);

  return <ChatView bot={bot} focusAt={at} maxWidth={cls === 'compact' ? undefined : CHAT_MAX_WIDTH} />;
}
