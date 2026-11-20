import { useLocalSearchParams } from 'expo-router';
import { RoomChat } from '@/components/RoomChat';
import { useLayoutClass } from '@/components/useLayoutClass';
import { CHAT_MAX_WIDTH } from '@/lib/layoutClass';

// The header (back, members, ⋯) is the room's own one-row header, drawn by RoomChat inside the shared ScreenFrame
// (RoomHeader in components/RoomChat.tsx), like the bot chat. The route is headerShown: false in app/_layout.tsx.
export default function RoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const cls = useLayoutClass();
  return <RoomChat id={id} maxWidth={cls === 'compact' ? undefined : CHAT_MAX_WIDTH} />;
}
