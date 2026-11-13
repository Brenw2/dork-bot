import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AvatarExport } from '@/components/avatars';
import { isDesktop } from '@/components/desktop';
import { DialogHost } from '@/components/Dialogs';
import { NotificationRoutes } from '@/components/notifications';
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
      <NotificationRoutes />
      <AvatarExport />
      <DialogHost />
    </TestInsets>
  );
}

// Screens that pop up over the app: a sheet on the phone, a panel over the dimmed app on desktop.
const POPUPS = new Set(['new', 'add', 'connect', 'notifications', 'look/[bot]', 'connectors/[bot]', 'model/[bot]', 'chats/[bot]', 'routines/[bot]', 'routine-results/[bot]', 'work/[bot]', 'work-session/[bot]', 'bot/[bot]']);

// The panel's own title; a bot's name goes under it (components/Overlay.tsx, components/Sheet.tsx).
const TITLES: Record<string, string> = {
  'look/[bot]': 'Look',
  'connectors/[bot]': 'Connectors',
  'model/[bot]': 'Model',
  'chats/[bot]': 'Chats',
  'routines/[bot]': 'Routines',
  'routine-results/[bot]': 'Routine results',
  'work/[bot]': 'Work',
  'work-session/[bot]': 'Work',
  'bot/[bot]': 'Bot settings',
};

/** The desktop panel (or, for the bot sheet, the popover under the chat title). */
function PopupOverlay({ route, title, children }: { route: { name: string; params?: object }; title: string | undefined; children: ReactNode }) {
  const bot = (route.params as { bot?: string } | undefined)?.bot;
  return (
    <Overlay title={TITLES[route.name] ?? title ?? ''} bot={bot} popover={route.name === 'bot/[bot]'}>
      {children}
    </Overlay>
  );
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
                <PopupOverlay route={route} title={options.title}>{children}</PopupOverlay>
              ) : (
                children
              )
          : undefined
      }
    >
      {/* The bot list draws its own header (large title on the phone, sidebar header on desktop and the open Duo). */}
      <Stack.Screen name="index" options={{ title: 'Dork Bot', headerShown: false }} />
      <Stack.Screen name="new" options={popup('New bot')} />
      <Stack.Screen name="add" options={popup('Add with a code')} />
      <Stack.Screen name="connect" options={popup('Hermes')} />
      {/* The chat draws its own one-row header (components/ChatHeader.tsx). */}
      <Stack.Screen name="chat/[bot]" options={{ title: '', headerShown: false }} />
      <Stack.Screen name="bot/[bot]" options={popup('Bot settings')} />
      <Stack.Screen name="look/[bot]" options={popup('Look')} />
      <Stack.Screen name="gallery" options={{ title: 'Gallery' }} />
      <Stack.Screen name="connectors/[bot]" options={popup('Connectors')} />
      <Stack.Screen name="model/[bot]" options={popup('Model')} />
      <Stack.Screen name="chats/[bot]" options={popup('Chats')} />
      <Stack.Screen name="routines/[bot]" options={popup('Routines')} />
      <Stack.Screen name="routine-results/[bot]" options={popup('Routine results')} />
      <Stack.Screen name="work/[bot]" options={popup('Work')} />
      <Stack.Screen name="work-session/[bot]" options={popup('Work')} />
      <Stack.Screen name="notifications" options={popup('Notifications')} />
    </Stack>
  );
}
