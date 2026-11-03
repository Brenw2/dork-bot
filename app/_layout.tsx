import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TestInsets } from '@/components/TestInsets';
import { applyInitialOrientation, OrientationController } from '@/components/useLayoutClass';
import { colors } from '@/lib/theme';

// Decide portrait lock from the first window size, before the first paint.
applyInitialOrientation();

export default function RootLayout() {
  return (
    <TestInsets>
      <StatusBar style="light" />
      <OrientationController />
      <Screens />
    </TestInsets>
  );
}

function Screens(): ReactNode {
  // The iPhone Duo has an 84 pt status rail on one side (right when closed, either side when open in
  // landscape). The header avoids it by itself; screen content doesn't, so every screen is inset here.
  const { left, right } = useSafeAreaInsets();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg, paddingLeft: left, paddingRight: right },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Dork Bot' }} />
      <Stack.Screen name="new" options={{ title: 'New bot', presentation: 'modal' }} />
      <Stack.Screen name="add" options={{ title: 'Add with a code', presentation: 'modal' }} />
      <Stack.Screen name="connect" options={{ title: 'Hermes', presentation: 'modal' }} />
      <Stack.Screen name="chat/[bot]" options={{ title: '' }} />
      <Stack.Screen name="look/[bot]" options={{ title: "Look", presentation: "modal" }} />
      <Stack.Screen name="gallery" options={{ title: 'Gallery' }} />
      <Stack.Screen name="connectors/[bot]" options={{ title: 'Connectors', presentation: 'modal' }} />
    </Stack>
  );
}
