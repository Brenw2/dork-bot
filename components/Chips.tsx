// Chips, badges and tags (docs/design/UI-KIT.md K9): one of each, so a screen never draws its own.
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { onColor } from '@/lib/theme';
import { makeStyles, useTheme } from '@/components/theme';
import { maxScale } from '@/lib/type';

/**
 * A tappable choice or status: 32 tall, radius 16, padding 12, 13/600. As a choice: selected = `tint` fill with
 * `onColor` text, unselected = a `border` outline. As a status (`status`): card fill, dim text, no outline (the
 * chat's step chip and its answered-approval chip). `leading` / `trailing` are small icons or a spinner.
 */
export function Chip({
  label,
  onPress,
  selected,
  tint,
  status,
  leading,
  trailing,
  disabled,
  accessibilityLabel,
  accessibilityState,
  testID,
  style,
  numberOfLines,
}: {
  label: string;
  testID?: string;
  onPress?: () => void;
  selected?: boolean;
  tint?: string;
  status?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityState?: { expanded?: boolean; selected?: boolean };
  style?: StyleProp<ViewStyle>;
  numberOfLines?: number;
}) {
  const { colors, label: say, theme, px } = useTheme();
  const styles = useStyles();
  const arc = !!theme.pixel;
  // Terminal outlines a status chip (the step and answered-approval chips) with the hairline `border`.
  // Arcade draws a status chip as the kit's tool chip: Silkscreen 10, no outline, radius 9.
  const fill = status ? { backgroundColor: colors.card, ...(theme.shape.square ? { borderColor: colors.border } : null), ...(arc ? { borderWidth: 0, borderRadius: 9, paddingVertical: 4 } : null) } : selected ? { backgroundColor: tint ?? colors.accent, borderColor: tint ?? colors.accent } : { borderColor: colors.border };
  const text = status ? colors.dim : selected ? onColor(tint ?? colors.accent) : colors.text;
  const pixelLabel = arc && status ? [{ fontSize: 10, lineHeight: 14 }, px()] : null;
  const pixelChip = arc && status;
  const body = (
    <>
      {leading}
      <Text style={[styles.chipText, { color: text }, pixelLabel]} numberOfLines={numberOfLines} maxFontSizeMultiplier={pixelChip ? maxScale.mono : maxScale.chrome}>
        {say(label)}
      </Text>
      {trailing}
    </>
  );
  if (!onPress) {
    return (
      <View style={[styles.chip, fill, style]} accessible accessibilityLabel={accessibilityLabel ?? label}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={accessibilityState ?? (selected === undefined ? undefined : { selected })}
      hitSlop={{ top: 6, bottom: 6 }}
      style={({ pressed }) => [styles.chip, fill, pressed && { opacity: 0.7 }, style]}
    >
      {body}
    </Pressable>
  );
}

/** "Needs you": 20 tall, radius 10, `bad` fill, 12 bold, `badgeText` color. List rows, room rows and the transcript. */
export function Badge({ label }: { label: string }) {
  const styles = useStyles();
  const { label: say, theme, px, depth, colors } = useTheme();
  const arc = !!theme.pixel;
  return (
    <View style={[styles.badge, arc && { backgroundColor: colors.needsYou ?? colors.bad, borderRadius: 6, paddingVertical: 4, paddingHorizontal: 6 }, depth()]}>
      <Text style={[styles.badgeText, arc && { fontSize: 9, lineHeight: 12 }, px()]} maxFontSizeMultiplier={arc ? maxScale.mono : maxScale.chrome}>
        {say(label)}
      </Text>
    </View>
  );
}

/** A non-tappable label (a group member held in a room): 22 tall, radius 11, card fill, 12. */
export function Tag({ label, leading, accessibilityLabel }: { label: string; leading?: ReactNode; accessibilityLabel?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.tag} accessible accessibilityLabel={accessibilityLabel ?? label}>
      {leading}
      <Text style={styles.tagText} maxFontSizeMultiplier={maxScale.chrome}>
        {label}
      </Text>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    chip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 7, minHeight: 32, maxWidth: '100%', paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: 'transparent', justifyContent: 'center' },
    chipText: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
    badge: { minHeight: 20, borderRadius: 10, paddingHorizontal: 8, backgroundColor: colors.bad, alignItems: 'center', justifyContent: 'center' },
    badgeText: { color: colors.badgeText, fontSize: 12, fontWeight: '700' },
    tag: { minHeight: 22, borderRadius: 11, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.card },
    tagText: { color: colors.dim, fontSize: 12, fontWeight: '500' },
  }),
);
