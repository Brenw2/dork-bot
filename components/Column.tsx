import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isDesktop } from '@/components/desktop';
import { useLayoutClass } from '@/components/useLayoutClass';
import { CHAT_MAX_WIDTH, FOLD } from '@/lib/layoutClass';

/**
 * Where a form or message screen puts its content:
 * - phones and the folded Duo: the full width (already inside the rail inset, see app/_layout.tsx),
 * - open Duo, portrait: a centered column, like the chat,
 * - open Duo, landscape: the left pane, so nothing sits on the fold.
 */
export function useColumnStyle(): ViewStyle {
  const cls = useLayoutClass();
  const { left } = useSafeAreaInsets();
  // Desktop: no fold to avoid; pop-ups are panels that already set the width.
  if (isDesktop) return { width: '100%' };
  if (cls === 'expanded-wide') return { width: FOLD.listSize - left, alignSelf: 'flex-start' };
  if (cls === 'expanded-narrow') return { width: '100%', maxWidth: CHAT_MAX_WIDTH, alignSelf: 'center' };
  return { width: '100%' };
}

export function Column({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.fill, useColumnStyle(), style]}>{children}</View>;
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
