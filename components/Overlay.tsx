import { useEffect, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { BotAvatar } from '@/components/BotSprite';
import { Icon } from '@/components/AppIcons';
import { useSheetAction } from '@/components/Sheet';
import { useBotLook } from '@/components/useBotLook';
import { useBotName } from '@/components/useBotName';
import { colors, onColor } from '@/lib/theme';

/**
 * Desktop app: a pop-up screen (Look, Model, Connectors, New bot…) as a panel over the dimmed app,
 * instead of a full page. Click outside it, ✕, or Esc closes it. The phone keeps its sheets.
 * Header (docs/design/REVIEW.md, fix 8): the bot's avatar when the panel belongs to a bot, the title
 * with the bot's name under it, the panel's create action as a small primary button, then ✕.
 * `popover`: the bot sheet, a 360 wide popover under the chat title instead of a centered panel.
 */
export function Overlay({ title, bot, popover = false, children }: { title: string; bot?: string; popover?: boolean; children: ReactNode }) {
  const { width, height } = useWindowDimensions();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const action = useSheetAction();
  const { color } = useBotLook(bot ?? '');
  const name = useBotName(bot ?? '');
  const tint = bot ? color : colors.accent;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    globalThis.addEventListener?.('keydown', onKey);
    return () => globalThis.removeEventListener?.('keydown', onKey);
  }, []);

  if (popover) {
    // Under the chat title: past the 320 sidebar when two panes are open, else near the left edge.
    const left = width >= 720 ? 340 : 16;
    return (
      <View style={StyleSheet.absoluteFill}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" accessible={false} />
        <View style={[styles.popover, { left, width: Math.min(360, width - 32), maxHeight: height - 72 }]} accessibilityRole="none" aria-modal role="dialog" aria-label={title}>
          {children}
        </View>
      </View>
    );
  }

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
          {bot ? <BotAvatar bot={bot} size={32} /> : null}
          <View style={styles.titles}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            {bot ? (
              <Text style={styles.subtitle} numberOfLines={1}>
                {name}
              </Text>
            ) : null}
          </View>
          {action ? (
            <Pressable
              onPress={action.onPress}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              style={({ pressed }) => [styles.action, { backgroundColor: tint }, pressed && { opacity: 0.7 }]}
            >
              <Icon name={action.icon} size={16} color={onColor(tint)} stroke={2.2} />
              <Text style={[styles.actionText, { color: onColor(tint) }]}>{action.label}</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close" style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [styles.close, (hovered || pressed) && { backgroundColor: colors.raised }]}>
            <Icon name="close" size={16} color={colors.dim} stroke={2} />
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
  popover: {
    position: 'absolute',
    top: 52,
    backgroundColor: colors.raised,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.menuBorder,
    overflow: 'hidden',
    boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 60,
    paddingHorizontal: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  titles: { flex: 1 },
  title: { color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '600' },
  subtitle: { color: colors.dim, fontSize: 12, lineHeight: 16 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, borderRadius: 16, paddingHorizontal: 14 },
  actionText: { fontSize: 14, fontWeight: '600' },
  close: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
});
