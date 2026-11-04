import { useEffect, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { colors } from '@/lib/theme';

/**
 * Desktop app: a pop-up screen (Look, Model, Connectors, New bot…) as a panel over the dimmed app,
 * instead of a full page. Click outside it, ✕, or Esc closes it. The phone keeps its sheets.
 */
export function Overlay({ title, children }: { title: string; children: ReactNode }) {
  const { width, height } = useWindowDimensions();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    globalThis.addEventListener?.('keydown', onKey);
    return () => globalThis.removeEventListener?.('keydown', onKey);
  }, []);

  return (
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" accessible={false} />
      <View
        style={[styles.panel, { width: Math.min(560, width - 32), height: Math.min(760, height - 48) }]}
        accessibilityRole="none"
        aria-modal
        role="dialog"
        aria-label={title}
      >
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Pressable onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>
        <View style={styles.body}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)' },
  panel: {
    backgroundColor: colors.bg,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '600' },
  close: { color: colors.dim, fontSize: 18, paddingHorizontal: 4 },
  body: { flex: 1 },
});
