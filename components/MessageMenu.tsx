// Long-press a message (phone): a menu with Copy and Select Text. Select Text opens app/select-text.tsx, the message
// as plain text in a read-only TextInput, which gives the phone's own partial selection (handles, Copy, Look Up,
// Share, Translate). selectable <Text> on iOS can only copy the whole block, and it also swallows the long press.
// Desktop and web: no menu and no Pressable. The text stays selectable with the mouse (drag, Ctrl/Cmd+C), so a
// wrapper must never capture the drag or turn user-select off.
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Platform, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { Menu } from '@/components/alert';
import { plainText } from '@/lib/plainText';

/** Phone only: Text elements are `selectable` on the web build (drag-select), and not on the phone (long-press menu instead). */
export const WEB_SELECT = Platform.OS === 'web';

export function MessageMenu({ text, bot, raw = false, children, style }: { text: string; bot?: string; /** Not markdown (what you typed): select and copy the exact characters. */ raw?: boolean; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  if (WEB_SELECT) return <View style={style}>{children}</View>;
  const open = () =>
    Menu.show('Message', [
      { text: 'Copy', icon: 'copy', onPress: () => void Clipboard.setStringAsync(raw ? text : plainText(text)) },
      { text: 'Select Text', icon: 'search', onPress: () => router.push({ pathname: '/select-text', params: { text, ...(bot ? { bot } : null), ...(raw ? { raw: '1' } : null) } }) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  // accessible={false}: the message's own links and Copy buttons stay reachable by VoiceOver.
  return (
    <Pressable onLongPress={open} delayLongPress={350} accessible={false} style={style}>
      {children}
    </Pressable>
  );
}
