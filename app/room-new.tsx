import { Stack } from 'expo-router';
import { isDesktop } from '@/components/desktop';
import { RoomNew } from '@/components/RoomNew';

// A sheet on the phone (its own Cancel | title | Create bar), a panel on desktop.
export default function NewRoomScreen() {
  return (
    <>
      {!isDesktop ? <Stack.Screen options={{ headerShown: false }} /> : null}
      <RoomNew />
    </>
  );
}
