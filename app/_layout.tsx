import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { applyInitialOrientation, OrientationController } from '@/components/useLayoutClass';
import { colors } from '@/lib/theme';

// Decide portrait lock from the first window size, before the first paint.
applyInitialOrientation();

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <OrientationController />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Dork Bot' }} />
        <Stack.Screen name="add" options={{ title: 'Add a bot', presentation: 'modal' }} />
        <Stack.Screen name="chat/[bot]" options={{ title: '' }} />
      </Stack>
    </>
  );
}
