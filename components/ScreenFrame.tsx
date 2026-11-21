// The chat screen frame, shared by the 1:1 chat (ChatView) and the group chat (RoomChat) so they can't drift apart:
// header slot, then the transcript slot (children), then the message box (Composer), all inside one
// KeyboardAvoidingView. Both screens draw their own header (`headerShown: false`), so the view starts at the top of
// the screen and the keyboard offset is always 0. Don't compute an offset from a native header: on the real device
// (iOS 26, Duo) that put the message box under the keyboard (card 29).
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { makeStyles } from '@/components/theme';

export const KEYBOARD_OFFSET = 0;

export function ScreenFrame({ header, composer, onLayout, children }: { header: ReactNode; composer: ReactNode; onLayout?: (e: LayoutChangeEvent) => void; children: ReactNode }) {
  const styles = useStyles();
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={KEYBOARD_OFFSET}
      onLayout={onLayout}
    >
      {header}
      {children}
      {composer}
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles(({ colors }) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
}));
