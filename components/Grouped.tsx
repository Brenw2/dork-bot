// Grouped lists (docs/design/REVIEW.md, fix 9): rows in one #1A1C20 container with radius 12, at least
// 52 tall, hairline separators inset 16 (or 60 with a leading icon or avatar). Used by the bot sheet
// and the Chats sheet.
import { Children, isValidElement, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '@/lib/theme';

export function Group({ children, style, inset = 16 }: { children: ReactNode; style?: StyleProp<ViewStyle>; inset?: number }) {
  const items = Children.toArray(children).filter(isValidElement);
  return (
    <View style={[styles.group, style]}>
      {items.map((child, i) => (
        <View key={i}>
          {i > 0 ? <View style={[styles.sep, { marginLeft: inset }]} /> : null}
          {child}
        </View>
      ))}
    </View>
  );
}

/** A row: label (and optional value and ›), or a custom `right` such as a switch. */
export function GroupRow({
  label,
  value,
  onPress,
  right,
  destructive,
  chevron,
  accessibilityLabel,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  right?: ReactNode;
  destructive?: boolean;
  chevron?: boolean;
  accessibilityLabel?: string;
}) {
  const body = (
    <>
      <Text style={[styles.label, destructive && { color: colors.bad }]} numberOfLines={1} maxFontSizeMultiplier={1.4}>
        {label}
      </Text>
      {value ? (
        <Text style={styles.value} numberOfLines={1} maxFontSizeMultiplier={1.4}>
          {value}
        </Text>
      ) : null}
      {right}
      {chevron ? <Text style={styles.chevron}>›</Text> : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? (value ? `${label}, ${value}` : label)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.raised }]}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: { backgroundColor: colors.card, borderRadius: 12, overflow: 'hidden' },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52, paddingHorizontal: 16 },
  label: { flex: 1, color: colors.text, fontSize: 17, lineHeight: 22 },
  value: { flexShrink: 1, color: colors.dim, fontSize: 17, lineHeight: 22 },
  chevron: { color: colors.disclosure, fontSize: 17 },
});
