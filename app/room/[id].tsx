import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Platform, Pressable, Text } from 'react-native';
import { RoomActions, RoomChat, RoomTitle, useRoomInfo } from '@/components/RoomChat';
import { useLayoutClass } from '@/components/useLayoutClass';
import { CHAT_MAX_WIDTH } from '@/lib/layoutClass';
import { headerSides } from '@/lib/headerItems';
import { colors } from '@/lib/theme';

export default function RoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const room = useRoomInfo(id);
  const cls = useLayoutClass();
  return (
    <>
      <Stack.Screen
        options={{
          title: room?.name ?? 'Group',
          headerTitle: () => <RoomTitle room={room} />,
          // Same as the bot chat: the back button is drawn by the app (no iOS 26 glass capsule), in the app accent.
          ...(Platform.OS === 'ios' ? { headerBackVisible: false } : {}),
          ...headerSides({ left: Platform.OS === 'ios' ? <BackToBots /> : undefined, right: <RoomActions room={room} /> }),
        }}
      />
      <RoomChat id={id} maxWidth={cls === 'compact' ? undefined : CHAT_MAX_WIDTH} />
    </>
  );
}

function BackToBots() {
  return (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      accessibilityRole="button"
      accessibilityLabel="Back to the bots"
      hitSlop={10}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 2 }, pressed && { opacity: 0.6 }]}
    >
      <Text style={{ color: colors.accent, fontSize: 28, lineHeight: 30, marginTop: -3 }}>‹</Text>
      <Text style={{ color: colors.accent, fontSize: 17 }}>Bots</Text>
    </Pressable>
  );
}
