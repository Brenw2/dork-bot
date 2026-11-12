import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { BotSprite } from '@/components/BotSprite';
import { useBusyWatch } from '@/components/busyWatch';
import { ChatActions, ChatView } from '@/components/ChatView';
import { openChat } from '@/components/currentChat';
import { WorkingOn } from '@/components/WorkingOn';
import { useBotLook } from '@/components/useBotLook';
import { useBotName } from '@/components/useBotName';
import { colors } from '@/lib/theme';
import { useLayoutClass } from '@/components/useLayoutClass';
import { CHAT_MAX_WIDTH, foldNavFor } from '@/lib/layoutClass';

export default function ChatScreen() {
  const { bot, chat, at } = useLocalSearchParams<{ bot: string; chat?: string; at?: string }>();
  // A link to one chat (a notification): open that one.
  useEffect(() => {
    if (chat) openChat(bot, chat);
  }, [bot, chat]);
  const name = useBotName(bot);
  const cls = useLayoutClass();
  useBusyWatch();
  const prevCls = useRef(cls);

  // Unfolding to two panes: go back to the list with this chat open in the right pane.
  useEffect(() => {
    const action = foldNavFor(prevCls.current, cls, { pushedChat: bot, selected: null });
    prevCls.current = cls;
    if (action?.type === 'show-in-pane') router.dismissTo({ pathname: '/', params: { bot: action.bot } });
  }, [cls, bot]);

  return (
    <>
      <Stack.Screen
        options={{
          title: name,
          headerTitle: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <BotSprite bot={bot} size={28} />
              <View>
                <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }} numberOfLines={1}>
                  {name}
                </Text>
                <WorkingOn bot={bot} />
              </View>
            </View>
          ),
          // iOS 26+ wraps header buttons, the back button included, in a grey liquid-glass capsule.
          // Hand them over as custom items with that background turned off, so they look like the
          // in-pane ones (the bot's color, no capsule). Swipe-back still works. Other platforms keep
          // the plain header buttons.
          ...(Platform.OS === 'ios'
            ? {
                headerBackVisible: false,
                unstable_headerLeftItems: () => [{ type: 'custom' as const, element: <BackToBots bot={bot} />, hidesSharedBackground: true }],
                unstable_headerRightItems: () => [{ type: 'custom' as const, element: <ChatActions bot={bot} />, hidesSharedBackground: true }],
              }
            : { headerRight: () => <ChatActions bot={bot} /> }),
        }}
      />
      <ChatView bot={bot} focusAt={at} maxWidth={cls === 'compact' ? undefined : CHAT_MAX_WIDTH} />
    </>
  );
}

/** "‹ Bots": back to the bot list, drawn by the app so iOS doesn't put it in a glass capsule. */
function BackToBots({ bot }: { bot: string }) {
  const { color } = useBotLook(bot);
  return (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      accessibilityRole="button"
      accessibilityLabel="Back to the bots"
      hitSlop={10}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 2 }, pressed && { opacity: 0.6 }]}
    >
      <Text style={{ color, fontSize: 28, lineHeight: 30, marginTop: -3 }}>‹</Text>
      <Text style={{ color, fontSize: 17 }}>Bots</Text>
    </Pressable>
  );
}
