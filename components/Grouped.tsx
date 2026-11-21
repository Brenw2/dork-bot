// Grouped lists (docs/design/REVIEW.md, fix 9): rows in one #1A1C20 container with radius 12, at least
// 52 tall, hairline separators inset 16 (60 when a row has a leading icon or avatar), section headers
// 13/18 uppercase dim. Used by the bot sheet, Chats, Connectors, Model, Notifications, Look and New bot.
import { Children, isValidElement, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from '@/components/AppIcons';
import { makeStyles, useTheme } from '@/components/theme';
import { maxScale } from '@/lib/type';

/** The separator inset for rows that have a leading icon or avatar. */
export const LEADING_INSET = 60;

export function Group({ children, style, inset = 16 }: { children: ReactNode; style?: StyleProp<ViewStyle>; inset?: number }) {
  const styles = useStyles();
  const { theme, depth, colors } = useTheme();
  const items = Children.toArray(children).filter(isValidElement);
  const inner = (
    <View style={[styles.group, theme.pixel ? { borderWidth: 1, borderColor: colors.border } : style]}>
      {items.map((child, i) => (
        <View key={i}>
          {i > 0 ? <View style={[styles.sep, { marginLeft: inset }]} /> : null}
          {child}
        </View>
      ))}
    </View>
  );
  // Arcade: the pressable edge is a shadow, and the group clips its rows (overflow hidden), which would clip the
  // shadow too, so the edge sits on a wrapper with the same corners.
  return theme.pixel ? <View style={[{ borderRadius: theme.pixel.radii.card, backgroundColor: colors.card }, depth(), style]}>{inner}</View> : inner;
}

/** A section header over a group: 13/18 uppercase dim, +0.3 tracking, 32 from the left, 18 above and 7 below. Arcade: Silkscreen. */
export function GroupHeader({ children }: { children: string }) {
  const styles = useStyles();
  const { px } = useTheme();
  const pixel = !!px();
  return (
    <Text style={[styles.header, px()]} accessibilityRole="header" maxFontSizeMultiplier={pixel ? maxScale.mono : maxScale.body}>
      {children}
    </Text>
  );
}

/** The 13 dim note under a group. */
export function GroupFootnote({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <Text style={styles.footnote}>{children}</Text>;
}

/**
 * A row: label (and an optional 13/18 detail under it, value, ›), a `leading` icon or avatar, or a custom
 * `right` such as a switch or a small button.
 */
export function GroupRow({
  label,
  detail,
  detailColor,
  value,
  onPress,
  right,
  leading,
  destructive,
  chevron,
  accessibilityLabel,
}: {
  label: string;
  detail?: string;
  detailColor?: string;
  value?: string;
  onPress?: () => void;
  right?: ReactNode;
  leading?: ReactNode;
  destructive?: boolean;
  chevron?: boolean;
  accessibilityLabel?: string;
}) {
  const { colors, label: say } = useTheme();
  const styles = useStyles();
  const body = (
    <>
      {leading}
      <View style={styles.text}>
        <Text style={[styles.label, destructive && { color: colors.bad }]} numberOfLines={1}>
          {say(label)}
        </Text>
        {detail ? (
          <Text style={[styles.detail, detailColor ? { color: detailColor } : null]} numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={styles.value} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {right}
      {chevron ? <Icon name="chevron" size={16} color={colors.disclosure} stroke={2.4} /> : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? [label, detail, value].filter(Boolean).join(', ')}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.raised }]}
    >
      {body}
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors }) => StyleSheet.create({
  group: { backgroundColor: colors.card, borderRadius: 12, overflow: 'hidden' },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 16, paddingVertical: 8 },
  text: { flex: 1, minWidth: 0 },
  label: { color: colors.text, fontSize: 17, lineHeight: 22 },
  detail: { color: colors.dim, fontSize: 13, lineHeight: 18 },
  value: { flexShrink: 1, color: colors.dim, fontSize: 17, lineHeight: 22 },
  chevron: { color: colors.disclosure, fontSize: 17 },
  header: { color: colors.dim, fontSize: 13, lineHeight: 18, letterSpacing: 0.3, textTransform: 'uppercase', marginLeft: 32, marginTop: 18, marginBottom: 7 },
  footnote: { color: colors.dim, fontSize: 13, lineHeight: 18, marginHorizontal: 32, marginTop: 7 },
}));
