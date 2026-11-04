import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform, Text, View } from 'react-native';
import { BotSprite } from '@/components/BotSprite';
import { ChatView, ConnectorsButton } from '@/components/ChatView';
import { colors } from '@/lib/theme';
import { useLayoutClass } from '@/components/useLayoutClass';
import { CHAT_MAX_WIDTH, foldNavFor } from '@/lib/layoutClass';

export default function ChatScreen() {
  const { bot } = useLocalSearchParams<{ bot: string }>();
  const cls = useLayoutClass();
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
          title: bot,
          headerTitle: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <BotSprite bot={bot} size={28} />
              <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }} numberOfLines={1}>
                {bot}
              </Text>
            </View>
          ),
          // iOS 26+ wraps a plain header button in a grey liquid-glass capsule. Hand the button over
          // as a custom item with that background turned off, so it looks like the in-pane one
          // (the bot's color, no capsule). Other platforms keep the plain headerRight.
          ...(Platform.OS === 'ios'
            ? {
                unstable_headerRightItems: () => [
                  { type: 'custom' as const, element: <ConnectorsButton bot={bot} />, hidesSharedBackground: true },
                ],
              }
            : { headerRight: () => <ConnectorsButton bot={bot} /> }),
        }}
      />
      <ChatView bot={bot} maxWidth={cls === 'compact' ? undefined : CHAT_MAX_WIDTH} />
    </>
  );
}
