// The header every sheet (phone) and panel (desktop) shares (docs/design/REVIEW.md, fix 8): a centered
// title with the bot's name under it, Done on the right (or Cancel on the left for forms), and the
// sheet's create action (New chat, New routine) as an icon on the left. A screen puts <Sheet .../>
// in its tree; on the phone that sets the native header, on desktop the panel (Overlay) reads it.
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/AppIcons';
import { isDesktop } from '@/components/desktop';
import { useBotLook } from '@/components/useBotLook';
import { useBotName } from '@/components/useBotName';
import { headerSides } from '@/lib/headerItems';
import { colors } from '@/lib/theme';

export interface SheetAction {
  label: string;
  icon: IconName;
  onPress: () => void;
}

let action: SheetAction | null = null;
const listeners = new Set<() => void>();
const setAction = (a: SheetAction | null) => {
  action = a;
  listeners.forEach((fn) => fn());
};

/** The open panel's create action (desktop). */
export function useSheetAction(): SheetAction | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => action,
  );
}

const dismiss = () => (router.canGoBack() ? router.back() : router.replace('/'));

/**
 * `bot`: the sheet belongs to a bot (its color on the buttons, its name under the title); without it the
 * app accent. `close`: "done" for a list, "cancel" for a form that commits with its own button.
 * Pass a stable `action` (useMemo) so the header isn't rebuilt on every render.
 */
export function Sheet({
  title,
  bot,
  action: create,
  close = 'done',
  commit,
}: {
  title: string;
  bot?: string;
  action?: SheetAction;
  close?: 'done' | 'cancel';
  /** A form's commit ("Save", "Create"): semibold on the right of the header (a small primary button in a desktop panel). */
  commit?: { label: string; onPress: () => void; disabled?: boolean };
}) {
  const { color: botColor } = useBotLook(bot ?? '');
  const color = bot ? botColor : colors.accent;
  const name = useBotName(bot ?? '');
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const hasCommit = !!commit;
  const commitLabel = commit?.label;
  const commitOff = !!commit?.disabled;
  const panelAction = useMemo<SheetAction | null>(
    () => create ?? (hasCommit ? { label: commitLabel ?? '', icon: 'check', onPress: () => !commitOff && commitRef.current?.onPress() } : null),
    [create, hasCommit, commitLabel, commitOff],
  );
  useEffect(() => {
    setAction(panelAction);
    return () => setAction(null);
  }, [panelAction]);
  if (isDesktop) return null;
  return (
    <Stack.Screen
      options={{
        title,
        headerTitleAlign: 'center',
        headerBackVisible: false,
        headerTitle: () => (title ? <SheetTitle title={title} subtitle={bot ? name : undefined} /> : null),
        ...headerSides({
          left: create ? (
            <HeaderIcon icon={create.icon} label={create.label} color={color} onPress={create.onPress} />
          ) : close === 'cancel' ? (
            <TextButton label="Cancel" color={color} bold={false} />
          ) : null,
          right: hasCommit ? (
            <TextButton label={commitLabel ?? ''} color={commitOff ? colors.faint : color} bold onPress={() => !commitOff && commitRef.current?.onPress()} />
          ) : close === 'done' ? (
            <TextButton label="Done" color={color} bold />
          ) : null,
        }),
      }}
    />
  );
}

function SheetTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.titleBlock} accessibilityRole="header">
      <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={1.4}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle} numberOfLines={1} maxFontSizeMultiplier={1.4}>{subtitle}</Text> : null}
    </View>
  );
}

function TextButton({ label, color, bold, onPress = dismiss }: { label: string; color: string; bold: boolean; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8} style={({ pressed }) => [styles.textButton, pressed && { opacity: 0.6 }]}>
      <Text style={[styles.textButtonText, { color }, bold && { fontWeight: '600' }]} maxFontSizeMultiplier={1.4}>{label}</Text>
    </Pressable>
  );
}

/** A 44 x 44 icon button for a header. */
export function HeaderIcon({ icon, label, color, onPress }: { icon: IconName; label: string; color: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.6 }]}>
      <Icon name={icon} size={24} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  titleBlock: { alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  title: { color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '600' },
  subtitle: { color: colors.dim, fontSize: 12, lineHeight: 15 },
  textButton: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  textButtonText: { fontSize: 17 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
