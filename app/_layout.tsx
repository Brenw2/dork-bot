import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isDesktop } from '@/components/desktop';
import { DialogHost } from '@/components/Dialogs';
import { Overlay } from '@/components/Overlay';
import { TestInsets } from '@/components/TestInsets';
import { applyInitialOrientation, OrientationController } from '@/components/useLayoutClass';
import { colors } from '@/lib/theme';

// A screen that throws shows expo-router's error page with a Retry button, instead of blanking
// the whole window (the desktop app went black on one bad render).
export { ErrorBoundary } from 'expo-router';

// A link straight to a pop-up (dorkbot://connect, a reload on /look/chief) still has the bot list
// under it, so the desktop panel sits over the app and closing it lands somewhere.
export const unstable_settings = { initialRouteName: 'index' };

// Decide portrait lock from the first window size, before the first paint.
applyInitialOrientation();

export default function RootLayout() {
  return (
    <TestInsets>
      <StatusBar style="light" />
      <OrientationController />
      <Screens />
      <DialogHost />
    </TestInsets>
  );
}

// Screens that pop up over the app: a sheet on the phone, a panel over the dimmed app on desktop.
const POPUPS = new Set(['new', 'add', 'connect', 'look/[bot]', 'connectors/[bot]', 'model/[bot]']);

function popupTitle(name: string, params: { bot?: string } | undefined, title: string | undefined): string {
  const bot = params?.bot;
  if (bot && name === 'look/[bot]') return `${bot}'s look`;
  if (bot && name === 'connectors/[bot]') return `${bot}'s connectors`;
  return title || '';
}

function Screens(): ReactNode {
  // The iPhone Duo has an 84 pt status rail on one side (right when closed, either side when open in
  // landscape). The header avoids it by itself; screen content doesn't, so every screen is inset here.
  const { left, right } = useSafeAreaInsets();
  const popup = (title: string) =>
    isDesktop
      ? { title, presentation: 'transparentModal' as const, headerShown: false, animation: 'fade' as const, contentStyle: { backgroundColor: 'transparent' } }
      : { title, presentation: 'modal' as const };
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg, paddingLeft: left, paddingRight: right },
      }}
      screenLayout={
        isDesktop
          ? ({ route, options, children }) =>
              POPUPS.has(route.name) ? (
                <Overlay title={popupTitle(route.name, route.params as { bot?: string }, options.title)}>{children}</Overlay>
              ) : (
                children
              )
          : undefined
      }
    >
      <Stack.Screen name="index" options={{ title: 'Dork Bot' }} />
      <Stack.Screen name="new" options={popup('New bot')} />
      <Stack.Screen name="add" options={popup('Add with a code')} />
      <Stack.Screen name="connect" options={popup('Hermes')} />
      <Stack.Screen name="chat/[bot]" options={{ title: '' }} />
      <Stack.Screen name="look/[bot]" options={popup('Look')} />
      <Stack.Screen name="gallery" options={{ title: 'Gallery' }} />
      <Stack.Screen name="connectors/[bot]" options={popup('Connectors')} />
      <Stack.Screen name="model/[bot]" options={popup('Model')} />
    </Stack>
  );
}
